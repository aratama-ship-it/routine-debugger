"use strict";

// ---------- 定数 ----------
const EVENT_TYPES = [
  { id: "drop_recovered", label: "ドロップ(復帰)", desc: "落としたが拾って続行", abort: false },
  { id: "wobble",         label: "乱れ(回収)",     desc: "崩れたが立て直した",   abort: false },
  { id: "avoid",          label: "回避",           desc: "安全のため技を飛ばした", abort: false },
  { id: "not_attempted",  label: "実施できなかった", desc: "直前の失敗などで、この技を実施できなかった", abort: false },
  { id: "drop_abort",     label: "ドロップ(中止)", desc: "落として通しを止めた", abort: true },
];
const HYPOTHESIS_TAGS = ["集中切れ", "疲労", "技術ミス", "環境(風/床/光)", "道具", "緊張"];
const FEELINGS = [
  { v: 3, label: "良い" }, { v: 2, label: "普通" }, { v: 1, label: "悪い" },
];
// リスク度: 自分が事前に感じる「この技はどれくらい失敗しそうか」(1=かなり安全 〜 5=かなり危険)。
// 実際の失敗率とのズレ(認識と結果の乖離)を見るための主観指標。1〜5の5段階。
const RISK_LEVELS = [1, 2, 3, 4, 5];
const RISK_LABEL = { 1: "リスク1", 2: "リスク2", 3: "リスク3", 4: "リスク4", 5: "リスク5" };
// 旧データ(負荷 low/mid/high)からの移行マップ
const LEGACY_LOAD_TO_RISK = { low: 2, mid: 3, high: 4 };
const MIN_N_FOR_PATTERN = 8; // これ未満の到達数は「観測不足」として件数のみ強調

const APP_VERSION = "v168"; // 要望フォーム等で自動送信するアプリ版
const RUN_VIDEO_LIMIT = 5; // アプリ全体。6本目は自動削除せず、保存時に入れ替える
const RUN_VIDEO_BPS = 1500000; // 通し映像は振り返りやすさと容量のバランスを取り、約720pで記録
// 開発中は、保存映像と同じ横長4:3と、画面いっぱいに見せる9:16を撮影前に比較できるようにする。
// 4:3は通常の横長保存、9:16は縦長出力を優先する。
const RUN_CAMERA_PROFILES = {
  wide: { id: "wide", label: "4:3 横長", width: 960, height: 720, ratio: 4 / 3, cssRatio: "4 / 3", resizeMode: "none" },
  vertical: { id: "vertical", label: "9:16 縦長", width: 720, height: 1280, ratio: 9 / 16, cssRatio: "9 / 16", resizeMode: "crop-and-scale" },
};
const ITEM_LINE_COLORS = ["blue", "rust", "olive", "mustard", "plum", "gray", "teal", "rose", "violet"];
const ITEM_LINE_COLOR_LABELS = {
  blue: ["紺", "Navy"], rust: ["朱", "Rust"], olive: ["オリーブ", "Olive"],
  mustard: ["黄土", "Mustard"], plum: ["葡萄", "Plum"], gray: ["墨", "Gray"],
  teal: ["青緑", "Teal"], rose: ["茜", "Rose"], violet: ["紫", "Violet"],
};
// 機能の要望・バグ報告の送信先(GASウェブアプリURL)。空のままだとメール送信にフォールバックする。
// 設定手順は FEEDBACK_GAS_SETUP.md 参照。デプロイ後、末尾が /exec のURLをここに貼る。
const FEEDBACK_ENDPOINT = "";
const FEEDBACK_MAILTO = "circusarata@gmail.com"; // フォールバック送信先

// ---------- 状態 ----------
let state = { v: 1, routines: [], sessions: [] };
let view = { name: "home", params: {} };
// 記録画面の一時状態(未確定の通し)
let openRun = null; // { routineId, versionId, events: [] }

const $app = document.getElementById("app");
const $sheet = document.getElementById("sheet");
const $backdrop = document.getElementById("sheet-backdrop");
const $toast = document.getElementById("toast");

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// 練習日は端末の現地日付で扱う。toISOString()だと日本時間の0〜8時台が前日になる。
const localDateString = (value = Date.now()) => {
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const today = () => localDateString();
const isEnglish = () => (state.settings || {}).language === "en";
const uiText = (value) => isEnglish() && window.RoutineI18n ? window.RoutineI18n.text(value) : String(value ?? "");
// 初期サンプルの固有名・メモだけを表示言語へ合わせる。
// 保存値は日本語のまま保持し、利用者が作った同名データを誤って翻訳しない。
const sampleDisplayText = (value, marker) => {
  const text = String(value ?? "");
  const isSampleContent = marker === true || !!(marker && (marker.sampleSet || marker.sample || marker.sampleContent));
  return isSampleContent ? uiText(text) : text;
};
const routineDisplayName = (routine) => sampleDisplayText(routine?.name, routine);
const routineDisplayMemo = (routine) => sampleDisplayText(routine?.memo, routine);
const trickDisplayName = (trick) => sampleDisplayText(trick?.name, trick);
const appConfirm = (message) => window.confirm(uiText(message));
const appAlert = (message) => window.alert(uiText(message));
function applyUiLanguage(root = document) {
  const language = isEnglish() ? "en" : "ja";
  document.documentElement.lang = language;
  document.title = language === "en" ? "Routine Note" : "ルーティンノート";
  if (language === "en" && window.RoutineI18n) window.RoutineI18n.apply(root);
}

// ---------- 永続化 (IndexedDB, localStorageフォールバック) ----------
const DB_NAME = "routine-debugger", STORE = "kv";
let db = null;

function openDb() {
  return new Promise((resolve) => {
    if (!window.indexedDB) return resolve(null);
    let settled = false;
    const finish = (value) => {
      if (settled) { if (value) value.close(); return; }
      settled = true;
      resolve(value);
    };
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs");
    };
    req.onsuccess = () => {
      const opened = req.result;
      opened.onversionchange = () => { opened.close(); if (db === opened) db = null; };
      finish(opened);
    };
    req.onerror = () => finish(null);
    // 別タブが旧DBを開いたままでも、初期画面を永久にローディングさせない。
    req.onblocked = () => finish(null);
  });
}
// 音声Blob(楽曲MP3/練習録音)はstateとは別ストアに保存。JSONバックアップには含まれない
function blobPut(id, blob) {
  return new Promise((resolve) => {
    if (!db) return resolve(false);
    const tx = db.transaction("blobs", "readwrite");
    tx.objectStore("blobs").put(blob, id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}
function blobGet(id) {
  return new Promise((resolve) => {
    if (!db) return resolve(null);
    const rq = db.transaction("blobs", "readonly").objectStore("blobs").get(id);
    rq.onsuccess = () => resolve(rq.result || null);
    rq.onerror = () => resolve(null);
  });
}
function blobDel(id) {
  return new Promise((resolve) => {
    if (!db) return resolve(false);
    const tx = db.transaction("blobs", "readwrite");
    tx.objectStore("blobs").delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}
// 旧データ(負荷 load: low/mid/high)を リスク度(risk: 1〜5)へ移行
function migrateState() {
  let sampleDataChanged = false;
  let routineSettingsChanged = false;
  let itemColorsChanged = false;
  let runVideoStateChanged = false;
  if (!Array.isArray(state.sessions)) state.sessions = [];
  if (!Array.isArray(state.tricks)) state.tricks = []; // 技ライブラリ(動画クリップ)
  if (!Array.isArray(state.audios)) state.audios = []; // 音源ライブラリ(楽曲・録音)。ルーティンへはコピーして添付
  if (!Array.isArray(state.runVideos)) { state.runVideos = []; runVideoStateChanged = true; }
  if (!state.settings) state.settings = {}; // アプリ設定(動画品質など)
  if (!Array.isArray(state.feedback)) state.feedback = []; // 送信した要望・バグ報告の控え(この端末のみ)
  // v133: 名前付きタグは廃止し、カード左端の一本線だけを識別色として保持する。
  // v132で試したタグがあれば、最初に付けたタグの色だけを線色へ引き継ぐ。
  const legacyTags = new Map((Array.isArray(state.entityTags) ? state.entityTags : [])
    .filter((tag) => tag && validBackupId(tag.id)).map((tag) => [tag.id, tag]));
  for (const item of [...(state.routines || []), ...state.tricks]) {
    const legacyColor = (Array.isArray(item.tagIds) ? item.tagIds : [])
      .map((id) => legacyTags.get(id)?.color).find((color) => ITEM_LINE_COLORS.includes(color));
    const nextColor = ITEM_LINE_COLORS.includes(item.lineColor) ? item.lineColor : (legacyColor || "blue");
    if (item.lineColor !== nextColor || Object.prototype.hasOwnProperty.call(item, "tagIds")) itemColorsChanged = true;
    item.lineColor = nextColor;
    delete item.tagIds;
  }
  if (Object.prototype.hasOwnProperty.call(state, "entityTags")) { delete state.entityTags; itemColorsChanged = true; }
  // 技のトリム情報を補完(fullDuration=元動画の長さ, trimStart/trimEnd=有効区間, duration=有効区間の長さ)
  for (const t of state.tricks) {
    if (t.fullDuration == null) t.fullDuration = t.duration;
    if (t.trimStart == null) t.trimStart = 0;
    if (t.trimEnd == null) t.trimEnd = t.fullDuration;
  }
  // 音源も動画と同じく、元の長さと有効区間を別々に持つ。旧データは全区間を有効として扱う。
  for (const a of state.audios) normalizeMusicMeta(a);
  for (const rt of state.routines || []) {
    // v91: 右上の「個別設定」はルーティンごとに保持する。
    // 旧データは、それまで使っていた全体設定を初期値として引き継ぐ。
    if (!rt.featureSettings) {
      rt.featureSettings = defaultRoutineFeatures();
      routineSettingsChanged = true;
    }
    if (rt.music) normalizeMusicMeta(rt.music);
    for (const ver of rt.versions || []) {
      for (const st of ver.steps || []) {
        if (rt.sampleSet && !st.sampleContent) { st.sampleContent = true; sampleDataChanged = true; }
        for (const option of st.options || []) {
          if (rt.sampleSet && !option.sampleContent) { option.sampleContent = true; sampleDataChanged = true; }
        }
        if (!ITEM_LINE_COLORS.includes(st.lineColor)) { st.lineColor = "blue"; itemColorsChanged = true; }
        // リスク度は任意(2026-07-17〜)。旧「負荷」だけは引き継ぎ、未設定はそのまま未設定にする
        if (st.risk == null && st.load) st.risk = LEGACY_LOAD_TO_RISK[st.load] || 3;
        delete st.load;
        // 旧A/Bステップにステップ共通の動画が残っている場合は、選択肢Aの動画として引き継ぐ。
        // 以降は各選択肢がそれぞれ独立した動画リンクを持つ。
        if (isSlot(st) && st.trickId) {
          if (!st.options[0].trickId) st.options[0].trickId = st.trickId;
          delete st.trickId;
          routineSettingsChanged = true;
        }
        // A/Bは複数の「技」から選ぶステップ。旧データで種別が欠けている／移行になっている場合も技へ統一する。
        if (isSlot(st) && st.kind !== "trick") {
          st.kind = "trick";
          routineSettingsChanged = true;
        }
      }
    }
  }
  // サンプルルーティンは、実際の分析画面まで最初から確認できるデモ履歴を持たせる。
  // v1→v2→v3の構成変更と、版ごとに分かれた分析を初回から体験できるようにする。
  for (const rt of state.routines || []) {
    if (rt.sampleSet && rt.memo == null) {
      rt.memo = "次回は4ボール前の呼吸を一定にし、A/Bを同じ本数ずつ試す。";
      sampleDataChanged = true;
    }
    if (linkSampleOptionVideos(rt)) sampleDataChanged = true;
    const upgraded = ensureSampleVersionDemo(rt);
    if (upgraded) {
      // 自動生成した旧デモ履歴だけ作り直す。本人が記録した通しは最新構成に残す。
      state.sessions = state.sessions.filter((s) => !(s.routineId === rt.id && s.sampleHistory));
      rt.sampleHistorySeeded = false;
      sampleDataChanged = true;
    }
    if (seedSampleHistory(rt, upgraded)) sampleDataChanged = true;
  }
  return sampleDataChanged || routineSettingsChanged || itemColorsChanged || runVideoStateChanged;
}

function normalizeMusicMeta(meta, knownFull) {
  if (!meta) return meta;
  if (meta.fullDuration == null && knownFull != null) meta.fullDuration = knownFull;
  if (meta.fullDuration == null && meta.duration != null) meta.fullDuration = meta.duration;
  if (meta.trimStart == null) meta.trimStart = 0;
  if (meta.trimEnd == null && meta.fullDuration != null) meta.trimEnd = meta.fullDuration;
  if (meta.duration == null && meta.trimEnd != null) meta.duration = Math.max(0, meta.trimEnd - meta.trimStart);
  return meta;
}
async function loadState() {
  db = await openDb();
  let idbState = null;
  if (db) {
    idbState = await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly").objectStore(STORE).get("state");
      tx.onsuccess = () => resolve(tx.result || null);
      tx.onerror = () => resolve(null);
    });
  }
  let localState = null;
  try {
    const raw = localStorage.getItem("rd_state");
    if (raw) localState = JSON.parse(raw);
  } catch (_) { /* 初回 */ }

  // IndexedDB書き込みが中断された場合でも、同期保存された新しいlocalStorage側を採用する。
  if (localState && (!idbState || Number(localState._savedAt || 0) > Number(idbState._savedAt || 0))) state = localState;
  else if (idbState) state = idbState;
  if (migrateState()) saveState();
}
let saveTimer = null;
let storageWarningShown = false;
function persistStateNow() {
  saveTimer = null;
  state._savedAt = Date.now();
  let localOk = false;
  try { localStorage.setItem("rd_state", JSON.stringify(state)); localOk = true; } catch (_) {}
  if (db) {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(state, "state");
      tx.onerror = tx.onabort = () => {
        if (!localOk && !storageWarningShown) {
          storageWarningShown = true;
          setTimeout(() => toast("端末に保存できませんでした。空き容量をご確認ください"), 0);
        }
      };
    } catch (_) {
      if (!localOk && !storageWarningShown) {
        storageWarningShown = true;
        setTimeout(() => toast("端末に保存できませんでした。空き容量をご確認ください"), 0);
      }
    }
  } else if (!localOk && !storageWarningShown) {
    storageWarningShown = true;
    setTimeout(() => toast("端末に保存できませんでした。空き容量をご確認ください"), 0);
  }
}
function flushStateSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  persistStateNow();
}
function saveState() {
  state._savedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistStateNow, 120);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushStateSave(); });
window.addEventListener("pagehide", flushStateSave);

// ---------- 統計 ----------
function wilson(k, n, z = 1.96) {
  if (n === 0) return null;
  const p = k / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
  return [Math.max(0, center - half), Math.min(1, center + half)];
}
const pct = (x) => Math.round(x * 100);

function getVersion(routine, versionId) {
  return routine.versions.find((v) => v.id === versionId) || routine.versions[routine.versions.length - 1];
}
function latestVersion(routine) { return routine.versions[routine.versions.length - 1]; }
function cloneRoutineSteps(steps) {
  return (steps || []).map((step) => ({
    ...step,
    options: Array.isArray(step.options) ? step.options.map((option) => ({ ...option })) : undefined,
  }));
}

function runsOfVersion(routineId, versionId) {
  const runs = [];
  for (const s of state.sessions) {
    if (s.routineId !== routineId || s.versionId !== versionId) continue;
    s.runs.forEach((r, i) => runs.push({ ...r, session: s, runNo: i + 1 }));
  }
  return runs;
}

// 選択スロット: step.options([{id,name,risk}] 2つ以上)を持つステップ。
// 通しごとに「どれを選んだか」を run.choices[stepId] に記録し、選択肢別の分母を作る
const isSlot = (st) => Array.isArray(st.options) && st.options.length >= 2;
const stepDisplayName = (st) => sampleDisplayText(st?.name, st);
const optionDisplayName = (option) => sampleDisplayText(option?.name, option);
const stepLabel = (st) => isSlot(st)
  ? (stepDisplayName(st) || st.options.map(optionDisplayName).join("/"))
  : stepDisplayName(st);
const runChoice = (run, st) => run.choices ? run.choices[st.id] : undefined;

function defaultRoutineFeatures() {
  return {
    showRisk: !!(state.settings && state.settings.showRisk),
    showSlots: !!(state.settings && state.settings.showSlots),
  };
}

function routineFeatureEnabled(rt, key, settingsOverride = null) {
  const settings = settingsOverride || (rt && rt.featureSettings);
  if (settings && Object.prototype.hasOwnProperty.call(settings, key)) return !!settings[key];
  return !!(state.settings && state.settings[key]);
}

function versionStats(routine, versionId) {
  const ver = getVersion(routine, versionId);
  const allRuns = runsOfVersion(routine.id, versionId);
  const excluded = allRuns.filter((r) => r.excluded).length;
  const runs = allRuns.filter((r) => !r.excluded); // 集計除外を反映
  const total = runs.length;
  const clean = runs.filter((r) => r.outcome === "clean").length;
  // ステップ別: 未実施は「予定地点へ到達したが試行できなかった」として失敗から分離する。
  // 失敗率の分母は実施回数、未実施率の分母は到達数。直前の失敗による連鎖で次の技の失敗率を歪めない。
  const steps = ver.steps.map((st, i) => {
    const reachedRuns = runs.filter((r) => r.reachedIndex >= i);
    const actualFailure = (r) => r.events.some((e) => e.stepIndex === i && e.type !== "not_attempted");
    const onlyNotAttempted = (r) => !actualFailure(r) && r.events.some((e) => e.stepIndex === i && e.type === "not_attempted");
    const unattempted = reachedRuns.filter(onlyNotAttempted).length;
    const attempted = reachedRuns.length - unattempted;
    const failRuns = reachedRuns.filter(actualFailure).length;
    const row = {
      step: st, index: i, reached: reachedRuns.length, attempted, unattempted,
      failed: failRuns, ci: wilson(failRuns, attempted),
    };
    if (isSlot(st)) {
      // 選択肢別も同じく、失敗率の分母から未実施を除く。
      row.options = st.options.map((opt) => {
        const optRuns = runs.filter((r) => r.reachedIndex >= i && runChoice(r, st) === opt.id);
        const optFailed = optRuns.filter(actualFailure).length;
        const optUnattempted = optRuns.filter(onlyNotAttempted).length;
        const optAttempted = optRuns.length - optUnattempted;
        return {
          opt, reached: optRuns.length, attempted: optAttempted, unattempted: optUnattempted,
          failed: optFailed, ci: wilson(optFailed, optAttempted),
        };
      });
      row.choiceUnknown = runs.filter((r) => r.reachedIndex >= i && !runChoice(r, st)).length;
    }
    return row;
  });
  // 回復率 = 継続できた失敗 / 全失敗イベント(回避と未実施は除外)
  let recov = 0, fails = 0;
  for (const r of runs) for (const e of r.events) {
    if (e.type === "avoid" || e.type === "not_attempted") continue;
    fails++;
    if (e.type !== "drop_abort") recov++;
  }
  // 内訳: 何本目か / 体調
  const byRunNo = [["1〜3本目", (r) => r.runNo <= 3], ["4〜6本目", (r) => r.runNo >= 4 && r.runNo <= 6], ["7本目〜", (r) => r.runNo >= 7]]
    .map(([label, f]) => { const g = runs.filter(f); return { label, n: g.length, clean: g.filter((r) => r.outcome === "clean").length }; });
  const byFeeling = FEELINGS.map((fl) => {
    const g = runs.filter((r) => r.session.feeling === fl.v);
    return { label: `体調: ${fl.label}`, n: g.length, clean: g.filter((r) => r.outcome === "clean").length };
  });
  // 仮説タグ集計
  const tagCount = {};
  for (const r of runs) for (const e of r.events) for (const t of e.tags || []) tagCount[t] = (tagCount[t] || 0) + 1;
  return { ver, runs, total, clean, cleanCi: wilson(clean, total), steps, recov, fails, byRunNo, byFeeling, tagCount, excluded };
}

// ---------- シート/トースト ----------
function showSheet(html, variant = "") {
  $sheet.innerHTML = `<div class="grabber"></div>` + html;
  $sheet.classList.toggle("trim-sheet", variant === "trim-sheet");
  $sheet.classList.remove("hidden");
  $backdrop.classList.remove("hidden");
  applyUiLanguage($sheet);
  if (typeof bindAllTrimVideos === "function") bindAllTrimVideos(); // シート内の技動画にトリム適用
}
function releaseSheetMedia() {
  stopRunVideoAudioSync();
  $sheet.querySelectorAll("audio,video").forEach((media) => {
    media.pause();
    media.removeAttribute("src");
    media.load();
  });
  if (sheetVideoUrl) { URL.revokeObjectURL(sheetVideoUrl); sheetVideoUrl = null; }
  if (sheetRunMusicUrl) { URL.revokeObjectURL(sheetRunMusicUrl); sheetRunMusicUrl = null; }
  if (musicTrimUrl) { URL.revokeObjectURL(musicTrimUrl); musicTrimUrl = null; }
  if (trimUrl) { URL.revokeObjectURL(trimUrl); trimUrl = null; }
  musicTrimDraft = null;
  trimDraft = null;
}
function hideSheet() {
  // 開始確認を閉じたら、カメラをバックグラウンドに残さない。
  // startRunCountdown() だけはrunCameraArmed=trueでカウントダウンへ引き継ぐ。
  if (!runCameraArmed) runCameraRequestGeneration++;
  if (runCamera && !runCamera.recording && !runCameraArmed) stopRunCameraNow();
  // 保存確認を外側タップで閉じた場合も、一時映像をメモリへ残さない。
  if (pendingRunVideo) clearPendingRunVideo();
  releaseSheetMedia();
  $sheet.classList.remove("trim-sheet");
  $sheet.classList.add("hidden");
  $backdrop.classList.add("hidden");
  $sheet.innerHTML = "";
}
$backdrop.addEventListener("click", hideSheet);

let toastTimer = null;
function toast(msg) {
  $toast.textContent = uiText(msg);
  $toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.add("hidden"), 2200);
}

function playMedia(media, failureMessage = "再生を開始できませんでした") {
  const playing = media.play();
  if (playing && playing.catch) playing.catch(() => toast(failureMessage));
  return playing;
}

// ---------- 楽曲プレイヤー(グローバル: 再描画しても再生が途切れない) ----------
const musicPlayer = new Audio();
musicPlayer.loop = false; // 区間ループはpartTickだけで制御し、Audio要素自体には任せない
musicPlayer.preload = "metadata";
function preserveMediaPitch(media) {
  for (const key of ["preservesPitch", "webkitPreservesPitch", "mozPreservesPitch"]) {
    if (!(key in media)) continue;
    try { media[key] = true; } catch (_) {}
  }
}
function setMusicPlaybackRate(rate = 1) {
  const next = Number(rate);
  const safeRate = Number.isFinite(next) && next > 0 ? next : 1;
  preserveMediaPitch(musicPlayer);
  musicPlayer.defaultPlaybackRate = safeRate;
  musicPlayer.playbackRate = safeRate;
  preserveMediaPitch(musicPlayer);
}
setMusicPlaybackRate(1);
musicPlayer.addEventListener("loadedmetadata", () => preserveMediaPitch(musicPlayer));
musicPlayer.addEventListener("ratechange", () => preserveMediaPitch(musicPlayer));
let musicLoadedFor = null;   // ロード済みのroutineId
let musicObjectUrl = null;
let musicMissing = false;    // バックアップ復元後などで音源Blobが無い場合
let musicTrimMeta = null;    // 現在ロード中の曲のトリム情報(routine.music / draft.music)
let musicLoadGeneration = 0; // 画面遷移後に古い非同期ロード結果を反映しないための世代番号

const fmtTime = (s) => {
  if (s == null || !isFinite(s)) return "-:--";
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
};
const fmtTimeFine = (s) => {
  if (s == null || !isFinite(s)) return "-:--.-";
  const m = Math.floor(s / 60), sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
};

// 曲のBlob自体は加工せず、物理時間[trimStart, trimEnd]を画面上の[0, 有効長]へ写像する。
function musicBounds(meta = musicTrimMeta) {
  const playerFull = isFinite(musicPlayer.duration) && musicPlayer.duration > 0 ? musicPlayer.duration : null;
  const full = playerFull || (meta && meta.fullDuration) || 0;
  const start = Math.max(0, Math.min(Number(meta && meta.trimStart) || 0, full || Infinity));
  const rawEnd = meta && meta.trimEnd != null ? Number(meta.trimEnd) : full;
  const end = full ? Math.max(start, Math.min(isFinite(rawEnd) ? rawEnd : full, full)) : Math.max(start, rawEnd || start);
  return { full, start, end, duration: Math.max(0, end - start) };
}
function musicCurrentTime() {
  const b = musicBounds();
  return Math.max(0, Math.min(b.duration || Infinity, (musicPlayer.currentTime || 0) - b.start));
}
function musicEffectiveDuration() { return musicBounds().duration; }
function musicSetTime(relative) {
  const b = musicBounds();
  const rel = Math.max(0, Math.min(Number(relative) || 0, b.duration || 0));
  try { musicPlayer.currentTime = b.start + rel; } catch (_) {}
}
function musicMetaIsTrimmed(meta) {
  if (!meta) return false;
  const full = meta.fullDuration;
  return (meta.trimStart || 0) > 0.05 || (meta.trimEnd != null && full != null && meta.trimEnd < full - 0.05);
}
function syncMusicMetadata() {
  if (!musicTrimMeta || !isFinite(musicPlayer.duration) || musicPlayer.duration <= 0) return;
  const full = musicPlayer.duration;
  const hadEnd = musicTrimMeta.trimEnd != null;
  normalizeMusicMeta(musicTrimMeta, full);
  musicTrimMeta.fullDuration = full;
  if (!hadEnd) musicTrimMeta.trimEnd = full;
  const b = musicBounds();
  musicTrimMeta.duration = b.duration;
  if (musicPlayer.currentTime < b.start - 0.05 || musicPlayer.currentTime > b.end + 0.05) musicSetTime(0);
}
function enforceMusicTrimEnd() {
  if (!musicTrimMeta || musicPlayer.paused) return;
  const b = musicBounds();
  if (!b.duration || musicPlayer.currentTime < b.end - 0.04) return;
  if (view.name === "part" && partLoopActive) return partTick();
  musicPlayer.pause();
  musicSetTime(0);
}

async function loadMusic(rt) {
  if (!rt.music) return;
  const generation = ++musicLoadGeneration;
  musicMissing = false;
  const blob = await blobGet(rt.music.blobId);
  if (generation !== musicLoadGeneration || view.params.id !== rt.id || !["record", "part"].includes(view.name)) return;
  if (!blob) { musicMissing = true; musicLoadedFor = rt.id; if (["record", "part"].includes(view.name)) render(); return; }
  if (musicObjectUrl) URL.revokeObjectURL(musicObjectUrl);
  musicObjectUrl = URL.createObjectURL(blob);
  musicTrimMeta = normalizeMusicMeta(rt.music);
  musicPlayer.src = musicObjectUrl;
  setMusicPlaybackRate(view.name === "part" ? partPlaybackRate(rt) : 1);
  musicLoadedFor = rt.id;
  musicPlayer.addEventListener("loadedmetadata", () => {
    syncMusicMetadata();
    saveState();
    if (view.name === "record" || view.name === "part") render();
  }, { once: true });
  try { musicPlayer.load(); } catch (_) {}
  if (view.name === "record" || view.name === "part") render();
}
function updateMusicUI() {
  enforceMusicTrimEnd();
  const rel = musicCurrentTime();
  const effectiveDur = musicEffectiveDuration();
  const cur = document.getElementById("music-cur");
  if (cur) cur.textContent = fmtTimeFine(rel);
  const dur = document.getElementById("music-dur");
  if (dur) dur.textContent = fmtTime(effectiveDur);
  const seek = document.getElementById("music-seek");
  if (seek && effectiveDur && !seek.matches(":active")) {
    seek.max = effectiveDur;
    seek.value = rel;
  }
  const tg = document.getElementById("music-toggle-pill");
  if (tg) tg.innerHTML = uiText(musicPlayer.paused ? "▶ 再生" : "❚❚ 一時停止");
  const vol = document.getElementById("music-vol");
  if (vol && !vol.matches(":active")) vol.value = musicVolume;
  if (view.name === "record") recordTickUI();   // キュー指定に基づく「いまこの技」ハイライト
  if (view.name === "part") { updatePartLoopPlayhead(); updatePracticeNowUI(); }
  if (view.name === "edit") { editorTickUI(); updateCueButtons(); updatePracticeNowUI(); } // 現在行+上部固定プレビュー
}
// 編集画面: 再生位置がキューを過ぎた最後のステップを光らせる(draft基準なので編集内容に即追従)
function editorTickUI() {
  if (!draft) return;
  const rows = document.querySelectorAll(".editor-step");
  if (!rows.length) return;
  const cur = musicCurrentTime();
  let ai = -1, best = -1;
  if (!musicPlayer.paused || cur > 0.05) {
    draft.steps.forEach((s, i) => { if (s.cue != null && cur >= s.cue && s.cue >= best) { best = s.cue; ai = i; } });
  }
  rows.forEach((el, i) => el.classList.toggle("now", i === ai));
}
// 編集画面用の楽曲ロード: 保存済み音源 or いま添付したばかりのファイル
async function loadEditorMusic() {
  const generation = ++musicLoadGeneration;
  let blob = null, key = null;
  if (draft && draft._newMusicFile) { blob = draft._newMusicFile; key = "edit:new:" + draft._for; }
  else {
    const rt = state.routines.find((r) => r.id === view.params.id);
    if (rt && rt.music) { key = "edit:" + rt.id; if (musicLoadedFor !== key) blob = await blobGet(rt.music.blobId); }
  }
  if (!key) return;
  if (generation !== musicLoadGeneration || view.name !== "edit" || !draft) return;
  // 同じBlobを再利用して編集画面へ入り直す場合も、破棄したdraftのトリム情報を引きずらない。
  if (musicLoadedFor === key) {
    const nextMeta = normalizeMusicMeta(draft && draft.music);
    if (musicTrimMeta !== nextMeta) {
      musicTrimMeta = nextMeta;
      syncMusicMetadata(); musicSetTime(0); updateMusicUI();
    }
    return;
  }
  if (!blob) return;
  if (musicObjectUrl) URL.revokeObjectURL(musicObjectUrl);
  musicObjectUrl = URL.createObjectURL(blob);
  musicTrimMeta = normalizeMusicMeta(draft && draft.music);
  musicPlayer.src = musicObjectUrl;
  musicLoadedFor = key;
  if (view.name === "edit") updateMusicUI();
}
// 編集/通し/パート共通: 曲位置から「いま実施予定の技」を求め、上部ドックへ表示する。
// 明示キューが無いステップは、直前ステップの開始時刻+技の長さで補う。
const practiceVideoUrls = new Map();
const practiceVideoLoading = new Set();
const practiceVideoFailed = new Set();
let practiceDockStepId = null;
let practiceDockGeneration = 0;
let editPreviewStepId = null;
let editPreviewManual = false;
function practiceSchedule(steps) {
  let fallback = 0;
  return steps.map((step, index) => {
    const start = step.cue != null ? Math.max(0, step.cue) : fallback;
    fallback = start + stepDur(step);
    return { step, index, start };
  });
}
function plannedPracticeStep(steps, cur) {
  if (!steps.length) return null;
  const schedule = practiceSchedule(steps);
  let active = schedule[0];
  for (const item of schedule) {
    if (item.start <= cur + 0.02) active = item;
    else break;
  }
  return { ...active, next: schedule[active.index + 1] || null };
}
function practiceStepName(rt, step) {
  if (!isSlot(step)) return stepDisplayName(step) || "名称未設定";
  // A/Bを使わない間は、どの画面の現在技表示でも選択肢Aを通常の技として扱う。
  // 保存済みの選択肢とセッション既定値は消さず、ONに戻したときに復元する。
  if (!routineFeatureEnabled(rt, "showSlots")) {
    return (step.options[0] && optionDisplayName(step.options[0])) || stepDisplayName(step) || "名称未設定";
  }
  if (view.name === "edit") return stepLabel(step);
  const opt = practiceStepOption(rt, step);
  return (opt && optionDisplayName(opt)) || stepLabel(step);
}
function practiceStepOption(rt, step) {
  if (!isSlot(step) || !step.options.length) return null;
  if (view.name === "record" && rt) {
    const sess = activeSession(rt.id);
    const optId = currentChoice(rt, sess, step);
    return step.options.find((o) => o.id === optId) || step.options[0];
  }
  // パート練習と編集プレビューでは、明示選択のない初期状態をAとして扱う。
  return step.options[0];
}
function practiceStepTrick(rt, step) {
  const source = isSlot(step) ? practiceStepOption(rt, step) : step;
  return source && source.trickId
    ? (state.tricks || []).find((t) => t.id === source.trickId) || null
    : null;
}
function previewShouldPlay() {
  return !musicPlayer.paused || (view.name === "edit" && editPreviewManual);
}
function syncEditPreviewButtons() {
  if (view.name !== "edit" || !draft) return;
  document.querySelectorAll(".editor-step").forEach((row, i) => {
    const btn = row.querySelector(".mini-btn.play");
    if (!btn) return;
    const active = !!(draft.steps[i] && draft.steps[i].id === practiceDockStepId);
    btn.classList.toggle("on", active);
    btn.setAttribute("aria-label", active ? "この技を上部でプレビュー中" : "この技を上部でプレビュー");
  });
}
function editorPreviewPlayerHtml(hasMusic) {
  const savedDuration = Number(draft && draft.music && draft.music.duration) || 0;
  const duration = hasMusic && musicLoadedFor && String(musicLoadedFor).startsWith("edit")
    ? musicEffectiveDuration() : savedDuration;
  return `<div class="practice-now-player ${hasMusic ? "" : "is-disabled"}" aria-label="楽曲プレイヤー">
    <span class="practice-now-player-label">楽曲</span>
    <div class="practice-now-player-controls">
      <button class="music-pill primary" id="music-toggle-pill" onclick="ensureAudioGraph();musicToggle()"
        ${hasMusic ? "" : "disabled"}>▶ 再生</button>
      <button class="music-btn text" onclick="musicStop()" ${hasMusic ? "" : "disabled"}>■ 停止</button>
    </div>
    <div class="practice-now-player-meta">
      <div class="music-time"><span id="music-cur">${fmtTimeFine(hasMusic ? musicCurrentTime() : 0)}</span><span class="dur"> / <span id="music-dur">${hasMusic ? fmtTime(duration) : "-:--"}</span></span></div>
      <details class="music-volume-control">
        <summary aria-label="楽曲の音量" title="楽曲の音量"><span aria-hidden="true">🔊</span><small>${Math.round(musicVolume * 100)}%</small></summary>
        <div class="music-volume-popover">
          <span class="vol-ico" aria-hidden="true">🔈</span>
          <input type="range" id="music-vol" min="0" max="1" step="0.02" value="${musicVolume}"
            aria-label="楽曲の音量" oninput="musicSetVolume(this.value);this.closest('details').querySelector('summary small').textContent=Math.round(this.value*100)+'%'">
          <span class="vol-ico" aria-hidden="true">🔊</span>
        </div>
      </details>
    </div>
  </div>`;
}
function practiceNowDockHtml(editorPlayer = "") {
  return `<section class="practice-now paused ${editorPlayer ? "has-editor-player" : ""}" id="practice-now" aria-live="polite" aria-atomic="true">
    <div class="practice-now-copy">
      <strong id="practice-now-name">技を準備中…</strong>
      <span class="practice-now-meta" id="practice-now-meta">プレビュー位置は固定されます</span>
      ${editorPlayer}
    </div>
    <div class="practice-now-media" id="practice-now-media"><span class="practice-video-empty">動画プレビュー</span></div>
  </section>`;
}
function mountPracticeVideo(step, trick, url) {
  const dock = document.getElementById("practice-now");
  const media = document.getElementById("practice-now-media");
  if (!dock || !media || practiceDockStepId !== step.id) return;
  const shouldPlay = previewShouldPlay();
  const existing = media.querySelector("video");
  if (existing && existing.dataset.trimTrick === trick.id) {
    if (shouldPlay) existing.play().catch(() => {}); else existing.pause();
    return;
  }
  media.innerHTML = "";
  const video = document.createElement("video");
  video.src = url; video.muted = true; video.loop = true; video.autoplay = shouldPlay; video.playsInline = true;
  video.setAttribute("playsinline", ""); video.dataset.trimTrick = trick.id;
  media.appendChild(video);
  bindTrimVideo(video, trick);
  if (shouldPlay) video.play().catch(() => {});
}
async function updatePracticeNowUI() {
  if (!["record", "part", "edit"].includes(view.name)) return;
  const dock = document.getElementById("practice-now");
  if (!dock) return;
  const isEdit = view.name === "edit";
  const rt = state.routines.find((r) => r.id === view.params.id) || null;
  const steps = isEdit ? (draft ? draft.steps : []) : (rt ? latestVersion(rt).steps : []);
  const schedule = practiceSchedule(steps);
  const hasEditMusic = !!(draft && (draft._newMusicFile || draft.music));
  let current = plannedPracticeStep(steps, isEdit && !hasEditMusic ? 0 : musicCurrentTime());
  if (isEdit && musicPlayer.paused && editPreviewManual && editPreviewStepId) {
    const selected = schedule.find((item) => item.step.id === editPreviewStepId);
    if (selected) current = { ...selected, next: schedule[selected.index + 1] || null };
  }
  if (!current) {
    dock.classList.add("paused");
    const name = document.getElementById("practice-now-name");
    const meta = document.getElementById("practice-now-meta");
    const media = document.getElementById("practice-now-media");
    if (name) name.textContent = uiText("技を追加するとここに表示されます");
    if (meta) meta.textContent = uiText("プレビュー位置は固定されます");
    if (media) media.innerHTML = `<span class="practice-video-empty">${uiText("動画プレビュー")}</span>`;
    practiceDockStepId = null;
    syncEditPreviewButtons();
    return;
  }
  if (isEdit && !musicPlayer.paused) {
    editPreviewStepId = current.step.id;
    editPreviewManual = false;
  }
  const paused = isEdit ? (musicPlayer.paused && !editPreviewManual) : (musicPlayer.paused || musicMissing);
  practiceDockStepId = current.step.id;
  dock.classList.toggle("paused", paused);
  const name = document.getElementById("practice-now-name");
  const meta = document.getElementById("practice-now-meta");
  if (name) name.textContent = `${current.index + 1}. ${practiceStepName(rt, current.step)}`;
  if (meta) meta.textContent = uiText(current.next
    ? `♪ ${fmtTime(current.start)}　次: ${practiceStepName(rt, current.next.step)}`
    : `♪ ${fmtTime(current.start)}　フィニッシュ`);
  syncEditPreviewButtons();

  const media = document.getElementById("practice-now-media");
  const trick = practiceStepTrick(rt, current.step);
  if (!media) return;
  if (!trick) { media.innerHTML = `<span class="practice-video-empty">${uiText("動画なし")}</span>`; return; }
  const cached = practiceVideoUrls.get(trick.id);
  if (cached) return mountPracticeVideo(current.step, trick, cached);
  if (practiceVideoFailed.has(trick.id)) {
    media.innerHTML = `<span class="practice-video-loading" role="status">${uiText("動画を読み込めません")}</span>`;
    return;
  }
  media.innerHTML = `<span class="practice-video-loading" role="status" aria-live="polite">${uiText("動画を準備中…")}</span>`;
  if (practiceVideoLoading.has(trick.id)) return;
  practiceVideoLoading.add(trick.id);
  const generation = practiceDockGeneration;
  try {
    const blob = await blobGet(trick.blobId);
    if (generation !== practiceDockGeneration) return;
    if (!blob) { practiceVideoFailed.add(trick.id); updatePracticeNowUI(); return; }
    const url = URL.createObjectURL(blob);
    practiceVideoUrls.set(trick.id, url);
    if (practiceDockStepId === current.step.id) mountPracticeVideo(current.step, trick, url);
  } catch (_) {
    if (generation === practiceDockGeneration) { practiceVideoFailed.add(trick.id); updatePracticeNowUI(); }
  } finally { practiceVideoLoading.delete(trick.id); }
}
function clearPracticeNowCache() {
  practiceDockGeneration++;
  practiceDockStepId = null;
  practiceVideoLoading.clear();
  practiceVideoFailed.clear();
  editPreviewStepId = null;
  editPreviewManual = false;
  for (const url of practiceVideoUrls.values()) URL.revokeObjectURL(url);
  practiceVideoUrls.clear();
}

// 通し練習: 再生位置がキューを過ぎた最後のステップを「いまこの技」として光らせる
function recordTickUI() {
  const rows = document.querySelectorAll(".step-list .step-btn");
  if (!rows.length) return;
  const rt = state.routines.find((r) => r.id === view.params.id);
  if (!rt) return;
  const steps = latestVersion(rt).steps;
  const cur = musicCurrentTime();
  const planned = plannedPracticeStep(steps, cur);
  const ai = (!musicPlayer.paused || cur > 0.05) && planned ? planned.index : -1;
  rows.forEach((el, i) => el.classList.toggle("now", i === ai));
  updatePracticeNowUI();
}
musicPlayer.addEventListener("loadedmetadata", syncMusicMetadata);
["timeupdate", "loadedmetadata", "play", "pause", "ended"].forEach((ev) =>
  musicPlayer.addEventListener(ev, updateMusicUI));

// timeupdateは毎秒4回程度しか発火せず0.1秒表示がカクつくため、再生中はrAFで滑らかに更新する
let musicRaf = 0;
function musicRafTick() {
  enforceMusicTrimEnd();
  const rel = musicCurrentTime();
  const effectiveDur = musicEffectiveDuration();
  const cur = document.getElementById("music-cur");
  if (cur) cur.textContent = fmtTimeFine(rel);
  const seek = document.getElementById("music-seek");
  if (seek && effectiveDur && !seek.matches(":active")) {
    seek.max = effectiveDur;
    seek.value = rel;
  }
  if (view.name === "part") updatePartLoopPlayhead();
  musicRaf = requestAnimationFrame(musicRafTick);
}
musicPlayer.addEventListener("play", () => { if (!musicRaf) musicRaf = requestAnimationFrame(musicRafTick); });
["pause", "ended"].forEach((ev) => musicPlayer.addEventListener(ev, () => {
  if (musicRaf) { cancelAnimationFrame(musicRaf); musicRaf = 0; }
  updateMusicUI(); // 停止時に最終位置へ同期
  if (runCamera && runCamera.recording) stopRunVideoCaptureAtMusicStop();
}));
// 楽曲付き通しは、カウントダウン中の再生権限取得ではなく、START後に実際に鳴り始めた時点で録画する。
musicPlayer.addEventListener("playing", () => {
  if (!activeFullRunRoutineId || !runCameraArmed || !runCameraReady(activeFullRunRoutineId)) return;
  if (startRunVideoCapture(activeFullRunRoutineId)) render();
});

// 音量: iOS Safariは audio.volume を無視するため、Web Audio APIのGainNodeを通して制御する
let musicVolume = Number(localStorage.getItem("rd_volume") || 1);
let audioCtx = null, musicSourceNode = null, gainNode = null;
function ensureAudioGraph() {
  if (audioCtx) { if (audioCtx.state === "suspended") audioCtx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    audioCtx = new AC();
    musicSourceNode = audioCtx.createMediaElementSource(musicPlayer);
    gainNode = audioCtx.createGain();
    musicSourceNode.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    gainNode.gain.value = musicVolume;
    // GainNodeが音量を担当する間は、media element側を1にして二重適用を防ぐ。
    musicPlayer.volume = 1;
  } catch (_) { audioCtx = null; musicSourceNode = null; gainNode = null; }
}
window.musicSetVolume = (v) => {
  musicVolume = Number(v);
  if (gainNode) {
    gainNode.gain.value = musicVolume;
    musicPlayer.volume = 1;
  } else {
    musicPlayer.volume = musicVolume; // GainNodeが使えない環境向けのフォールバック
  }
  try { localStorage.setItem("rd_volume", String(musicVolume)); } catch (_) {}
};
window.musicToggle = () => {
  if (musicPlayer.paused) {
    const b = musicBounds();
    if (musicPlayer.currentTime < b.start - 0.05 || musicPlayer.currentTime >= b.end - 0.04) musicSetTime(0);
    ensureAudioGraph(); playMedia(musicPlayer, "楽曲を再生できませんでした");
  }
  else musicPlayer.pause();
};
window.musicStop = () => { musicPlayer.pause(); musicSetTime(0); updateMusicUI(); };
window.musicSeek = (v) => { musicSetTime(Number(v)); updateMusicUI(); };
// 通しの記録が確定したら曲を頭に戻す(次の通しは▶を押すだけ)
function musicResetForNextRun() {
  if (!musicPlayer.src) return;
  musicPlayer.pause();
  musicSetTime(0);
  updateMusicUI();
}

// ---------- 練習録音(MediaRecorder) ----------
let recState = null; // { rec, chunks, id, startedAt, timer, stream }

window.toggleRecording = async () => {
  if (recState) return stopRecording();
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    return toast("この環境ではマイク録音を使えません(https配信が必要です)");
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    recState = { rec, chunks: [], id: uid(), startedAt: Date.now(), stream, timer: null };
    rec.ondataavailable = (e) => { if (e.data.size) recState.chunks.push(e.data); };
    rec.start(1000);
    recState.timer = setInterval(() => {
      const el = document.getElementById("rec-elapsed");
      if (el) el.textContent = fmtTimeFine((Date.now() - recState.startedAt) / 1000);
    }, 200);
    render();
  } catch (_) {
    toast("マイクへのアクセスが許可されませんでした");
  }
};
async function stopRecording() {
  if (!recState) return;
  const rs = recState;
  clearInterval(rs.timer);
  await new Promise((resolve) => { rs.rec.onstop = resolve; rs.rec.stop(); });
  rs.stream.getTracks().forEach((t) => t.stop());
  recState = null;
  const blob = new Blob(rs.chunks, { type: rs.rec.mimeType || "audio/mp4" });
  const duration = (Date.now() - rs.startedAt) / 1000;
  const sess = view.name === "record" ? activeSession(view.params.id) : null;
  if (sess && blob.size) {
    const saved = await blobPut(rs.id, blob);
    if (saved) {
      sess.recordings = sess.recordings || [];
      sess.recordings.push({ id: rs.id, blobId: rs.id, at: rs.startedAt, duration });
      saveState();
      toast(`録音を保存しました (${fmtTime(duration)})`);
    } else {
      toast("録音を保存できませんでした");
    }
  }
  if (view.name === "record") render();
}

// ---------- 通し練習の映像(インカメ＋アプリ音源／アプリ全体で最大5本) ----------
// カメラは開始確認でのみ準備し、カウントダウン終了と同時に録画を開始する。
// 6本目は古い映像を勝手に消さず、保存時に利用者が入れ替え先を選ぶ。
let runCamera = null; // { routineId, stream, rec, chunks, recording, startedAt }
let runCameraArmed = false;
let runCameraRequestGeneration = 0;
let runVideoTimer = null;
let stoppedRunVideoCapture = null; // 音源停止後、通し結果と結び付けるまで保持する一時映像
let runVideoStopPromise = null;
let pendingRunVideo = null; // 録画終了後、保存／破棄を選ぶまでの一時Blob
let pendingRunVideoUrl = null;

function selectedRunCameraProfileId() {
  let stored = "";
  try { stored = localStorage.getItem("rd_run_camera_profile") || ""; } catch (_) {}
  return RUN_CAMERA_PROFILES[stored] ? stored : "wide";
}
function runCameraProfile(profileId = selectedRunCameraProfileId()) {
  return RUN_CAMERA_PROFILES[profileId] || RUN_CAMERA_PROFILES.wide;
}
function runVideoAspect(video) {
  // 旧版の wide 映像には3:4の値が保存されているため、現在のプロフィール定義を優先する。
  const profile = RUN_CAMERA_PROFILES[video?.cameraProfile];
  if (profile) return profile.ratio;
  const ratio = Number(video?.aspectRatio);
  if (Number.isFinite(ratio) && ratio > 0) return ratio;
  return RUN_CAMERA_PROFILES.wide.ratio;
}
function runVideoAspectStyle(video) {
  return `--run-camera-aspect:${runVideoAspect(video)}`;
}
function runVideoProfile(video) {
  if (RUN_CAMERA_PROFILES[video?.cameraProfile]) return RUN_CAMERA_PROFILES[video.cameraProfile];
  return Math.abs(runVideoAspect(video) - RUN_CAMERA_PROFILES.wide.ratio) < 0.01
    ? RUN_CAMERA_PROFILES.wide : RUN_CAMERA_PROFILES.vertical;
}
function clearStoppedRunVideoCapture() {
  stoppedRunVideoCapture = null;
}

function storedRunVideos() {
  return Array.isArray(state.runVideos) ? state.runVideos : [];
}
function findRunRecord(sessionId, runId) {
  const sess = state.sessions.find((s) => s.id === sessionId);
  return { sess, run: sess && (sess.runs || []).find((r) => r.id === runId) };
}
function runCameraReady(routineId) {
  return !!(runCamera && runCamera.routineId === routineId && runCamera.stream && !runCamera.recording);
}
function runCameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}
function releaseRunCameraComposition(cap) {
  if (!cap || !cap.webComposition) return;
  try { cap.webComposition.release(); } catch (_) {}
  cap.webComposition = null;
}
function stopRunCameraNow() {
  runCameraRequestGeneration++;
  const cap = runCamera;
  runCamera = null;
  runCameraArmed = false;
  clearStoppedRunVideoCapture();
  clearInterval(runVideoTimer);
  runVideoTimer = null;
  if (!cap) return;
  try { if (cap.rec && cap.rec.state !== "inactive") cap.rec.stop(); } catch (_) {}
  releaseRunCameraComposition(cap);
  if (cap.stream) cap.stream.getTracks().forEach((track) => track.stop());
}
function clearPendingRunVideo() {
  if (pendingRunVideoUrl) URL.revokeObjectURL(pendingRunVideoUrl);
  pendingRunVideoUrl = null;
  pendingRunVideo = null;
}
function runCameraConfirmBody(routineId, status = "") {
  const ready = runCameraReady(routineId);
  const count = storedRunVideos().length;
  const selectedProfile = runCameraProfile(ready ? runCamera.profileId : undefined);
  const routine = state.routines.find((item) => item.id === routineId);
  const recordingDelay = preferredRunVideoAudioDelay();
  const audioCopy = routine && routine.music
    ? (isEnglish() ? "Music included · until the music stops" : "音源入り・音源停止まで")
    : (isEnglish() ? "Video only · until the run ends" : "映像のみ・通し終了まで");
  return `
    <div class="run-camera-head">
      <div><b>インカメで撮影</b><span>${audioCopy}</span></div>
      <span class="run-video-capacity">保存 ${count}/${RUN_VIDEO_LIMIT}本</span>
    </div>
    <div class="run-camera-profile" role="group" aria-label="撮影画角">
      ${Object.values(RUN_CAMERA_PROFILES).map((profile) => `<button type="button"
        class="${selectedProfile.id === profile.id ? "selected" : ""}"
        aria-pressed="${selectedProfile.id === profile.id}"
        onclick="selectRunCameraProfile('${routineId}','${profile.id}')">${profile.label}</button>`).join("")}
    </div>
    ${ready ? `<video id="run-camera-preview" class="run-camera-preview" style="--run-camera-aspect:${selectedProfile.cssRatio}" autoplay playsinline muted></video>` : ""}
    ${status ? `<div class="run-camera-status" role="status">${esc(status)}</div>` : ""}
    <button type="button" class="btn ${ready ? "ghost" : ""}" id="run-camera-toggle"
      onclick="toggleRunCamera('${routineId}')">${ready ? "撮影をやめる" : "インカメを準備"}</button>
    <small>${routine && routine.music
      ? (isEnglish()
        ? `The selected framing is used throughout. The app music is digitally recorded in the video; the camera microphone is not used. Recording sync correction: ${recordingDelay.toFixed(2)} sec.`
        : `選んだ画角を確認映像・撮影中・保存後まで維持します。アプリ音源を映像へデジタル収録し、カメラのマイク音は入れません。収録同期補正は${recordingDelay.toFixed(2)}秒です。`)
      : (isEnglish()
        ? "The selected framing is used throughout. With no music assigned, the app records video only."
        : "選んだ画角を確認映像・撮影中・保存後まで維持します。音源未設定のため映像のみ撮影します。")}</small>`;
}
function updateRunCameraConfirm(routineId, status = "") {
  const area = document.getElementById("run-camera-area");
  if (!area) return;
  area.innerHTML = runCameraConfirmBody(routineId, status);
  applyUiLanguage(area);
  const preview = document.getElementById("run-camera-preview");
  if (preview && runCameraReady(routineId)) {
    preview.srcObject = runCamera.stream;
    preview.play().catch(() => {});
  }
}
async function prepareRunCamera(routineId) {
  if (!runCameraSupported()) {
    updateRunCameraConfirm(routineId, "この環境ではカメラ撮影を使えません");
    return false;
  }
  const profile = runCameraProfile();
  const button = document.getElementById("run-camera-toggle");
  if (button) { button.disabled = true; button.textContent = uiText("カメラを準備中…"); }
  const requestGeneration = ++runCameraRequestGeneration;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: profile.width }, height: { ideal: profile.height },
        aspectRatio: { ideal: profile.ratio },
        resizeMode: profile.resizeMode,
        frameRate: { ideal: 24, max: 30 },
      },
      audio: false,
    });
    if (requestGeneration !== runCameraRequestGeneration || !document.getElementById("run-camera-area")) {
      stream.getTracks().forEach((track) => track.stop());
      return false;
    }
    runCamera = { routineId, stream, chunks: [], recording: false, profileId: profile.id, generation: requestGeneration };
    updateRunCameraConfirm(routineId, "インカメの準備ができました");
    return true;
  } catch (_) {
    if (requestGeneration !== runCameraRequestGeneration) return false;
    runCamera = null;
    updateRunCameraConfirm(routineId, "カメラを使えません。端末の許可設定をご確認ください");
    return false;
  }
}

window.selectRunCameraProfile = async (routineId, profileId) => {
  if (!RUN_CAMERA_PROFILES[profileId]) return;
  const restart = runCameraReady(routineId);
  try { localStorage.setItem("rd_run_camera_profile", profileId); } catch (_) {}
  if (!restart) return updateRunCameraConfirm(routineId);
  stopRunCameraNow();
  updateRunCameraConfirm(routineId, "選んだ画角でカメラを準備中…");
  await prepareRunCamera(routineId);
};

window.toggleRunCamera = async (routineId) => {
  if (runCameraReady(routineId)) {
    stopRunCameraNow();
    updateRunCameraConfirm(routineId);
    return;
  }
  stopRunCameraNow();
  await prepareRunCamera(routineId);
};

function startRunVideoCapture(routineId) {
  if (!runCameraReady(routineId)) { runCameraArmed = false; return false; }
  const cap = runCamera;
  const rt = state.routines.find((routine) => routine.id === routineId);
  clearStoppedRunVideoCapture();
  // 撮影後の即時プレビューも、開始時点で使っていた音源へ確実に結び付ける。
  cap.music = cloneRunVideoMusicMeta(rt && rt.music);
  if (cap.music) ensureAudioGraph();
  let webComposition = createWebRunVideoRecordingStream({
    videoStream: cap.stream,
    audioContext: audioCtx,
    musicSourceNode,
    includeMusic: !!cap.music,
    audioDelaySeconds: preferredRunVideoAudioDelay(),
  });
  cap.webComposition = webComposition;
  const mime = MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4"
    : MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "";
  try {
    const createRecorder = (stream, includeAudio) => {
      const options = { videoBitsPerSecond: RUN_VIDEO_BPS };
      if (mime) options.mimeType = mime;
      if (includeAudio) options.audioBitsPerSecond = 128000;
      return new MediaRecorder(stream, options);
    };
    const beginRecorder = (recorder) => {
      cap.chunks = [];
      recorder.ondataavailable = (event) => { if (event.data.size) cap.chunks.push(event.data); };
      // 一部のiPhoneではコンストラクタ成功後、start()で複合Streamを拒否するため、ここもフォールバック対象にする。
      recorder.start(1000);
    };
    let rec = null;
    try {
      rec = createRecorder(webComposition.stream, webComposition.audioEmbedded);
      beginRecorder(rec);
    } catch (error) {
      // 端末のエンコーダーが映像＋Web Audioを受け付けない場合も、映像自体は失わない。
      if (!webComposition.audioEmbedded) throw error;
      webComposition.release();
      webComposition = createWebRunVideoRecordingStream({ videoStream: cap.stream, includeMusic: false });
      cap.webComposition = webComposition;
      rec = createRecorder(cap.stream, false);
      beginRecorder(rec);
    }
    cap.webComposition = webComposition;
    cap.audioEmbedded = webComposition.audioEmbedded;
    cap.audioMode = cap.audioEmbedded ? "embedded" : (cap.music ? "linked" : "none");
    cap.recordingAudioDelaySeconds = webComposition.recordingAudioDelaySeconds || 0;
    cap.rec = rec;
    cap.recording = true;
    cap.startedAt = Date.now();
    if (cap.music && !cap.audioEmbedded) {
      toast("この端末では音源を映像へ収録できないため、別音源同期で保存します");
    }
    clearInterval(runVideoTimer);
    runVideoTimer = setInterval(() => {
      const elapsed = document.getElementById("run-video-elapsed");
      if (elapsed && runCamera && runCamera.recording) {
        elapsed.textContent = fmtTimeFine((Date.now() - runCamera.startedAt) / 1000);
      }
    }, 200);
    runCameraArmed = false;
    return true;
  } catch (_) {
    stopRunCameraNow();
    toast("映像の撮影を開始できませんでした");
    return false;
  }
}

// 通し練習中も、撮影前に確認した構図を小さく見返せるようREC欄へ同じストリームを出す。
// muted + playsinline により音声や全画面プレイヤーを発生させず、録画本体にも影響しない。
function bindRunCameraLivePreview() {
  const preview = document.getElementById("run-camera-live-preview");
  if (!preview || !runCamera || !runCamera.recording || !runCamera.stream) return;
  if (preview.srcObject !== runCamera.stream) preview.srcObject = runCamera.stream;
  const playing = preview.play();
  if (playing && playing.catch) playing.catch(() => {});
}

async function stopRunVideoCapture(rt, sess, run) {
  if (runCamera && runCamera.recording) await stopRunVideoCaptureAtMusicStop();
  else if (runVideoStopPromise) await runVideoStopPromise;
  const capture = stoppedRunVideoCapture;
  stoppedRunVideoCapture = null;
  if (!capture || capture.routineId !== rt.id) return false;
  clearPendingRunVideo();
  pendingRunVideo = {
    ...capture, at: run.at, routineId: rt.id, sessionId: sess.id, runId: run.id,
    music: capture.music ? { ...capture.music } : null,
  };
  pendingRunVideoUrl = URL.createObjectURL(capture.blob);
  await showRunVideoReview();
  return true;
}

// 楽曲が止まった瞬間にMediaRecorderとカメラトラックを閉じる。
// 通し結果は少し後に入力されるため、Blobだけ一時保持して結果確定時にrunへ結び付ける。
async function stopRunVideoCaptureAtMusicStop() {
  if (runVideoStopPromise) return runVideoStopPromise;
  const cap = runCamera;
  runCamera = null;
  runCameraArmed = false;
  clearInterval(runVideoTimer);
  runVideoTimer = null;
  if (!cap || !cap.recording || !cap.rec) {
    if (cap && cap.stream) cap.stream.getTracks().forEach((track) => track.stop());
    return false;
  }
  const captureGeneration = cap.generation;
  runVideoStopPromise = (async () => {
    const rec = cap.rec;
    // 収録音源を遅らせた分だけ最後の音がDelayNode内に残るため、その尾まで記録してから閉じる。
    const audioTailMs = Math.round(normalizeRunVideoAudioDelay(cap.recordingAudioDelaySeconds) * 1000);
    if (audioTailMs > 0) await new Promise((resolve) => setTimeout(resolve, audioTailMs));
    await new Promise((resolve) => {
      rec.onstop = resolve;
      try { rec.stop(); } catch (_) { resolve(); }
    });
    releaseRunCameraComposition(cap);
    cap.stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(cap.chunks, { type: rec.mimeType || "video/mp4" });
    if (!blob.size) { toast("撮影した映像が空でした"); return false; }
    // 画面離脱やキャンセルで世代が進んだ録画は、後から保存候補へ戻さない。
    if (captureGeneration !== runCameraRequestGeneration) return false;
    const profile = runCameraProfile(cap.profileId);
    stoppedRunVideoCapture = await finalizeRunVideoComposition({
      blob, duration: Math.max(0, (Date.now() - cap.startedAt) / 1000), routineId: cap.routineId,
      mimeType: blob.type || rec.mimeType || "video/mp4", size: blob.size,
      cameraProfile: profile.id, aspectRatio: profile.ratio,
      music: cap.music ? { ...cap.music } : null,
      audioEmbedded: !!cap.audioEmbedded,
      recordingAudioDelaySeconds: cap.recordingAudioDelaySeconds,
    });
    render();
    return true;
  })();
  try { return await runVideoStopPromise; }
  finally { runVideoStopPromise = null; }
}

function runVideoTitle(video) {
  const rt = state.routines.find((r) => r.id === video.routineId);
  const sess = state.sessions.find((s) => s.id === video.sessionId);
  const date = sess ? sess.date : localDateString(video.at);
  return `${date} / ${rt ? routineDisplayName(rt) : "削除済みルーティン"}`;
}
async function showRunVideoReview() {
  if (!pendingRunVideo) return;
  const pending = pendingRunVideo;
  const profile = runVideoProfile(pending);
  const music = runVideoMusicMeta(pending);
  const needsLinkedMusic = runVideoNeedsLinkedMusic(pending);
  const musicBlob = needsLinkedMusic && music ? await blobGet(music.blobId) : null;
  if (pendingRunVideo !== pending) return;
  stopRunVideoAudioSync();
  if (sheetRunMusicUrl) URL.revokeObjectURL(sheetRunMusicUrl);
  sheetRunMusicUrl = musicBlob ? URL.createObjectURL(musicBlob) : null;
  showSheet(`
    <h3>通し練習の映像</h3>
    <div class="sheet-sub">${uiText(profile.label)} / ${runVideoAudioLabel(pending)} / ${fmtTimeFine(pending.duration)} / ${fmtBytes(pending.size)}</div>
    <video id="run-video-player" class="run-video-review" style="${runVideoAspectStyle(pending)}" src="${pendingRunVideoUrl}" controls playsinline preload="metadata"></video>
    ${needsLinkedMusic && sheetRunMusicUrl ? `<audio id="run-video-audio" src="${sheetRunMusicUrl}" preload="auto"></audio>` : ""}
    ${runVideoPlaybackAudioMarkup(pending, music, !!sheetRunMusicUrl)}
    ${runVideoSyncDelayMarkup(pending, "pending")}
    <div class="run-video-save-note">保存枠 ${storedRunVideos().length}/${RUN_VIDEO_LIMIT}本</div>
    <button class="btn primary" onclick="savePendingRunVideo()">この映像を保存</button>
    <button class="btn ghost" onclick="discardPendingRunVideo()">保存しない</button>`);
  if (needsLinkedMusic && sheetRunMusicUrl) bindRunVideoAudioSync(music);
  else bindRunVideoEmbeddedAudioDelay(pending);
}
function showRunVideoReplacement() {
  if (!pendingRunVideo) return;
  stopRunVideoAudioSync();
  if (sheetRunMusicUrl) { URL.revokeObjectURL(sheetRunMusicUrl); sheetRunMusicUrl = null; }
  const rows = [...storedRunVideos()].sort((a, b) => b.at - a.at).map((video) => `
    <div class="run-video-replace-row">
      <div><b>${esc(runVideoTitle(video))}</b><span>${fmtTimeFine(video.duration)} / ${fmtBytes(video.size || 0)}</span></div>
      <button class="btn small danger-ghost" onclick="savePendingRunVideo('${video.id}')">この映像と入れ替える</button>
    </div>`).join("");
  showSheet(`
    <h3>保存する映像を入れ替え</h3>
    <div class="sheet-sub">アプリ全体で${RUN_VIDEO_LIMIT}本保存済みです。自動では削除しません。</div>
    <div class="run-video-replace-list">${rows}</div>
    <button class="btn ghost" onclick="showRunVideoReview()">映像の確認へ戻る</button>
    <button class="btn ghost" onclick="discardPendingRunVideo()">今回の映像を保存しない</button>`);
}
window.savePendingRunVideo = async (replaceId = "") => {
  if (!pendingRunVideo) return;
  if (!replaceId && storedRunVideos().length >= RUN_VIDEO_LIMIT) return showRunVideoReplacement();
  const pending = pendingRunVideo;
  const id = uid();
  if (!(await blobPut(id, pending.blob))) return toast("映像を保存できませんでした");
  if (replaceId) await removeRunVideo(replaceId, false);
  const video = {
    id, blobId: id, routineId: pending.routineId, sessionId: pending.sessionId, runId: pending.runId,
    at: pending.at, duration: pending.duration, mimeType: pending.mimeType, size: pending.size,
    camera: "user", audio: !!pending.audio, audioMode: pending.audioMode,
    cameraProfile: pending.cameraProfile, aspectRatio: pending.aspectRatio,
    music: pending.music ? { ...pending.music } : null,
    composition: pending.composition ? JSON.parse(JSON.stringify(pending.composition)) : null,
    recordingAudioDelaySeconds: runVideoRecordingAudioDelay(pending),
    syncAudioDelaySeconds: runVideoDesiredAudioDelay(pending),
    playbackAudioDelaySeconds: runVideoPlaybackAudioDelay(pending),
  };
  state.runVideos.push(video);
  const found = findRunRecord(video.sessionId, video.runId);
  if (found.run) found.run.videoId = id;
  clearPendingRunVideo();
  saveState(); hideSheet(); render();
  toast(replaceId ? "通し映像を入れ替えました" : "通し映像を保存しました");
};
window.discardPendingRunVideo = () => {
  clearPendingRunVideo();
  hideSheet(); render(); toast("今回の映像は保存しませんでした");
};

// ---------- 録音の聴き返し(統計画面) ----------
const recPlayer = new Audio();
let recLoadedId = null;
let recObjectUrl = null;
recPlayer.addEventListener("timeupdate", () => {
  const el = document.getElementById(`recplay-${recLoadedId}`);
  if (el) el.textContent = uiText(`再生中 ${fmtTime(recPlayer.currentTime)}`);
});
recPlayer.addEventListener("ended", () => {
  const el = document.getElementById(`recplay-${recLoadedId}`);
  if (el) el.textContent = uiText("▶ 再生");
});
async function ensureRecLoaded(recId) {
  if (recLoadedId === recId) return true;
  const blob = await blobGet(recId);
  if (!blob) { toast("録音データが見つかりません"); return false; }
  if (recObjectUrl) URL.revokeObjectURL(recObjectUrl);
  recObjectUrl = URL.createObjectURL(blob);
  recPlayer.src = recObjectUrl;
  recLoadedId = recId;
  return true;
}
window.recPlayToggle = async (recId) => {
  if (recLoadedId === recId && !recPlayer.paused) return recPlayer.pause();
  if (!(await ensureRecLoaded(recId))) return;
  playMedia(recPlayer, "録音を再生できませんでした");
};
window.recSeekTo = async (recId, t) => {
  if (!(await ensureRecLoaded(recId))) return;
  recPlayer.currentTime = Math.max(0, t - 3); // 失敗の3秒前から
  playMedia(recPlayer, "録音を再生できませんでした");
};
window.recDownload = async (recId, date) => {
  const blob = await blobGet(recId);
  if (!blob) return toast("録音データが見つかりません");
  const ext = (blob.type || "").includes("mp4") ? "m4a" : "webm";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `practice-${date}-${recId}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast("録音を書き出しました");
};
window.recDelete = async (sessId, recId) => {
  if (!appConfirm("この録音を削除しますか?(元に戻せません)")) return;
  const sess = state.sessions.find((s) => s.id === sessId);
  if (sess) sess.recordings = (sess.recordings || []).filter((r) => r.id !== recId);
  if (recLoadedId === recId) { recPlayer.pause(); recLoadedId = null; }
  await blobDel(recId);
  saveState(); render(); toast("録音を削除しました");
};

// ---------- 画面遷移 ----------
function go(name, params = {}) {
  if (name !== view.name) musicLoadGeneration++;
  // 記録画面を離れるとき: 楽曲は一時停止、録音中なら保存して終了
  if (view.name === "record" && name !== "record") {
    clearRunCountdown();
    activeFullRunRoutineId = null;
    musicPlayer.pause();
    stopRunCameraNow();
    clearPendingRunVideo();
    if (recState) stopRecording();
  }
  // パート練習を離れるとき: ループ停止+一時停止
  if (view.name === "part" && name !== "part") stopPartLoop(true);
  if (view.name === "part" && name !== "part") setMusicPlaybackRate(1);
  if (["record", "part", "edit"].includes(view.name) && name !== view.name) clearPracticeNowCache();
  if (view.name === "edit" && name !== "edit") { musicPlayer.pause(); cuePlayStepId = null; }
  if (view.name === "stats" && name !== "stats") recPlayer.pause();
  // 技撮影を離れるとき: カメラ解放
  if (view.name === "trickrec" && name !== "trickrec") releaseTrickCam();
  // 音源ライブラリを離れるとき: 試聴停止・録音中なら保存して停止
  if (view.name === "audios" && name !== "audios") {
    if (audioPlayingId) { libAudio.pause(); audioPlayingId = null; libAudioMeta = null; }
    if (audioRec) stopAudioRec();
  }
  view = { name, params }; render(); window.scrollTo(0, 0);
}

// 見出しの「?」で開く説明。項目内の長い説明文はここに畳む(UIをすっきり&いつでも参照)
const INFO = {
  timeline: { t: "構成時間", b: "各技の長さ(動画リンクは自動、それ以外は既定値)を足し合わせ、構成全体の合計時間を表示します。「♪ 技の長さから曲位置を自動セット」を押すと、全ステップの♪キューに反映されます。" },
  steps: { t: "ステップの並べ替えとピン", b: "番号の下の <span style=\"color:var(--muted)\">⠿</span> を上下にドラッグすると、技の順番を入れ替えられます。<br><br>ピンを打つと、並べ替えや自動セットでもその技の曲位置を維持します。" },
  meter: { t: "失敗率メーターの見方", b: "各バーは失敗率(左=0%、右=100%)です。<br><br><b>オレンジの帯</b> = まだ不確かな範囲(95%区間)。帯が広いほど本数が少なく、まだ断定できません。<br><b>縦線</b> = 実測の失敗率。<br><br>失敗率の分母は、そのステップを実際に行った回数です。「実施できなかった」は失敗に混ぜず、到達数に対する未実施率として別表示します。" },
  audioLib: { t: "音源ライブラリ", b: "ここの音源は、ルーティン編集/タイムラインの「♪ ライブラリから」で選んで使えます。付属サンプルは最初から使えます。音源はこの端末内に保存され、JSONバックアップには含まれません(残したい録音は書き出しを)。" },
  editorFeatures: { t: "ルーティンで使う機能", b: "人によっては使わない機能を、初期状態では隠しています。<br><br><b>リスク度</b> = 各技に危険度(1〜5)を付けて、分析で失敗率とのズレを見る機能。<br><b>A/B分岐</b> = 本番でどちらの技をやるか選べるステップを作る機能。<br><br>右上の<b>全体</b>から変更すると、すべてのルーティンへ一括適用します。ルーティン画面の<b>個別</b>から変更すると、そのルーティンだけに適用します。OFFにしても、設定済みのデータは消えません。" },
  videoQuality: { t: "技の動画の画質", b: "技の動画は容量を抑えるため自動で圧縮されます。軽量にすると保存容量が減りますが、少し粗くなります。この設定は今後の撮影・アップロードに適用されます(既存の動画はそのまま)。" },
  backup: { t: "バックアップ", b: "iPhoneは長期間使わないと保存データを消すことがあります。定期的にJSONを書き出してください(音声は含まれません)。" },
  feedback: { t: "ご意見・機能の要望", b: "「こんな機能がほしい」「ここが使いにくい」などを開発者に直接送れます。いただいた要望は今後の改善に使わせてもらいます。" },
  reset: { t: "初期化", b: "まっさらな状態から試し直したいとき・サンプル一式を入れ直したいときに。ルーティン・記録・技と通しの動画・録音・楽曲・設定がすべて消えます(元に戻せません)。" },
};
const INFO_EN = {
  timeline: { t: "Routine duration", b: "The app adds each skill duration to show the routine's total length. Use “Set cues from skill durations” to write the calculated positions to every step." },
  steps: { t: "Reordering and position pins", b: "Drag the ⠿ handle below the step number to change the order.<br><br>Pin a step to keep that skill at the same music position when reordering or automatically setting cues." },
  meter: { t: "Reading the issue-rate meter", b: "The vertical line is the observed issue rate. The orange range is its 95% uncertainty interval. A wider range means there are not enough runs to draw a firm conclusion. Issue rate uses actual attempts as its denominator. Not-attempted steps are reported separately against runs reaching the step." },
  audioLib: { t: "Audio Library", b: "Reuse audio here from Routine Edit or Timeline. Audio is stored only on this device and is not included in JSON backups, so export any recordings you need to keep." },
  editorFeatures: { t: "Routine features", b: "Risk rating compares your expectation with the observed issue rate. A/B branch lets you choose between two skills for a run. Global applies a change to every routine; Routine changes only the current routine. Turning features off does not erase saved values." },
  videoQuality: { t: "Skill video quality", b: "Videos are compressed to save storage. Data saver uses less space with lower image quality. This affects future recordings and uploads only." },
  backup: { t: "Backup", b: "iPhone may remove browser storage after a long period of inactivity. Export a JSON backup regularly. Audio files are not included." },
  feedback: { t: "Feedback and requests", b: "Send feature requests or usability feedback directly to the developer." },
  reset: { t: "Reset", b: "Deletes all routines, practice records, skill videos, recordings, audio, and settings on this device. This cannot be undone." },
};
const infoBtn = (key) => `<button class="info-btn" onclick="event.stopPropagation();showInfo('${key}')" aria-label="説明">?</button>`;
window.showInfo = (key) => {
  const it = (isEnglish() ? INFO_EN : INFO)[key]; if (!it) return;
  showSheet(`<h3>${esc(it.t)}</h3>
    <div class="help-body" style="margin-top:8px">${it.b}</div>
    <div style="height:16px"></div>
    <button class="btn ghost" onclick="hideSheet()">閉じる</button>`);
};

// 現在のUIはルーズリーフの単一デザイン。過去データにtheme値が残っていても適用しない。
function applySingleDesign() { delete document.body.dataset.theme; }

const DEFAULT_RUN_COUNTDOWN = 5;
const MAX_RUN_COUNTDOWN = 15;
function normalizeRunCountdown(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_RUN_COUNTDOWN, Math.round(n))) : DEFAULT_RUN_COUNTDOWN;
}
function routineCountdownSeconds(rt) { return normalizeRunCountdown(rt && rt.countdownSeconds); }

function headerSettingsIcon(kind) {
  if (kind === "routine") {
    return `<svg class="head-settings-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 5h14M3 10h14M3 15h14"></path><circle cx="7" cy="5" r="1.7"></circle>
      <circle cx="13" cy="10" r="1.7"></circle><circle cx="9" cy="15" r="1.7"></circle>
    </svg>`;
  }
  return `<svg class="head-settings-icon" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M10 3.2v2M10 14.8v2M3.2 10h2M14.8 10h2M5.2 5.2l1.4 1.4M13.4 13.4l1.4 1.4M14.8 5.2l-1.4 1.4M6.6 13.4l-1.4 1.4"></path>
    <circle cx="10" cy="10" r="3.1"></circle>
  </svg>`;
}

function globalSettingsAction() {
  const current = view.name === "settings";
  return `<button class="head-settings-btn global-settings-btn ${current ? "current" : ""}"
    onclick="openGlobalSettings()" aria-label="グローバル設定を開く" title="グローバル設定" ${current ? `aria-current="page"` : ""}>
    ${headerSettingsIcon("global")}<span class="head-settings-label">全体</span>
  </button>`;
}

// グローバル設定は、開いた元の画面とルーティンID等のパラメータを保って往復する。
// 設定画面を直接開いた場合や再読み込み後は、安全な予備動作としてHOMEへ戻す。
window.openGlobalSettings = () => {
  if (view.name === "settings") return;
  go("settings", { returnView: view.name, returnParams: { ...(view.params || {}) } });
};
window.returnFromGlobalSettings = () => {
  const returnView = view.params && view.params.returnView;
  const returnParams = view.params && view.params.returnParams;
  if (!returnView || returnView === "settings") return go("home");
  go(returnView, returnParams && typeof returnParams === "object" ? returnParams : {});
};

// 全画面の右上にグローバル設定を常設する。ルーティン画面では個別設定と横並びにする。
function ensureGlobalSettingsAction() {
  $app.querySelectorAll(".topbar").forEach((topbar) => {
    if (topbar.querySelector(".global-settings-btn")) return;
    const actions = topbar.querySelector(".routine-head-actions");
    if (actions) actions.insertAdjacentHTML("beforeend", globalSettingsAction());
    else topbar.insertAdjacentHTML("beforeend", `<div class="routine-head-actions global-only">${globalSettingsAction()}</div>`);
  });
}

// ルーティン画面共通の右上「個別設定」。このルーティンだけの表示機能を切り替える。
function routineMenuAction(routineId, before = "") {
  return `<div class="routine-head-actions">${before}<button class="head-settings-btn routine-menu-btn"
    onclick="showRoutineMenu('${routineId || ""}')" aria-label="個別設定を開く" title="個別設定">
    ${headerSettingsIcon("routine")}<span class="head-settings-label">個別</span>
  </button></div>`;
}
window.showRoutineMenu = (routineId) => {
  const rt = routineId ? state.routines.find((r) => r.id === routineId) : null;
  const settings = rt ? (rt.featureSettings || defaultRoutineFeatures())
    : (draft && draft.featureSettings ? draft.featureSettings : defaultRoutineFeatures());
  const routineName = rt ? routineDisplayName(rt)
    : (draft && draft.name ? sampleDisplayText(draft.name, draft._sampleContent) : "新規ルーティン");
  showSheet(`
    <h3>個別設定</h3>
    <div class="sheet-sub"><span data-user-text>${esc(routineName)}</span> にだけ適用します</div>
    <section class="routine-menu-section" aria-labelledby="routine-feature-title">
      <h4 id="routine-feature-title">使う機能</h4>
      <div class="routine-menu-toggle-list">
        ${routineSwitchRow("リスク度", "事前予想と実際の失敗率を比べる", "showRisk", routineId, settings)}
        ${routineSwitchRow("A/B分岐", "本番で使う技を選択肢から切り替える", "showSlots", routineId, settings)}
      </div>
      <div class="routine-menu-note">OFFにしても登録済みの値は消えません</div>
    </section>
    ${view.name === "edit" && rt ? routineVersionHistoryHtml(rt) : ""}
    <div class="routine-menu-close">
      <button class="btn ghost" onclick="hideSheet()">閉じる</button>
    </div>
  `);
};

function routineVersionHistoryHtml(rt) {
  const latestIndex = rt.versions.length - 1;
  const rows = rt.versions.map((ver, index) => {
    const runCount = state.sessions
      .filter((session) => session.routineId === rt.id && session.versionId === ver.id)
      .reduce((total, session) => total + (session.runs || []).length, 0);
    const date = new Date(ver.createdAt || Date.now()).toLocaleDateString(isEnglish() ? "en-US" : "ja-JP");
    const detail = isEnglish()
      ? `${(ver.steps || []).length} steps · ${runCount} runs · ${date}`
      : `${(ver.steps || []).length}ステップ・通し${runCount}本・${date}`;
    return `<div class="routine-version-row ${index === latestIndex ? "current" : ""}">
      <div class="routine-version-copy">
        <div class="routine-version-title"><b>v${index + 1}</b>
          ${ver.label ? `<span>${esc(ver.label)}</span>` : ""}
          ${index === latestIndex ? `<em>現在の版</em>` : ""}
        </div>
        <small>${detail}</small>
      </div>
      ${index === latestIndex ? "" : `<button type="button" onclick="showVersionRestoreConfirm('${rt.id}',${index})">この版を開く</button>`}
    </div>`;
  }).reverse().join("");
  return `<section class="routine-menu-section routine-version-section" aria-labelledby="routine-version-title">
    <h4 id="routine-version-title">構成の履歴</h4>
    <div class="routine-version-list">${rows}</div>
    <div class="routine-menu-note">過去版を開いても、現在の構成と練習記録は削除されません</div>
  </section>`;
}

window.showVersionRestoreConfirm = (routineId, versionIndex) => {
  const rt = state.routines.find((routine) => routine.id === routineId);
  const version = rt && rt.versions[versionIndex];
  if (!rt || !version || view.name !== "edit") return hideSheet();
  const nextVersion = rt.versions.length + 1;
  const title = isEnglish() ? `Open v${versionIndex + 1}?` : `v${versionIndex + 1}を開きますか？`;
  const description = isEnglish()
    ? `The v${versionIndex + 1} sequence will replace the unsaved steps in the editor. The current sequence and practice records will remain. Saving creates v${nextVersion}.`
    : `v${versionIndex + 1}の構成を編集画面へ読み込みます。編集中の未保存ステップは置き換わりますが、現在の構成と練習記録は残ります。次に保存するとv${nextVersion}として追加されます。`;
  showSheet(`
    <h3>${title}</h3>
    <div class="sheet-sub" data-user-text>${esc(routineDisplayName(rt))}</div>
    <div class="version-restore-summary">
      <b>v${versionIndex + 1}${version.label ? ` ${esc(version.label)}` : ""}</b>
      <span>${isEnglish() ? `${version.steps.length} steps` : `${version.steps.length}ステップ`}</span>
    </div>
    <p class="version-restore-copy">${description}</p>
    <button class="btn primary" onclick="loadRoutineVersionIntoDraft('${routineId}',${versionIndex})">${isEnglish() ? `Load v${versionIndex + 1} in editor` : `v${versionIndex + 1}を編集画面に読み込む`}</button>
    <button class="btn ghost" onclick="showRoutineMenu('${routineId}')">戻る</button>`);
};

window.loadRoutineVersionIntoDraft = (routineId, versionIndex) => {
  const rt = state.routines.find((routine) => routine.id === routineId);
  const version = rt && rt.versions[versionIndex];
  if (!rt || !version || view.name !== "edit" || !draft || draft.id !== routineId) return hideSheet();
  draft.steps = cloneRoutineSteps(version.steps);
  draft._restoredFromVersion = versionIndex + 1;
  hideSheet(); render();
  toast(`v${versionIndex + 1}の構成を読み込みました。保存すると新しい版になります`);
};

function render() {
  const r = { home: renderHome, routines: renderRoutines, edit: renderEdit, record: renderRecord,
    stats: renderStats, settings: renderSettings, history: renderHistory, stepdetail: renderStepDetail,
    part: renderPart, help: renderHelp, tricks: renderTricks, trickrec: renderTrickRec,
    audios: renderAudios, runvideos: renderRunVideos }[view.name];
  $app.innerHTML = r ? r() : renderHome();
  applySingleDesign(); // 過去のスキン値に関係なく、常にルーズリーフデザインへ固定
  ensureGlobalSettingsAction();
  applyUiLanguage($app);
  if (typeof bindAllTrimVideos === "function") bindAllTrimVideos(); // 技動画にトリム区間を適用
  // 音源ロードによる再描画後も、常設の現在技名と静止プレビューを同じDOMへ同期する
  if (["record", "part", "edit"].includes(view.name)) updatePracticeNowUI();
  if (view.name === "record") bindRunCameraLivePreview();
}

// ルーティンカードはホームの「前回」と一覧で共通化し、どちらからも目的の操作へ1タップで入れる。
function itemLineColorTarget(kind, id) {
  if (kind === "step") return (draft?.steps || []).find((step) => step.id === id) || null;
  const collection = kind === "routine" ? state.routines : state.tricks;
  return (collection || []).find((item) => item.id === id) || null;
}

function itemLineColor(item) {
  return ITEM_LINE_COLORS.includes(item?.lineColor) ? item.lineColor : "blue";
}

function itemLineColorButtonHtml(item, kind) {
  const itemName = kind === "routine" ? routineDisplayName(item)
    : kind === "trick" ? trickDisplayName(item) : String(item?.name || "");
  const label = isEnglish()
    ? `Change marker color for ${itemName}`
    : `${itemName}の識別色を変更`;
  return `<button class="item-line-color-open" type="button" data-line-color="${itemLineColor(item)}"
    aria-label="${esc(label)}" title="${esc(label)}"
    onclick="openItemLineColorSheet('${kind}','${item.id}')"></button>`;
}

function stepLineColorButtonHtml(step, index) {
  const name = stepLabel(step) || (isEnglish() ? `Step ${index + 1}` : `ステップ${index + 1}`);
  const label = isEnglish() ? `Change marker color for ${name}` : `${name}の識別色を変更`;
  return `<button class="step-line-color-open" type="button" data-line-color="${itemLineColor(step)}"
    aria-label="${esc(label)}" title="${esc(label)}"
    onclick="openItemLineColorSheet('step','${step.id}')"><span class="no">${index + 1}</span></button>`;
}

function routineCardHtml(rt, context = "list") {
  const ver = latestVersion(rt);
  const runCount = state.sessions.filter((s) => s.routineId === rt.id).reduce((a, s) => a + s.runs.length, 0);
  const videoCount = storedRunVideos().filter((video) => video.routineId === rt.id).length;
  const routineName = routineDisplayName(rt);
  const rawMemo = String(rt.memo || "").trim();
  const memo = routineDisplayMemo(rt).trim();
  const memoLabel = isEnglish()
    ? (rawMemo ? `Open full memo for ${routineName}` : `Add a quick memo to ${routineName}`)
    : (rawMemo ? `${routineName}の簡易メモ全文を開く` : `${routineName}に簡易メモを追加`);
  const deleteLabel = isEnglish() ? `Delete ${routineName}` : `${routineName}を削除`;
  const memoHtml = `
      <div class="routine-quick-note ${rawMemo ? "" : "empty"}" role="button" tabindex="0"
        aria-label="${esc(memoLabel)}" onclick="showRoutineMemo('${rt.id}')"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();showRoutineMemo('${rt.id}')}"
        title="${rawMemo ? "タップして全文を表示" : "タップしてメモを追加"}">
        <span class="routine-quick-note-label">簡易メモ</span>
        <p ${rawMemo ? "data-user-text" : ""}>${rawMemo ? esc(memo) : "タップしてメモを追加"}</p>
      </div>`;
  return `<article class="routine-card ${context === "home" ? "home-routine-card" : ""}">
    <div class="routine-row" data-line-color="${itemLineColor(rt)}">
      ${itemLineColorButtonHtml(rt, "routine")}
      <button class="routine-delete-open" onclick="showDeleteRoutine('${rt.id}')"
        aria-label="${esc(deleteLabel)}" title="${esc(deleteLabel)}">✕</button>
      <div class="name"><span data-user-text>${esc(routineName)}</span>
        <span class="meta">${ver.steps.length}ステップ / v${rt.versions.length} / 通し${runCount}本</span></div>
      <div class="actions">
        <button class="btn small primary" onclick="showRoutinePracticeChoice('${rt.id}')">練習</button>
        <button class="btn small routine-video-action"
          onclick="go('runvideos',{from:'${context === "home" ? "home" : "routines"}',routineId:'${rt.id}'})">
          <span>演技映像を見る</span><small>${isEnglish() ? `${videoCount} videos` : `${videoCount}本`}</small>
        </button>
        <button class="btn small" onclick="go('stats',{id:'${rt.id}'})">分析</button>
        <button class="btn small ghost" onclick="go('edit',{id:'${rt.id}'})">編集</button>
      </div>
      ${memoHtml}
    </div>
  </article>`;
}

// 一覧では練習方法を一つの入口にまとめ、詳細を選んでから各モードへ移る。
window.showRoutinePracticeChoice = (id) => {
  const rt = state.routines.find((routine) => routine.id === id);
  if (!rt) return;
  const english = isEnglish();
  showSheet(`
    <div class="practice-choice-head">
      <small>${english ? "PRACTICE" : "PRACTICE / 練習"}</small>
      <h3>${english ? "Choose a practice mode" : "練習方法を選ぶ"}</h3>
      <p data-user-text>${esc(routineDisplayName(rt))}</p>
    </div>
    <div class="practice-choice-list">
      <button type="button" class="practice-choice-button primary"
        onclick="openRoutinePractice('${id}','record')">
        <span><b>${english ? "Full Run" : "通し練習"}</b>
          <small>${english ? "Perform from start to finish · record issues and video" : "最初から最後まで実施・失敗や映像を記録"}</small></span>
        <i aria-hidden="true">→</i>
      </button>
      <button type="button" class="practice-choice-button"
        onclick="openRoutinePractice('${id}','part')">
        <span><b>${english ? "Section Practice" : "パート練習"}</b>
          <small>${english ? "Loop a section · adjust speed and timing" : "区間をループ・速度や始点／終点を調整"}</small></span>
        <i aria-hidden="true">→</i>
      </button>
    </div>
    <button class="btn ghost" onclick="hideSheet()">${english ? "Cancel" : "キャンセル"}</button>`);
};

window.openRoutinePractice = (id, mode) => {
  if (!state.routines.some((routine) => routine.id === id)) return hideSheet();
  hideSheet();
  go(mode === "part" ? "part" : "record", { id });
};

// ========== ホーム(稽古場に戻る) ==========
function renderHome() {
  const routines = state.routines || [];
  const routineIds = new Set(routines.map((rt) => rt.id));
  const recentSessions = [...(state.sessions || [])]
    .filter((s) => routineIds.has(s.routineId))
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const liveSession = recentSessions.find((s) => !s.endedAt);
  const previousSession = liveSession || recentSessions[0];
  const previousRoutine = previousSession && routines.find((rt) => rt.id === previousSession.routineId);
  const trickCount = (state.tricks || []).length;
  const audioCount = (state.audios || []).length;
  const runVideoCount = storedRunVideos().length;
  const runVideoBytes = runVideoStorageBytes();
  const previousButton = previousRoutine ? routineCardHtml(previousRoutine, "home") : `
    <div class="home-recent-empty">
      <span>まだ練習したルーティンはありません</span>
    </div>`;

  return `
    <div class="home-simple-shell">
      <div class="home-binder-edge" aria-hidden="true"></div>
      <div class="home-paper-sheet">
        <header class="home-simple-head">
          <div class="home-title-block">
            <small>SHEET 00 / HOME · ${APP_VERSION}</small>
            <h1>ルーティンノート</h1>
          </div>
          <div class="home-head-buttons">
            <button onclick="go('help')">使い方</button>
            ${globalSettingsAction()}
          </div>
        </header>
        <main class="home-simple-main">
          <button class="home-practice-button" onclick="go('routines')">
            <span class="home-practice-copy"><small>ROUTINES</small><span>ルーティン一覧</span></span>
            <span class="home-button-arrow" aria-hidden="true">→</span>
          </button>
          <section class="home-recent" aria-labelledby="home-recent-title">
            <h2 id="home-recent-title">前回のルーティン</h2>
            ${previousButton}
          </section>
        </main>
        <div class="home-paper-space" aria-hidden="true"><span>01</span><span>02</span><span>03</span></div>
        <footer class="home-libraries" aria-label="ライブラリ">
          <div class="home-library-grid">
            <button class="home-library-videos" onclick="go('runvideos')">
              <span class="home-library-copy"><b>演技映像ライブラリ</b><small>${runVideoCount
                ? `${isEnglish() ? "Saved" : "保存"} ${runVideoCount}/${RUN_VIDEO_LIMIT}${isEnglish() ? " videos" : "本"} · ${fmtBytes(runVideoBytes)}`
                : "まだ映像はありません"}</small></span>
              <span class="home-button-arrow" aria-hidden="true">›</span>
            </button>
            <button class="home-library-tricks" onclick="go('tricks')">
              <span class="home-library-copy"><b>技ライブラリ</b><small>${trickCount ? (isEnglish() ? `${trickCount} skills` : `${trickCount}本`) : "未登録"}</small></span>
              <span class="home-button-arrow" aria-hidden="true">›</span>
            </button>
            <button class="home-library-audios" onclick="go('audios')">
              <span class="home-library-copy"><b>音源ライブラリ</b><small>${audioCount ? (isEnglish() ? `${audioCount} audio files` : `${audioCount}件`) : "未登録"}</small></span>
              <span class="home-button-arrow" aria-hidden="true">›</span>
            </button>
          </div>
        </footer>
      </div>
    </div>`;
}

// ========== 演技映像ライブラリ ==========
// 通し練習で保存した映像をルーティン横断で確認する。映像本体はIndexedDBに置き、
// 一覧ではメタデータだけを描画して、再生時にのみBlobを読み込む。
function renderRunVideos() {
  const allList = [...storedRunVideos()].sort((a, b) => b.at - a.at);
  const routineFilter = view.params.routineId
    ? state.routines.find((routine) => routine.id === view.params.routineId) : null;
  const list = routineFilter
    ? allList.filter((video) => video.routineId === routineFilter.id) : allList;
  const totalBytes = list.reduce((sum, video) => sum + (Number(video.size) || 0), 0);
  const english = isEnglish();
  const backAction = view.params.from === "routines" ? "go('routines')" : "go('home')";
  const pageTitle = routineFilter
    ? (english ? `${routineDisplayName(routineFilter)} Videos` : `${routineDisplayName(routineFilter)}の演技映像`)
    : (english ? "Performance Video Library" : "演技映像ライブラリ");
  const rows = list.map((video, index) => {
    const title = runVideoTitle(video);
    const linkedMusic = runVideoMusicMeta(video);
    const found = findRunRecord(video.sessionId, video.runId);
    const runIndex = found.sess && found.run ? found.sess.runs.indexOf(found.run) + 1 : 0;
    const issueCount = found.run ? (found.run.events || []).length : 0;
    const runMeta = runIndex
      ? (english ? `Run ${runIndex} in this session` : `この練習の${runIndex}本目`)
      : (english ? "Saved full run" : "保存した通し練習");
    const issueMeta = issueCount
      ? (english ? `${issueCount} issue marker${issueCount === 1 ? "" : "s"}` : `記録地点 ${issueCount}件`)
      : (english ? "No issue markers" : "記録地点なし");
    const playLabel = english ? `Play video: ${title}` : `${title}の映像を再生`;
    const deleteLabel = english ? `Delete video: ${title}` : `${title}の映像を削除`;
    return `<article class="run-video-library-row">
      <span class="run-video-library-number" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
      <div class="run-video-library-copy">
        <b data-user-text>${esc(title)}</b>
        <span>${esc(runMeta)} / ${esc(issueMeta)}</span>
        <small>${fmtTimeFine(video.duration)} / ${fmtBytes(video.size || 0)} / ${linkedMusic
          ? (runVideoHasEmbeddedAudio(video)
            ? (english ? `Music included: ${esc(linkedMusic.name || "Recorded music")}` : `♪ ${esc(linkedMusic.name || "対象音源")}を収録済み`)
            : (english ? `Linked music: ${esc(linkedMusic.name || "Linked music")}` : `♪ ${esc(linkedMusic.name || "対象音源")}と別同期`))
          : (english ? "Video only" : "映像のみ")}</small>
      </div>
      <div class="run-video-library-actions">
        <button class="btn small" aria-label="${esc(playLabel)}" onclick="openRunVideo('${video.id}')">▶ ${english ? "Play" : "再生"}</button>
        <button class="mini-btn del" aria-label="${esc(deleteLabel)}" onclick="runVideoDelete('${video.id}')">✕</button>
      </div>
    </article>`;
  }).join("");
  const headingTitle = routineFilter
    ? (english ? "Videos from this routine" : "このルーティンで撮った映像")
    : (english ? "Saved full-run videos" : "保存した通し練習の映像");
  const headingCopy = routineFilter
    ? (english ? "Play, export, or delete recordings from this routine."
      : "このルーティンの映像を、再生確認・書き出し・削除できます。")
    : (english ? "Review, export, or delete recordings across all routines."
      : "すべてのルーティンの映像を、再生確認・書き出し・削除できます。");
  const emptyCopy = routineFilter
    ? (english ? "No videos have been recorded for this routine yet.<br>Prepare the front camera before starting a full run."
      : "このルーティンの演技映像はまだありません。<br>通し練習の開始前にインカメを準備すると、終了後に保存できます。")
    : (english ? "No performance videos yet.<br>Prepare the front camera before starting a full run."
      : "演技映像はまだありません。<br>通し練習の開始前にインカメを準備すると、終了後に保存できます。");
  return `
    <div class="topbar"><button class="back-btn" onclick="${backAction}">戻る</button><h1 data-user-text>${esc(pageTitle)}</h1></div>
    <section class="card run-video-library-card" aria-labelledby="run-video-library-title">
      <div class="run-video-library-heading">
        <div><h2 id="run-video-library-title">${headingTitle}</h2><p>${headingCopy}</p></div>
        <strong>${routineFilter ? `${list.length}${english ? " videos" : "本"}` : `${list.length}/${RUN_VIDEO_LIMIT}`}</strong>
      </div>
      ${routineFilter ? `<div class="run-video-library-scope">${english
        ? `App storage: ${allList.length}/${RUN_VIDEO_LIMIT} videos`
        : `アプリ全体の保存枠 ${allList.length}/${RUN_VIDEO_LIMIT}本`}</div>` : ""}
      <div class="run-video-library-slots" aria-label="${english ? `${allList.length} of ${RUN_VIDEO_LIMIT} video slots used` : `${RUN_VIDEO_LIMIT}本中${allList.length}本を保存`}">
        ${Array.from({ length: RUN_VIDEO_LIMIT }, (_, index) => `<i class="${index < allList.length ? "used" : ""}"></i>`).join("")}
      </div>
      ${totalBytes ? `<div class="run-video-library-size">${english ? "Storage used" : "使用容量"} ${fmtBytes(totalBytes)}</div>` : ""}
      <p class="run-video-library-storage-note">${english
        ? "Saved on this device. A normal page reload does not delete videos. Safari website-data removal, Private Browsing, or storage cleanup can remove them."
        : "この端末内に保存されます。通常の画面更新では消えませんが、Safariのサイトデータ削除・プライベートブラウズ・端末の容量整理では失われる場合があります。"}</p>
      <div class="run-video-library-list">${rows || `<div class="empty">${emptyCopy}</div>`}</div>
      ${!routineFilter ? runVideoStorageActions(allList) : ""}
    </section>`;
}

// ========== ルーティン一覧 ==========
function renderRoutines() {
  const rows = state.routines.map((rt) => routineCardHtml(rt)).join("");
  return `
    <div class="topbar"><button class="back-btn" onclick="go('home')">戻る</button>
      <h1>ルーティン一覧</h1></div>
    <section class="routine-stack-list" aria-labelledby="routine-stack-title">
      <h2 id="routine-stack-title">登録済みのルーティン</h2>
      ${rows || `<div class="empty">まだルーティンがありません。<br>技と移行を順番に登録するところから始めます。</div>`}
    </section>
    <button class="btn" onclick="go('edit',{})">＋ 新規ルーティン</button>
    ${state.routines.some((r) => r.sampleSet) ? "" :
      `<button class="btn ghost" onclick="loadSampleSet()">サンプルルーティンを読み込む</button>`}
`;
}

// ルーティン単位の簡易メモ。構成バージョンや分析結果とは分けて保持する。
window.showRoutineMemo = (id) => {
  const rt = state.routines.find((r) => r.id === id);
  if (!rt) return;
  const rawMemo = String(rt.memo || "").trim();
  if (!rawMemo) return showRoutineMemoEditor(id);
  showSheet(`
    <h3>簡易メモ</h3>
    <div class="sheet-sub" data-user-text>${esc(routineDisplayName(rt))}</div>
    <div class="routine-memo-full" data-user-text>${esc(routineDisplayMemo(rt))}</div>
    <button class="btn primary" onclick="showRoutineMemoEditor('${id}')">メモを編集</button>
    <button class="btn ghost" onclick="hideSheet()">閉じる</button>`);
};
window.showRoutineMemoEditor = (id) => {
  const rt = state.routines.find((r) => r.id === id);
  if (!rt) return hideSheet();
  const memoForDisplay = routineDisplayMemo(rt);
  showSheet(`
    <h3>簡易メモを編集</h3>
    <div class="sheet-sub" data-user-text>${esc(routineDisplayName(rt))}</div>
    <textarea id="routine-memo-input" rows="7" maxlength="1000"
      data-sample-source="${rt.sampleSet ? esc(rt.memo || "") : ""}"
      placeholder="次回試したいこと、衣装・道具の注意点など">${esc(memoForDisplay)}</textarea>
    <div class="sheet-sub">空欄で保存するとメモを削除します</div>
    <button class="btn primary" onclick="saveRoutineMemo('${id}')">保存</button>
    <button class="btn ghost" onclick="hideSheet()">やめる</button>`);
  const input = document.getElementById("routine-memo-input");
  if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
};
window.saveRoutineMemo = (id) => {
  const rt = state.routines.find((r) => r.id === id);
  const input = document.getElementById("routine-memo-input");
  if (!rt || !input) return hideSheet();
  const source = input.dataset.sampleSource || "";
  const entered = input.value.trim();
  rt.memo = rt.sampleSet && isEnglish() && source && entered === uiText(source).trim() ? source.trim() : entered;
  saveState(); hideSheet(); render();
  toast(rt.memo ? "簡易メモを保存しました" : "簡易メモを削除しました");
};

window.openItemLineColorSheet = (kind, id) => {
  const item = itemLineColorTarget(kind, id);
  if (!item) return hideSheet();
  const selected = itemLineColor(item);
  const itemName = kind === "step" ? (stepLabel(item) || (isEnglish() ? "Step" : "ステップ"))
    : kind === "routine" ? routineDisplayName(item) : trickDisplayName(item);
  showSheet(`
    <h3>識別色</h3>
    <div class="sheet-sub" data-user-text>${esc(itemName)}</div>
    <div class="line-color-help">左端の線の色を選んでください</div>
    <div class="line-color-palette">
      ${ITEM_LINE_COLORS.map((color) => {
        const active = color === selected;
        const colorLabel = ITEM_LINE_COLOR_LABELS[color][isEnglish() ? 1 : 0];
        return `<button type="button" class="line-color-choice ${active ? "selected" : ""}"
          data-line-color="${color}" aria-label="${esc(colorLabel)}" aria-pressed="${active}"
          onclick="setItemLineColor('${kind}','${id}','${color}')">
          <span class="line-color-choice-swatch" aria-hidden="true"></span>
          <small>${esc(colorLabel)}</small>
          <b aria-hidden="true">${active ? "✓" : ""}</b>
        </button>`;
      }).join("")}
    </div>
    <button class="btn ghost" type="button" onclick="hideSheet()">閉じる</button>`);
};

window.setItemLineColor = (kind, id, color) => {
  const item = itemLineColorTarget(kind, id);
  if (!item || !ITEM_LINE_COLORS.includes(color)) return;
  item.lineColor = color;
  if (kind !== "step") saveState();
  hideSheet(); render();
  toast("識別色を変更しました");
};

// ルーティン削除は「右上の✕ → シート内を右端までスライド」の二段階だけで実行する。
// タップや短いスワイプでは削除せず、右端で指を離したときだけ確定する。
window.showDeleteRoutine = (id) => {
  const rt = state.routines.find((r) => r.id === id);
  if (!rt) return;
  const sessions = state.sessions.filter((s) => s.routineId === id);
  const runCount = sessions.reduce((a, s) => a + s.runs.length, 0);
  const countText = isEnglish()
    ? `${sessions.length} sessions · ${runCount} runs`
    : `セッション${sessions.length}件・通し${runCount}本`;
  const detailText = isEnglish()
    ? "The routine, its practice records, full-run videos, recordings, and attached music will be removed."
    : "ルーティン、練習記録、通し映像、録音、添付した楽曲が削除されます。";
  showSheet(`
    <h3>ルーティンを削除</h3>
    <div class="delete-routine-name" data-user-text>${esc(routineDisplayName(rt))}</div>
    <div class="delete-routine-warning">
      <strong>${isEnglish() ? "This cannot be undone" : "この操作は元に戻せません"}</strong>
      <span>${countText}</span>
      <p>${detailText}</p>
    </div>
    <div class="delete-slide-wrap">
      <div class="delete-slide-track" id="delete-slide-track" role="slider" tabindex="0"
        aria-label="右端までスライドして削除" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"
        onkeydown="routineDeleteKey(event,'${id}')">
        <div class="delete-slide-fill"></div>
        <span class="delete-slide-copy">右へスライドして削除</span>
        <button class="delete-slide-handle" type="button" aria-label="削除スライダー"
          onpointerdown="startRoutineDeleteSlide(event,'${id}')">✕</button>
      </div>
      <div class="delete-slide-help">右端まで動かして指を離すと削除されます</div>
    </div>
    <button class="btn ghost" onclick="hideSheet()">キャンセル</button>
  `);
};

let routineDeleteDrag = null;
function deleteSlideState(track, handle, id, action = "routine") {
  const fill = track.querySelector(".delete-slide-fill");
  const copy = track.querySelector(".delete-slide-copy");
  const rect = track.getBoundingClientRect();
  const inset = 5;
  const max = Math.max(1, rect.width - handle.offsetWidth - inset * 2);
  return { id, action, track, handle, fill, copy, rect, inset, max, progress: Number(handle.dataset.progress || 0) };
}
function updateDeleteSlide(d, progress) {
  const p = Math.max(0, Math.min(1, progress));
  d.progress = p;
  d.handle.dataset.progress = String(p);
  d.handle.style.transform = `translateX(${d.max * p}px)`;
  d.fill.style.width = `${d.inset + d.handle.offsetWidth + d.max * p}px`;
  d.track.setAttribute("aria-valuenow", String(Math.round(p * 100)));
  d.track.setAttribute("aria-valuetext", p >= .94
    ? (isEnglish() ? "Ready to delete" : "削除できる位置")
    : (isEnglish() ? `${Math.round(p * 100)} percent` : `${Math.round(p * 100)}パーセント`));
  d.track.classList.toggle("armed", p >= .94);
  d.copy.textContent = p >= .94
    ? (isEnglish() ? "Release to delete" : "指を離すと削除")
    : p >= .68 ? (isEnglish() ? "Keep sliding" : "右端まであと少し")
      : (isEnglish() ? "Slide right to delete" : "右へスライドして削除");
}
function resetDeleteSlide(d) {
  d.track.classList.add("resetting");
  updateDeleteSlide(d, 0);
  setTimeout(() => d.track && d.track.classList.remove("resetting"), 220);
}
function startDeleteSlide(event, id, action) {
  const handle = event.currentTarget;
  const track = handle.closest(".delete-slide-track");
  if (!track || routineDeleteDrag) return;
  event.preventDefault();
  event.stopPropagation();
  routineDeleteDrag = deleteSlideState(track, handle, id, action);
  routineDeleteDrag.pointerId = event.pointerId;
  const handleRect = handle.getBoundingClientRect();
  routineDeleteDrag.grabOffset = event.clientX - (handleRect.left + handleRect.width / 2);
  handle.classList.add("dragging");
  try { handle.setPointerCapture(event.pointerId); } catch (_) {}
}
window.startRoutineDeleteSlide = (event, id) => startDeleteSlide(event, id, "routine");
window.startRunVideoBulkDeleteSlide = (event) => startDeleteSlide(event, "", "run-videos");
document.addEventListener("pointermove", (event) => {
  if (!routineDeleteDrag) return;
  event.preventDefault();
  const d = routineDeleteDrag;
  const x = event.clientX - d.grabOffset - d.rect.left - d.inset - d.handle.offsetWidth / 2;
  updateDeleteSlide(d, x / d.max);
}, true);
function finishRoutineDeleteSlide(event, cancelled = false) {
  if (!routineDeleteDrag) return;
  const d = routineDeleteDrag;
  routineDeleteDrag = null;
  d.handle.classList.remove("dragging");
  try { d.handle.releasePointerCapture(d.pointerId); } catch (_) {}
  if (!cancelled && d.progress >= .94) performDeleteSlideAction(d);
  else resetDeleteSlide(d);
}
document.addEventListener("pointerup", (event) => finishRoutineDeleteSlide(event), true);
document.addEventListener("pointercancel", (event) => finishRoutineDeleteSlide(event, true), true);

function deleteSlideKey(event, id, action) {
  const track = event.currentTarget;
  const handle = track.querySelector(".delete-slide-handle");
  if (!handle) return;
  const d = deleteSlideState(track, handle, id, action);
  let next = d.progress;
  if (event.key === "ArrowRight") next += .1;
  else if (event.key === "ArrowLeft") next -= .1;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = 1;
  else if ((event.key === "Enter" || event.key === " ") && d.progress >= .94) {
    event.preventDefault(); performDeleteSlideAction(d); return;
  } else return;
  event.preventDefault();
  updateDeleteSlide(d, next);
}
window.routineDeleteKey = (event, id) => deleteSlideKey(event, id, "routine");
window.runVideoBulkDeleteKey = (event) => deleteSlideKey(event, "", "run-videos");

function performDeleteSlideAction(d) {
  if (d.action === "run-videos") return performRunVideoBulkDelete();
  return performRoutineDelete(d.id);
}

async function performRoutineDelete(id) {
  const rt = state.routines.find((r) => r.id === id);
  if (!rt) return hideSheet();
  const sessions = state.sessions.filter((s) => s.routineId === id);
  const routineVideos = storedRunVideos().filter((item) => item.routineId === id);
  const musicBlobIds = new Set([rt.music && rt.music.blobId,
    ...routineVideos.map((video) => video.music && video.music.blobId)].filter(Boolean));
  hideSheet();
  // 音声Blobの後始末(楽曲+このルーティンのセッション録音)
  for (const s of sessions) for (const rec of s.recordings || []) blobDel(rec.blobId);
  for (const video of routineVideos) blobDel(video.blobId);
  state.runVideos = storedRunVideos().filter((item) => item.routineId !== id);
  state.routines = state.routines.filter((r) => r.id !== id);
  state.sessions = state.sessions.filter((s) => s.routineId !== id);
  for (const blobId of musicBlobIds) await deleteRunVideoMusicBlobIfUnused(blobId);
  if (musicLoadedFor === id) { musicPlayer.pause(); musicPlayer.removeAttribute("src"); musicLoadedFor = null; }
  saveState(); render(); toast("削除しました");
}

// ドラッグ等の直後に意図しないclickが行内ボタンへ落ちるのを防ぐ。
let swipeSuppressClick = false;
document.addEventListener("click", (e) => {
  if (swipeSuppressClick) { e.stopPropagation(); e.preventDefault(); }
}, true);

// ========== ルーティン編集 ==========
let draft = null; // { id?, name, steps: [{id,name,kind,load}] }

// タイムライン(旧ビルダーの機能を編集画面に統合): 各ステップの長さから曲位置を計算
const DEFAULT_STEP_DUR = 2; // 動画リンクの無いステップ(移行/手入力)の既定の長さ(秒)
function stepDur(s) {
  if (s.dur != null) return s.dur;
  if (s.trickId) { const t = (state.tricks || []).find((x) => x.id === s.trickId); if (t) return t.duration; }
  return DEFAULT_STEP_DUR;
}
// 曲位置とは別に、編集行で確認するための長さ表示。A/Bは各選択肢の動画トリム長を並べる。
function editorDurationSource(s) {
  const own = Number(s && s.dur);
  if (Number.isFinite(own) && own >= 0) return own;
  if (s && s.trickId) {
    const trick = (state.tricks || []).find((x) => x.id === s.trickId);
    const linked = Number(trick && trick.duration);
    if (Number.isFinite(linked) && linked >= 0) return linked;
  }
  return DEFAULT_STEP_DUR;
}
function editorDurationLabel(s, showSlots) {
  const suffix = isEnglish() ? "s" : "秒";
  const prefix = isEnglish() ? "Duration" : "長さ";
  if (isSlot(s)) {
    const options = showSlots ? s.options : s.options.slice(0, 1);
    const values = options.map((o, oi) => `${String.fromCharCode(65 + oi)} ${editorDurationSource(o).toFixed(1)}`);
    return `${prefix} ${values.join(" / ")}${suffix}`;
  }
  return `${prefix} ${editorDurationSource(s).toFixed(1)}${suffix}`;
}
// ピン留めされたステップは楽曲上の絶対時刻をアンカーとして扱う。
// それ以外のステップだけを、直前のアンカー（または0秒）から技の長さで並べ直す。
function draftStarts() {
  let t = 0;
  return draft.steps.map((s) => {
    const st = s.cueLocked && s.cue != null ? s.cue : t;
    t = st + stepDur(s);
    return Math.round(st * 10) / 10;
  });
}
function applyDraftAutoCues() {
  const starts = draftStarts();
  draft.steps.forEach((s, i) => {
    if (!(s.cueLocked && s.cue != null)) s.cue = starts[i];
  });
}
function draftTotal() { return Math.round(draft.steps.reduce((a, s) => a + stepDur(s), 0) * 10) / 10; }
window.editorAutoCue = () => {
  if (!draft || !draft.steps.length) return;
  const hasLocks = draft.steps.some((s) => s.cueLocked && s.cue != null);
  const message = hasLocks
    ? "ピン留めした曲位置は維持して、それ以外のステップを技の長さから自動セットします。よいですか?"
    : "各技の長さから曲位置(♪)を自動計算して、全ステップのキューを上書きします。よいですか?";
  if (!appConfirm(message)) return;
  applyDraftAutoCues();
  render();
  toast(hasLocks ? "ピンを維持して曲位置を自動セットしました" : "曲位置を自動セットしました");
};

function renderEdit() {
  const rt = view.params.id ? state.routines.find((r) => r.id === view.params.id) : null;
  if (!draft || draft._for !== (view.params.id || "new")) {
    draft = rt
      ? { _for: rt.id, id: rt.id, name: rt.name, _sampleContent: !!rt.sampleSet,
          steps: cloneRoutineSteps(latestVersion(rt).steps),
          music: rt.music ? { ...rt.music } : null, countdownSeconds: routineCountdownSeconds(rt),
          featureSettings: { ...(rt.featureSettings || defaultRoutineFeatures()) }, _newMusicFile: null }
      : { _for: "new", name: "", steps: [], music: null,
          countdownSeconds: DEFAULT_RUN_COUNTDOWN, featureSettings: defaultRoutineFeatures(), _newMusicFile: null };
  }
  // リスク度はプルダウン(任意・省スペース)。選択値で文字色を変えて危険度が一目で分かるようにする
  const riskSelect = (selected, onchangeTpl) => `
    <select class="risk-select ${selected != null ? `risk-${selected}` : "unset"}" onchange="${onchangeTpl}" aria-label="リスク度(任意)">
      <option value="" ${selected == null ? "selected" : ""}>リスク —</option>
      ${RISK_LEVELS.map((n) => `<option value="${n}" ${selected === n ? "selected" : ""}>リスク ${n}</option>`).join("")}
    </select>`;
  const hasEditorMusic = !!(draft._newMusicFile || (rt && rt.music && draft.music));
  // 任意機能(初期は非表示。設定でON/OFF)。既に使われているステップは設定OFFでも操作可能にして詰まらせない
  const showRisk = routineFeatureEnabled(rt, "showRisk", draft.featureSettings);
  const showSlots = routineFeatureEnabled(rt, "showSlots", draft.featureSettings);
  const stepRows = draft.steps.map((s, i) => {
    // A/B機能がOFFのA/Bステップは、データは残したまま表示だけ畳んで「選択肢A」を通常の技として見せる
    const collapsedSlot = isSlot(s) && !showSlots;
    const nameVal = collapsedSlot ? optionDisplayName(s.options[0]) : stepDisplayName(s);
    const namePh = collapsedSlot ? "技名" : (isSlot(s) ? "分岐の名前(例: ラスト技)" : s.kind === "transition" ? "移行(例: 持ち替え)" : "技名");
    const nameOninput = collapsedSlot ? `draft.steps[${i}].options[0].name=this.value` : `draft.steps[${i}].name=this.value`;
    const stepKind = isSlot(s) ? "trick" : (s.kind || "trick");
    const kindToggleText = isEnglish() ? (stepKind === "trick" ? "Skill" : "Trans.") : (stepKind === "trick" ? "技" : "移行");
    const kindToggleLabel = isEnglish() ? (stepKind === "trick" ? "Skill" : "Transition") : (stepKind === "trick" ? "技" : "移行");
    const hasStepMeta = showSlots || (showRisk && (collapsedSlot || !isSlot(s)));
    return `
    <div class="editor-step" data-line-color="${itemLineColor(s)}">
      <div class="es-row1">
        <div class="es-lead">
          ${stepLineColorButtonHtml(s, i)}
          <span class="drag-handle" data-i="${i}" title="ドラッグで並べ替え" aria-label="ドラッグで並べ替え">⠿</span>
        </div>
        <input type="text" value="${esc(nameVal)}" placeholder="${namePh}"
          oninput="${nameOninput}">
        <button class="mini-btn del es-delete-top" onclick="delStep(${i})" aria-label="ステップを削除">✕</button>
      </div>
      <div class="es-row2">
        <div class="es-playback-controls">
          <div class="es-time-stack">
            <input type="text" class="cue-input ${s.cueLocked ? "locked" : ""}" inputmode="numeric" data-i="${i}"
              value="${s.cue != null ? fmtCue(s.cue) : ""}" placeholder="♪秒" onchange="setCue(${i},this.value)"
              ${s.cueLocked ? `readonly aria-label="ポジションロック中の曲位置" title="ピンを外すと曲位置を変更できます"` : `aria-label="曲位置"`}>
            <span class="es-duration">${editorDurationLabel(s, showSlots)}</span>
          </div>
          <button class="mini-btn cue-pin ${s.cueLocked ? "locked" : ""}" onclick="toggleCueLock(${i})"
            aria-pressed="${s.cueLocked ? "true" : "false"}"
            aria-label="${s.cueLocked ? "ポジションロックを解除" : "ポジションを固定"}"
            title="${s.cueLocked ? "ポジションロックを解除" : "この技を現在の曲位置に固定"}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 3.5h7l-1 5 2.5 2.5v2h-4v7l-1 1.5-1-1.5v-7H7v-2l2.5-2.5-1-5Z"/></svg>
          </button>
          ${hasEditorMusic && s.cue != null
            ? `<button class="mini-btn cue-play ${cuePlayStepId === s.id && !musicPlayer.paused ? "on" : ""}" data-cue-step="${s.id}" onclick="editorPlayFromCue(${i})">${cuePlayStepId === s.id && !musicPlayer.paused ? "♪❚❚" : "♪▶"}</button>` : ""}
          ${s.trickId && (state.tricks || []).some((t) => t.id === s.trickId)
            ? `<button class="mini-btn video-trim-btn" aria-label="動画を再生・トリム" title="動画を再生・トリム"
                 onclick="sheetTrimTrick('${s.trickId}','step:${i}')">▶</button>`
            : s.kind === "trick" && !isSlot(s)
              ? `<button class="mini-btn link" onclick="sheetLinkTrick(${i})">🔗</button>` : ""}
        </div>
        ${hasStepMeta ? `<div class="es-step-meta">
          ${showSlots ? (isSlot(s)
            ? `<button class="kind-toggle t" onclick="toggleSlot(${i})">A/B解除</button>`
            : `<button class="kind-toggle" onclick="toggleSlot(${i})">A/B化</button>`) : ""}
          ${showRisk
            ? (collapsedSlot
                ? riskSelect(s.options[0].risk ?? null, `setOptRisk(${i},0,this.value)`)
                : (!isSlot(s) ? riskSelect(s.risk ?? null, `setRisk(${i},this.value)`) : ""))
            : ""}
        </div>` : ""}
        <button class="kind-toggle es-kind-toggle ${stepKind === "trick" ? "t" : ""}"
          onclick="toggleStepKind(${i})" ${isSlot(s)
            ? `aria-label="A/B選択の技。タップで移行に変更" title="移行にする場合は確認します"`
            : `aria-label="${kindToggleLabel}"`}>${kindToggleText}</button>
      </div>
      ${isSlot(s) && showSlots ? s.options.map((o, oi) => `
        <div class="es-opt">
          <span class="es-opt-mark">${String.fromCharCode(65 + oi)}</span>
          <input type="text" value="${esc(optionDisplayName(o))}" placeholder="選択肢${String.fromCharCode(65 + oi)}の技名"
            oninput="draft.steps[${i}].options[${oi}].name=this.value">
          ${o.trickId && (state.tricks || []).some((t) => t.id === o.trickId)
            ? `<button class="mini-btn video-trim-btn" aria-label="選択肢の動画を再生・トリム" title="動画を再生・トリム"
                 onclick="sheetTrimTrick('${o.trickId}','option:${i}:${oi}')">▶</button>`
            : `<button class="mini-btn link" aria-label="選択肢に動画を紐づけ" title="動画を紐づけ"
                 onclick="sheetLinkTrickToOption(${i},${oi})">🔗</button>`}
          ${showRisk ? riskSelect(o.risk ?? null, `setOptRisk(${i},${oi},this.value)`) : ""}
          ${s.options.length > 2 ? `<button class="mini-btn del" onclick="delOpt(${i},${oi})">✕</button>` : ""}
        </div>`).join("") + (s.options.length < 3 ? `
        <button class="btn small ghost" style="margin:8px 0 0 32px" onclick="addOpt(${i})">＋ 選択肢を追加</button>` : "")
      : ""}
    </div>`;
  }).join("");
  // 編集中の試聴プレイヤー(音源があれば)。再生すると♪キューに沿って該当ステップが光る
  if (hasEditorMusic) setTimeout(loadEditorMusic, 0);
  // 構成バーは表示せず、曲長と合計時間の比較だけを小さく残す。
  let durationSummary = "";
  if (hasEditorMusic && draft.steps.length) {
    const total = draftTotal();
    const songDur = (musicLoadedFor && String(musicLoadedFor).startsWith("edit")) ? musicEffectiveDuration() : null;
    const over = songDur && total > songDur + 0.5;
    durationSummary = `<div class="tl-caption">構成 ${fmtTime(total)}${songDur ? ` / 曲 ${fmtTime(songDur)}` : ""}${over ? ` <span style="color:var(--danger);margin-left:6px">曲より長い</span>` : ""}${infoBtn("timeline")}</div>`;
  }
  // 楽曲カード(プレイヤーと楽曲の選択/添付を1カードに統合)。音源が無い時は小さな選択行のみ
  const trackName = draft._newMusicFile ? draft._newMusicFile.name : (draft.music ? draft.music.name : "");
  const musicCard = hasEditorMusic ? `
    <div class="card music-card">
      <div class="music-track-stack">
        <div class="music-track-line">
          <span class="music-track-label">楽曲</span>
          <input type="range" id="music-seek" min="0" max="100" step="0.1" value="0" aria-label="楽曲の再生位置" oninput="musicSeek(this.value)">
          ${durationSummary}
        </div>
      </div>
      <div class="music-foot">
        <span class="mf-name" title="${esc(trackName)}">♪ ${esc(trackName)}${musicMetaIsTrimmed(draft.music) ? " ✂" : ""}</span>
        <div class="music-foot-actions">
          <button class="mini-btn" onclick="sheetTrimRoutineMusic()">編集</button>
          <button class="mini-btn del" onclick="removeMusic()">削除</button>
        </div>
      </div>
      <input type="file" id="music-file" accept="audio/*" class="hidden" onchange="attachMusic(this)">
    </div>` : `
    <div class="card music-card music-empty">
      <div class="me-label">♪ 楽曲(任意)</div>
      <div class="row-2">
        <button class="btn small primary" onclick="sheetPickLibraryMusic('edit')">♪ ライブラリから</button>
        <button class="btn small" onclick="document.getElementById('music-file').click()">＋ 音源を添付</button>
      </div>
      <input type="file" id="music-file" accept="audio/*" class="hidden" onchange="attachMusic(this)">
    </div>`;
  return `
    <div class="topbar"><button class="back-btn" onclick="draft=null;go('routines')">戻る</button>
      <h1>${rt ? "ルーティン編集" : "新規ルーティン"}</h1>${routineMenuAction(rt ? rt.id : "")}</div>
    ${draft._restoredFromVersion ? `<div class="version-restore-notice">
      <span><b>v${draft._restoredFromVersion}</b> の構成を編集中です</span>
      <button type="button" onclick="cancelVersionRestore('${rt.id}')">現在のv${rt.versions.length}に戻す</button>
    </div>` : ""}
    ${practiceNowDockHtml(editorPreviewPlayerHtml(hasEditorMusic))}
    <div class="card routine-name-card">
      <label class="fld">ルーティン名</label>
      <input type="text" value="${esc(sampleDisplayText(draft.name, draft._sampleContent))}" placeholder="例: 2026ステージ用 4分" oninput="draft.name=this.value">
    </div>
    ${musicCard}
    <div class="card">
      <h2>ステップ(技と移行) — 上から実施順${infoBtn("steps")}</h2>
      ${stepRows || `<div class="empty">「＋ 技」で最初の技を追加</div>`}
      <div class="row-2" style="margin-top:12px">
        <button class="btn small" onclick="addStep('trick')">＋ 技</button>
        <button class="btn small" onclick="sheetPickTrick()">＋ 技リストから</button>
        <button class="btn small ghost" onclick="addStep('transition')">＋ 移行</button>
      </div>
      ${hasEditorMusic && draft.steps.length ? `<button class="btn small primary" style="margin-top:10px;width:100%" onclick="editorAutoCue()">♪ 技の長さから曲位置を自動セット${draft.steps.some((s) => s.cueLocked) ? "（ピンを維持）" : ""}</button>` : ""}
    </div>
    <button class="btn primary" onclick="saveRoutine()">保存</button>
    ${rt ? `<button class="btn" onclick="duplicateRoutine('${rt.id}')">このルーティンを複製</button>` : ""}`;
}
window.toggleKind = (i) => { draft.steps[i].kind = draft.steps[i].kind === "trick" ? "transition" : "trick"; render(); };
window.toggleStepKind = (i) => {
  const s = draft && draft.steps[i];
  if (!s) return;
  if (!isSlot(s)) return window.toggleKind(i);
  if (!appConfirm("A/B選択を解除して「移行」に変更しますか?\n選択肢Aを移行として残し、選択肢B以降は削除されます。")) return;
  flattenSlotToStep(s, "transition");
  render();
};
window.setRisk = (i, n) => {
  if (n === "" || n == null) delete draft.steps[i].risk;
  else draft.steps[i].risk = Number(n);
  render();
};
// このステップの♪キュー位置から曲を再生/一時停止。押した技のボタンだけ再生↔停止でトグルする
let cuePlayStepId = null;
window.editorPlayFromCue = (i) => {
  const s = draft && draft.steps[i];
  if (!s || s.cue == null || !musicPlayer.src) return;
  if (cuePlayStepId === s.id) {
    // 同じ技のボタン: 再生中なら一時停止、停止中なら再開(位置はそのまま)
    if (musicPlayer.paused) { ensureAudioGraph(); playMedia(musicPlayer, "楽曲を再生できませんでした"); } else musicPlayer.pause();
  } else {
    // 別の技のボタン: その技の位置へ頭出しして再生
    cuePlayStepId = s.id;
    ensureAudioGraph();
    musicSetTime(s.cue);
    playMedia(musicPlayer, "楽曲を再生できませんでした");
  }
  updateCueButtons();
};
// ♪キュー再生ボタンの表示更新(押した技=再生中は一時停止アイコン、他は常に再生アイコン)
function updateCueButtons() {
  document.querySelectorAll(".cue-play").forEach((b) => {
    const active = cuePlayStepId && b.dataset.cueStep === cuePlayStepId && !musicPlayer.paused;
    b.textContent = active ? "♪❚❚" : "♪▶";
    b.classList.toggle("on", !!active);
  });
}
// 曲位置キュー(この技を曲の何秒に入れるか)。注釈扱いなので版は分割しない
window.setCue = (i, v) => {
  if (draft.steps[i] && draft.steps[i].cueLocked) return toast("ピンを外すと曲位置を変更できます");
  const cue = parseCue(v);
  if (Number.isNaN(cue)) { toast("秒指定は「1:23.4」か「83.4」の形式で"); render(); return; }
  if (cue == null) delete draft.steps[i].cue;
  else draft.steps[i].cue = cue;
  render();
};
window.toggleCueLock = (i) => {
  const s = draft && draft.steps[i];
  if (!s) return;
  if (s.cueLocked) {
    delete s.cueLocked;
    render();
    toast("ポジションロックを解除しました");
    return;
  }
  if (s.cue == null) s.cue = draftStarts()[i];
  s.cueLocked = true;
  render();
  toast("この曲位置に固定しました");
};
// ♪欄の横スワイプで秒数を微調整(20px=1秒、0.1秒刻み)。タップなら従来どおりキーボード入力
let cueDrag = null;
document.addEventListener("pointerdown", (e) => {
  const inp = e.target.closest(".cue-input");
  if (!inp || view.name !== "edit" || !draft) return;
  const i = Number(inp.dataset.i);
  if (draft.steps[i] && draft.steps[i].cueLocked) return;
  cueDrag = { inp, i, startX: e.clientX, startY: e.clientY,
    base: draft.steps[i] && draft.steps[i].cue != null ? draft.steps[i].cue : 0, moved: false, cur: null };
}, true);
document.addEventListener("pointermove", (e) => {
  if (!cueDrag) return;
  const dx = e.clientX - cueDrag.startX, dy = e.clientY - cueDrag.startY;
  if (!cueDrag.moved) {
    if (Math.abs(dx) < 8) return;
    if (Math.abs(dy) > Math.abs(dx)) { cueDrag = null; return; } // 縦スクロール優先
    cueDrag.moved = true;
    cueDrag.inp.blur(); // ドラッグ中はキーボードを出さない
  }
  cueDrag.cur = Math.max(0, round1(cueDrag.base + dx * 0.05));
  cueDrag.inp.value = fmtCue(cueDrag.cur);
});
document.addEventListener("pointerup", () => {
  if (!cueDrag) return;
  const d = cueDrag; cueDrag = null;
  if (!d.moved || d.cur == null || !draft || !draft.steps[d.i]) return;
  draft.steps[d.i].cue = d.cur;
  swipeSuppressClick = true;
  setTimeout(() => { swipeSuppressClick = false; }, 80);
  render();
});

// ステップのドラッグ&ドロップ並べ替え(つまみ=番号の下のグリップ)。タッチ対応のためPointer Eventsで実装
let stepDrag = null;
// 入れ替えプレビュー: ドラッグ中、通過した行が上下にスライドして空きを作る(重なって隠れない)
function applyDragShift(d) {
  d.steps.forEach((el, k) => {
    if (k === d.fromIndex) return;
    let ty = 0;
    if (d.insertAt > d.fromIndex && k > d.fromIndex && k < d.insertAt) ty = -d.draggedH; // 下へ→間の行は上へ
    else if (d.insertAt <= d.fromIndex && k >= d.insertAt && k < d.fromIndex) ty = d.draggedH; // 上へ→間の行は下へ
    el.style.transform = ty ? `translateY(${ty}px)` : "";
  });
}
document.addEventListener("pointerdown", (e) => {
  const h = e.target.closest(".drag-handle");
  if (!h || view.name !== "edit" || !draft) return;
  e.preventDefault();
  const stepEl = h.closest(".editor-step");
  const container = stepEl.parentElement;
  const steps = [...container.querySelectorAll(".editor-step")];
  stepDrag = {
    fromIndex: Number(h.dataset.i),
    stepEl, steps, startY: e.clientY,
    rects: steps.map((el) => el.getBoundingClientRect()),
    draggedH: stepEl.offsetHeight,
    insertAt: Number(h.dataset.i),
    pointerId: e.pointerId,
  };
  try { stepEl.setPointerCapture(e.pointerId); } catch (_) {}
  stepEl.classList.add("dragging");
  document.body.classList.add("dragging-active");
}, true);
document.addEventListener("pointermove", (e) => {
  if (!stepDrag) return;
  e.preventDefault();
  const d = stepDrag;
  d.stepEl.style.transform = `translateY(${e.clientY - d.startY}px)`;
  // ドロップ位置(0..n)を、開始時スナップショットした各行の中央線で判定
  let insertAt = d.rects.length;
  for (let k = 0; k < d.rects.length; k++) {
    const r = d.rects[k];
    if (e.clientY < r.top + r.height / 2) { insertAt = k; break; }
  }
  d.insertAt = insertAt;
  applyDragShift(d);
}, true);
function endStepDrag(commit) {
  if (!stepDrag) return;
  const d = stepDrag; stepDrag = null;
  d.stepEl.classList.remove("dragging");
  document.body.classList.remove("dragging-active");
  d.steps.forEach((el) => { el.style.transform = ""; });
  if (commit && draft && draft.steps[d.fromIndex]) {
    const from = d.fromIndex;
    let to = d.insertAt > from ? d.insertAt - 1 : d.insertAt; // 自分を抜いた分の補正
    to = Math.max(0, Math.min(to, draft.steps.length - 1));
    if (to !== from) {
      const [item] = draft.steps.splice(from, 1);
      draft.steps.splice(to, 0, item);
      // ピンがあるルーティンでは、固定位置はそのままに未固定の♪秒だけを並べ直す。
      if (draft.steps.some((s) => s.cueLocked && s.cue != null)) applyDraftAutoCues();
    }
  }
  swipeSuppressClick = true;
  setTimeout(() => { swipeSuppressClick = false; }, 80);
  render();
}
document.addEventListener("pointerup", () => endStepDrag(true), true);
document.addEventListener("pointercancel", () => endStepDrag(false), true);

function flattenSlotToStep(s, kind = "trick") {
  const a = s.options[0];
  s.name = a.name || s.name;
  if (a.risk != null) s.risk = a.risk; else delete s.risk;
  if (a.trickId) s.trickId = a.trickId; else delete s.trickId;
  delete s.options;
  s.kind = kind;
}

// A/B化: 既存の技名を選択肢Aに移し、スロット(分岐)にする。解除は選択肢Aを技に戻す
window.toggleSlot = (i) => {
  const s = draft.steps[i];
  if (isSlot(s)) {
    flattenSlotToStep(s, "trick");
  } else {
    const optA = { id: uid(), name: s.name, sampleContent: !!s.sampleContent };
    if (s.risk != null) optA.risk = s.risk;
    if (s.trickId) optA.trickId = s.trickId;
    s.options = [optA, { id: uid(), name: "" }];
    s.name = "";
    delete s.trickId;
    s.kind = "trick";
  }
  render();
};
window.setOptRisk = (i, oi, n) => {
  if (n === "" || n == null) delete draft.steps[i].options[oi].risk;
  else draft.steps[i].options[oi].risk = Number(n);
  render();
};
window.duplicateRoutine = async (id) => {
  const src = state.routines.find((r) => r.id === id);
  if (!src) return;
  return withLoading("ルーティンを複製中…", async () => {
    const ver = latestVersion(src);
    let music = null;
    if (src.music) {
      const blob = await blobGet(src.music.blobId);
      if (blob) { const bid = uid(); if (await blobPut(bid, blob)) music = { ...src.music, blobId: bid }; }
    }
    state.routines.push({
      id: uid(), name: `${src.name} (コピー)`, music, copiedFrom: src.id,
      lineColor: itemLineColor(src),
      countdownSeconds: routineCountdownSeconds(src),
      featureSettings: { ...(src.featureSettings || defaultRoutineFeatures()) },
      partLoop: src.partLoop ? { ...src.partLoop } : undefined,
      versions: [{ id: uid(), createdAt: Date.now(),
        steps: cloneRoutineSteps(ver.steps).map((s) => ({ ...s, id: uid(),
          options: s.options ? s.options.map((o) => ({ ...o, id: uid() })) : undefined })) }],
    });
    saveState(); draft = null; go("routines");
    toast("複製しました(記録・分析データは引き継ぎません)");
  });
};
window.cancelVersionRestore = (routineId) => {
  const rt = state.routines.find((routine) => routine.id === routineId);
  if (!rt || !draft || draft.id !== routineId) return;
  draft.steps = cloneRoutineSteps(latestVersion(rt).steps);
  delete draft._restoredFromVersion;
  render(); toast("現在の構成に戻しました");
};
window.addOpt = (i) => { draft.steps[i].options.push({ id: uid(), name: "" }); render(); };
window.delOpt = (i, oi) => { draft.steps[i].options.splice(oi, 1); render(); };
window.moveStep = (i, d) => { const [s] = draft.steps.splice(i, 1); draft.steps.splice(i + d, 0, s); render(); };
window.delStep = (i) => { draft.steps.splice(i, 1); render(); };
window.addStep = (kind) => { draft.steps.push({ id: uid(), name: "", kind, lineColor: "blue" }); render(); };

// 技ライブラリから選んでステップに追加(trickIdで動画に紐づく)
window.sheetPickTrick = () => {
  const tricks = (state.tricks || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  if (!tricks.length) {
    return showSheet(`
      <h3>技リストから追加</h3>
      <div class="empty">技ライブラリが空です。<br>先に技を撮影・登録してください。</div>
      <button class="btn" onclick="hideSheet();go('tricks')">技ライブラリへ</button>
      <button class="btn ghost" onclick="hideSheet()">閉じる</button>`);
  }
  showSheet(`
    <h3>技リストから追加</h3>
    <div class="sheet-sub">タップで追加 / 再生マークで動画を確認</div>
    ${tricks.map((t) => `
      <div class="pick-trick-row" data-line-color="${itemLineColor(t)}" onclick="addStepFromTrick('${t.id}')">
        <span class="nm">${esc(trickDisplayName(t))}</span>
        <span class="kn">${fmtTime(t.duration)}</span>
        <button class="mini-btn play" aria-label="${esc(trickDisplayName(t))}の動画を再生" onclick="event.stopPropagation();playTrickVideo('${t.id}',true)">▶</button>
      </div>`).join("")}
    <div style="height:10px"></div>
    <button class="btn ghost" onclick="hideSheet()">閉じる</button>`);
};
window.addStepFromTrick = (trickId) => {
  const t = (state.tricks || []).find((x) => x.id === trickId);
  if (!t || !draft) return hideSheet();
  draft.steps.push({ id: uid(), name: t.name, kind: "trick", trickId: t.id,
    lineColor: itemLineColor(t), sampleContent: !!t.sample });
  hideSheet(); render();
  toast(`「${t.name}」を追加しました`);
};

// バージョン分割は「構成の変更(技名・種別・順序・選択肢)」でのみ発生させる。
// リスク度は主観アノテーションなので、変えても統計を分割しない(在版を更新するだけ)。
const stepsSignature = (steps) => steps.map((s) =>
  `${s.name}|${s.kind}|${(s.options || []).map((o) => o.name).join("+")}`).join("//");

window.attachMusic = (input) => {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 40 * 1024 * 1024) { input.value = ""; return toast("40MB以下の音源にしてください"); }
  draft._newMusicFile = file;
  draft.music = normalizeMusicMeta({ name: file.name, fullDuration: null, trimStart: 0, trimEnd: null, duration: null });
  draft._removeMusic = false;
  musicPlayer.pause(); musicLoadedFor = null;
  input.value = "";
  render();
};
window.removeMusic = () => { draft._newMusicFile = null; draft.music = null; draft._removeMusic = true; musicPlayer.pause(); musicLoadedFor = null; render(); };
// 添付/削除の差分を音声Blobストアに反映し、routine.musicメタを返す。
// 安全側の原則: 「削除」を明示的に押したときだけ既存Blobを消す。
// それ以外は draft の状態がどうであれ既存の楽曲を維持する(想定外のdraft破損で音源を失わないため)
async function applyMusicChange(prevMusic) {
  if (draft._newMusicFile) {
    const blobId = uid();
    const ok = await blobPut(blobId, draft._newMusicFile);
    if (!ok) { toast("音源を保存できませんでした(既存の音源を維持します)"); return prevMusic || null; }
    if (prevMusic && !preserveRunVideoMusicSnapshots(draft.id, prevMusic)) blobDel(prevMusic.blobId);
    return normalizeMusicMeta({ ...(draft.music || {}), blobId, name: draft._newMusicFile.name });
  }
  if (draft._removeMusic && prevMusic) {
    if (!preserveRunVideoMusicSnapshots(draft.id, prevMusic)) blobDel(prevMusic.blobId);
    return null;
  }
  // Blobが同じでも、編集画面で変更したトリム範囲は保存する。
  return draft.music ? { ...(prevMusic || {}), ...draft.music } : (prevMusic || null);
}

window.saveRoutine = async () => {
  // スロットは選択肢名があれば残す(ラベル自体は任意)。空の選択肢は落とす
  for (const s of draft.steps) {
    if (Array.isArray(s.options)) {
      s.options = s.options.filter((o) => o.name.trim());
      if (s.options.length === 1) {
        s.name = s.name || s.options[0].name;
        if (s.options[0].risk != null) s.risk = s.options[0].risk; else delete s.risk;
        delete s.options;
      }
      else if (s.options.length === 0) delete s.options;
    }
  }
  draft.steps = draft.steps.filter((s) => isSlot(s) || s.name.trim());
  if (!draft.name.trim()) return toast("ルーティン名を入れてください");
  if (draft.steps.length < 2) return toast("ステップを2つ以上登録してください");
  // 時系列チェック: 後のステップの♪キューが前のステップより早い場合は保存不可(理由を明記)
  const cued = draft.steps.map((s, i) => ({ s, i })).filter((x) => x.s.cue != null);
  const violations = [];
  for (let k = 1; k < cued.length; k++) {
    if (cued[k].s.cue < cued[k - 1].s.cue) violations.push([cued[k - 1], cued[k]]);
  }
  if (violations.length) {
    return showSheet(`
      <h3>保存できません</h3>
      <div class="sheet-sub">ステップの順番と♪秒指定が時系列的に矛盾しています</div>
      ${violations.map(([a, b]) => `
        <div class="gap-note" style="margin-bottom:8px">
          ${b.i + 1}番「${esc(stepLabel(b.s))}」(♪${fmtCue(b.s.cue)}) が、
          その前の ${a.i + 1}番「${esc(stepLabel(a.s))}」(♪${fmtCue(a.s.cue)}) より早い時間になっています
        </div>`).join("")}
      <p class="hint">順番を入れ替えるか、♪秒指定を直してから保存してください。</p>
      <button class="btn primary" onclick="hideSheet()">直す</button>`);
  }
  return withLoading("ルーティンを保存中…", async () => {
    if (draft.id) {
      const rt = state.routines.find((r) => r.id === draft.id);
      rt.name = draft.name.trim();
      rt.countdownSeconds = normalizeRunCountdown(draft.countdownSeconds);
      rt.featureSettings = { ...(draft.featureSettings || defaultRoutineFeatures()) };
      rt.music = await applyMusicChange(rt.music);
      if (musicLoadedFor === rt.id) musicLoadedFor = null; // 次回記録画面で再ロード
      const cur = latestVersion(rt);
      const structuralChange = stepsSignature(cur.steps) !== stepsSignature(draft.steps);
      const hasRuns = state.sessions.some((s) => s.versionId === cur.id && s.runs.length > 0);
      const restoredFromVersion = draft._restoredFromVersion;
      if (restoredFromVersion || (structuralChange && hasRuns)) {
        // 過去版からの復元は常に新バージョン。通常編集は記録済み構成を変えたときだけ版を分ける。
        rt.versions.push({ id: uid(), createdAt: Date.now(),
          label: restoredFromVersion ? `v${restoredFromVersion}から復元` : undefined,
          restoredFromVersion: restoredFromVersion || undefined,
          steps: cloneRoutineSteps(draft.steps) });
        toast(`構成が変わったので v${rt.versions.length} を作成しました(分析は分かれます)`);
      } else {
        // 構成は同じ(リスク度だけの変更を含む)、または記録がまだない → 在版をその場で更新
        cur.steps = cloneRoutineSteps(draft.steps);
      }
    } else {
      const music = await applyMusicChange(null);
      state.routines.push({ id: uid(), name: draft.name.trim(), music, lineColor: "blue",
        countdownSeconds: normalizeRunCountdown(draft.countdownSeconds),
        featureSettings: { ...(draft.featureSettings || defaultRoutineFeatures()) },
        versions: [{ id: uid(), createdAt: Date.now(), steps: draft.steps }] });
    }
    saveState(); draft = null; go("routines");
  });
};

// ========== 記録 ==========
function activeSession(routineId) {
  return state.sessions.find((s) => s.routineId === routineId && !s.endedAt);
}
function routineRunProgress(routineId) {
  const sessions = state.sessions.filter((s) => s.routineId === routineId);
  const totalRuns = sessions.flatMap((s) => s.runs || []);
  const todayRuns = sessions.filter((s) => s.date === today()).flatMap((s) => s.runs || []);
  return {
    totalCompleted: totalRuns.length,
    todayCompleted: todayRuns.length,
    todayClean: todayRuns.filter((r) => r.outcome === "clean").length,
    nextToday: todayRuns.length + 1,
  };
}

// セッション(練習日)と1本の通しは別に扱う。スタート確認後にだけ失敗/クリーンを記録できる。
let activeFullRunRoutineId = null;
let runCountdownTimer = null;
let runCountdownFinishTimer = null;
function fullRunIsActive(routineId) {
  return activeFullRunRoutineId === routineId || !!(openRun && openRun.routineId === routineId);
}
function removeRunCountdownOverlay() {
  document.getElementById("run-countdown")?.remove();
}
function clearRunCountdown() {
  if (runCountdownTimer) clearInterval(runCountdownTimer);
  if (runCountdownFinishTimer) clearTimeout(runCountdownFinishTimer);
  runCountdownTimer = null;
  runCountdownFinishTimer = null;
  removeRunCountdownOverlay();
}
window.cancelRunCountdown = () => {
  clearRunCountdown();
  stopRunCameraNow();
  musicResetForNextRun();
  toast("通し練習の開始をキャンセルしました");
};

window.confirmRunStart = (routineId) => {
  const rt = state.routines.find((r) => r.id === routineId);
  if (!rt) return;
  const sess = activeSession(routineId);
  if (!sess) return sheetStartSession(rt);
  if (fullRunIsActive(routineId)) return toast("この通しは開始済みです");
  const countdown = routineCountdownSeconds(rt);
  const runProgress = routineRunProgress(routineId);
  const first = latestVersion(rt).steps[0];
  showSheet(`
    <h3>通し練習を始めますか？</h3>
    <div class="sheet-sub">${esc(routineDisplayName(rt))}</div>
    <div class="run-confirm-note">
      <div><span>最初の技</span><b>${first ? esc(stepLabel(first)) : "—"}</b></div>
      <div><span>楽曲</span><b>${rt.music ? `「${esc(rt.music.name)}」を0秒から再生` : "楽曲なし"}</b></div>
    </div>
    <section class="run-camera-confirm" id="run-camera-area">
      ${runCameraConfirmBody(rt.id)}
    </section>
    <div class="run-confirm-count">
      <b class="run-confirm-order">本日 ${runProgress.nextToday}本目</b>
      <span>COUNTDOWN</span>
      <div class="run-confirm-adjust">
        <button type="button" onclick="adjustConfirmRunCountdown('${rt.id}',-1)" aria-label="開始までの時間を1秒短くする">−</button>
        <strong id="run-confirm-countdown-value" aria-live="polite">${countdown}秒</strong>
        <button type="button" onclick="adjustConfirmRunCountdown('${rt.id}',1)" aria-label="開始までの時間を1秒長くする">＋</button>
      </div>
      <small>0になったら通し練習スタートです</small>
      <em>ここでの変更はこのルーティンに保存されます</em>
    </div>
    <button class="btn primary run-confirm-btn" onclick="startRunCountdown('${rt.id}')">始める</button>
    <button class="btn ghost" onclick="hideSheet()">キャンセル</button>`);
};

window.adjustConfirmRunCountdown = (routineId, delta) => {
  const rt = state.routines.find((r) => r.id === routineId);
  if (!rt) return;
  const next = normalizeRunCountdown(routineCountdownSeconds(rt) + Number(delta || 0));
  rt.countdownSeconds = next;
  saveState();
  const value = document.getElementById("run-confirm-countdown-value");
  if (value) value.textContent = uiText(`${next}秒`);
  const recordHint = document.querySelector(".run-start-countdown");
  if (recordHint) recordHint.textContent = uiText(`${next}秒カウントダウン`);
};

window.startRunCountdown = (routineId) => {
  const rt = state.routines.find((r) => r.id === routineId);
  const sess = activeSession(routineId);
  if (!rt || !sess || fullRunIsActive(routineId)) return;
  const seconds = routineCountdownSeconds(rt);
  const runProgress = routineRunProgress(routineId);
  runCameraArmed = runCameraReady(routineId);
  hideSheet();
  clearRunCountdown();
  musicResetForNextRun();

  // ユーザー操作の直後に一度再生権限を取得し、カウント終了時の自動再生成功率を上げる。
  if (rt.music && musicPlayer.src && !musicMissing) {
    ensureAudioGraph();
    const priming = musicPlayer.play();
    if (priming && priming.then) {
      priming.then(() => { musicPlayer.pause(); musicSetTime(0); }).catch(() => {});
    }
  }

  document.body.insertAdjacentHTML("beforeend", `
    <div id="run-countdown" class="run-countdown-overlay" role="status" aria-live="assertive">
      <div class="run-countdown-card">
        <b class="run-countdown-order">本日 ${runProgress.nextToday}本目</b>
        <small>通し練習モード</small>
        <strong id="run-countdown-number">${seconds || "START"}</strong>
        <span>${esc(routineDisplayName(rt))}</span>
        <button onclick="cancelRunCountdown()">キャンセル</button>
      </div>
    </div>`);

  const begin = () => {
    if (runCountdownTimer) clearInterval(runCountdownTimer);
    runCountdownTimer = null;
    activeFullRunRoutineId = routineId;
    const number = document.getElementById("run-countdown-number");
    const card = document.querySelector(".run-countdown-card");
    if (number) number.textContent = "START";
    if (card) card.classList.add("go");
    runCountdownFinishTimer = setTimeout(() => {
      runCountdownFinishTimer = null;
      removeRunCountdownOverlay();
      const hasPlayableMusic = !!(rt.music && musicPlayer.src && !musicMissing);
      if (!hasPlayableMusic) startRunVideoCapture(routineId);
      render();
      if (hasPlayableMusic) {
        ensureAudioGraph(); musicSetTime(0);
        const playing = musicPlayer.play();
        if (playing && playing.catch) playing.catch(() => toast("楽曲は再生ボタンから開始してください"));
      }
    }, 520);
  };

  if (seconds <= 0) return begin();
  let remaining = seconds;
  runCountdownTimer = setInterval(() => {
    remaining -= 1;
    const number = document.getElementById("run-countdown-number");
    if (remaining <= 0) begin();
    else if (number) number.textContent = String(remaining);
  }, 1000);
};

// スロットの現在の選択(セッションの既定値。演技中に変えたらチップで切り替える)
// A/B分岐がOFFの間は、選択チップを出さず常に選択肢A(options[0])に固定する
function currentChoice(rt, sess, st) {
  if (!routineFeatureEnabled(rt, "showSlots")) return st.options[0].id;
  return (sess && sess.slotDefaults && sess.slotDefaults[st.id]) || st.options[0].id;
}
function currentChoices(rt, ver, sess) {
  const out = {};
  for (const st of ver.steps) if (isSlot(st)) out[st.id] = currentChoice(rt, sess, st);
  return Object.keys(out).length ? out : undefined;
}
window.setSlotChoice = (stepId, optId) => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  const sess = activeSession(rt.id);
  if (!sess) return;
  sess.slotDefaults = { ...(sess.slotDefaults || {}), [stepId]: optId };
  saveState(); render();
};

function renderRecord() {
  const rt = state.routines.find((r) => r.id === view.params.id);
  if (!rt) return renderHome();
  const ver = latestVersion(rt);
  const sess = activeSession(rt.id);
  if (!sess) { setTimeout(() => sheetStartSession(rt), 0); }
  const runProgress = routineRunProgress(rt.id);
  const isOpen = openRun && openRun.routineId === rt.id;
  const runActive = fullRunIsActive(rt.id);
  const countdown = routineCountdownSeconds(rt);

  // 楽曲プレイヤー(添付がある場合のみ)
  if (rt.music && musicLoadedFor !== rt.id) setTimeout(() => loadMusic(rt), 0);
  const recordMusicDuration = rt.music
    ? ((musicLoadedFor === rt.id && musicEffectiveDuration()) || Number(rt.music.duration) || 0) : 0;
  const musicCard = rt.music ? `
    <div class="card music-card">
      ${musicMissing && musicLoadedFor === rt.id
        ? `<div class="hint">♪ 音源データが見つかりません(バックアップ復元後は編集画面で再添付してください)</div>`
        : `<div class="music-name">♪ ${esc(rt.music.name)}</div>
           <div class="music-time big"><span id="music-cur">${fmtTimeFine(musicLoadedFor === rt.id ? musicCurrentTime() : 0)}</span><span class="dur"> / <span id="music-dur">${fmtTime(recordMusicDuration)}</span></span></div>
           <input type="range" id="music-seek" min="0" max="${recordMusicDuration || 100}" step="0.1" value="${musicLoadedFor === rt.id ? musicCurrentTime() : 0}" oninput="musicSeek(this.value)">
           <div class="music-controls">
             <button class="music-pill primary" id="music-toggle-pill" onclick="musicToggle()">▶ 再生</button>
             <button class="music-pill" onclick="musicStop()">■ 停止(頭に戻す)</button>
           </div>
           <div class="volume-row">
             <span class="vol-ico">🔈</span>
             <input type="range" id="music-vol" min="0" max="1" step="0.02" value="${musicVolume}" oninput="musicSetVolume(this.value)">
             <span class="vol-ico">🔊</span>
           </div>`}
    </div>` : "";

  const showSlots = routineFeatureEnabled(rt, "showSlots");
  const showRisk = routineFeatureEnabled(rt, "showRisk");
  const stepBtns = ver.steps.map((s, i) => {
    const hitCount = isOpen ? openRun.events.filter((e) => e.stepIndex === i).length : 0;
    if (isSlot(s) && showSlots) {
      const sel = currentChoice(rt, sess, s);
      const selOpt = s.options.find((o) => o.id === sel) || s.options[0];
      const risk = selOpt.risk; // 任意。未設定ならバッジなし
      return `<div class="step-btn slot" onclick="tapStep(${i})">
        <span class="no">${i + 1}</span>
        <div class="slot-body">
          ${s.name || s.cue != null ? `<span class="slot-label">${s.cue != null ? `♪${fmtCue(s.cue)} ` : ""}${esc(stepDisplayName(s))}</span>` : ""}
          <div class="slot-chips">${s.options.map((o) => `<button class="opt-chip ${sel === o.id ? "selected" : ""}"
            onclick="event.stopPropagation();setSlotChoice('${s.id}','${o.id}')">${esc(optionDisplayName(o))}</button>`).join("")}</div>
        </div>
        ${hitCount ? `<span class="badge hit">記録 ${hitCount}件</span>` : showRisk && risk >= 3 ? `<span class="badge risk-${risk}">${RISK_LABEL[risk]}</span>` : ""}
      </div>`;
    }
    if (isSlot(s)) {
      // A/B分岐OFF: 選択肢A(options[0])を通常の技として表示。チップは出さず、常にAで進める
      const selOpt = s.options[0];
      const risk = selOpt.risk;
      return `<div class="step-btn ${s.kind}" onclick="tapStep(${i})">
        <span class="no">${i + 1}</span><span class="nm">${s.cue != null ? `<span class="cue-chip">♪${fmtCue(s.cue)}</span> ` : ""}${esc(optionDisplayName(selOpt) || stepDisplayName(s))}</span>
        ${hitCount ? `<span class="badge hit">記録 ${hitCount}件</span>` : showRisk && risk >= 3 ? `<span class="badge risk-${risk}">${RISK_LABEL[risk]}</span>` : ""}
      </div>`;
    }
    const risk = s.risk; // 任意。未設定ならバッジなし
    const hasVideo = s.trickId && (state.tricks || []).some((t) => t.id === s.trickId);
    return `<div class="step-btn ${s.kind}" onclick="tapStep(${i})">
      <span class="no">${i + 1}</span><span class="nm">${s.cue != null ? `<span class="cue-chip">♪${fmtCue(s.cue)}</span> ` : ""}${esc(stepDisplayName(s))}</span>
      ${hasVideo ? `<button class="mini-btn play" aria-label="${esc(stepDisplayName(s))}の動画を再生" onclick="event.stopPropagation();playTrickVideo('${s.trickId}')">▶</button>` : ""}
      ${hitCount ? `<span class="badge hit">記録 ${hitCount}件</span>` : showRisk && risk >= 3 ? `<span class="badge risk-${risk}">${RISK_LABEL[risk]}</span>` : ""}
    </div>`;
  }).join("");

  return `
    <div class="topbar"><button class="back-btn" onclick="endSessionAsk('${rt.id}')">戻る</button>
      <h1 class="record-mode-head"><span>通し練習モード</span><small>${esc(routineDisplayName(rt))}</small></h1>
      ${routineMenuAction(rt.id, `<span class="sub">v${rt.versions.length}</span>`)}</div>
    ${practiceNowDockHtml()}
    <button class="run-start-btn ${runActive ? "active" : ""}" onclick="confirmRunStart('${rt.id}')"
      ${runActive ? "disabled aria-disabled=\"true\"" : ""}>
      <small>${runActive ? "IN PROGRESS" : "START"}</small>
      <b class="run-start-number">本日 ${runProgress.nextToday}本目</b>
      <strong>${runActive ? "通し練習中" : "通し練習をスタート"}</strong>
      <span class="run-start-total">これまでの合計 ${runProgress.totalCompleted}本</span>
      <span class="run-start-countdown">${runActive ? "終わったら結果を記録してください" : `${countdown}秒カウントダウン`}</span>
    </button>
    <div class="runbar">
      <span class="stat">${isEnglish() ? `Today <b>${runProgress.todayCompleted}</b> runs` : `今日 <b>${runProgress.todayCompleted}</b> 本`}</span>
      <span class="stat">${isEnglish() ? `Clean <b>${runProgress.todayClean}</b>` : `クリーン <b>${runProgress.todayClean}</b>`}</span>
      ${sess ? `<span class="stat">${isEnglish() ? "Condition" : "体調"} <b>${uiText((FEELINGS.find((f) => f.v === sess.feeling) || {}).label || "-")}</b></span>` : ""}
    </div>
    ${runCamera && runCamera.recording ? `<div class="run-video-live" role="status" aria-live="polite">
      <video id="run-camera-live-preview" class="run-camera-live-preview" style="--run-camera-aspect:${runCameraProfile(runCamera.profileId).cssRatio}" autoplay playsinline muted
        aria-label="${isEnglish() ? "Live front camera preview" : "撮影中のインカメプレビュー"}"></video>
      <div class="run-video-live-copy">
        <div><span class="run-video-live-dot"></span><b>REC</b><span id="run-video-elapsed">${fmtTimeFine((Date.now() - runCamera.startedAt) / 1000)}</span></div>
        <small>${isEnglish()
          ? `${uiText(runCameraProfile(runCamera.profileId).label)} · Front camera · ${runVideoAudioLabel(runCamera)}`
          : `${runCameraProfile(runCamera.profileId).label}・インカメ・${runVideoAudioLabel(runCamera)}`}</small>
      </div>
    </div>` : ""}
    ${stoppedRunVideoCapture && stoppedRunVideoCapture.routineId === rt.id ? `<div class="run-video-stopped" role="status">
      <span aria-hidden="true">■</span><div><b>撮影終了・すぐ確認できます</b><small>音源の停止に合わせて終了しました。結果を記録する前でも、何度でも映像を確認できます。</small></div>
      <button type="button" class="btn run-video-instant-preview" onclick="previewStoppedRunVideo('${rt.id}')">▶ 今撮った映像を見る</button>
    </div>` : ""}
    ${musicCard}
    ${isOpen ? `<div class="openrun-note">この通しは続行中です。ミスは複数記録できます。最後までいったら「完走」、別のミスがあれば続けて該当箇所をタップしてください。</div>` : ""}
    <div class="card">
      <h2>${runActive ? "失敗・実施できなかった場所をタップ" : "スタート後、該当する場所をタップ"}</h2>
      <div class="step-list">${stepBtns}</div>
    </div>
    <button class="clean-btn record-result-btn" onclick="${isOpen ? "finishOpenRun()" : "recordClean()"}"
      ${runActive ? "" : "disabled aria-disabled=\"true\""}>
      ${isOpen ? "完走" : "クリーン"}<span class="sub">${isOpen ? "失敗ありで最後まで" : runActive ? "ノーミスで完走 = 1タップ" : "通し練習のスタート後に記録できます"}</span>
    </button>
    <div class="bottombar">
      <button class="undo" onclick="undo()">取り消し</button>
      <button onclick="endSessionAsk('${rt.id}')">セッション終了</button>
    </div>`;
}

function sheetStartSession(rt) {
  // 前回セッションの振り返り/次回試すことを冒頭に出す(記録を次の行動につなげる)
  const last = state.sessions
    .filter((s) => s.routineId === rt.id && s.endedAt)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  const lastClean = last ? last.runs.filter((r) => r.outcome === "clean").length : 0;
  const recap = last ? `
    <div class="recap">
      <div class="recap-h">前回 ${last.date} — ${last.runs.length}本 / クリーン${lastClean}</div>
      ${last.nextPlan ? `<div class="recap-plan">▶ 前回決めた「次回試すこと」: <b>${esc(last.nextPlan)}</b></div>` : ""}
      ${last.review ? `<div class="recap-line">振り返り: ${esc(last.review)}</div>` : ""}
      ${last.note ? `<div class="recap-line">メモ: ${esc(last.note)}</div>` : ""}
    </div>` : "";
  showSheet(`
    <h3>セッション開始</h3>
    <div class="sheet-sub">${esc(routineDisplayName(rt))} / ${today()}</div>
    ${recap}
    <div class="tag-label">今日の体調(開始時の主観)</div>
    <div class="segmented" id="feel-grid">
      ${FEELINGS.map((f) => `<button class="choice ${f.v === 2 ? "selected" : ""}" data-v="${f.v}"
        onclick="selectOne('feel-grid',this)">${f.label}</button>`).join("")}
    </div>
    <label class="fld">条件メモ(任意: 会場・道具・風など)</label>
    <input type="text" id="sess-note" placeholder="例: 屋外、やや風あり">
    <div style="height:14px"></div>
    <button class="btn primary" onclick="startSession('${rt.id}')">セッションを準備する</button>
    <button class="btn ghost" onclick="hideSheet();go('routines')">やめる</button>`);
}
window.selectOne = (gridId, el) => {
  document.querySelectorAll(`#${gridId} .choice`).forEach((c) => c.classList.remove("selected"));
  el.classList.add("selected");
};
window.startSession = (routineId) => {
  const rt = state.routines.find((r) => r.id === routineId);
  const feel = Number(document.querySelector("#feel-grid .selected")?.dataset.v || 2);
  state.sessions.push({
    id: uid(), routineId, versionId: latestVersion(rt).id, date: today(),
    startedAt: Date.now(), endedAt: null, feeling: feel,
    note: document.getElementById("sess-note").value.trim(), runs: [],
  });
  activeFullRunRoutineId = null;
  saveState(); hideSheet(); render();
};

window.recordClean = async () => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  const sess = activeSession(rt.id);
  if (!sess) return sheetStartSession(rt);
  if (!fullRunIsActive(rt.id)) return toast("先に通し練習をスタートしてください");
  const verC = latestVersion(rt);
  const run = { id: uid(), at: Date.now(), outcome: "clean", events: [],
    reachedIndex: verC.steps.length - 1, choices: currentChoices(rt, verC, sess) };
  sess.runs.push(run);
  activeFullRunRoutineId = null;
  musicResetForNextRun();
  saveState(); render(); toast(`クリーン記録 (今日${sess.runs.length}本目)`);
  await stopRunVideoCapture(rt, sess, run);
};

window.finishOpenRun = async () => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  const sess = activeSession(rt.id);
  if (!openRun || !sess) return;
  const verF = latestVersion(rt);
  const run = {
    id: uid(), at: Date.now(), outcome: "finished",
    events: openRun.events, reachedIndex: verF.steps.length - 1, choices: currentChoices(rt, verF, sess),
  };
  sess.runs.push(run);
  openRun = null; activeFullRunRoutineId = null; musicResetForNextRun();
  saveState(); render(); toast("完走(失敗あり)を記録");
  await stopRunVideoCapture(rt, sess, run);
};

let pendingCapture = null; // 失敗タップ瞬間の曲位置/録音位置

window.tapStep = (stepIndex) => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  if (!activeSession(rt.id)) return sheetStartSession(rt);
  if (!fullRunIsActive(rt.id)) return toast("先に通し練習をスタートしてください");
  const step = latestVersion(rt).steps[stepIndex];
  // タップした瞬間の時刻だけを先に確保する。続行できるミスでは楽曲と録画を止めず、複数地点を残せるようにする。
  pendingCapture = {};
  if (rt.music && musicLoadedFor === rt.id && !musicMissing &&
      (musicCurrentTime() > 0.05 || !musicPlayer.paused)) {
    pendingCapture.musicTime = musicCurrentTime();
  }
  if (recState) {
    pendingCapture.recId = recState.id;
    pendingCapture.recTime = (Date.now() - recState.startedAt) / 1000;
  }
  if (runCamera && runCamera.recording) {
    pendingCapture.videoTime = (Date.now() - runCamera.startedAt) / 1000;
  }
  const capBadges = [
    pendingCapture.musicTime != null ? `♪ 曲 ${fmtTime(pendingCapture.musicTime)}` : "",
    pendingCapture.recTime != null ? `● 録音 ${fmtTime(pendingCapture.recTime)}` : "",
    pendingCapture.videoTime != null ? `● 映像 ${fmtTime(pendingCapture.videoTime)}` : "",
  ].filter(Boolean).join(" / ");
  const sessNow = activeSession(rt.id);
  const slotChips = isSlot(step) && routineFeatureEnabled(rt, "showSlots") ? `
    <div class="tag-label">どちらをやった?</div>
    <div class="slot-chips" id="opt-grid" style="margin-bottom:12px">
      ${step.options.map((o) => `<button class="opt-chip choice ${currentChoice(rt, sessNow, step) === o.id ? "selected" : ""}"
        data-o="${o.id}" onclick="selectOne('opt-grid',this)">${esc(optionDisplayName(o))}</button>`).join("")}
    </div>` : "";
  showSheet(`
    <h3>${stepIndex + 1}. ${esc(stepLabel(step))}</h3>
    <div class="sheet-sub">何が起きた？ 初期値は「ドロップして復帰」です。中止を選ばない限り通しは続きます。${capBadges ? ` — <b>${capBadges}</b> を記録` : ""}</div>
    ${slotChips}
    <div class="choice-grid" id="type-grid">
      ${EVENT_TYPES.map((t, i) => `<button class="choice ${t.abort ? "abort" : ""} ${i === 0 ? "selected" : ""}"
        data-t="${t.id}" onclick="selectOne('type-grid',this)">${t.label}<span class="d">${t.desc}</span></button>`).join("")}
    </div>
    <div class="tag-label">原因の仮説(任意)</div>
    <div class="tag-row" id="tag-row">
      ${HYPOTHESIS_TAGS.map((t) => `<button class="tag" data-t="${esc(t)}" onclick="this.classList.toggle('selected')">${t}</button>`).join("")}
    </div>
    <label class="fld">メモ(任意)</label>
    <input type="text" id="ev-note" placeholder="例: 左手の握りが浅かった気がする">
    <div style="height:14px"></div>
    <button class="btn primary" onclick="commitEvent(${stepIndex})">記録</button>
    <button class="btn ghost" onclick="hideSheet()">キャンセル</button>`);
};

window.commitEvent = async (stepIndex) => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  const ver = latestVersion(rt);
  const sess = activeSession(rt.id);
  const typeId = document.querySelector("#type-grid .selected")?.dataset.t || "drop_recovered";
  const type = EVENT_TYPES.find((t) => t.id === typeId);
  const tags = [...document.querySelectorAll("#tag-row .tag.selected")].map((el) => el.dataset.t);
  const note = document.getElementById("ev-note").value.trim();
  const ev = { stepId: ver.steps[stepIndex].id, stepIndex, type: typeId, tags, note, ...(pendingCapture || {}) };
  pendingCapture = null;
  // 未実施は、同じ通し内で直前に記録された実際の失敗と結び付ける。
  // 現時点の画面では集計だけに使い、将来「どの失敗が次の技へ波及したか」を分析できる形で保持する。
  if (typeId === "not_attempted" && openRun && openRun.routineId === rt.id) {
    const cause = [...openRun.events].reverse().find((e) => e.type !== "not_attempted");
    if (cause) {
      ev.causedByStepId = cause.stepId;
      ev.causedByStepIndex = cause.stepIndex;
    }
  }
  // スロットで失敗した場合: どちらをやったかを記録し、セッションの既定選択も追随させる
  const stepObj = ver.steps[stepIndex];
  if (isSlot(stepObj)) {
    const optId = document.querySelector("#opt-grid .selected")?.dataset.o || currentChoice(rt, sess, stepObj);
    ev.optionId = optId;
    sess.slotDefaults = { ...(sess.slotDefaults || {}), [stepObj.id]: optId };
  }

  if (type.abort) {
    // 中止: 前段は成功扱い(到達済み)、後段は未到達
    const events = (openRun && openRun.routineId === rt.id) ? [...openRun.events, ev] : [ev];
    const run = { id: uid(), at: Date.now(), outcome: "aborted", events, reachedIndex: stepIndex,
      choices: currentChoices(rt, ver, sess) };
    sess.runs.push(run);
    openRun = null;
    activeFullRunRoutineId = null;
    musicResetForNextRun();
    toast(`中止を記録 (${stepIndex + 1}. ${ver.steps[stepIndex].name})`);
    saveState(); hideSheet(); render();
    await stopRunVideoCapture(rt, sess, run);
    return;
  } else {
    // 続行: 通しを開いたまま追加失敗を待つ
    if (!openRun || openRun.routineId !== rt.id) openRun = { routineId: rt.id, versionId: ver.id, events: [] };
    openRun.events.push(ev);
    toast(`記録して続行中 — この通しのミス${openRun.events.length}件`);
  }
  saveState(); hideSheet(); render();
};

window.undo = async () => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  const sess = activeSession(rt.id);
  if (openRun && openRun.routineId === rt.id && openRun.events.length) {
    openRun.events.pop();
    if (!openRun.events.length) openRun = null;
    render(); return toast("直前の失敗記録を取り消しました");
  }
  if (sess && sess.runs.length) {
    const r = sess.runs.pop();
    const video = storedRunVideos().find((item) => item.runId === r.id);
    if (video) await removeRunVideo(video.id, false);
    saveState(); render();
    return toast(`直前の通し(${r.outcome === "clean" ? "クリーン" : r.outcome === "aborted" ? "中止" : "完走"})を取り消しました`);
  }
  toast("取り消すものがありません");
};

window.endSessionAsk = (routineId) => {
  const sess = activeSession(routineId);
  if (!sess) return go("routines");
  if (openRun && openRun.routineId === routineId) {
    return toast("続行中の通しがあります。「完走」か失敗記録で確定してください");
  }
  if (activeFullRunRoutineId === routineId) {
    return showSheet(`
      <h3>この通しを中断しますか？</h3>
      <div class="sheet-sub">まだ結果を記録していません。中断した通しは分析に入りません。</div>
      <button class="btn danger-ghost" style="width:100%" onclick="abandonActiveRun('${routineId}')">この通しを記録せず中断</button>
      <button class="btn ghost" onclick="hideSheet()">通し練習を続ける</button>`);
  }
  showSheet(`
    <h3>セッション終了</h3>
    <div class="sheet-sub">今日 ${sess.runs.length} 本 / クリーン ${sess.runs.filter((r) => r.outcome === "clean").length} 本</div>
    <label class="fld">振り返りメモ(任意 — 気づいた仮説など)</label>
    <textarea id="end-note" rows="2" placeholder="例: 3本目以降、腕が重くなってからリング系が怪しい"></textarea>
    <label class="fld">次回試すこと(任意 — 次のセッション開始時に表示されます)</label>
    <textarea id="end-plan" rows="2" placeholder="例: 持ち替え→ソロクラブの移行だけ10回反復してから通す"></textarea>
    <div style="height:14px"></div>
    <button class="btn primary" onclick="endSession('${routineId}')">終了して記録する</button>
    <button class="btn danger-ghost" style="width:100%;min-height:50px" onclick="discardSession('${routineId}')">記録せず終了(破棄)</button>
    <button class="btn ghost" onclick="hideSheet()">まだ続ける</button>`);
};
window.abandonActiveRun = (routineId) => {
  if (activeFullRunRoutineId !== routineId || (openRun && openRun.routineId === routineId)) return hideSheet();
  activeFullRunRoutineId = null;
  stopRunCameraNow();
  musicResetForNextRun();
  hideSheet(); render(); toast("この通しを記録せず中断しました");
};
window.endSession = async (routineId) => {
  clearRunCountdown(); activeFullRunRoutineId = null;
  if (recState) await stopRecording(); // 録音中なら先に保存(セッションを閉じる前に)
  const sess = activeSession(routineId);
  sess.endedAt = Date.now();
  sess.review = document.getElementById("end-note").value.trim();
  sess.nextPlan = document.getElementById("end-plan").value.trim();
  saveState(); hideSheet(); go("routines");
  toast("セッションを保存しました");
};
// このセッションを記録せず破棄(通しの記録・録音を保存しない)
window.discardSession = async (routineId) => {
  const sess = activeSession(routineId);
  if (!sess) return go("routines");
  const n = sess.runs.length;
  if (n > 0 && !appConfirm(`このセッションを記録せず破棄します。\n今日の通し ${n} 本は保存されません。よいですか?`)) return;
  if (recState) await stopRecording(); // 録音を止める(直後にBlobごと破棄)
  for (const rec of (sess.recordings || [])) { await blobDel(rec.blobId); }
  const sessionVideos = storedRunVideos().filter((video) => video.sessionId === sess.id);
  const musicBlobIds = new Set(sessionVideos.map((video) => video.music && video.music.blobId).filter(Boolean));
  for (const video of sessionVideos) await blobDel(video.blobId);
  state.runVideos = storedRunVideos().filter((video) => video.sessionId !== sess.id);
  state.sessions = state.sessions.filter((s) => s.id !== sess.id);
  for (const blobId of musicBlobIds) await deleteRunVideoMusicBlobIfUnused(blobId);
  clearRunCountdown(); activeFullRunRoutineId = null; openRun = null;
  saveState(); hideSheet(); go("routines");
  toast("記録せず終了しました");
};

// ========== 統計 ==========
function renderStats() {
  const rt = state.routines.find((r) => r.id === view.params.id);
  if (!rt) return renderHome();
  const versionId = view.params.versionId || latestVersion(rt).id;
  const st = versionStats(rt, versionId);
  const verIndex = rt.versions.findIndex((v) => v.id === st.ver.id) + 1;
  const showSlots = routineFeatureEnabled(rt, "showSlots");

  const versionGuide = rt.sampleSet && rt.versions.length >= 3 ? `
    <div class="version-guide">
      <b>構成の変化を比較できます</b>
      <span>v1 基本構成 → v2 移行を追加 → v3 A/B分岐を追加</span>
    </div>` : "";
  const verSelect = rt.versions.length > 1 ? `
    ${versionGuide}
    <select onchange="go('stats',{id:'${rt.id}',versionId:this.value})" style="margin-bottom:12px">
      ${rt.versions.map((v, i) => `<option value="${v.id}" ${v.id === st.ver.id ? "selected" : ""}>
        v${i + 1}${v.label ? ` ${esc(v.label)}` : ""} (${new Date(v.createdAt).toLocaleDateString("ja-JP")}〜)</option>`).join("")}
    </select>` : "";

  if (st.total === 0) {
    return `
      <div class="topbar"><button class="back-btn" onclick="go('routines')">戻る</button>
        <h1>${esc(routineDisplayName(rt))} 分析</h1>${routineMenuAction(rt.id)}</div>
      ${verSelect}
      <div class="empty">v${verIndex} の通し記録はまだありません。<br>「通し練習」からクリーン、失敗、実施できなかった技を記録すると、ここに偏りが表示されます。</div>`;
  }

  const cleanCiTxt = st.cleanCi ? `${pct(st.cleanCi[0])}〜${pct(st.cleanCi[1])}%` : "-";
  const overview = `
    <div class="stat-overview">
      <div class="stat-box"><div class="v">${st.total}</div><div class="l">通し数</div></div>
      <div class="stat-box"><div class="v">${st.clean}/${st.total}</div><div class="l">クリーン率 ${pct(st.clean / st.total)}%</div>
        <div class="ci">95%区間 ${cleanCiTxt}</div></div>
      <div class="stat-box"><div class="v">${st.fails ? `${st.recov}/${st.fails}` : "-"}</div><div class="l">乱れ/ドロップ<br>からの回復</div></div>
    </div>`;

  // ステップ一覧は「実施した中での失敗」と「到達したが実施できなかった」を分ける。
  // 到達数、95%区間、事前リスク、曲位置などの補助パラメータは詳細画面で扱う。
  const failSummary = (item) => {
    const attempted = item.attempted == null ? item.reached : item.attempted;
    const rate = attempted ? item.failed / attempted : 0;
    const unavailable = item.unattempted || 0;
    const unavailableText = unavailable
      ? (isEnglish() ? ` / ${unavailable} not attempted` : ` / 未実施 ${unavailable}回`)
      : "";
    return (isEnglish()
      ? `${item.failed} issues · ${pct(rate)}%`
      : `失敗 ${item.failed}回・${pct(rate)}%`) + unavailableText;
  };
  const stepRows = st.steps.map((s) => {
    const openDetail = `onclick="go('stepdetail',{id:'${rt.id}',versionId:'${st.ver.id}',stepIndex:${s.index}})"`;

    if (s.options && showSlots) {
      // A/Bも候補ごとに、失敗と未実施を同じ書式で示す。
      const optRows = s.options.map((o) => {
        return `<div class="slot-opt-stat">
          <div class="head"><span class="nm">└ ${esc(optionDisplayName(o.opt))}</span>
            <span class="kn">${failSummary(o)}</span></div>
        </div>`;
      }).join("");
      return `<div class="step-stat ${s.step.kind}" ${openDetail}>
        <div class="head"><span class="nm">${s.index + 1}. ${esc(stepLabel(s.step))} <span class="slot-mark">A/B</span></span>
          <span class="kn">${failSummary(s)} ›</span></div>
        ${optRows}
      </div>`;
    }

    if (s.options) {
      // A/B OFF時は選択肢別の内訳を隠し、ステップ全体の実測値だけを表示する。
      // 過去に記録した選択肢データは保持し、ONへ戻せば同じ内訳が復元される。
      const collapsedName = stepDisplayName(s.step) || "選択ステップ";
      return `<div class="step-stat ${s.step.kind}" ${openDetail}>
        <div class="head"><span class="nm">${s.index + 1}. ${esc(collapsedName)}</span>
          <span class="kn">${failSummary(s)} ›</span></div>
      </div>`;
    }

    return `<div class="step-stat ${s.step.kind}" ${openDetail}>
      <div class="head"><span class="nm">${s.index + 1}. ${esc(stepDisplayName(s.step))}</span>
        <span class="kn">${failSummary(s)} ›</span></div>
    </div>`;
  }).join("");

  // 練習録音の聴き返し(このルーティンの全セッション、新しい順)
  const recSessions = state.sessions
    .filter((s) => s.routineId === rt.id && (s.recordings || []).length)
    .sort((a, b) => b.startedAt - a.startedAt).slice(0, 5);
  const recCard = recSessions.length ? `
    <div class="card"><h2>練習の録音(タップで失敗の3秒前から再生)</h2>
      ${recSessions.map((sess) => (sess.recordings || []).map((rec) => {
        const markers = sess.runs.flatMap((r) => r.events.filter((e) => e.recId === rec.id))
          .map((e) => {
            const ver2 = getVersion(rt, sess.versionId);
            const nm = ver2.steps[e.stepIndex] ? ver2.steps[e.stepIndex].name : "?";
            return `<button class="time-chip tappable" onclick="recSeekTo('${rec.id}',${e.recTime})">${esc(nm)} ${fmtTime(e.recTime)}</button>`;
          }).join("");
        return `<div class="rec-row">
          <div class="head"><span class="nm">${sess.date} (${fmtTime(rec.duration)})</span>
            <button class="btn small" id="recplay-${rec.id}" onclick="recPlayToggle('${rec.id}')">▶ 再生</button>
            <button class="mini-btn" onclick="recDownload('${rec.id}','${sess.date}')">↓</button>
            <button class="mini-btn del" onclick="recDelete('${sess.id}','${rec.id}')">✕</button></div>
          ${markers ? `<div class="time-chips">${markers}</div>` : `<div class="hint" style="margin:4px 0 0">この録音中の失敗記録はありません</div>`}
        </div>`;
      }).join("")).join("")}
    </div>` : "";

  const versionSessionIds = new Set(state.sessions
    .filter((session) => session.routineId === rt.id && session.versionId === st.ver.id)
    .map((session) => session.id));
  const runVideos = storedRunVideos()
    .filter((video) => video.routineId === rt.id && versionSessionIds.has(video.sessionId))
    .sort((a, b) => b.at - a.at);
  const runVideoCard = runVideos.length ? `
    <div class="card"><h2>通し練習の映像 <span class="card-count">全体 ${storedRunVideos().length}/${RUN_VIDEO_LIMIT}本</span></h2>
      ${runVideos.map((video) => `
        <div class="run-video-row">
          <div><b>${esc(runVideoTitle(video))}</b><span>${fmtTimeFine(video.duration)} / ${runVideoMusicMeta(video)
            ? `♪ ${esc(runVideoMusicMeta(video).name || "対象音源")}${runVideoHasEmbeddedAudio(video) ? "を収録済み" : "と別同期"}`
            : "映像のみ"}</span></div>
          <button class="btn small" onclick="openRunVideo('${video.id}')">▶ 映像を見る</button>
        </div>`).join("")}
      <div class="hint">失敗記録がある映像は、再生画面から記録地点の3秒前へ移動できます。</div>
    </div>` : "";

  const bdRows = (arr) => arr.filter((b) => b.n > 0).map((b) =>
    `<div class="bd-row"><span class="k">${b.label}</span><span class="v">クリーン ${b.clean}/${b.n} (${pct(b.clean / b.n)}%)</span></div>`).join("") || `<div class="empty">データなし</div>`;

  const tagRows = Object.entries(st.tagCount).sort((a, b) => b[1] - a[1]).map(([t, c]) =>
    `<div class="bd-row"><span class="k">${esc(t)}</span><span class="v">${c}回</span></div>`).join("");

  return `
    <div class="topbar"><button class="back-btn" onclick="go('routines')">戻る</button>
      <h1>${esc(routineDisplayName(rt))} 分析</h1>${routineMenuAction(rt.id, `<span class="sub">v${verIndex}</span>`)}</div>
    ${verSelect}
    ${overview}
    <div class="card">
      <h2>ステップ別の失敗・未実施</h2>
      ${stepRows}
    </div>
    ${runVideoCard}
    ${recCard}
    <div class="card"><h2>何本目で崩れるか</h2>${bdRows(st.byRunNo)}</div>
    <div class="card"><h2>体調別</h2>${bdRows(st.byFeeling)}</div>
    ${tagRows ? `<div class="card"><h2>原因の仮説タグ(推測の集計)</h2>${tagRows}</div>` : ""}
    ${st.excluded ? `<div class="note-caveat">集計から除外中の通し: ${st.excluded}本(履歴から戻せます)</div>` : ""}
    <div style="height:10px"></div>
    <button class="btn" onclick="go('history',{id:'${rt.id}'})">セッション履歴・メモを見る</button>
    <button class="btn" onclick="go('record',{id:'${rt.id}'})">この構成で通し練習する</button>`;
}

// ========== パート練習(楽曲のA→Bループ) ==========
// 通しと条件が違うため、パート練習は分析データに混ぜない(純粋な練習用ループ再生)
let partLoopTimer = null;
let partLoopDelayTimer = null;
let partLoopWaitingUntil = 0;
let partLoopActive = false;
let partLoopDrag = null; // { which, pointerId }
const PART_MIN_RANGE = 0.3;
const PART_LOOP_DELAY_STEP = 0.5;
const PART_LOOP_DELAY_MAX = 30;
const PART_PLAYBACK_MIN = 0.5;
const PART_PLAYBACK_MAX = 1.25;
const PART_PLAYBACK_STEP = 0.05;
const PART_PLAYBACK_PRESETS = [0.5, 0.75, 1, 1.25];

function normalizePartPlaybackRate(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value)) return 1;
  const clamped = Math.max(PART_PLAYBACK_MIN, Math.min(PART_PLAYBACK_MAX, value));
  return Number((Math.round(clamped / PART_PLAYBACK_STEP) * PART_PLAYBACK_STEP).toFixed(2));
}

function partPlaybackRate(rt) {
  const raw = Number(rt && rt.partPlaybackRate);
  if (!Number.isFinite(raw) || raw < PART_PLAYBACK_MIN || raw > PART_PLAYBACK_MAX) return 1;
  return normalizePartPlaybackRate(raw);
}

function partLoopDelaySeconds(rt) {
  const raw = Number(rt && rt.partLoop && rt.partLoop.delaySeconds);
  if (!isFinite(raw)) return 0;
  return Math.round(Math.max(0, Math.min(PART_LOOP_DELAY_MAX, raw)) * 2) / 2;
}
function partLoopDelayLabel(seconds) {
  return seconds > 0 ? `${Number(seconds.toFixed(1))}秒` : "すぐ";
}
function clearPartLoopDelay() {
  clearTimeout(partLoopDelayTimer);
  partLoopDelayTimer = null;
  partLoopWaitingUntil = 0;
}
function updatePartLoopDelayDOM(rt) {
  if (!rt || view.name !== "part") return;
  const delay = partLoopDelaySeconds(rt);
  const value = document.getElementById("part-loop-delay-value");
  if (value) value.textContent = uiText(partLoopDelayLabel(delay));
  const dec = document.getElementById("part-loop-delay-dec");
  const inc = document.getElementById("part-loop-delay-inc");
  if (dec) dec.disabled = delay <= 0;
  if (inc) inc.disabled = delay >= PART_LOOP_DELAY_MAX;
  const status = document.getElementById("part-loop-delay-status");
  if (status) {
    const remain = partLoopWaitingUntil ? Math.max(0, (partLoopWaitingUntil - Date.now()) / 1000) : null;
    status.textContent = remain != null
      ? uiText(`Aへ戻るまで ${Math.ceil(remain * 10) / 10}秒`)
      : uiText("Bで停止してAへ戻るまで");
  }
}

function partStorePoint(rt, which, value) {
  const dur = musicEffectiveDuration();
  if (!rt || !dur) return;
  const range = partRange(rt);
  rt.partLoop = rt.partLoop || {};
  if (which === "a") {
    const limit = Math.max(0, (range.b != null ? range.b : dur) - PART_MIN_RANGE);
    rt.partLoop.a = Math.round(Math.max(0, Math.min(value, limit)) * 10) / 10;
  } else {
    const limit = Math.min(dur, range.a + PART_MIN_RANGE);
    rt.partLoop.b = Math.round(Math.min(dur, Math.max(value, limit)) * 10) / 10;
  }
}
function partPointerTime(e) {
  const track = document.getElementById("part-loop-track");
  const dur = musicEffectiveDuration();
  if (!track || !dur) return null;
  const rect = track.getBoundingClientRect();
  return Math.max(0, Math.min(dur, ((e.clientX - rect.left) / rect.width) * dur));
}
function updatePartLoopDOM(rt) {
  if (!rt || view.name !== "part") return;
  const dur = musicEffectiveDuration();
  if (!dur) return;
  const { a, b } = partRange(rt);
  const end = b == null ? dur : b;
  const aPct = (a / dur) * 100, bPct = (end / dur) * 100;
  const range = document.getElementById("part-loop-range");
  if (range) { range.style.left = aPct + "%"; range.style.width = Math.max(0, bPct - aPct) + "%"; }
  const ah = document.getElementById("part-handle-a"), bh = document.getElementById("part-handle-b");
  if (ah) { ah.style.left = aPct + "%"; ah.setAttribute("aria-valuenow", String(a)); ah.setAttribute("aria-valuetext", fmtTimeFine(a)); }
  if (bh) { bh.style.left = bPct + "%"; bh.setAttribute("aria-valuenow", String(end)); bh.setAttribute("aria-valuetext", fmtTimeFine(end)); }
  const at = document.getElementById("part-time-a"), bt = document.getElementById("part-time-b");
  if (at) at.textContent = fmtTimeFine(a);
  if (bt) bt.textContent = fmtTimeFine(end);
  const invalid = document.getElementById("part-loop-invalid");
  if (invalid) invalid.classList.toggle("hidden", end > a);
}
function updatePartLoopPlayhead() {
  const ph = document.getElementById("part-loop-playhead");
  const dur = musicEffectiveDuration();
  if (ph && dur) ph.style.left = Math.min(100, (musicCurrentTime() / dur) * 100) + "%";
}
function beginPartLoopDrag(e, which, keepGrabOffset) {
  if (view.name !== "part" || !musicEffectiveDuration()) return;
  e.preventDefault();
  const t = partPointerTime(e);
  const rt = state.routines.find((r) => r.id === view.params.id);
  if (t == null || !rt) return;
  const range = partRange(rt);
  const current = which === "a" ? range.a : range.b;
  partLoopDrag = { which, pointerId: e.pointerId, offset: keepGrabOffset ? current - t : 0 };
  partStorePoint(rt, which, t + partLoopDrag.offset); updatePartLoopDOM(rt);
}
window.partTrackPointerDown = (e) => {
  if (e.button != null && e.button !== 0) return;
  const rt = state.routines.find((r) => r.id === view.params.id);
  const t = partPointerTime(e);
  if (!rt || t == null) return;
  const { a, b } = partRange(rt);
  const which = Math.abs(t - a) <= Math.abs(t - (b == null ? musicEffectiveDuration() : b)) ? "a" : "b";
  beginPartLoopDrag(e, which, false);
};
window.partHandlePointerDown = (e, which) => { e.stopPropagation(); beginPartLoopDrag(e, which, true); };
document.addEventListener("pointermove", (e) => {
  if (!partLoopDrag || e.pointerId !== partLoopDrag.pointerId) return;
  e.preventDefault();
  const rt = state.routines.find((r) => r.id === view.params.id);
  const t = partPointerTime(e);
  if (rt && t != null) { partStorePoint(rt, partLoopDrag.which, t + partLoopDrag.offset); updatePartLoopDOM(rt); }
}, { passive: false });
function finishPartLoopDrag(e) {
  if (!partLoopDrag || (e.pointerId != null && e.pointerId !== partLoopDrag.pointerId)) return;
  partLoopDrag = null; saveState();
}
document.addEventListener("pointerup", finishPartLoopDrag);
document.addEventListener("pointercancel", finishPartLoopDrag);
window.partHandleKey = (e, which) => {
  const delta = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -0.1
    : e.key === "ArrowRight" || e.key === "ArrowUp" ? 0.1 : 0;
  if (!delta) return;
  e.preventDefault();
  const rt = state.routines.find((r) => r.id === view.params.id);
  if (!rt) return;
  const range = partRange(rt);
  partStorePoint(rt, which, (which === "a" ? range.a : range.b) + delta);
  updatePartLoopDOM(rt); saveState();
};

function stopPartLoop(pauseMusic) {
  clearInterval(partLoopTimer);
  partLoopTimer = null;
  clearPartLoopDelay();
  partLoopActive = false;
  partLoopDrag = null;
  if (pauseMusic) musicPlayer.pause();
}
function partRange(rt) {
  const p = rt.partLoop || {};
  const dur = musicEffectiveDuration() || null;
  const a = Math.max(0, Math.min(p.a ?? 0, dur || Infinity));
  const b = p.b == null ? dur : Math.max(0, Math.min(p.b, dur || p.b));
  return { a, b }; // B未設定はトリム後の曲末まで
}
function partTick() {
  const rt = state.routines.find((r) => r.id === view.params.id);
  if (!rt || view.name !== "part" || document.visibilityState === "hidden") return stopPartLoop(true);
  if (partLoopWaitingUntil) { updatePartLoopDelayDOM(rt); return; }
  const { a, b } = partRange(rt);
  if (b != null && b > a && musicCurrentTime() >= b - 0.05) {
    const delay = partLoopDelaySeconds(rt);
    if (delay <= 0) {
      musicSetTime(a);
      if (musicPlayer.paused) playMedia(musicPlayer, "楽曲を再生できませんでした");
      return;
    }
    musicPlayer.pause();
    partLoopWaitingUntil = Date.now() + delay * 1000;
    updatePartLoopDelayDOM(rt);
    clearTimeout(partLoopDelayTimer);
    partLoopDelayTimer = setTimeout(() => {
      partLoopDelayTimer = null;
      partLoopWaitingUntil = 0;
      const currentRt = state.routines.find((r) => r.id === view.params.id);
      if (!partLoopActive || view.name !== "part" || !currentRt) return;
      musicSetTime(partRange(currentRt).a);
      updatePartLoopDelayDOM(currentRt);
      playMedia(musicPlayer, "楽曲を再生できませんでした");
    }, delay * 1000);
  }
}
window.partSetPoint = (which) => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  partStorePoint(rt, which, musicCurrentTime());
  saveState(); render();
};
window.partNudge = (which, d) => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  const cur = which === "a" ? partRange(rt).a : partRange(rt).b;
  if (cur == null) return toast("先に位置を設定してください");
  partStorePoint(rt, which, cur + d);
  saveState(); render();
};
window.partClear = () => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  if (!rt) return;
  clearPartLoopDelay();
  if (rt.partLoop) {
    delete rt.partLoop.a;
    delete rt.partLoop.b;
    if (!partLoopDelaySeconds(rt)) delete rt.partLoop;
  }
  saveState(); render();
};
window.partChangeLoopDelay = (delta) => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  if (!rt) return;
  rt.partLoop = rt.partLoop || {};
  const next = Math.round(Math.max(0, Math.min(PART_LOOP_DELAY_MAX,
    partLoopDelaySeconds(rt) + Number(delta || 0))) * 2) / 2;
  if (next > 0) rt.partLoop.delaySeconds = next;
  else delete rt.partLoop.delaySeconds;
  saveState(); updatePartLoopDelayDOM(rt);
};
window.partSetPlaybackRate = (rate) => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  if (!rt) return;
  const next = normalizePartPlaybackRate(rate);
  rt.partPlaybackRate = next;
  setMusicPlaybackRate(next);
  saveState(); render();
  toast(`再生速度を ${next}倍にしました`);
};
window.partNudgePlaybackRate = (delta) => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  if (!rt) return;
  window.partSetPlaybackRate(partPlaybackRate(rt) + Number(delta || 0));
};
window.partPlayFromA = () => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  const { a } = partRange(rt);
  clearPartLoopDelay();
  ensureAudioGraph();
  musicSetTime(a);
  playMedia(musicPlayer, "楽曲を再生できませんでした");
  if (partLoopActive && !partLoopTimer) partLoopTimer = setInterval(partTick, 80);
};
window.partToggleLoop = () => {
  if (!partLoopActive) {
    partLoopActive = true;
    if (!partLoopTimer) partLoopTimer = setInterval(partTick, 80);
  } else {
    stopPartLoop(false);
  }
  render();
};

function renderPart() {
  const rt = state.routines.find((r) => r.id === view.params.id);
  if (!rt) return renderHome();
  if (!rt.music) {
    return `
      <div class="topbar"><button class="back-btn" onclick="go('routines')">戻る</button>
        <h1>${esc(routineDisplayName(rt))} パート練習</h1>${routineMenuAction(rt.id)}</div>
      <div class="empty">パート練習は登録した楽曲の一部をループ再生する機能です。<br>まず「編集」から音源(MP3等)を添付してください。</div>
      <button class="btn" onclick="go('edit',{id:'${rt.id}'})">編集画面へ</button>`;
  }
  if (musicLoadedFor !== rt.id) setTimeout(() => loadMusic(rt), 0);
  const playbackRate = partPlaybackRate(rt);
  setMusicPlaybackRate(playbackRate);
  const { a, b } = partRange(rt);
  const dur = musicEffectiveDuration() || null;
  const end = b == null ? dur : b;
  const aPct = dur ? (a / dur) * 100 : 0;
  const bPct = dur && end != null ? (end / dur) * 100 : 100;
  const bandStyle = `left:${aPct}%;width:${Math.max(0, bPct - aPct)}%`;
  const abInvalid = b != null && b <= a;
  const loopDelay = partLoopDelaySeconds(rt);
  const loopDelayStatus = partLoopWaitingUntil
    ? `Aへ戻るまで ${Math.ceil(Math.max(0, partLoopWaitingUntil - Date.now()) / 100) / 10}秒`
    : "Bで停止してAへ戻るまで";
  const pointRow = (which, val, label) => `
    <div class="part-point">
      <span class="pp-label">${label}</span>
      <span class="pp-time" id="part-time-${which}">${val != null ? fmtTimeFine(val) : "未設定(曲末)"}</span>
      <button class="mini-btn" onclick="partNudge('${which}',-1)">−1s</button>
      <button class="mini-btn" onclick="partNudge('${which}',1)">＋1s</button>
      <button class="btn small" onclick="partSetPoint('${which}')">今の位置</button>
    </div>`;
  return `
    <div class="topbar"><button class="back-btn" onclick="go('routines')">戻る</button>
      <h1>${esc(routineDisplayName(rt))} パート練習</h1>${routineMenuAction(rt.id)}</div>
    ${practiceNowDockHtml()}
    <div class="card music-card">
      <div class="music-name">♪ ${esc(rt.music.name)}</div>
      <div class="music-time big"><span id="music-cur">${fmtTimeFine(musicCurrentTime())}</span><span class="dur"> / <span id="music-dur">${fmtTime(musicEffectiveDuration())}</span></span></div>
      <input type="range" id="music-seek" min="0" max="100" step="0.1" value="0" oninput="musicSeek(this.value)">
      <div class="music-controls">
        <button class="music-pill primary" id="music-toggle-pill" onclick="musicToggle()">▶ 再生</button>
        <button class="music-pill" onclick="musicStop()">■ 停止</button>
      </div>
      <div class="volume-row">
        <span class="vol-ico">🔈</span>
        <input type="range" id="music-vol" min="0" max="1" step="0.02" value="${musicVolume}" oninput="musicSetVolume(this.value)">
        <span class="vol-ico">🔊</span>
      </div>
      <div class="part-speed-row">
        <span>再生速度</span>
        <div class="part-speed-controls">
          <div class="part-speed-adjust" role="group"
            aria-label="${isEnglish() ? "Adjust playback speed in 0.05× steps" : "再生速度を0.05倍ずつ調整"}">
            <button onclick="partNudgePlaybackRate(-${PART_PLAYBACK_STEP})"
              aria-label="${isEnglish() ? "Decrease playback speed by 0.05×" : "再生速度を0.05倍遅く"}"
              ${playbackRate <= PART_PLAYBACK_MIN ? "disabled" : ""}>−</button>
            <output aria-live="polite">${Number(playbackRate.toFixed(2))}×</output>
            <button onclick="partNudgePlaybackRate(${PART_PLAYBACK_STEP})"
              aria-label="${isEnglish() ? "Increase playback speed by 0.05×" : "再生速度を0.05倍速く"}"
              ${playbackRate >= PART_PLAYBACK_MAX ? "disabled" : ""}>＋</button>
          </div>
          <div class="part-speed-presets" role="group"
            aria-label="${isEnglish() ? "Section Practice playback speed presets" : "パート練習の再生速度プリセット"}">
            ${PART_PLAYBACK_PRESETS.map((rate) => `<button class="${rate === playbackRate ? "selected" : ""}"
              onclick="partSetPlaybackRate(${rate})" aria-pressed="${rate === playbackRate}">${rate}×</button>`).join("")}
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>ループ区間</h2>
      <div class="part-loop-track ${dur ? "" : "disabled"}" id="part-loop-track" onpointerdown="partTrackPointerDown(event)">
        <div class="part-loop-range" id="part-loop-range" style="${bandStyle}"></div>
        <div class="part-loop-playhead" id="part-loop-playhead" style="left:${dur ? Math.min(100, (musicCurrentTime() / dur) * 100) : 0}%"></div>
        <button class="part-loop-handle a" id="part-handle-a" style="left:${aPct}%" data-which="a"
          role="slider" aria-label="始点A" aria-valuemin="0" aria-valuemax="${dur || 0}" aria-valuenow="${a}"
          onpointerdown="partHandlePointerDown(event,'a')" onkeydown="partHandleKey(event,'a')"><span>A</span></button>
        <button class="part-loop-handle b" id="part-handle-b" style="left:${bPct}%" data-which="b"
          role="slider" aria-label="終点B" aria-valuemin="0" aria-valuemax="${dur || 0}" aria-valuenow="${end || 0}"
          onpointerdown="partHandlePointerDown(event,'b')" onkeydown="partHandleKey(event,'b')"><span>B</span></button>
      </div>
      <div class="part-loop-scale"><span>0:00</span><span>バーをタップ＆スライド</span><span>${fmtTime(dur)}</span></div>
      ${pointRow("a", rt.partLoop && rt.partLoop.a != null ? rt.partLoop.a : 0, "A 始点")}
      ${pointRow("b", end, "B 終点")}
      <div class="gap-note ${abInvalid ? "" : "hidden"}" id="part-loop-invalid">⚠︎ 終点Bが始点Aより前です。ループしません。</div>
      <div class="part-loop-delay-row">
        <div class="part-loop-delay-copy">
          <strong>ループの間隔</strong>
          <small id="part-loop-delay-status" aria-live="polite">${loopDelayStatus}</small>
        </div>
        <div class="part-loop-delay-stepper" role="group" aria-label="終点Bから始点Aへ戻るまでの時間">
          <button id="part-loop-delay-dec" onclick="partChangeLoopDelay(-${PART_LOOP_DELAY_STEP})"
            aria-label="ループの間隔を短くする" ${loopDelay <= 0 ? "disabled" : ""}>−</button>
          <output id="part-loop-delay-value">${partLoopDelayLabel(loopDelay)}</output>
          <button id="part-loop-delay-inc" onclick="partChangeLoopDelay(${PART_LOOP_DELAY_STEP})"
            aria-label="ループの間隔を長くする" ${loopDelay >= PART_LOOP_DELAY_MAX ? "disabled" : ""}>＋</button>
        </div>
      </div>
      <div class="row-2" style="margin-top:12px">
        <button class="btn primary" style="margin:0" onclick="partPlayFromA()">Aから再生</button>
        <button class="btn ${partLoopActive ? "ok" : ""}" style="margin:0" onclick="partToggleLoop()">ループ ${partLoopActive ? "ON" : "OFF"}</button>
      </div>
      ${rt.partLoop ? `<button class="btn ghost" style="margin-top:10px" onclick="partClear()">区間をリセット</button>` : ""}
    </div>`;
}

// ========== 技の詳細(ステップ別のミス内訳) ==========
const typeLabel = (id) => uiText((EVENT_TYPES.find((t) => t.id === id) || {}).label || id);

function renderStepDetail() {
  const rt = state.routines.find((r) => r.id === view.params.id);
  if (!rt) return renderHome();
  const ver = getVersion(rt, view.params.versionId);
  const i = view.params.stepIndex;
  const step = ver.steps[i];
  if (!step) return renderStats();
  const showSlots = routineFeatureEnabled(rt, "showSlots");
  const detailStepName = isSlot(step) && !showSlots ? (stepDisplayName(step) || "選択ステップ") : stepLabel(step);
  const runs = runsOfVersion(rt.id, ver.id).filter((r) => !r.excluded);
  const reachedRuns = runs.filter((r) => r.reachedIndex >= i);
  const reached = reachedRuns.length;
  const evs = [];
  for (const r of runs) for (const e of r.events) if (e.stepIndex === i) evs.push({ ...e, run: r });
  const actualFailure = (r) => r.events.some((e) => e.stepIndex === i && e.type !== "not_attempted");
  const onlyNotAttempted = (r) => !actualFailure(r) && r.events.some((e) => e.stepIndex === i && e.type === "not_attempted");
  const failRuns = reachedRuns.filter(actualFailure).length;
  const unattemptedRuns = reachedRuns.filter(onlyNotAttempted).length;
  const attemptedRuns = reached - unattemptedRuns;
  const failRate = attemptedRuns ? failRuns / attemptedRuns : 0;
  const unattemptedRate = reached ? unattemptedRuns / reached : 0;

  const optName = (e) => {
    if (!showSlots || !isSlot(step) || !e.optionId) return "";
    const o = step.options.find((o2) => o2.id === e.optionId);
    return o ? `[${optionDisplayName(o)}] ` : "";
  };
  // 最新メモを上に(Codex指摘: 細かいチャートより実用価値が高い)
  const noteRows = evs.slice().sort((a, b) => b.run.at - a.run.at).slice(0, 15).map((e) => `
    <div class="bd-row"><span class="k">${e.run.session.date} ${optName(e)}${typeLabel(e.type)}${(e.tags || []).length ? ` / ${e.tags.join("・")}` : ""}${e.musicTime != null ? ` / ♪${fmtTime(e.musicTime)}` : ""}</span>
      <span class="v">${e.note ? "" : ""}</span></div>
    ${e.note ? `<div class="note-line">${esc(sampleDisplayText(e.note, e.run.session.sampleHistory))}</div>` : ""}`).join("");

  const typeCounts = EVENT_TYPES.map((t) => ({ t, n: evs.filter((e) => e.type === t.id).length })).filter((x) => x.n);
  const tagCounts = {};
  for (const e of evs) for (const tg of e.tags || []) tagCounts[tg] = (tagCounts[tg] || 0) + 1;
  const musicTimes = evs.filter((e) => e.musicTime != null).map((e) => e.musicTime).sort((a, b) => a - b);

  const optBreakdown = isSlot(step) && showSlots ? step.options.map((o) => {
    const oRuns = reachedRuns.filter((r) => runChoice(r, step) === o.id);
    const oFailed = oRuns.filter(actualFailure).length;
    const oUnattempted = oRuns.filter(onlyNotAttempted).length;
    const oAttempted = oRuns.length - oUnattempted;
    const oRate = oAttempted ? oFailed / oAttempted : 0;
    const unavailable = oUnattempted
      ? (isEnglish() ? ` / ${oUnattempted} not attempted` : ` / 未実施 ${oUnattempted}回`)
      : "";
    return `<div class="bd-row"><span class="k">${esc(optionDisplayName(o))}</span><span class="v">${isEnglish() ? `${oFailed} issues · ${pct(oRate)}%` : `失敗 ${oFailed}回・${pct(oRate)}%`}${unavailable}</span></div>`;
  }).join("") : "";

  return `
    <div class="topbar"><button class="back-btn" onclick="go('stats',{id:'${rt.id}',versionId:'${ver.id}'})">戻る</button>
      <h1>${esc(detailStepName)}</h1>${routineMenuAction(rt.id)}</div>
    <div class="stat-overview" style="grid-template-columns:1fr 1fr">
      <div class="stat-box"><div class="v">${attemptedRuns}</div><div class="l">実施回数</div></div>
      <div class="stat-box"><div class="v">${isEnglish() ? failRuns : `${failRuns}回`}</div><div class="l">失敗率 ${pct(failRate)}%</div></div>
      <div class="stat-box"><div class="v">${isEnglish() ? unattemptedRuns : `${unattemptedRuns}回`}</div><div class="l">実施できず ${pct(unattemptedRate)}%</div></div>
      <div class="stat-box"><div class="v">${reached}</div><div class="l">対象地点への到達</div></div>
    </div>
    ${step.trickId && (state.tricks || []).some((t) => t.id === step.trickId)
      ? `<button class="btn" onclick="playTrickVideo('${step.trickId}')">▶ 技の動画を見る</button>` : ""}
    ${optBreakdown ? `<div class="card"><h2>選択肢別</h2>${optBreakdown}</div>` : ""}
    ${noteRows ? `<div class="card"><h2>この技の記録(新しい順)</h2>${noteRows}</div>` : `<div class="empty">この技の失敗・未実施記録はまだありません</div>`}
    ${typeCounts.length ? `<div class="card"><h2>記録の種類(全${evs.length}件中)</h2>
      ${typeCounts.map((x) => `<div class="bd-row"><span class="k">${x.t.label}</span><span class="v">${x.n}件</span></div>`).join("")}</div>` : ""}
    ${Object.keys(tagCounts).length ? `<div class="card"><h2>原因の仮説タグ(複数選択・推測)</h2>
      ${Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).map(([t, c]) => `<div class="bd-row"><span class="k">${esc(t)}</span><span class="v">${c}回</span></div>`).join("")}</div>` : ""}
    ${musicTimes.length ? `<div class="card"><h2>記録した曲位置</h2>
      <div class="time-chips" style="margin:6px 0 10px">${musicTimes.map((t) => `<span class="time-chip">♪ ${fmtTime(t)}</span>`).join("")}</div></div>` : ""}
    `;
}

// ========== セッション履歴(見返し・編集) ==========
function renderHistory() {
  const rt = state.routines.find((r) => r.id === view.params.id);
  if (!rt) return renderHome();
  const sessions = state.sessions
    .filter((s) => s.routineId === rt.id)
    .sort((a, b) => b.startedAt - a.startedAt);
  if (!sessions.length) {
    return `<div class="topbar"><button class="back-btn" onclick="go('stats',{id:'${rt.id}'})">戻る</button>
      <h1>履歴</h1>${routineMenuAction(rt.id)}</div><div class="empty">まだセッションがありません</div>`;
  }
  const blocks = sessions.map((sess) => {
    const ver = getVersion(rt, sess.versionId);
    const vno = rt.versions.findIndex((v) => v.id === ver.id) + 1;
    const feel = (FEELINGS.find((f) => f.v === sess.feeling) || {}).label || "-";
    const runRows = sess.runs.map((run, ri) => {
      const outcomeTxt = run.outcome === "clean" ? uiText("クリーン")
        : run.outcome === "finished" ? (isEnglish() ? "Finished (with issues)" : "完走(失敗あり)")
        : `${isEnglish() ? "Stopped" : "中止"} @${ri >= 0 && ver.steps[run.reachedIndex] ? esc(stepLabel(ver.steps[run.reachedIndex])) : "?"}`;
      const evRows = run.events.map((e, ei) => {
        const st = ver.steps[e.stepIndex];
        const option = st && isSlot(st) && e.optionId ? st.options.find((o) => o.id === e.optionId) : null;
        const oName = option ? optionDisplayName(option) : "";
        return `<div class="ev-row" onclick="sheetEditEvent('${sess.id}','${run.id}',${ei})">
          <span class="k">${e.stepIndex + 1}. ${st ? esc(stepLabel(st)) : "?"}${oName ? ` [${esc(oName)}]` : ""} — ${typeLabel(e.type)}${e.musicTime != null ? ` ♪${fmtTime(e.musicTime)}` : ""}</span>
          ${(e.tags || []).length ? `<span class="ev-tags">${e.tags.map(uiText).join(isEnglish() ? ", " : "・")}</span>` : ""}
          ${e.note ? `<div class="note-line">${esc(sampleDisplayText(e.note, sess.sampleHistory))}</div>` : ""}
          <span class="ev-edit">${isEnglish() ? "Tap to edit" : "タップで編集"} ›</span>
        </div>`;
      }).join("");
      // スロットの選択修正チップ(その場で変えたのに記録し損ねた通しを直す)。A/B分岐OFFでは表示しない(データは保持)
      const slotFix = !routineFeatureEnabled(rt, "showSlots") ? "" : ver.steps.filter(isSlot).map((st) => {
        const cur = run.choices ? run.choices[st.id] : undefined;
        return `<div class="run-choice"><span class="k">${esc(stepLabel(st))}:</span>
          ${st.options.map((o) => `<button class="opt-chip small ${cur === o.id ? "selected" : ""}"
            onclick="setRunChoice('${sess.id}','${run.id}','${st.id}','${o.id}')">${esc(optionDisplayName(o))}</button>`).join("")}
          ${!cur ? `<span class="ev-tags">未記録</span>` : ""}</div>`;
      }).join("");
      return `<div class="run-block ${run.excluded ? "excluded" : ""}">
        <div class="head"><span class="k">${isEnglish() ? `Run ${ri + 1}` : `${ri + 1}本目`} — ${outcomeTxt}${run.editedAt ? (isEnglish() ? " (edited)" : " (編集済)") : ""}</span>
          <button class="btn small ghost" onclick="toggleExcludeRun('${sess.id}','${run.id}')">${run.excluded ? "集計に戻す" : "集計から除外"}</button></div>
        ${evRows}${slotFix}
      </div>`;
    }).join("");
    return `<div class="card">
      <h2>${sess.date} — v${vno} / ${isEnglish() ? `Condition: ${uiText(feel)} / ${sess.runs.length} runs` : `体調${feel} / ${sess.runs.length}本`}
        <button class="btn small ghost" style="float:right" onclick="sheetEditSession('${sess.id}')">${isEnglish() ? "Edit notes" : "メモ編集"}</button></h2>
      ${sess.note ? `<div class="note-line">${isEnglish() ? "Conditions" : "条件"}: ${esc(sampleDisplayText(sess.note, sess.sampleHistory))}</div>` : ""}
      ${sess.review ? `<div class="note-line">${isEnglish() ? "Review" : "振り返り"}: ${esc(sampleDisplayText(sess.review, sess.sampleHistory))}</div>` : ""}
      ${sess.nextPlan ? `<div class="note-line plan">${isEnglish() ? "Try next" : "次回試すこと"}: ${esc(sampleDisplayText(sess.nextPlan, sess.sampleHistory))}</div>` : ""}
      ${runRows || `<div class="hint">${isEnglish() ? "No runs recorded" : "通しの記録なし"}</div>`}
    </div>`;
  }).join("");
  return `
    <div class="topbar"><button class="back-btn" onclick="go('stats',{id:'${rt.id}'})">戻る</button>
      <h1>${esc(routineDisplayName(rt))} 履歴</h1>${routineMenuAction(rt.id)}</div>
    ${blocks}
    `;
}

window.toggleExcludeRun = (sessId, runId) => {
  const sess = state.sessions.find((s) => s.id === sessId);
  const run = sess && sess.runs.find((r) => r.id === runId);
  if (!run) return;
  if (!run.excluded && !appConfirm("この通しを集計から除外しますか?(データは残り、いつでも戻せます)")) return;
  run.excluded = !run.excluded;
  run.editedAt = Date.now();
  saveState(); render();
  toast(run.excluded ? "集計から除外しました" : "集計に戻しました");
};
window.setRunChoice = (sessId, runId, stepId, optId) => {
  const sess = state.sessions.find((s) => s.id === sessId);
  const run = sess && sess.runs.find((r) => r.id === runId);
  if (!run) return;
  run.choices = { ...(run.choices || {}), [stepId]: optId };
  run.editedAt = Date.now();
  saveState(); render();
};
window.sheetEditEvent = (sessId, runId, evi) => {
  const sess = state.sessions.find((s) => s.id === sessId);
  const run = sess.runs.find((r) => r.id === runId);
  const e = run.events[evi];
  showSheet(`
    <h3>記録の編集</h3>
    <div class="sheet-sub">${sess.date} / ${typeLabel(e.type)}(種類は変更不可)</div>
    <div class="tag-label">原因の仮説</div>
    <div class="tag-row" id="edit-tag-row">
      ${HYPOTHESIS_TAGS.map((t) => `<button class="tag ${(e.tags || []).includes(t) ? "selected" : ""}" data-t="${esc(t)}"
        onclick="this.classList.toggle('selected')">${t}</button>`).join("")}
    </div>
    <label class="fld">メモ</label>
    <input type="text" id="edit-ev-note" value="${esc(e.note || "")}">
    <div style="height:14px"></div>
    <button class="btn primary" onclick="commitEditEvent('${sessId}','${runId}',${evi})">保存</button>
    <button class="btn ghost" onclick="hideSheet()">キャンセル</button>`);
};
window.commitEditEvent = (sessId, runId, evi) => {
  const sess = state.sessions.find((s) => s.id === sessId);
  const run = sess.runs.find((r) => r.id === runId);
  const e = run.events[evi];
  e.tags = [...document.querySelectorAll("#edit-tag-row .tag.selected")].map((el) => el.dataset.t);
  e.note = document.getElementById("edit-ev-note").value.trim();
  saveState(); hideSheet(); render(); toast("保存しました");
};
window.sheetEditSession = (sessId) => {
  const sess = state.sessions.find((s) => s.id === sessId);
  showSheet(`
    <h3>セッションのメモ編集</h3>
    <div class="sheet-sub">${sess.date}</div>
    <label class="fld">条件メモ</label>
    <input type="text" id="edit-sess-note" value="${esc(sess.note || "")}">
    <label class="fld">振り返り</label>
    <textarea id="edit-sess-review" rows="2">${esc(sess.review || "")}</textarea>
    <label class="fld">次回試すこと</label>
    <textarea id="edit-sess-plan" rows="2">${esc(sess.nextPlan || "")}</textarea>
    <div style="height:14px"></div>
    <button class="btn primary" onclick="commitEditSession('${sessId}')">保存</button>
    <button class="btn ghost" onclick="hideSheet()">キャンセル</button>`);
};
window.commitEditSession = (sessId) => {
  const sess = state.sessions.find((s) => s.id === sessId);
  sess.note = document.getElementById("edit-sess-note").value.trim();
  sess.review = document.getElementById("edit-sess-review").value.trim();
  sess.nextPlan = document.getElementById("edit-sess-plan").value.trim();
  saveState(); hideSheet(); render(); toast("保存しました");
};

// ========== 技ライブラリ(動画クリップの登録・撮影) ==========
// RDB-05の第一歩。技を最大20秒の動画として蓄積する。将来: 音楽タイムラインへの配置
const TRICK_MAX_SEC = 20;      // 技の最大長。超過は登録を弾く
const TRICK_MAX_BYTES = 100 * 1024 * 1024; // 登録動画の上限100MB
// C: 動画の圧縮プロファイル(撮影・アップロード両方に適用)。設定で切替可
const VIDEO_PROFILES = {
  standard: { label: "標準 (480p)", maxH: 480, bps: 900000 },
  small:    { label: "軽量 (360p)", maxH: 360, bps: 450000 },
};
function videoProfile() { return VIDEO_PROFILES[(state.settings || {}).videoQuality] || VIDEO_PROFILES.standard; }
const fmtBytes = (n) => n >= 1e9 ? `${(n / 1e9).toFixed(1)}GB` : n >= 1e6 ? `${(n / 1e6).toFixed(0)}MB` : `${Math.ceil(n / 1e3)}KB`;

// サンプル技(ボール軌道のループアニメ)。samples/ に同梱、http(s)配信時のみ読み込み可
const SAMPLE_TRICKS = [
  { f: "samples/s1.mp4", n: "3ボールカスケード" }, { f: "samples/s2.mp4", n: "リバースカスケード" },
  { f: "samples/s3.mp4", n: "シャワー" },           { f: "samples/s4.mp4", n: "4ボールファウンテン" },
  { f: "samples/s5.mp4", n: "コラムス" },           { f: "samples/s6.mp4", n: "ミルズメス風" },
  { f: "samples/s7.mp4", n: "5ボールハイトス" },    { f: "samples/s8.mp4", n: "サークルトス" },
  { f: "samples/s9.mp4", n: "5ボールカスケード" },
];
// サンプル楽曲(開発者本人の楽曲)。ルーティン編集/タイムラインの「サンプル曲から」でも使う
// ★曲を追加する手順: samples/ にmp3を置き、ここに1行足すだけ(リリース時に複数追加予定)
const SAMPLE_MUSIC = [
  { f: "samples/challie-lav.mp3", n: "challie lav" },
  { f: "samples/verse1.mp3", n: "Verse 1" },
];
async function fetchSampleMusicFile(idx) {
  const s = SAMPLE_MUSIC[idx];
  if (!s) return null;
  try {
    const resp = await fetch(s.f);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return new File([blob], `${s.n}.mp3`, { type: blob.type || "audio/mpeg" });
  } catch (_) { return null; }
}
const FILE_OPEN_ALERT = "ファイルから直接開いているため、サンプルを取得できません。\n\n公開版URLで開いてください:\nhttps://aratama-ship-it.github.io/routine-debugger/";
// サンプル曲の選択シート(target: 'edit'=ルーティン編集)
window.sheetSampleMusic = (target) => {
  if (!location.protocol.startsWith("http")) return appAlert(FILE_OPEN_ALERT);
  showSheet(`
    <h3>サンプル曲から選ぶ</h3>
    <div class="sheet-sub">練習用に自由に使える楽曲です(今後追加予定)</div>
    ${SAMPLE_MUSIC.map((s, i) => `<button class="btn" onclick="pickSampleMusic(${i},'${target}')">♪ ${esc(s.n)}</button>`).join("")}
    <button class="btn ghost" onclick="hideSheet()">やめる</button>`);
};
window.pickSampleMusic = async (i, target) => {
  hideSheet(); showLoading(`♪ ${SAMPLE_MUSIC[i].n} を読み込み中…`);
  try {
    const file = await fetchSampleMusicFile(i);
    if (!file) return toast("サンプル曲を取得できませんでした(通信環境をご確認ください)");
    await attachMusicFile(file, target);
  } finally { hideLoading(); }
};
// 音源Fileをルーティン編集(draft)へ設定。ライブラリ/サンプル共通
async function attachMusicFile(file, target, sourceMeta) {
  hideSheet();
  const meta = normalizeMusicMeta({
    name: file.name,
    fullDuration: sourceMeta && sourceMeta.fullDuration != null ? sourceMeta.fullDuration : null,
    trimStart: sourceMeta && sourceMeta.trimStart != null ? sourceMeta.trimStart : 0,
    trimEnd: sourceMeta && sourceMeta.trimEnd != null ? sourceMeta.trimEnd : null,
    duration: sourceMeta && sourceMeta.duration != null ? sourceMeta.duration : null,
  });
  if (target !== "edit" || !draft) return toast("編集画面を開き直してください");
  draft._newMusicFile = file;
  draft.music = meta;
  draft._removeMusic = false;
  musicPlayer.pause(); musicLoadedFor = null;
  render();
  toast(`♪ ${file.name} を設定しました`);
}

// 初回起動・音源・動画・保存で共通するローディング表示。
// 実測できない処理に推測の%を出さず、何を準備しているかを言葉と動きで示す。
let loadingDepth = 0;
let loadingShownAt = 0;
let loadingHideTimer = null;
function loadingMarkup(msg) {
  return `<div class="loading-sheet">
    <span class="loading-kicker">ROUTINE NOTE</span>
    <div class="loading-motion" aria-hidden="true"><i></i><i></i><i></i></div>
    <strong class="msg">${esc(uiText(msg || "読み込み中…"))}</strong>
    <span class="loading-sub">${uiText("処理が終わるまで、この画面のままお待ちください")}</span>
    <div class="loading-track" aria-hidden="true"><span></span></div>
  </div>`;
}
function showLoading(msg) {
  if (loadingHideTimer) { clearTimeout(loadingHideTimer); loadingHideTimer = null; }
  if (loadingDepth === 0) loadingShownAt = Date.now();
  loadingDepth++;
  let el = document.getElementById("loading");
  if (!el) { el = document.createElement("div"); el.id = "loading"; document.body.appendChild(el); }
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "assertive");
  el.setAttribute("aria-busy", "true");
  el.innerHTML = loadingMarkup(msg);
  el.classList.remove("hidden");
  document.documentElement.setAttribute("aria-busy", "true");
}
function removeLoadingOverlay() {
  const el = document.getElementById("loading");
  if (el) el.remove();
  document.documentElement.removeAttribute("aria-busy");
  loadingHideTimer = null;
}
function hideLoading() {
  loadingDepth = Math.max(0, loadingDepth - 1);
  if (loadingDepth) return;
  // 一瞬だけ点滅して見えない状態を避け、処理中だったことを認識できる最低表示時間を持たせる。
  const remaining = Math.max(0, 360 - (Date.now() - loadingShownAt));
  if (remaining) loadingHideTimer = setTimeout(removeLoadingOverlay, remaining);
  else removeLoadingOverlay();
}
async function withLoading(msg, work) {
  showLoading(msg);
  try { return await work(); }
  finally { hideLoading(); }
}

// ========== 音源ライブラリ(楽曲・録音を貯めて再利用) ==========
function probeAudioDuration(blob) {
  return new Promise((resolve) => {
    const a = new Audio();
    const url = URL.createObjectURL(blob);
    let settled = false;
    let timeout = null;
    const finish = (duration) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      a.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    a.onloadedmetadata = () => finish(isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => finish(0);
    a.src = url;
    timeout = setTimeout(() => finish(0), 4000);
  });
}
const libAudio = new Audio();
let libAudioSource = null;
let audioPlayingId = null;
let libAudioMeta = null;
// 音源ライブラリの試聴も、編集・練習と同じGainNodeで音量を共有する。
// iOS SafariでHTMLMediaElement.volumeが効かない場合にも反映できるようにする。
function ensureLibAudioGraph() {
  ensureAudioGraph();
  if (!audioCtx || !gainNode) { libAudio.volume = musicVolume; return; }
  if (!libAudioSource) {
    try {
      libAudioSource = audioCtx.createMediaElementSource(libAudio);
      libAudioSource.connect(gainNode);
    } catch (_) { libAudioSource = null; }
  }
  libAudio.volume = libAudioSource ? 1 : musicVolume;
}
window.libAudioSetVolume = (v) => {
  window.musicSetVolume(v);
  ensureLibAudioGraph();
  if (!libAudioSource) libAudio.volume = musicVolume;
};
function libAudioBounds() {
  const full = isFinite(libAudio.duration) && libAudio.duration > 0 ? libAudio.duration : ((libAudioMeta && libAudioMeta.fullDuration) || 0);
  const start = Math.max(0, Number(libAudioMeta && libAudioMeta.trimStart) || 0);
  const end = Math.max(start, Math.min(libAudioMeta && libAudioMeta.trimEnd != null ? libAudioMeta.trimEnd : full, full || Infinity));
  return { start, end, duration: Math.max(0, end - start) };
}
function libAudioCurrentTime() {
  const b = libAudioBounds();
  return Math.max(0, Math.min(b.duration || Infinity, (libAudio.currentTime || 0) - b.start));
}
libAudio.addEventListener("ended", () => { audioPlayingId = null; libAudioMeta = null; if (view.name === "audios") render(); });
// 再生中の現在位置を0.1秒刻みで更新(再描画なしにDOM更新)
libAudio.addEventListener("timeupdate", () => {
  const b = libAudioBounds();
  if (libAudioMeta && !libAudio.paused && b.duration && libAudio.currentTime >= b.end - 0.04) {
    libAudio.pause(); libAudio.currentTime = b.start; audioPlayingId = null;
    if (view.name === "audios") render();
    return;
  }
  const el = document.getElementById("lib-pos");
  if (el) el.textContent = fmtTimeFine(libAudioCurrentTime());
});

function renderAudios() {
  const list = (state.audios || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  const totalBytes = list.reduce((a, x) => a + (x.size || 0), 0);
  const rows = list.map((a) => `
    <div class="trick-row">
      <div class="head">
        <span class="nm" data-user-text onclick="sheetRenameAudio('${a.id}')">${esc(a.name)}${a.source === "rec" ? " ●" : ""}</span>
        <span class="kn">${audioPlayingId === a.id ? `<span id="lib-pos">${fmtTimeFine(libAudioCurrentTime())}</span> / ` : ""}${fmtTime(a.duration || 0)}${musicMetaIsTrimmed(a) ? " ✂" : ""}</span>
        <button class="btn small" onclick="sheetTrimAudio('${a.id}')">編集</button>
        <button class="btn small" onclick="audioPlay('${a.id}')">${audioPlayingId === a.id ? "■ 停止" : "▶"}</button>
        <button class="mini-btn del" onclick="audioDelete('${a.id}')">✕</button>
      </div>
    </div>`).join("");
  // 付属サンプル(自由に使える楽曲)。常設。選ぶとその場で読み込む
  const sampleRows = SAMPLE_MUSIC.map((s, i) => `
    <div class="trick-row">
      <div class="head">
        <span class="nm" data-user-text>${esc(s.n)}</span>
        <span class="kn">${audioPlayingId === "sample:" + i ? `<span id="lib-pos">${fmtTimeFine(libAudio.currentTime || 0)}</span> / 付属` : "付属"}</span>
        <button class="btn small" onclick="playSample(${i})">${audioPlayingId === "sample:" + i ? "■ 停止" : "▶"}</button>
      </div>
    </div>`).join("");
  return `
    <div class="topbar"><button class="back-btn" onclick="go('home')">戻る</button><h1>音源ライブラリ</h1></div>
    <div class="row-2">
      <button class="btn primary" style="margin-bottom:12px" onclick="audioRecToggle()">${audioRec ? `■ 停止 <span id="arec-elapsed" style="font-weight:400">0:00.0</span>` : "● マイクで録音"}</button>
      <button class="btn" onclick="document.getElementById('audio-file').click()">＋ 音源を登録(MP3等)</button>
    </div>
    <div class="audio-library-volume-bar">
      <span class="audio-library-volume-copy"><b>試聴音量</b><small>編集・練習画面と共通</small></span>
      <details class="music-volume-control audio-library-volume-control">
        <summary aria-label="音源ライブラリの試聴音量" title="音源ライブラリの試聴音量"><span aria-hidden="true">🔊</span><small>${Math.round(musicVolume * 100)}%</small></summary>
        <div class="music-volume-popover">
          <span class="vol-ico" aria-hidden="true">🔈</span>
          <input type="range" min="0" max="1" step="0.02" value="${musicVolume}"
            aria-label="音源ライブラリの試聴音量" oninput="libAudioSetVolume(this.value);this.closest('details').querySelector('summary small').textContent=Math.round(this.value*100)+'%'">
          <span class="vol-ico" aria-hidden="true">🔊</span>
        </div>
      </details>
    </div>
    <input type="file" id="audio-file" accept="audio/*" class="hidden" onchange="audioImport(this)">
    <div class="card">
      <h2>付属のサンプル音源(自由に使えます)${infoBtn("audioLib")}</h2>
      ${sampleRows}
    </div>
    <div class="card">
      <h2>あなたが追加した音源${totalBytes ? ` — 合計${fmtBytes(totalBytes)}` : ""}</h2>
      ${rows || `<div class="empty">まだありません。<br>マイクで録音するか、MP3等を登録してください。</div>`}
    </div>`;
}
// 付属サンプルの試聴(その場で読み込んで再生)
window.playSample = async (i) => {
  if (audioPlayingId === "sample:" + i) { libAudio.pause(); audioPlayingId = null; libAudioMeta = null; return render(); }
  ensureLibAudioGraph();
  showLoading(`♪ ${SAMPLE_MUSIC[i].n} を読み込み中…`);
  try {
    const file = await fetchSampleMusicFile(i);
    if (!file) return toast("サンプル曲を取得できませんでした");
    if (libAudio._url) URL.revokeObjectURL(libAudio._url);
    libAudio._url = URL.createObjectURL(file);
    libAudioMeta = null;
    libAudio.src = libAudio._url; audioPlayingId = "sample:" + i;
    libAudio.play().catch(() => {});
    render();
  } finally { hideLoading(); }
};
window.audioImport = async (input) => {
  const file = input.files[0]; input.value = "";
  if (!file) return;
  if (file.size > 40 * 1024 * 1024) return toast("40MB以下の音源にしてください");
  return withLoading("音源を保存中…", async () => {
    const id = uid();
    if (!(await blobPut(id, file))) return toast("音源を保存できませんでした");
    const dur = await probeAudioDuration(file);
    const duration = Math.round((dur || 0) * 10) / 10;
    state.audios.push({ id, name: file.name.replace(/\.[^.]+$/, ""), blobId: id,
      duration, fullDuration: duration, trimStart: 0, trimEnd: duration,
      size: file.size, createdAt: Date.now(), source: "file" });
    saveState(); render();
    toast(`♪ ${file.name} を追加しました`);
  });
};
window.audioPlay = async (id) => {
  if (audioPlayingId === id) { libAudio.pause(); audioPlayingId = null; libAudioMeta = null; return render(); }
  ensureLibAudioGraph();
  const a = (state.audios || []).find((x) => x.id === id);
  if (!a) return;
  return withLoading("音源を読み込み中…", async () => {
    const blob = await blobGet(a.blobId);
    if (!blob) return toast("音源データが見つかりません");
    if (libAudio._url) URL.revokeObjectURL(libAudio._url);
    libAudio._url = URL.createObjectURL(blob);
    libAudioMeta = normalizeMusicMeta(a);
    libAudio.src = libAudio._url; audioPlayingId = id;
    libAudio.addEventListener("loadedmetadata", () => {
      normalizeMusicMeta(a, libAudio.duration);
      a.fullDuration = libAudio.duration;
      const b = libAudioBounds();
      try { libAudio.currentTime = b.start; } catch (_) {}
      libAudio.play().catch(() => {});
    }, { once: true });
    render();
  });
};

// ---------- 楽曲の長さ調整(トリム)。技動画と同じく元Blobは残し、有効区間だけを保存 ----------
let musicTrimUrl = null;
let musicTrimDraft = null; // { kind, id, meta, start, end, full }
async function openMusicTrim(meta, blob, kind, id) {
  if (!meta || !blob) return toast("音源データが見つかりません");
  musicPlayer.pause(); libAudio.pause();
  let full = Number(meta.fullDuration) || 0;
  if (!full) full = await probeAudioDuration(blob);
  if (!full) return toast("音源の長さを取得できませんでした");
  normalizeMusicMeta(meta, full);
  meta.fullDuration = full;
  if (meta.trimEnd == null) meta.trimEnd = full;
  if (musicTrimUrl) URL.revokeObjectURL(musicTrimUrl);
  musicTrimUrl = URL.createObjectURL(blob);
  musicTrimDraft = {
    kind, id, meta, full,
    start: Math.max(0, Math.min(meta.trimStart || 0, full - 0.3)),
    end: Math.max(0.3, Math.min(meta.trimEnd != null ? meta.trimEnd : full, full)),
  };
  if (musicTrimDraft.end <= musicTrimDraft.start) musicTrimDraft.end = Math.min(full, musicTrimDraft.start + 0.3);
  showSheet(musicTrimSheetHtml());
  const a = document.getElementById("music-trim-audio");
  if (!a) return;
  const toStart = () => { try { a.currentTime = musicTrimDraft.start; } catch (_) {} };
  a.addEventListener("loadedmetadata", () => { toStart(); a.play().catch(() => {}); }, { once: true });
  a.addEventListener("timeupdate", () => {
    if (!musicTrimDraft) return;
    if (a.currentTime >= musicTrimDraft.end - 0.03 || a.currentTime < musicTrimDraft.start - 0.1) {
      toStart(); if (a.paused) a.play().catch(() => {});
    }
    updateMusicTrimPlayhead();
  });
}
window.sheetTrimAudio = async (id) => {
  const a = (state.audios || []).find((x) => x.id === id);
  if (!a) return;
  return withLoading("音源の編集画面を準備中…", async () =>
    openMusicTrim(a, await blobGet(a.blobId), "library", id));
};
window.sheetTrimRoutineMusic = async () => {
  if (!draft || !draft.music) return;
  return withLoading("音源の編集画面を準備中…", async () => {
    const blob = draft._newMusicFile || (draft.music.blobId ? await blobGet(draft.music.blobId) : null);
    return openMusicTrim(draft.music, blob, "draft", draft._for);
  });
};
function musicTrimSheetHtml() {
  const d = musicTrimDraft;
  const left = d.full ? (d.start / d.full) * 100 : 0;
  const width = d.full ? Math.max(1, ((d.end - d.start) / d.full) * 100) : 0;
  return `
    <h3>楽曲を編集</h3>
    <div class="sheet-sub">残したい区間の始点と終点を決めます。元の音源は消えません</div>
    <audio id="music-trim-audio" class="music-trim-audio" src="${musicTrimUrl}" controls autoplay preload="metadata"></audio>
    <div class="trim-track" onclick="musicTrimSeek(event)" ontouchstart="musicTrimSeek(event)" ontouchmove="musicTrimSeek(event)">
      <div class="range" id="music-trim-bar" style="left:${left}%;width:${width}%"></div>
      <div class="head" id="music-trim-playhead" style="left:${left}%"></div>
    </div>
    <div class="trim-scale"><span id="music-trim-cur">${fmtTimeFine(d.start)}</span><span>元の長さ ${fmtTime(d.full)}</span></div>
    <div class="part-point">
      <span class="pp-label">始点</span><span class="pp-time" id="music-trim-start">${fmtTimeFine(d.start)}</span>
      <button class="mini-btn" onclick="musicTrimNudge('start',-0.1)">−</button>
      <button class="mini-btn" onclick="musicTrimNudge('start',0.1)">＋</button>
      <button class="btn small" onclick="musicTrimSetPoint('start')">今の位置</button>
    </div>
    <div class="part-point">
      <span class="pp-label">終点</span><span class="pp-time" id="music-trim-end">${fmtTimeFine(d.end)}</span>
      <button class="mini-btn" onclick="musicTrimNudge('end',-0.1)">−</button>
      <button class="mini-btn" onclick="musicTrimNudge('end',0.1)">＋</button>
      <button class="btn small" onclick="musicTrimSetPoint('end')">今の位置</button>
    </div>
    <div class="b-now-line" style="color:var(--text)">この楽曲の長さ: <b id="music-trim-len">${fmtTime(d.end - d.start)}</b></div>
    <div class="row-2" style="margin-top:12px">
      <button class="btn" style="margin:0" onclick="musicTrimReset()">全体に戻す</button>
      <button class="btn primary" style="margin:0" onclick="musicTrimSave()">保存</button>
    </div>
    <button class="btn ghost" onclick="hideSheet()">キャンセル</button>`;
}
function updateMusicTrimPlayhead() {
  const a = document.getElementById("music-trim-audio");
  const ph = document.getElementById("music-trim-playhead");
  if (a && ph && musicTrimDraft && musicTrimDraft.full) ph.style.left = (a.currentTime / musicTrimDraft.full) * 100 + "%";
  const cur = document.getElementById("music-trim-cur");
  if (cur && a) cur.textContent = fmtTimeFine(a.currentTime);
}
window.musicTrimSeek = (e) => {
  const a = document.getElementById("music-trim-audio");
  if (!a || !musicTrimDraft || !musicTrimDraft.full) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const point = e.touches ? e.touches[0] : e;
  const frac = Math.max(0, Math.min(1, (point.clientX - rect.left) / rect.width));
  try { a.currentTime = frac * musicTrimDraft.full; } catch (_) {}
  updateMusicTrimPlayhead();
};
function updateMusicTrimSheetUI() {
  const d = musicTrimDraft; if (!d) return;
  const s = document.getElementById("music-trim-start"); if (s) s.textContent = fmtTimeFine(d.start);
  const e = document.getElementById("music-trim-end"); if (e) e.textContent = fmtTimeFine(d.end);
  const l = document.getElementById("music-trim-len"); if (l) l.textContent = fmtTime(d.end - d.start);
  const bar = document.getElementById("music-trim-bar");
  if (bar && d.full) { bar.style.left = (d.start / d.full) * 100 + "%"; bar.style.width = Math.max(1, ((d.end - d.start) / d.full) * 100) + "%"; }
}
window.musicTrimSetPoint = (which) => {
  const a = document.getElementById("music-trim-audio"); if (!a || !musicTrimDraft) return;
  const t = round1(a.currentTime);
  if (which === "start") musicTrimDraft.start = Math.max(0, Math.min(t, musicTrimDraft.end - 0.3));
  else musicTrimDraft.end = Math.min(musicTrimDraft.full, Math.max(t, musicTrimDraft.start + 0.3));
  updateMusicTrimSheetUI();
};
window.musicTrimNudge = (which, delta) => {
  const d = musicTrimDraft; if (!d) return;
  if (which === "start") d.start = Math.max(0, Math.min(round1(d.start + delta), d.end - 0.3));
  else d.end = Math.min(d.full, Math.max(round1(d.end + delta), d.start + 0.3));
  updateMusicTrimSheetUI();
};
window.musicTrimReset = () => {
  if (!musicTrimDraft) return;
  musicTrimDraft.start = 0; musicTrimDraft.end = musicTrimDraft.full;
  updateMusicTrimSheetUI();
};
window.musicTrimSave = () => {
  const d = musicTrimDraft; if (!d || d.end - d.start < 0.3) return toast("0.3秒以上にしてください");
  d.meta.fullDuration = d.full;
  d.meta.trimStart = round1(d.start);
  d.meta.trimEnd = round1(d.end);
  d.meta.duration = round1(d.end - d.start);
  if (d.kind !== "draft") saveState();
  if (audioPlayingId === d.id) { libAudio.pause(); audioPlayingId = null; libAudioMeta = null; }
  musicPlayer.pause(); musicLoadedFor = null; musicTrimMeta = null;
  const duration = d.meta.duration;
  musicTrimDraft = null;
  hideSheet(); render();
  toast(`楽曲の長さを ${fmtTime(duration)} にしました`);
};
window.sheetRenameAudio = (id) => {
  const a = (state.audios || []).find((x) => x.id === id);
  if (!a) return;
  showSheet(`<h3>音源の名前</h3>
    <input type="text" id="audio-name" value="${esc(a.name)}">
    <div style="height:12px"></div>
    <button class="btn primary" onclick="saveAudioName('${id}')">保存</button>
    <button class="btn ghost" onclick="hideSheet()">やめる</button>`);
};
window.saveAudioName = (id) => {
  const a = (state.audios || []).find((x) => x.id === id);
  const v = (document.getElementById("audio-name").value || "").trim();
  if (a && v) a.name = v;
  saveState(); hideSheet(); render();
};
window.audioDelete = async (id) => {
  const a = (state.audios || []).find((x) => x.id === id);
  if (!a) return;
  if (!appConfirm(`「${a.name}」を削除しますか?(元に戻せません。既にルーティンに設定した分は残ります)`)) return;
  if (audioPlayingId === id) { libAudio.pause(); audioPlayingId = null; libAudioMeta = null; }
  await blobDel(a.blobId);
  state.audios = state.audios.filter((x) => x.id !== id);
  saveState(); render();
};
// マイク録音(ライブラリ用。練習録音recStateとは別管理)
let audioRec = null; // { rec, chunks, startedAt, stream, timer }
window.audioRecToggle = async () => {
  if (audioRec) return stopAudioRec();
  if (!navigator.mediaDevices || !window.MediaRecorder) return toast("この環境ではマイク録音を使えません(https配信が必要です)");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    audioRec = { rec, chunks: [], startedAt: Date.now(), stream, timer: null };
    rec.ondataavailable = (e) => { if (e.data.size) audioRec.chunks.push(e.data); };
    rec.start(1000);
    audioRec.timer = setInterval(() => {
      const el = document.getElementById("arec-elapsed");
      if (el) el.textContent = fmtTimeFine((Date.now() - audioRec.startedAt) / 1000);
    }, 200);
    render();
  } catch (_) { toast("マイクへのアクセスが許可されませんでした"); }
};
async function stopAudioRec() {
  if (!audioRec) return;
  const rs = audioRec; clearInterval(rs.timer);
  await new Promise((res) => { rs.rec.onstop = res; rs.rec.stop(); });
  rs.stream.getTracks().forEach((t) => t.stop());
  audioRec = null;
  const blob = new Blob(rs.chunks, { type: rs.rec.mimeType || "audio/mp4" });
  const duration = (Date.now() - rs.startedAt) / 1000;
  if (!blob.size) { render(); return toast("録音が空でした"); }
  const id = uid();
  const t = new Date();
  if (await blobPut(id, blob)) {
    const d = Math.round(duration * 10) / 10;
    state.audios.push({ id, name: `録音 ${today()} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`,
      blobId: id, duration: d, fullDuration: d, trimStart: 0, trimEnd: d,
      size: blob.size, createdAt: Date.now(), source: "rec" });
    saveState();
    toast(`録音を保存しました (${fmtTime(duration)})`);
  } else toast("録音を保存できませんでした");
  render();
}
window.sheetAddSampleAudio = () => {
  if (!location.protocol.startsWith("http")) return appAlert(FILE_OPEN_ALERT);
  showSheet(`<h3>サンプル曲を追加</h3>
    <div class="sheet-sub">練習用に自由に使える楽曲(音源ライブラリに追加します)</div>
    ${SAMPLE_MUSIC.map((s, i) => `<button class="btn" onclick="addSampleToLibrary(${i})">♪ ${esc(s.n)}</button>`).join("")}
    <button class="btn ghost" onclick="hideSheet()">やめる</button>`);
};
window.addSampleToLibrary = async (i) => {
  hideSheet(); showLoading(`♪ ${SAMPLE_MUSIC[i].n} を読み込み中…`);
  try {
    const file = await fetchSampleMusicFile(i);
    if (!file) return toast("サンプル曲を取得できませんでした");
    const id = uid();
    if (!(await blobPut(id, file))) return toast("保存できませんでした");
    const dur = await probeAudioDuration(file);
    const duration = Math.round((dur || 0) * 10) / 10;
    state.audios.push({ id, name: SAMPLE_MUSIC[i].n, blobId: id,
      duration, fullDuration: duration, trimStart: 0, trimEnd: duration,
      size: file.size, createdAt: Date.now(), source: "sample" });
    saveState(); render();
    toast(`♪ ${SAMPLE_MUSIC[i].n} を追加しました`);
  } finally { hideLoading(); }
};
// ライブラリから音源を選んでルーティン/タイムラインに設定(コピー添付)。付属サンプルも選べる
window.sheetPickLibraryMusic = (target) => {
  const list = (state.audios || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  const savedHtml = list.map((a) => `<button class="btn" onclick="pickLibraryMusic('${a.id}','${target}')">♪ ${esc(a.name)} <span style="color:var(--muted);font-weight:400">${fmtTime(a.duration || 0)}</span></button>`).join("");
  const sampleHtml = SAMPLE_MUSIC.map((s, i) => `<button class="btn" onclick="pickSampleMusic(${i},'${target}')">♪ ${esc(s.n)} <span style="color:var(--muted);font-weight:400">付属</span></button>`).join("");
  showSheet(`<h3>音源ライブラリから選ぶ</h3>
    ${savedHtml ? `<div class="tag-label" style="margin-top:0">追加した音源</div>${savedHtml}` : ""}
    <div class="tag-label">付属サンプル(自由に使えます)</div>
    ${sampleHtml}
    <button class="btn ghost" onclick="hideSheet()">やめる</button>`);
};
window.pickLibraryMusic = async (id, target) => {
  const a = (state.audios || []).find((x) => x.id === id);
  if (!a) return toast("音源が見つかりません");
  return withLoading("音源を読み込み中…", async () => {
    const blob = await blobGet(a.blobId);
    if (!blob) return toast("音源データが見つかりません");
    const nm = /\.\w+$/.test(a.name) ? a.name : `${a.name}.${/mp4|m4a/.test(blob.type) ? "m4a" : "mp3"}`;
    const file = new File([blob], nm, { type: blob.type || "audio/mpeg" });
    return attachMusicFile(file, target, a);
  });
};

window.loadSampleTricks = async () => {
  if (!location.protocol.startsWith("http")) return appAlert(FILE_OPEN_ALERT);
  if (!appConfirm("サンプルの技9個(アニメーション)を技ライブラリに追加しますか?")) return;
  showLoading("サンプルの技を読み込み中…");
  let ok = 0;
  try {
    for (const s of SAMPLE_TRICKS) {
      try {
        const resp = await fetch(s.f);
        if (!resp.ok) continue;
        const blob = await resp.blob();
        const dur = (await probeVideoDuration(blob)) || 4;
        const id = uid();
        if (await blobPut(id, blob)) {
          const d = Math.round(dur * 10) / 10;
          state.tricks.push({ id, name: `${s.n} (サンプル)`, blobId: id, duration: d,
            fullDuration: d, trimStart: 0, trimEnd: d, lineColor: "blue",
            size: blob.size, createdAt: Date.now(), sample: true });
          ok++;
        }
      } catch (_) { /* 個別失敗はスキップ */ }
    }
  } finally { hideLoading(); }
  saveState(); render();
  toast(ok ? `サンプル${ok}個を追加しました` : "サンプルを読み込めませんでした");
};
// サンプル一式: 技9個(既にあれば再利用)+サンプル楽曲+全機能入りのサンプルルーティン
// v1=基本構成、v2=移行と後半技を追加、v3=A/B分岐を追加。初心者が版の意味を実画面で追えるようにする。
function linkSampleOptionVideos(rt) {
  if (!rt?.sampleSet) return false;
  let changed = false;
  const sampleTricks = (state.tricks || []).filter((t) => t.sample);
  for (const version of rt.versions || []) {
    for (const step of version.steps || []) {
      if (!isSlot(step)) continue;
      for (const option of step.options) {
        if (option.trickId) continue;
        const baseName = String(option.name || "").replace(/[（(].*?[）)]/g, "").trim();
        const trick = sampleTricks.find((t) => String(t.name || "").replace(/\s*\(サンプル\)$/, "").startsWith(baseName));
        if (baseName && trick) {
          option.trickId = trick.id;
          changed = true;
        }
      }
    }
  }
  return changed;
}
function cloneSampleStep(step) {
  if (!step) return null;
  const cloned = { ...step, id: uid() };
  if (Array.isArray(step.options)) cloned.options = step.options.map((o) => ({ ...o, id: uid() }));
  return cloned;
}
function sampleDirectChoiceStep(slot) {
  if (!slot) return null;
  const opt = slot.options && slot.options[0];
  const name = opt?.name || slot.name || "選択技";
  const trick = (state.tricks || []).find((t) => t.sample && t.name.startsWith(name));
  return {
    id: uid(), name, kind: "trick", cue: slot.cue,
    risk: opt?.risk, trickId: trick?.id, sampleContent: true,
  };
}
function buildSampleHistoricalVersions(rt) {
  const current = latestVersion(rt);
  const source = current?.steps || [];
  if (!source.length) return [];
  const findName = (part) => source.find((s) => String(s.name || "").includes(part));
  const three = findName("3ボール");
  const reverse = findName("リバース");
  const transition = source.find((s) => s.kind === "transition" && !String(s.name || "").includes("フィニッシュ"));
  const four = findName("4ボール");
  const slot = source.find(isSlot);
  const five = findName("5ボールカスケード");
  const finish = findName("フィニッシュ") || source[source.length - 1];
  const directChoice = sampleDirectChoiceStep(slot);
  const cloneAll = (steps) => steps.filter(Boolean).map(cloneSampleStep);
  const dayMs = 24 * 60 * 60 * 1000;
  const currentCreatedAt = Number(current.createdAt) || Date.now();
  const now = Math.min(Date.now(), currentCreatedAt);
  return [
    { id: uid(), createdAt: now - 35 * dayMs, label: "基本構成",
      steps: cloneAll([three, reverse, four, directChoice, finish]) },
    { id: uid(), createdAt: now - 18 * dayMs, label: "移行を追加",
      steps: cloneAll([three, reverse, transition, four, directChoice, five, finish]) },
  ];
}
function ensureSampleVersionDemo(rt) {
  if (!rt?.sampleSet || rt.sampleVersionDemo >= 3 || !Array.isArray(rt.versions) || !rt.versions.length) return false;
  const historical = buildSampleHistoricalVersions(rt);
  if (!historical.length) return false;
  const originalCount = rt.versions.length;
  if (originalCount === 1) {
    rt.versions = [...historical, ...rt.versions];
  } else if (originalCount === 2) {
    // 既に本人が編集してv2を作っている場合は、履歴参照を壊さずv1だけを手前に足す。
    rt.versions = [historical[0], ...rt.versions];
  }
  if (rt.versions.length >= 3) {
    if (!rt.versions[0].label) rt.versions[0].label = "基本構成";
    if (!rt.versions[1].label) rt.versions[1].label = "移行を追加";
    if (!latestVersion(rt).label) latestVersion(rt).label = "A/B分岐を追加";
    if (originalCount === 1) {
      latestVersion(rt).createdAt = Math.min(Number(latestVersion(rt).createdAt) || Date.now(), Date.now() - 5 * 24 * 60 * 60 * 1000);
    }
  }
  rt.sampleVersionDemo = 3;
  return true;
}
function sampleFailureStepIndex(ver, key) {
  const steps = ver.steps || [];
  const match = (s) => {
    const name = String(s.name || "");
    if (key === "reverse") return name.includes("リバース");
    if (key === "four") return name.includes("4ボール");
    if (key === "choice") return isSlot(s) || name.includes("5ボールハイトス") || name.includes("シャワー");
    if (key === "five") return name.includes("5ボールカスケード");
    return false;
  };
  let index = steps.findIndex(match);
  if (index < 0 && key === "five") index = steps.findIndex((s) => String(s.name || "").includes("5ボール"));
  return index >= 0 ? index : Math.max(0, steps.length - 1);
}
// 分析画面の読み方まで試せるよう、サンプルの3バージョンに5日・40本のデモ通し履歴を分けて付ける。
function seedSampleHistory(rt, force = false) {
  if (!rt || !rt.sampleSet || (rt.sampleHistorySeeded && !force)) return false;
  const newest = latestVersion(rt);
  if (!newest || !newest.steps || !newest.steps.length) return false;
  if (!force && state.sessions.some((s) => s.routineId === rt.id)) {
    rt.sampleHistorySeeded = true;
    return true;
  }

  const plans = [
    { days: 28, feeling: 2, note: "体育館・通常の道具", review: "4ボール以降で力みやすかった。", nextPlan: "4ボール前の呼吸を一定にする", fails: {
      2: ["four", "drop_abort", ["技術ミス"], "高さが揃わず中止"],
      4: ["choice", "wobble", ["技術ミス"], "5ボールで一度乱れた"],
      5: ["reverse", "wobble", ["集中切れ"], "視線が先へ行った"],
      7: ["four", "drop_recovered", ["疲労"], "落としたが拾って続行"],
      8: ["five", "drop_abort", ["疲労"], "終盤で高さが落ちた"],
    } },
    { days: 21, feeling: 1, note: "仕事後・少し疲労", review: "後半だけでなく4ボールへの入りも不安定。", nextPlan: "通し前に4ボールを3回だけ確認", fails: {
      1: ["four", "wobble", ["疲労"], "入りで軌道が狭くなった"],
      2: ["choice", "drop_abort", ["技術ミス"], "選択技の入りでドロップ"],
      3: ["four", "drop_abort", ["疲労"], "4ボールで中止"],
      5: ["five", "wobble", ["疲労"], "終盤で乱れた"],
      6: ["reverse", "drop_recovered", ["集中切れ"], "リバースで一度落とした"],
      7: ["choice", "wobble", ["技術ミス"], "ラスト前で軌道が前へ出た"],
      8: ["four", "drop_abort", ["疲労"], "4ボールの高さ不足"],
    } },
    { days: 14, feeling: 2, note: "体育館・本番用の靴", review: "呼吸を意識すると4ボールの成功が増えた。", nextPlan: "選択技A/Bを同じ本数ずつ試す", fails: {
      2: ["four", "wobble", ["技術ミス"], "4ボールで小さな乱れ"],
      4: ["choice", "drop_recovered", ["技術ミス"], "5ボールを拾って復帰"],
      6: ["four", "drop_abort", ["集中切れ"], "音を聞き逃して中止"],
      8: ["five", "wobble", ["疲労"], "終盤の高さが不足"],
    } },
    { days: 7, feeling: 3, note: "本番を想定して衣装で練習", review: "全体は安定。Aの方がまだ乱れやすい。", nextPlan: "Aを選ぶ日は手の高さだけ意識", fails: {
      3: ["four", "wobble", ["緊張"], "4ボールの最初だけ硬くなった"],
      5: ["choice", "wobble", ["技術ミス"], "選択技Aで乱れた"],
      7: ["reverse", "wobble", ["集中切れ"], "リバースの出口で乱れた"],
    } },
    { days: 2, feeling: 3, note: "通し前に短いパート練習", review: "後半まで余裕を残せた。", nextPlan: "同じ準備で本番テンポを確認", fails: {
      4: ["four", "wobble", ["技術ミス"], "4ボールを立て直した"],
      8: ["choice", "drop_recovered", ["緊張"], "ラスト前で落としたが復帰"],
    } },
  ];
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const demoVersions = rt.versions.length >= 3
    ? [rt.versions[0], rt.versions[1], newest]
    : [newest, newest, newest];

  plans.forEach((plan, sessionIndex) => {
    const ver = demoVersions[sessionIndex < 2 ? 0 : sessionIndex < 4 ? 1 : 2];
    const slotIndex = ver.steps.findIndex(isSlot);
    const slot = slotIndex >= 0 ? ver.steps[slotIndex] : null;
    const startedAt = now - plan.days * dayMs;
    const runs = Array.from({ length: 8 }, (_, index) => {
      const runNo = index + 1;
      const fail = plan.fails[runNo];
      const chosen = slot ? slot.options[(sessionIndex + runNo) % 2 === 0 ? 0 : 1] : null;
      const choices = slot && chosen ? { [slot.id]: chosen.id } : undefined;
      if (!fail) {
        return { id: uid(), at: startedAt + runNo * 7 * 60 * 1000, outcome: "clean", events: [],
          reachedIndex: ver.steps.length - 1, choices };
      }
      const [stepKey, type, tags, note] = fail;
      const stepIndex = sampleFailureStepIndex(ver, stepKey);
      const step = ver.steps[stepIndex];
      const event = {
        stepId: step.id, stepIndex, type, tags, note,
        musicTime: Math.round(((Number(step.cue) || 0) + 0.6 + (runNo % 3) * 0.2) * 10) / 10,
      };
      if (stepIndex === slotIndex && chosen) event.optionId = chosen.id;
      return {
        id: uid(), at: startedAt + runNo * 7 * 60 * 1000,
        outcome: type === "drop_abort" ? "aborted" : "finished",
        events: [event], reachedIndex: type === "drop_abort" ? stepIndex : ver.steps.length - 1, choices,
      };
    });
    state.sessions.push({
      id: uid(), routineId: rt.id, versionId: ver.id,
      date: localDateString(startedAt), startedAt,
      endedAt: startedAt + 70 * 60 * 1000, feeling: plan.feeling,
      note: plan.note, review: plan.review, nextPlan: plan.nextPlan,
      runs, recordings: [], sampleHistory: true,
    });
  });
  rt.sampleHistorySeeded = true;
  return true;
}

async function ensureSampleTricks() {
  const byName = {};
  for (const s of SAMPLE_TRICKS) {
    let t = (state.tricks || []).find((x) => x.sample && x.name.startsWith(s.n));
    if (!t) {
      try {
        const resp = await fetch(s.f);
        if (!resp.ok) continue;
        const blob = await resp.blob();
        const dur = (await probeVideoDuration(blob)) || 4;
        const id = uid();
        if (await blobPut(id, blob)) {
          const d = Math.round(dur * 10) / 10;
          t = { id, name: `${s.n} (サンプル)`, blobId: id, duration: d, fullDuration: d,
            trimStart: 0, trimEnd: d, lineColor: "blue", size: blob.size, createdAt: Date.now(), sample: true };
          state.tricks.push(t);
        }
      } catch (_) {}
    }
    if (t) byName[s.n] = t;
  }
  return byName;
}
window.loadSampleSet = async () => {
  if (!location.protocol.startsWith("http")) return appAlert(FILE_OPEN_ALERT);
  if (!appConfirm("サンプル一式(技9個+楽曲付きサンプルルーティン)を追加しますか?")) return;
  showLoading("サンプル一式を読み込み中…");
  try {
  const byName = await ensureSampleTricks();
  if (state.routines.some((r) => r.sampleSet)) {
    state.routines.filter((r) => r.sampleSet).forEach(linkSampleOptionVideos);
    saveState(); render();
    return toast("サンプルルーティンは既にあります(技のみ確認しました)");
  }
  // サンプル楽曲(レジストリの1曲目を使用)
  let music = null;
  const mf = await fetchSampleMusicFile(0);
  if (mf) {
    const mid = uid();
    if (await blobPut(mid, mf)) music = { blobId: mid, name: mf.name };
  }
  // 技リンク/移行/リスク度/♪キュー/A/Bスロットを含むが、任意機能の表示は初期OFFにする。
  const T = (n) => (byName[n] ? byName[n].id : undefined);
  const steps = [
    { id: uid(), name: "3ボールカスケード", kind: "trick", risk: 1, cue: 0, trickId: T("3ボールカスケード") },
    { id: uid(), name: "リバースカスケード", kind: "trick", risk: 2, cue: 8, trickId: T("リバースカスケード") },
    { id: uid(), name: "持ち替え(間)", kind: "transition", risk: 1, cue: 15 },
    { id: uid(), name: "4ボールファウンテン", kind: "trick", risk: 3, cue: 18, trickId: T("4ボールファウンテン") },
    { id: uid(), name: "ラスト前(調子で選ぶ)", kind: "trick", cue: 28, options: [
      { id: uid(), name: "5ボールハイトス", risk: 5, trickId: T("5ボールハイトス") },
      { id: uid(), name: "シャワー(安牌)", risk: 2, trickId: T("シャワー") },
    ] },
    { id: uid(), name: "5ボールカスケード", kind: "trick", risk: 4, cue: 40, trickId: T("5ボールカスケード") },
    { id: uid(), name: "フィニッシュポーズ", kind: "transition", risk: 1, cue: 50 },
  ];
  steps.forEach((step) => {
    step.sampleContent = true;
    (step.options || []).forEach((option) => { option.sampleContent = true; });
  });
  const sampleRoutine = {
    id: uid(), name: "サンプル: はじめてのルーティン", music, sampleSet: true,
    lineColor: "rust",
    memo: "次回は4ボール前の呼吸を一定にし、A/Bを同じ本数ずつ試す。",
    featureSettings: { showRisk: false, showSlots: false },
    partLoop: { a: 18, b: 28 }, // パート練習のデモ区間(4ボールの部分)
    versions: [{ id: uid(), createdAt: Date.now(), steps }],
  };
  state.routines.push(sampleRoutine);
  ensureSampleVersionDemo(sampleRoutine);
  seedSampleHistory(sampleRoutine, true);
  saveState(); render();
  toast("サンプルv1〜v3と通し40本の分析例を追加しました");
  } finally { hideLoading(); }
};
window.removeSampleTricks = async () => {
  const samples = (state.tricks || []).filter((t) => t.sample);
  if (!samples.length) return;
  if (!appConfirm(`サンプルの技${samples.length}個をまとめて削除しますか?`)) return;
  for (const t of samples) await blobDel(t.blobId);
  state.tricks = state.tricks.filter((t) => !t.sample);
  saveState(); render(); toast("サンプルを削除しました");
};

function renderTricks() {
  const tricks = (state.tricks || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  const totalBytes = tricks.reduce((a, t) => a + (t.size || 0), 0);
  const rows = tricks.map((t) => `
    <div class="trick-row" data-line-color="${itemLineColor(t)}">
      ${itemLineColorButtonHtml(t, "trick")}
      <div class="head">
        <span class="nm" data-user-text onclick="sheetRenameTrick('${t.id}')">${esc(trickDisplayName(t))}</span>
        <span class="kn">${t.duration.toFixed(1)}s${(t.trimStart || 0) > 0.05 || (t.trimEnd != null && t.fullDuration != null && t.trimEnd < t.fullDuration - 0.05) ? "✂" : ""}</span>
        <button class="mini-btn video-trim-btn" aria-label="${esc(trickDisplayName(t))}の動画を再生・トリム" title="動画を再生・トリム" onclick="sheetTrimTrick('${t.id}')">▶</button>
        <button class="mini-btn del" onclick="trickDelete('${t.id}')">✕</button>
      </div>
    </div>`).join("");
  return `
    <div class="topbar"><button class="back-btn" onclick="go('home')">戻る</button><h1>技ライブラリ</h1></div>
    <div class="row-2">
      <button class="btn primary" style="margin-bottom:12px" onclick="go('trickrec')">● カメラで撮影</button>
      <button class="btn" onclick="document.getElementById('trick-file').click()">＋ 動画を登録</button>
    </div>
    <input type="file" id="trick-file" accept="video/*" class="hidden" onchange="trickImport(this)">
    <div class="card">
      <h2>登録済みの技 (最大${TRICK_MAX_SEC}秒/本${totalBytes ? ` — 合計${fmtBytes(totalBytes)}` : ""})</h2>
      ${rows || `<div class="empty">まだ技がありません。<br>撮影するか、撮ってある動画を登録してください。</div>`}
    </div>
    ${tricks.some((t) => t.sample)
      ? `<button class="btn ghost" onclick="removeSampleTricks()">サンプル技をまとめて削除</button>`
      : `<button class="btn ghost" onclick="loadSampleSet()">サンプル一式を読み込む(技9個+ルーティン)</button>`}`;
}

// 技動画をシートで再生(どの画面からでもワンタップ)。
// ctx: true=追加ピッカーから(「この技を追加」) / 数値=編集ステップctxへの紐づけモード / なし=閲覧のみ
let sheetVideoUrl = null;
window.playTrickVideo = async (trickId, ctx) => {
  const t = (state.tricks || []).find((x) => x.id === trickId);
  if (!t) return toast("動画が見つかりません(技ライブラリから削除されています)");
  return withLoading("動画を読み込み中…", async () => {
    const blob = await blobGet(t.blobId);
    if (!blob) return toast("動画データが見つかりません");
    if (sheetVideoUrl) URL.revokeObjectURL(sheetVideoUrl);
    sheetVideoUrl = URL.createObjectURL(blob);
    const optionContext = typeof ctx === "string" ? ctx.match(/^option:(\d+):(\d+)$/) : null;
    const actions = optionContext
      ? `<button class="btn primary" onclick="linkTrickToOption(${optionContext[1]},${optionContext[2]},'${t.id}')">この動画を紐づける</button>
         <button class="btn ghost" onclick="sheetLinkTrickToOption(${optionContext[1]},${optionContext[2]})">戻る</button>`
      : typeof ctx === "number"
      ? `<button class="btn primary" onclick="linkTrickToStep(${ctx},'${t.id}')">この動画を紐づける</button>
         <button class="btn ghost" onclick="sheetLinkTrick(${ctx})">戻る</button>`
      : ctx === true
      ? `<button class="btn primary" onclick="addStepFromTrick('${t.id}')">この技をルーティンに追加</button>
         <button class="btn ghost" onclick="sheetPickTrick()">技リストに戻る</button>`
      : `<button class="btn ghost" onclick="hideSheet()">閉じる</button>`;
    showSheet(`
      <h3>${esc(trickDisplayName(t))}</h3>
      <div class="sheet-sub">${fmtTime(t.duration)}</div>
      <video class="trick-video" style="margin-top:0" src="${sheetVideoUrl}" data-trim-trick="${t.id}" controls autoplay playsinline loop></video>
      <div style="height:14px"></div>
      ${actions}`);
  });
};

// 編集画面の技動画は、行内を広げず、通し/パートと共通の上部固定プレビューへ表示する。
window.editorPreviewTrick = (i) => {
  const s = draft && draft.steps[i];
  if (!s || !s.trickId) return;
  musicPlayer.pause();
  editPreviewStepId = s.id;
  editPreviewManual = true;
  updatePracticeNowUI();
};

// 手入力の技に技ライブラリの動画を紐づける(注釈扱い=版は分割しない)
window.sheetLinkTrick = (i) => {
  const s = draft && draft.steps[i];
  if (!s) return;
  const tricks = (state.tricks || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  if (!tricks.length) {
    return showSheet(`
      <h3>動画を紐づけ</h3>
      <div class="empty">技ライブラリが空です。<br>先に技を撮影・登録してください。</div>
      <button class="btn" onclick="hideSheet();go('tricks')">技ライブラリへ</button>
      <button class="btn ghost" onclick="hideSheet()">閉じる</button>`);
  }
  showSheet(`
    <h3>「${esc(stepDisplayName(s) || "この技")}」に動画を紐づけ</h3>
    <div class="sheet-sub">タップで紐づけ / 再生マークで動画を確認</div>
    ${tricks.map((t) => `
      <div class="pick-trick-row" data-line-color="${itemLineColor(t)}" onclick="linkTrickToStep(${i},'${t.id}')">
        <span class="nm">${esc(trickDisplayName(t))}</span>
        <span class="kn">${fmtTime(t.duration)}</span>
        <button class="mini-btn play" aria-label="${esc(trickDisplayName(t))}の動画を再生" onclick="event.stopPropagation();playTrickVideo('${t.id}',${i})">▶</button>
      </div>`).join("")}
    <div style="height:10px"></div>
    ${s.trickId ? `<button class="btn danger-ghost" style="width:100%" onclick="unlinkTrickFromStep(${i})">紐づけを解除</button>` : ""}
    <button class="btn ghost" onclick="hideSheet()">閉じる</button>`);
};
window.linkTrickToStep = (i, trickId) => {
  const s = draft && draft.steps[i];
  const t = (state.tricks || []).find((x) => x.id === trickId);
  if (!s || !t) return hideSheet();
  s.trickId = trickId;
  if (!s.name.trim()) {
    s.name = t.name;
    s.sampleContent = !!t.sample;
  }
  hideSheet(); render();
  toast(`「${t.name}」の動画を紐づけました`);
};
window.unlinkTrickFromStep = (i) => {
  const s = draft && draft.steps[i];
  if (!s) return hideSheet();
  delete s.trickId;
  hideSheet(); render();
  toast("紐づけを解除しました");
};

// A/Bの各選択肢は独立した技として、別々の動画を紐づける。
window.sheetLinkTrickToOption = (i, oi) => {
  const option = draft && draft.steps[i] && draft.steps[i].options && draft.steps[i].options[oi];
  if (!option) return;
  const tricks = (state.tricks || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  if (!tricks.length) {
    return showSheet(`
      <h3>動画を紐づけ</h3>
      <div class="empty">技ライブラリが空です。<br>先に技を撮影・登録してください。</div>
      <button class="btn" onclick="hideSheet();go('tricks')">技ライブラリへ</button>
      <button class="btn ghost" onclick="hideSheet()">閉じる</button>`);
  }
  const optionLabel = optionDisplayName(option) || `選択肢${String.fromCharCode(65 + oi)}`;
  showSheet(`
    <h3>「${esc(optionLabel)}」に動画を紐づけ</h3>
    <div class="sheet-sub">この選択肢だけに紐づきます / 再生マークで動画を確認</div>
    ${tricks.map((t) => `
      <div class="pick-trick-row" data-line-color="${itemLineColor(t)}" onclick="linkTrickToOption(${i},${oi},'${t.id}')">
        <span class="nm">${esc(trickDisplayName(t))}</span>
        <span class="kn">${fmtTime(t.duration)}</span>
        <button class="mini-btn play" aria-label="${esc(trickDisplayName(t))}の動画を再生"
          onclick="event.stopPropagation();playTrickVideo('${t.id}','option:${i}:${oi}')">▶</button>
      </div>`).join("")}
    <div style="height:10px"></div>
    ${option.trickId ? `<button class="btn danger-ghost" style="width:100%" onclick="unlinkTrickFromOption(${i},${oi})">紐づけを解除</button>` : ""}
    <button class="btn ghost" onclick="hideSheet()">閉じる</button>`);
};
window.linkTrickToOption = (i, oi, trickId) => {
  const option = draft && draft.steps[i] && draft.steps[i].options && draft.steps[i].options[oi];
  const t = (state.tricks || []).find((x) => x.id === trickId);
  if (!option || !t) return hideSheet();
  option.trickId = trickId;
  if (!option.name.trim()) {
    option.name = t.name.replace(/\s*\(サンプル\)$/, "");
    option.sampleContent = !!t.sample;
  }
  hideSheet(); render();
  toast(`「${t.name}」の動画を選択肢に紐づけました`);
};
window.unlinkTrickFromOption = (i, oi) => {
  const option = draft && draft.steps[i] && draft.steps[i].options && draft.steps[i].options[oi];
  if (!option) return hideSheet();
  delete option.trickId;
  hideSheet(); render();
  toast("選択肢の動画紐づけを解除しました");
};

// トリム区間[trimStart,trimEnd]でループ再生させる。トリム無しなら何もしない(native loopに任せる)。
// 端でのplay()再開は音ありビデオだとブラウザにブロックされるため、native loop=onのまま
// 「区間外に出たら始点へシーク」だけで実現する(再生は途切れない)
function bindTrimVideo(v, t) {
  if (!v || !t || v._trimBound) return;
  const start = t.trimStart || 0;
  const end = t.trimEnd != null ? t.trimEnd : (t.fullDuration || t.duration);
  const full = t.fullDuration || t.duration;
  if (start <= 0.02 && end >= full - 0.05) return; // トリム無し
  v._trimBound = true;
  v.loop = true;
  const toStart = () => { try { v.currentTime = start; } catch (_) {} };
  v.addEventListener("loadedmetadata", toStart);
  if (v.readyState >= 1) toStart();
  // 端に来たら始点へ折り返す。逆方向シークはwaiting→pauseを誘発するので、seeked後にplay()で再開する
  v.addEventListener("timeupdate", () => {
    if (v.currentTime >= end - 0.05 || v.currentTime < start - 0.1) { v._looping = true; toStart(); }
  });
  v.addEventListener("seeked", () => { if (v._looping) { v._looping = false; v.play().catch(() => {}); } });
}
function bindAllTrimVideos() {
  document.querySelectorAll("video[data-trim-trick]").forEach((v) =>
    bindTrimVideo(v, (state.tricks || []).find((x) => x.id === v.dataset.trimTrick)));
}

// ---------- 技動画の長さ調整(トリム)。始点/終点を設定=有効区間だけを技の長さに。後からいつでも変更可 ----------
let trimUrl = null;
let trimDraft = null; // { id, start, end, full, changeContext? }
window.sheetTrimTrick = async (id, changeContext = "") => {
  const t = (state.tricks || []).find((x) => x.id === id);
  if (!t) return;
  return withLoading("動画の編集画面を準備中…", async () => {
    const blob = await blobGet(t.blobId);
    if (!blob) return toast("動画データが見つかりません");
    musicPlayer.pause(); // カット中は曲を止める(編集画面から開いた場合)
    if (trimUrl) URL.revokeObjectURL(trimUrl);
    trimUrl = URL.createObjectURL(blob);
    const full = t.fullDuration != null ? t.fullDuration : t.duration;
    trimDraft = { id, start: t.trimStart || 0, end: t.trimEnd != null ? t.trimEnd : full, full, changeContext };
    showSheet(trimSheetHtml(), "trim-sheet");
    const v = document.getElementById("trim-video");
    if (v) {
      v.addEventListener("timeupdate", () => {
        if (!trimDraft) return;
        if (v.currentTime >= trimDraft.end - 0.03 || v.currentTime < trimDraft.start - 0.1) {
          v.currentTime = trimDraft.start; if (v.paused) v.play().catch(() => {});
        }
        updateTrimPlayhead();
      });
      v.addEventListener("loadedmetadata", () => { try { v.currentTime = trimDraft.start; } catch (_) {} });
    }
  });
};
// シークバーの現在位置プレイヘッド更新
function updateTrimPlayhead() {
  const v = document.getElementById("trim-video"), ph = document.getElementById("trim-playhead");
  if (v && ph && trimDraft && trimDraft.full) ph.style.left = (v.currentTime / trimDraft.full) * 100 + "%";
  const cur = document.getElementById("trim-cur");
  if (cur && v) cur.textContent = fmtTimeFine(v.currentTime);
}
// シークバーをタップ/ドラッグで再生位置を移動
window.trimSeek = (e) => {
  const v = document.getElementById("trim-video"); if (!v || !trimDraft || !trimDraft.full) return;
  const track = e.currentTarget.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - track.left;
  const frac = Math.max(0, Math.min(1, x / track.width));
  try { v.currentTime = frac * trimDraft.full; } catch (_) {}
  updateTrimPlayhead();
};
function trimSheetHtml() {
  const d = trimDraft;
  const trick = (state.tricks || []).find((t) => t.id === d.id);
  const left = d.full ? (d.start / d.full) * 100 : 0;
  const w = d.full ? Math.max(1, ((d.end - d.start) / d.full) * 100) : 0;
  const stepContext = typeof d.changeContext === "string" ? d.changeContext.match(/^step:(\d+)$/) : null;
  const optionContext = typeof d.changeContext === "string" ? d.changeContext.match(/^option:(\d+):(\d+)$/) : null;
  const changeAction = stepContext
    ? `<button class="btn video-link-change" onclick="openStepVideoPicker(${stepContext[1]})">動画を変更</button>`
    : optionContext
      ? `<button class="btn video-link-change" onclick="openOptionVideoPicker(${optionContext[1]},${optionContext[2]})">動画を変更</button>`
      : "";
  return `
    <h3>動画を再生・トリム</h3>
    ${trick ? `<div class="sheet-sub trim-linked-video">現在の動画: <b>${esc(trick.name)}</b></div>` : ""}
    <div class="sheet-sub">動画を確認しながら「今の位置」で始点・終点を決めます。バーをタップで頭出し</div>
    <video id="trim-video" class="trick-video" style="margin-top:0" src="${trimUrl}" controls autoplay playsinline></video>
    <div class="trim-track" onclick="trimSeek(event)" ontouchstart="trimSeek(event)" ontouchmove="trimSeek(event)">
      <div class="range" id="trim-bar" style="left:${left}%;width:${w}%"></div>
      <div class="head" id="trim-playhead" style="left:0%"></div>
    </div>
    <div class="trim-scale"><span id="trim-cur">0:00.0</span><span>${fmtTime(d.full)}</span></div>
    <div class="part-point">
      <span class="pp-label">始点</span><span class="pp-time" id="trim-start">${fmtTimeFine(d.start)}</span>
      <button class="mini-btn" onclick="trimNudge('start',-0.1)">−</button>
      <button class="mini-btn" onclick="trimNudge('start',0.1)">＋</button>
      <button class="btn small" onclick="trimSetPoint('start')">今の位置</button>
    </div>
    <div class="part-point">
      <span class="pp-label">終点</span><span class="pp-time" id="trim-end">${fmtTimeFine(d.end)}</span>
      <button class="mini-btn" onclick="trimNudge('end',-0.1)">−</button>
      <button class="mini-btn" onclick="trimNudge('end',0.1)">＋</button>
      <button class="btn small" onclick="trimSetPoint('end')">今の位置</button>
    </div>
    <div class="b-now-line" style="color:var(--text)">この技の長さ: <b id="trim-len">${fmtTime(d.end - d.start)}</b></div>
    <button class="btn primary" onclick="trimSave()">保存</button>
    ${changeAction}
    <button class="btn ghost" onclick="hideSheet()">キャンセル</button>`;
}
// トリム画面から動画選択へ移る前に、再生中メディアと一時URLを確実に解放する。
window.openStepVideoPicker = (i) => {
  releaseSheetMedia();
  sheetLinkTrick(i);
};
window.openOptionVideoPicker = (i, oi) => {
  releaseSheetMedia();
  sheetLinkTrickToOption(i, oi);
};
function updateTrimSheetUI() {
  const d = trimDraft; if (!d) return;
  const s = document.getElementById("trim-start"); if (s) s.textContent = fmtTimeFine(d.start);
  const e = document.getElementById("trim-end"); if (e) e.textContent = fmtTimeFine(d.end);
  const l = document.getElementById("trim-len"); if (l) l.textContent = fmtTime(d.end - d.start);
  const bar = document.getElementById("trim-bar");
  if (bar && d.full) { bar.style.left = (d.start / d.full) * 100 + "%"; bar.style.width = Math.max(1, ((d.end - d.start) / d.full) * 100) + "%"; }
}
window.trimSetPoint = (which) => {
  const v = document.getElementById("trim-video"); if (!v || !trimDraft) return;
  const t = round1(v.currentTime);
  if (which === "start") trimDraft.start = Math.max(0, Math.min(t, trimDraft.end - 0.3));
  else trimDraft.end = Math.min(trimDraft.full, Math.max(t, trimDraft.start + 0.3));
  updateTrimSheetUI();
};
window.trimNudge = (which, delta) => {
  if (!trimDraft) return;
  if (which === "start") trimDraft.start = Math.max(0, Math.min(round1(trimDraft.start + delta), trimDraft.end - 0.3));
  else trimDraft.end = Math.min(trimDraft.full, Math.max(round1(trimDraft.end + delta), trimDraft.start + 0.3));
  updateTrimSheetUI();
};
window.trimSave = () => {
  const d = trimDraft; if (!d) return;
  if (d.end - d.start < 0.3) return toast("0.3秒以上にしてください");
  const t = state.tricks.find((x) => x.id === d.id);
  if (t) {
    t.fullDuration = d.full;
    t.trimStart = round1(d.start);
    t.trimEnd = round1(d.end);
    t.duration = round1(d.end - d.start);
  }
  trimDraft = null;
  saveState(); hideSheet(); render();
  toast(`長さを ${fmtTime(t.duration)} にしました`);
};
window.trickDelete = async (id) => {
  const t = state.tricks.find((x) => x.id === id);
  if (!t) return;
  if (!appConfirm(`「${t.name}」を削除しますか?(元に戻せません)`)) return;
  await blobDel(id);
  state.tricks = state.tricks.filter((x) => x.id !== id);
  saveState(); render(); toast("削除しました");
};
window.sheetRenameTrick = (id) => {
  const t = state.tricks.find((x) => x.id === id);
  showSheet(`
    <h3>技の名前</h3>
    <input type="text" id="trick-name" value="${esc(t.name)}">
    <div style="height:14px"></div>
    <button class="btn primary" onclick="commitRenameTrick('${id}')">保存</button>
    <button class="btn ghost" onclick="hideSheet()">キャンセル</button>`);
};
window.commitRenameTrick = (id) => {
  const t = state.tricks.find((x) => x.id === id);
  const name = document.getElementById("trick-name").value.trim();
  if (name) t.name = name;
  saveState(); hideSheet(); render();
};

// 動画ファイルの長さをメタデータから取得
function probeVideoDuration(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.preload = "metadata";
    let settled = false;
    let timeout = null;
    const finish = (duration) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      v.removeAttribute("src");
      v.load();
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    v.onloadedmetadata = () => finish(isFinite(v.duration) ? v.duration : null);
    v.onerror = () => finish(null);
    v.src = url;
    timeout = setTimeout(() => finish(null), 6000);
  });
}
async function saveTrick(blob, duration, defaultName) {
  const id = uid();
  if (!(await blobPut(id, blob))) return toast("動画を保存できませんでした");
  state.tricks.push({ id, name: defaultName, blobId: id, duration, fullDuration: duration, lineColor: "blue",
    trimStart: 0, trimEnd: duration, size: blob.size, createdAt: Date.now() });
  saveState();
  go("tricks");
  setTimeout(() => sheetRenameTrick(id), 80); // 保存直後に名前を付けさせる
}
// アップロード動画をプロファイルに合わせて再エンコード(canvas→captureStream→MediaRecorder)。
// ffmpeg等の重い依存を足さずブラウザ標準で完結。音声は落とす(技は映像確認が目的)。非対応/失敗はnull
async function reencodeVideo(file) {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
  const prof = videoProfile();
  const src = document.createElement("video");
  src.muted = true; src.playsInline = true; src.preload = "auto"; src.src = URL.createObjectURL(file);
  try {
    await new Promise((res, rej) => { src.onloadedmetadata = res; src.onerror = () => rej(new Error("load")); });
    const sw = src.videoWidth, sh = src.videoHeight;
    if (!sw || !sh) throw new Error("no dims");
    const scale = Math.min(1, prof.maxH / sh);
    const w = Math.max(2, Math.round(sw * scale / 2) * 2), h = Math.max(2, Math.round(sh * scale / 2) * 2);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    const cstream = canvas.captureStream(24);
    const mime = MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "";
    const rec = mime ? new MediaRecorder(cstream, { mimeType: mime, videoBitsPerSecond: prof.bps })
                     : new MediaRecorder(cstream, { videoBitsPerSecond: prof.bps });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    let raf = null, maxT = 0;
    const draw = () => { try { ctx.drawImage(src, 0, 0, w, h); } catch (_) {} maxT = Math.max(maxT, src.currentTime); raf = requestAnimationFrame(draw); };
    await new Promise((resolve) => {
      let done = false;
      let guard = null;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        cancelAnimationFrame(raf);
        try { if (rec.state !== "inactive") rec.stop(); } catch (_) { resolve(); }
      };
      rec.onstop = resolve;
      rec.onerror = finish;
      src.onended = finish;
      guard = setTimeout(finish, (TRICK_MAX_SEC + 3) * 1000); // 保険(実時間で回すため)
      rec.start(200);
      src.currentTime = 0;
      const playing = src.play();
      if (playing && playing.then) playing.then(draw).catch(finish);
      else draw();
    });
    cstream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: rec.mimeType || "video/mp4" });
    // 再生が進まない環境(=静止フレームだけ)は壊れた圧縮になるので採用しない → 元動画を保持
    if (!blob.size || maxT < Math.min(0.5, src.duration * 0.5)) return null;
    const dur = await probeVideoDuration(blob);
    return { blob, duration: dur || src.duration };
  } catch (_) {
    return null;
  } finally {
    URL.revokeObjectURL(src.src);
  }
}

window.trickImport = async (input) => {
  const file = input.files[0];
  input.value = "";
  if (!file) return;
  if (file.size > TRICK_MAX_BYTES) return toast(`${fmtBytes(TRICK_MAX_BYTES)}以下の動画にしてください(現在${fmtBytes(file.size)})`);
  return withLoading("動画を確認・圧縮中…", async () => {
    const dur0 = await probeVideoDuration(file);
    if (dur0 == null) return toast("動画を読み込めませんでした");
    if (dur0 > TRICK_MAX_SEC + 0.5) return toast(`技は最大${TRICK_MAX_SEC}秒です(この動画は${fmtTime(dur0)})。トリミングしてから登録してください`);
    let blob = file, dur = dur0;
    const enc = await reencodeVideo(file);
    if (enc && enc.blob.size > 0 && enc.blob.size < file.size) { blob = enc.blob; dur = enc.duration || dur0; }
    await saveTrick(blob, dur, file.name.replace(/\.[^.]+$/, "") || "新しい技");
  });
};

// --- アプリ内カメラ撮影(設定の画質プロファイル=容量対策、上限秒で自動停止) ---
let trickCam = null; // { stream, rec, chunks, recording, startedAt, timer, blob, objUrl }

function releaseTrickCam() {
  if (!trickCam) return;
  clearInterval(trickCam.timer);
  try { if (trickCam.rec && trickCam.rec.state !== "inactive") trickCam.rec.stop(); } catch (_) {}
  if (trickCam.stream) trickCam.stream.getTracks().forEach((t) => t.stop());
  if (trickCam.objUrl) URL.revokeObjectURL(trickCam.objUrl);
  trickCam = null;
}
async function initTrickCam() {
  if (!navigator.mediaDevices || !window.MediaRecorder) { trickCam = { error: true }; render(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", height: { ideal: videoProfile().maxH }, frameRate: { ideal: 24, max: 30 } },
      audio: false,
    });
    trickCam = { stream, chunks: [], recording: false };
    render();
    const v = document.getElementById("cam-preview");
    if (v) { v.srcObject = stream; v.play().catch(() => {}); }
  } catch (_) {
    trickCam = { error: true };
    if (view.name === "trickrec") render();
  }
}
window.trickRecToggle = () => {
  if (!trickCam || !trickCam.stream) return;
  if (trickCam.recording) return trickRecStop();
  const mime = MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4"
    : MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "";
  const bps = videoProfile().bps;
  const rec = mime
    ? new MediaRecorder(trickCam.stream, { mimeType: mime, videoBitsPerSecond: bps })
    : new MediaRecorder(trickCam.stream, { videoBitsPerSecond: bps });
  trickCam.rec = rec; trickCam.chunks = []; trickCam.recording = true; trickCam.startedAt = Date.now();
  rec.ondataavailable = (e) => { if (e.data.size) trickCam.chunks.push(e.data); };
  rec.start(500);
  trickCam.timer = setInterval(() => {
    if (!trickCam || !trickCam.recording) return;
    const t = (Date.now() - trickCam.startedAt) / 1000;
    const el = document.getElementById("trickrec-time");
    if (el) el.textContent = `${fmtTimeFine(t)} / 0:${TRICK_MAX_SEC}.0`;
    if (t >= TRICK_MAX_SEC) trickRecStop(); // 上限で自動停止
  }, 100);
  render();
  const v = document.getElementById("cam-preview");
  if (v) { v.srcObject = trickCam.stream; v.play().catch(() => {}); }
};
async function trickRecStop() {
  if (!trickCam || !trickCam.recording) return;
  clearInterval(trickCam.timer);
  trickCam.recording = false;
  const rec = trickCam.rec;
  await new Promise((resolve) => { rec.onstop = resolve; rec.stop(); });
  const dur = Math.min(TRICK_MAX_SEC, (Date.now() - trickCam.startedAt) / 1000);
  trickCam.blob = new Blob(trickCam.chunks, { type: rec.mimeType || "video/mp4" });
  trickCam.duration = Math.round(dur * 10) / 10;
  if (trickCam.objUrl) URL.revokeObjectURL(trickCam.objUrl);
  trickCam.objUrl = URL.createObjectURL(trickCam.blob);
  render();
}
window.trickRecRetake = () => {
  if (trickCam) { if (trickCam.objUrl) URL.revokeObjectURL(trickCam.objUrl); trickCam.blob = null; trickCam.objUrl = null; }
  render();
  const v = document.getElementById("cam-preview");
  if (v && trickCam) { v.srcObject = trickCam.stream; v.play().catch(() => {}); }
};
window.trickRecSave = async () => {
  if (!trickCam || !trickCam.blob) return;
  const blob = trickCam.blob, dur = trickCam.duration;
  return withLoading("動画を保存中…", async () =>
    saveTrick(blob, dur, `技 ${new Date().toLocaleDateString("ja-JP")}`));
};

function renderTrickRec() {
  if (!trickCam) setTimeout(initTrickCam, 0);
  if (trickCam && trickCam.error) {
    return `
      <div class="topbar"><button class="back-btn" onclick="go('tricks')">戻る</button><h1>技を撮影</h1></div>
      <div class="empty">この環境ではアプリ内カメラを使えません。<br>カメラアプリで撮影して「動画を登録」から取り込んでください。</div>
      <button class="btn" onclick="document.getElementById('trick-file2').click()">＋ 動画を登録</button>
      <input type="file" id="trick-file2" accept="video/*" capture="environment" class="hidden" onchange="trickImport(this)">`;
  }
  const reviewing = trickCam && trickCam.blob;
  return `
    <div class="topbar"><button class="back-btn" onclick="go('tricks')">戻る</button><h1>技を撮影</h1></div>
    ${reviewing ? `
      <video class="trick-video main" src="${trickCam.objUrl}" controls autoplay playsinline loop></video>
      <div class="row-2" style="margin-top:12px">
        <button class="btn primary" style="margin:0" onclick="trickRecSave()">この技を保存</button>
        <button class="btn" style="margin:0" onclick="trickRecRetake()">撮り直す</button>
      </div>` : `
      <video id="cam-preview" class="trick-video main" autoplay playsinline muted></video>
      <div class="center" style="margin:10px 0 14px">
        <span class="rec-timer" id="trickrec-time">${trickCam && trickCam.recording ? "" : `0:00.0 / 0:${TRICK_MAX_SEC}.0`}</span>
      </div>
      <button class="clean-btn ${trickCam && trickCam.recording ? "recording" : ""}" onclick="trickRecToggle()">
        ${trickCam && trickCam.recording ? "■ 停止" : "● 録画開始"}
        <span class="sub">${trickCam && trickCam.recording ? `${TRICK_MAX_SEC}秒で自動停止` : `${videoProfile().label}で撮影(設定で変更可)`}</span>
      </button>`}`;
}

const round1 = (x) => Math.round(x * 10) / 10;
// 曲位置キューの入力解釈: "1:23"/"1:23.5"/"83" → 秒。空=解除、不正=NaN
function parseCue(str) {
  const s = String(str).trim().replace(/[♪\s]/g, "");
  if (!s) return null;
  const m = s.match(/^(\d+):([0-5]?\d(?:\.\d+)?)$/);
  if (m) return round1(Number(m[1]) * 60 + Number(m[2]));
  const n = Number(s);
  return isFinite(n) && n >= 0 ? round1(n) : NaN;
}
// 曲位置は整数秒でも必ず小数第1位まで表示し、0.1秒単位で編集できることを明示する。
const fmtCue = (sec) => fmtTimeFine(sec);

// ========== 使い方(UIから追い出した説明の集約先) ==========
function renderHelpEnglish() {
  return `
    <div class="topbar"><button class="back-btn" onclick="go('home')">Back</button><h1>Guide</h1></div>
    <div class="card"><h2>About Routine Note</h2>
      <div class="help-body">Log each full run with one tap for a clean run or one tap at the step where an issue happened. The analysis helps you see where problems cluster instead of relying on memory alone.</div></div>
    <div class="card"><h2>Full-run workflow</h2>
      <div class="help-body">1. Prepare a session with your condition and practice notes.<br>
      2. Tap the large vermilion start button, confirm the countdown, and begin. You can change the countdown with − / + on the confirmation screen. To film the run, choose 4:3 Landscape or 9:16 Tall and prepare the front camera there. The setup preview uses the selected framing. The assigned app music is digitally recorded in the video; the camera microphone is not used.<br>
      3. For a clean run, tap <b>Clean</b> below the skill list.<br>
      4. If something happens, tap the relevant skill. <b>Drop (recovered)</b> is selected by default, so the music, video recording, and run continue. You can log multiple issues in one run. Choose <b>Drop (stopped)</b> only when the run actually ends, or choose <b>Not attempted</b> when an earlier issue prevented the next skill.<br>
      5. Start the next run, or end the session and leave a review and one thing to try next time.</div></div>
    <div class="card"><h2>Music, recordings, and full-run video</h2>
      <div class="help-body">Attach audio in Routine Edit. Volume is shared across Edit, Full Run, and Section Practice. When you log an issue, the current music position is saved automatically. Audio Library lets you reuse music and microphone recordings across routines.<br><br>For a routine with music, the app records the front-camera video and app music into one video file, so playback and seeking use one timeline. The saved music level is independent of the listening-volume slider, and camera microphone audio is not recorded. During development, choose 4:3 Landscape or 9:16 Tall before each run; the setup preview, live preview, and saved-player frame all use that choice. Recording follows music playback and ends when the music stops. The app stores up to five videos in total. A sixth video never deletes an older one automatically; choose which saved video to replace. Open a video from Analysis and jump to three seconds before a logged issue. Audio and video stay on this device and are not included in JSON backups.</div></div>
    <div class="card"><h2>Section Practice</h2>
      <div class="help-body">Set points A and B on the music and loop that range. Drag either handle for quick adjustment, choose a playback speed from 0.5× to 1.25×, and optionally add a pause before returning to A. Section Practice is deliberately excluded from analysis because its conditions differ from a full run.</div></div>
    <div class="card"><h2>Adding steps</h2>
      <div class="help-body"><b>Transition</b> covers prop changes, movement, or gaze changes between skills. <b>Risk rating</b> is your expectation before seeing the results. <b>Music cue</b> places a skill at a target time. <b>A/B branch</b> records which of two alternatives you used. Editing a practiced sequence creates a new version so results from different structures are not mixed. In Edit, open <b>Routine Settings → Sequence History</b> to load an older version. Saving it creates a new version without deleting the current sequence or practice records.</div></div>
    <div class="card"><h2>Reading the analysis</h2>
      <div class="help-body">“2/6 (9–65%)” means 2 issues among 6 actual attempts; 9–65% is the 95% uncertainty interval. A step blocked by an earlier issue is recorded as <b>Not attempted</b> and excluded from that issue-rate denominator. Its count and rate against runs reaching the step are shown separately.</div></div>
    <div class="card"><h2>Editing records</h2>
      <div class="help-body">Open Session History from Analysis to edit cause tags, notes, and missed A/B choices. If a run was logged by mistake, exclude it from analysis; the record remains and can be included again later.</div></div>
    <div class="card"><h2>Skill Library</h2>
      <div class="help-body">Store short video clips for individual skills, trim the usable range, and link them to routine steps. Linked clips appear in the fixed preview area during Edit, Full Run, and Section Practice without shifting the surrounding layout.</div></div>
    <div class="card"><h2>Timeline</h2>
      <div class="help-body">Arrange skills against music and calculate cue positions from clip durations. You can still type or fine-tune each cue manually.</div></div>
    <div class="card"><h2>Saving your data</h2>
      <div class="help-body">Data is stored in this browser. Export a JSON backup regularly and before changing devices. Audio and video files are not included. Export any video you want to keep, then use <b>Performance Video Library → Delete all performance videos</b> to remove only the saved full-run videos from this device.</div></div>`;
}

function renderHelp() {
  if (isEnglish()) return renderHelpEnglish();
  return `
    <div class="topbar"><button class="back-btn" onclick="go('home')">戻る</button><h1>使い方</h1></div>
    <div class="card">
      <h2>このアプリ</h2>
      <div class="help-body">通し練習を「クリーン1タップ / 問題箇所1タップ」で記録して、ルーティンの<b>どこで崩れ、どこまで影響したか</b>の偏りを見るためのアプリです。ルーティン一覧の右上にある✕から確認画面を開き、最後までスライドした場合だけ削除できます。</div>
    </div>
    <div class="card">
      <h2>通し練習の流れ</h2>
      <div class="help-body">
        1. セッションを準備(体調と条件メモ)<br>
        2. 朱色の「通し練習をスタート」→確認→カウントダウン。スタートから実施中まで「本日何本目」かを大きく表示し、スタートボタンにはこれまでの合計本数も表示します。初期値は5秒で、確認画面の−/＋からルーティンごとに変更できます。映像を残す場合は、同じ確認画面で4:3（横長）または9:16（縦長）を選び、「インカメを準備」を押します。最初の確認映像も選んだ画角で表示されます<br>
        3. 通しがノーミスなら、技一覧の一番下にある「クリーン」を1タップ<br>
        4. 失敗したら、該当する技をタップします。初期値は「ドロップして復帰」で、楽曲・録画・通しは止まりません。1本の中で複数のミスを続けて登録できます。実際に通しを止めた場合だけ「ドロップ(中止)」を選び、直前の失敗で次の技ができなかった場合は「実施できなかった」を選びます。最後までいったら「完走」<br>
        5. 次の1本はもう一度スタート。練習を終えたら「セッション終了」で振り返りと「次回試すこと」をメモします
      </div>
    </div>
    <div class="card">
      <h2>楽曲と録音</h2>
      <div class="help-body">編集画面で音源(MP3等)を添付すると、通し練習中に再生できます。編集画面・通し練習・パート練習の音量は共通で、各画面の音量バーから調整できます。<b>失敗をタップした瞬間の曲位置(♪1:23)が自動で記録</b>されます。復帰して続けるミスでは楽曲と録画も継続し、「中止」を記録した場合だけ曲を止めて頭へ戻します。<br><br>音源を設定した通し練習では、<b>インカメ映像とアプリ音源を一つの動画ファイルへデジタル収録</b>します。カメラのマイク音は入れず、保存音量は画面の試聴用フェーダーに左右されません。一つの時間軸で再生するため、映像の再生・一時停止・シークも滑らかに動きます。開発中は4:3（横長）と9:16（縦長）を選択でき、確認映像・撮影中プレビュー・保存後の再生枠へ同じ画角を反映します。録画は楽曲が実際に再生された時点で始まり、楽曲の一時停止・停止・終了に合わせて終了します。音源が止まると、結果入力前でも「今撮った映像を見る」から何度でも確認できます。映像はアプリ全体で最大5本。6本目は古い映像を自動削除せず、保存時に入れ替える映像を選びます。分析画面から映像を開くと、失敗記録の3秒前へ移動できます。<br><br>音源は「音源ライブラリ」に貯めて、どのルーティンでも「♪ ライブラリから」で使い回せます。マイク録音した音源もライブラリに追加できます。音源と通し映像はこの端末のブラウザ内にのみ保存され、JSONバックアップには含まれません。</div>
    </div>
    <div class="card">
      <h2>パート練習</h2>
      <div class="help-body">楽曲のA点→B点をループ再生する練習モード。曲を再生しながら「今の位置」でA/Bを決めて、ループON。Bに達すると自動でAに戻ります。区間と再生速度はルーティンに保存されます。<br><br>パート練習の結果は分析に入りません(通しと条件が違うため)。失敗を記録したいときは通し練習で。</div>
    </div>
    <div class="card">
      <h2>ステップの登録(編集画面)</h2>
      <div class="help-body"><b>移行</b> = 持ち替え・立ち位置移動・視線移動など。失敗は技そのものではなく移行で起きることも多いので、怪しい箇所は移行もステップに入れると分析対象になります。<br><br><b>リスク度(1〜5・任意)</b> = 「この技はどれくらい失敗しそうか」という自分の事前予想。<b>入れなくてもOK</b>です(「リスク —」のまま)。入れておくと、実際の失敗率とのズレ(思い込みと結果の乖離)が分析に表示されます。結果を見て数字を合わせに行くとズレが消えるので、基本は最初の感覚のまま。<br><br><b>♪何秒(キュー)</b> = 技名の右の欄に「1:23」や「83」と入れると、その技を曲のどこに入れるかの目標を指定できます。<b>♪欄を横にスライドすると0.1秒刻みで微調整</b>できます(タップすればキーボード入力)。音源があれば編集画面上部のプレイヤーで曲を流せて、再生位置に合わせて「いまこのへん」のステップが緑に光ります(通し練習でも同様)。順番と秒指定が時系列的に矛盾していると保存できません。タイムラインから書き出したルーティンには自動で入ります。<br><br><b>A/B化</b> = 調子で技を入れ替える箇所は「選択スロット」にできます。通し練習画面のチップでいつでも切替でき、選択肢ごとに失敗率が分かれて集計されます。<br><br>記録済みの通しがある状態で構成(技名・順序・種別・選択肢)を変えると新しいバージョンが作られ、分析は分かれます。条件の違うデータを混ぜないためです。リスク度の変更では分かれません。編集画面の<b>個別設定 → 構成の履歴</b>から過去のv1・v2を読み込めます。保存すると新しい版になり、現在の構成と練習記録は残ります。付属サンプルにはv1〜v3の構成と版ごとの記録が入っているので、分析画面で違いを試せます。「複製」は好調版/安牌版のように別ルーティンとして育てたいときに(記録は引き継ぎません)。</div>
    </div>
    <div class="card">
      <h2>分析の数字の読み方</h2>
      <div class="help-body">「2/6 (9〜65%)」= そのステップを実施した6回中2回失敗、真の失敗率の95%区間は9〜65%。<b>本数が少ないうちは幅が広い=まだ断定できない</b>という意味です。0/3は「失敗率0%」ではありません。<br><br>直前の失敗などでその技をできなかった場合は「実施できなかった」として、失敗率の分母から除外します。未実施回数と、対象地点へ到達した通しに対する未実施率は別表示します。途中で中止した通しは、その先のステップの到達数に入りません。<br><br>色付きチップは自分で付けたリスク度。実際の失敗率とズレている技には注意書きが出ます(到達8本以上)。<br><br>このアプリが示すのは「どこに偏りがあるか」まで。「なぜか」(直前の大技のせい等)は、順序を変えた比較実験で確かめる必要があります。</div>
    </div>
    <div class="card">
      <h2>記録の編集と削除</h2>
      <div class="help-body">分析→「セッション履歴・メモを見る」から、タグ・メモはいつでも編集できます。通しの成否そのものは書き換えられません。間違えた通しは「集計から除外」して記録し直してください(除外は分析に件数表示され、いつでも戻せます)。スロットの選択の記録し損ねも履歴から直せます。</div>
    </div>
    <div class="card">
      <h2>技ライブラリ</h2>
      <div class="help-body">技を最大${TRICK_MAX_SEC}秒の動画クリップとして貯めておく場所です(ホームの「技ライブラリ」)。アプリ内カメラ(${TRICK_MAX_SEC}秒で自動停止)で撮るか、撮ってある動画を登録します。どちらも容量を抑えるため自動で圧縮されます(画質は設定で標準/軽量を選べます)。${TRICK_MAX_SEC}秒を超える動画は登録できないので、先にトリミングしてください。名前はタップで変更できます。各技の<b>「長さ」</b>ボタンから、始点・終点を決めて<b>動画の使う区間を後からいつでも調整</b>できます(前後の余分をカット)。<br><br>ルーティン編集の「＋ 技リストから」でライブラリの技をステップとして追加できます。手で入力した技にも<b>🔗</b>でライブラリの動画を後から紐づけられます(🔗のシートから解除も可能)。<br><br>紐づいた技は各画面の<b>四角で囲まれた再生マーク</b>からワンタップで動画を確認できます。編集画面では再生マークを押すと<b>画面最上部の固定プレビューでループ再生</b>され、スクロールしても残るので、動画を見ながら順番やリスク度を調整できます。楽曲再生中も同じ枠が現在の技へ追従します。編集画面の行にある<b>✂</b>から、その場で動画の長さ(始点・終点)も調整できます。通し練習では再生マークを押しても失敗記録にはなりません。<br><br>将来的には、この技リストを音楽のタイムラインに並べてルーティンを組み立てる機能につなげる予定です。</div>
    </div>
    <div class="card">
      <h2>タイムラインで曲に合わせる</h2>
      <div class="help-body">ルーティン編集で音源を添付すると「タイムライン」が出ます。各技の長さ(動画リンクは自動、移行は±で調整)を足し合わせて、<b>各技が曲の何分何秒に当たるか</b>を計算し、「♪ この長さで曲位置を自動セット」で全ステップの♪キューに反映できます。<br><br>プレイヤーで再生するとタイムライン上にプレイヘッドが動き、いま曲のどこ=どの技かが行のハイライトで分かります。もちろん♪キューは各ステップで手入力・微調整もできます。</div>
    </div>
    <div class="card">
      <h2>データの保存</h2>
      <div class="help-body">データはこの端末のブラウザ内に保存されます。iPhoneは長期間使わないと保存データを消すことがあるため、<b>定期的に設定からJSONバックアップを書き出してください</b>。機種変更時もJSONで移行できます。音声と映像はJSONに含まれないため、残したい通し映像は先に書き出してください。不要になった演技映像は、ホームまたは設定の<b>「演技映像ライブラリ」→「演技映像をまとめて削除」</b>から端末内の映像データだけを消せます。</div>
    </div>`;
}

// ========== 設定(バックアップ) ==========
function renderSettings() {
  const runTotal = state.sessions.reduce((a, s) => a + s.runs.length, 0);
  const runVideoBytes = runVideoStorageBytes();
  return `
    <div class="topbar"><button class="back-btn" onclick="returnFromGlobalSettings()">戻る</button><h1>グローバル設定</h1></div>
    <div class="card">
      <h2>${isEnglish() ? "Language" : "表示言語"}</h2>
      <div class="segmented" id="language-seg" role="group" aria-label="${isEnglish() ? "Language" : "表示言語"}">
        <button class="choice ${!isEnglish() ? "selected" : ""}" onclick="setLanguage('ja')">日本語</button>
        <button class="choice ${isEnglish() ? "selected" : ""}" onclick="setLanguage('en')">English</button>
      </div>
    </div>
    <div class="card">
      <h2>データ</h2>
      <div class="bd-row"><span class="k">ルーティン</span><span class="v">${state.routines.length}</span></div>
      <div class="bd-row"><span class="k">セッション</span><span class="v">${state.sessions.length}</span></div>
      <div class="bd-row"><span class="k">通し合計</span><span class="v">${runTotal}本</span></div>
      <div class="bd-row"><span class="k">通し映像</span><span class="v">${storedRunVideos().length}/${RUN_VIDEO_LIMIT}本</span></div>
      <div class="bd-row"><span class="k">映像の使用容量</span><span class="v">${fmtBytes(runVideoBytes)}</span></div>
      <button class="btn storage-manage-btn" onclick="go('runvideos')">演技映像の保存を管理</button>
    </div>
    <div class="card">
      <h2>すべてのルーティンに適用${infoBtn("editorFeatures")}</h2>
      ${switchRow("リスク度", "すべてのルーティンで危険度(1〜5)を表示します", "showRisk")}
      ${switchRow("A/B分岐", "すべてのルーティンで選択ステップ(A/B)を使います", "showSlots")}
    </div>
    <div class="card">
      <h2>技の動画の画質(撮影・アップロード)${infoBtn("videoQuality")}</h2>
      <div class="segmented" id="vq-seg">
        ${Object.entries(VIDEO_PROFILES).map(([k, p]) => `<button class="choice ${(state.settings.videoQuality || "standard") === k ? "selected" : ""}"
          onclick="setVideoQuality('${k}')">${p.label}</button>`).join("")}
      </div>
    </div>
    <div class="card">
      <h2>バックアップ${infoBtn("backup")}</h2>
      <button class="btn" onclick="exportJson()">JSONバックアップを書き出す</button>
      <button class="btn" onclick="document.getElementById('import-file').click()">JSONから復元する</button>
      <input type="file" id="import-file" accept=".json" class="hidden" onchange="importJson(this)">
      <button class="btn ghost" onclick="exportCsv()">CSVエクスポート(表計算用)</button>
    </div>
    <div class="card">
      <h2>ご意見・機能の要望${infoBtn("feedback")}</h2>
      <button class="btn" onclick="openFeedback()">機能の要望・バグ報告を送る</button>
    </div>
    <div class="card">
      <h2>初期化${infoBtn("reset")}</h2>
      <button class="btn danger-ghost" style="width:100%" onclick="resetAllData()">この端末のデータを全て削除</button>
    </div>
    <button class="btn" onclick="go('help')">使い方を見る</button>`;
}

window.setLanguage = (language) => {
  state.settings.language = language === "en" ? "en" : "ja";
  saveState(); render();
  toast(isEnglish() ? "Language: English" : "表示言語: 日本語");
};

window.setVideoQuality = (k) => {
  state.settings.videoQuality = k;
  saveState(); render();
  toast(`動画の画質: ${(VIDEO_PROFILES[k] || {}).label || k}`);
};

// ON/OFFトグル行(iOS風スイッチ)。任意機能の表示切り替えに使う
function switchRow(label, sub, key) {
  const on = !!state.settings[key];
  return `<div class="set-row">
    <div class="set-text"><div class="set-label">${esc(label)}</div>${sub ? `<div class="set-sub">${esc(sub)}</div>` : ""}</div>
    <label class="switch"><input type="checkbox" ${on ? "checked" : ""} onchange="toggleSetting('${key}',this.checked)">
      <span class="track"></span><span class="knob"></span></label>
  </div>`;
}

function routineSwitchRow(label, sub, key, routineId, settings) {
  const on = routineFeatureEnabled(null, key, settings);
  return `<div class="set-row">
    <div class="set-text"><div class="set-label">${esc(label)}</div>${sub ? `<div class="set-sub">${esc(sub)}</div>` : ""}</div>
    <label class="switch"><input type="checkbox" ${on ? "checked" : ""} onchange="toggleRoutineFeature('${routineId || ""}','${key}',this.checked)">
      <span class="track"></span><span class="knob"></span></label>
  </div>`;
}

window.toggleSetting = (key, val) => {
  state.settings[key] = !!val;
  // グローバル設定の機能スイッチは、現在あるすべてのルーティンへ一括適用する。
  if (key === "showRisk" || key === "showSlots") {
    for (const rt of state.routines) {
      rt.featureSettings = { ...(rt.featureSettings || defaultRoutineFeatures()), [key]: !!val };
    }
    if (draft) draft.featureSettings = { ...(draft.featureSettings || defaultRoutineFeatures()), [key]: !!val };
  }
  saveState();
  // シートを開いたまま背面の画面を更新し、切り替え結果をその場で確認できるようにする。
  render();
  const label = key === "showRisk" ? "リスク度" : key === "showSlots" ? "A/B分岐" : "表示設定";
  toast(`${label}をすべてのルーティンで${val ? "ON" : "OFF"}にしました`);
};

window.toggleRoutineFeature = (routineId, key, val) => {
  const rt = routineId ? state.routines.find((r) => r.id === routineId) : null;
  if (rt) {
    rt.featureSettings = { ...(rt.featureSettings || defaultRoutineFeatures()), [key]: !!val };
    if (draft && draft._for === rt.id) {
      draft.featureSettings = { ...(draft.featureSettings || rt.featureSettings), [key]: !!val };
    }
    saveState();
  } else if (draft) {
    draft.featureSettings = { ...(draft.featureSettings || defaultRoutineFeatures()), [key]: !!val };
  } else return;
  render();
  const label = key === "showRisk" ? "リスク度" : key === "showSlots" ? "A/B分岐" : "表示設定";
  toast(`${label}をこのルーティンで${val ? "ON" : "OFF"}にしました`);
};

// ========== 機能の要望・バグ報告フォーム ==========
const FEEDBACK_KINDS = [
  { v: "request", label: "機能の要望" },
  { v: "bug", label: "バグ報告" },
  { v: "other", label: "その他" },
];
window.openFeedback = () => {
  const nm = state.settings.feedbackName || "";
  showSheet(`
    <h3>ご意見・機能の要望</h3>
    <div class="sheet-sub">開発者に直接届きます。気軽にどうぞ。</div>
    <div class="tag-label">種類</div>
    <div class="segmented" id="fb-kind">
      ${FEEDBACK_KINDS.map((k, i) => `<button class="choice ${i === 0 ? "selected" : ""}" data-v="${k.v}"
        onclick="selectOne('fb-kind',this)">${k.label}</button>`).join("")}
    </div>
    <label class="fld">内容 *</label>
    <textarea id="fb-body" rows="5" placeholder="例: 技ごとに成功率のグラフが見たい / ○○の画面でボタンが押しにくい など"></textarea>
    <label class="fld">お名前(任意)</label>
    <input type="text" id="fb-name" value="${esc(nm)}" placeholder="誰からの要望か分かると助かります(空欄OK)">
    <div style="height:14px"></div>
    <button class="btn primary" onclick="submitFeedback()">送信する</button>
    <button class="btn ghost" onclick="hideSheet()">やめる</button>
    <p class="hint">端末やアプリの版数が自動で一緒に送られます(不具合の再現に使います)。</p>`);
};

window.submitFeedback = async () => {
  const body = (document.getElementById("fb-body").value || "").trim();
  if (!body) { toast("内容を入力してください"); return; }
  const kindEl = document.querySelector("#fb-kind .choice.selected");
  const kind = kindEl ? kindEl.dataset.v : "request";
  const kindLabel = (FEEDBACK_KINDS.find((k) => k.v === kind) || {}).label || kind;
  const name = (document.getElementById("fb-name").value || "").trim();
  state.settings.feedbackName = name; // 次回のために名前を控える

  const payload = {
    kind, kindLabel, body, name,
    app: "routine-debugger",
    version: APP_VERSION,
    ua: navigator.userAgent,
    date: new Date().toISOString(),
  };
  // 送った控えを端末に残す(送信失敗しても内容が消えないように)
  state.feedback.push({ ...payload, sent: false });
  saveState();
  const rec = state.feedback[state.feedback.length - 1];

  const btn = document.querySelector("#sheet .btn.primary");
  if (btn) { btn.disabled = true; btn.textContent = uiText("送信中…"); }

  let ok = false;
  if (FEEDBACK_ENDPOINT) {
    try {
      // GASウェブアプリはCORSプリフライトを避けるため text/plain + no-cors で投げる(応答は読めない=送れれば成功とみなす)
      await fetch(FEEDBACK_ENDPOINT, {
        method: "POST", mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });
      ok = true;
    } catch (_) { ok = false; }
  }

  if (ok) {
    rec.sent = true; saveState();
    hideSheet();
    toast("送信しました。ありがとうございます!");
    return;
  }
  // 送信先未設定 or 通信失敗 → メールにフォールバック
  const subject = `[ルーティンノート] ${kindLabel}${name ? `(${name})` : ""}`;
  const mailBody = `${body}\n\n---\n種類: ${kindLabel}\nお名前: ${name || "(未記入)"}\nアプリ版: ${APP_VERSION}\n端末: ${navigator.userAgent}`;
  const mailto = `mailto:${FEEDBACK_MAILTO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mailBody)}`;
  rec.sent = true; saveState(); // メールアプリに引き継いだので控えは送信済み扱い
  hideSheet();
  toast("メールアプリで送信を完了してください");
  location.href = mailto;
};
// この端末のデータを全消去して初期状態へ(IndexedDB削除+localStorage掃除+リロード)
window.resetAllData = async () => {
  if (!appConfirm("この端末のデータを全て削除して初期状態に戻します。\nルーティン・記録・技と通しの動画・録音・楽曲・設定が消えます。よいですか?")) return;
  if (!appConfirm("本当に初期化しますか? 元に戻せません。\n(残したいデータがあれば先にJSONバックアップを)")) return;
  try { musicPlayer.pause(); } catch (_) {}
  try { if (db) db.close(); } catch (_) {}
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
    setTimeout(resolve, 3000); // onblocked等で固まらない保険
  });
  try { localStorage.removeItem("rd_state"); localStorage.removeItem("rd_volume"); } catch (_) {}
  location.reload();
};

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
window.exportJson = () => {
  download(`routine-debugger-backup-${today()}.json`, JSON.stringify(state, null, 2), "application/json");
  toast("JSONを書き出しました");
};
function validBackupId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{1,100}$/.test(value);
}
function validateBackupShape(data) {
  if (!data || !Array.isArray(data.routines) || !Array.isArray(data.sessions)) return false;
  if (data.routines.length > 1000 || data.sessions.length > 10000) return false;
  const routinesOk = data.routines.every((rt) => validBackupId(rt.id)
    && typeof rt.name === "string"
    && Array.isArray(rt.versions) && rt.versions.length > 0
    && rt.versions.every((ver) => validBackupId(ver.id) && Array.isArray(ver.steps)
      && ver.steps.every((step) => validBackupId(step.id) && typeof step.name === "string"
        && (!step.options || (Array.isArray(step.options)
          && step.options.every((option) => validBackupId(option.id) && typeof option.name === "string"))))));
  const sessionsOk = data.sessions.every((sess) => validBackupId(sess.id)
    && validBackupId(sess.routineId) && validBackupId(sess.versionId)
    && Array.isArray(sess.runs)
    && sess.runs.every((run) => (!run.id || validBackupId(run.id)) && Array.isArray(run.events)));
  return routinesOk && sessionsOk;
}
window.importJson = (input) => {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) { input.value = ""; return toast("20MB以下のバックアップを選んでください"); }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!validateBackupShape(data)) throw new Error("bad format");
      if (!appConfirm("現在のデータをバックアップの内容で置き換えます。よいですか?")) return;
      state = data;
      migrateState();
      saveState(); render(); toast("復元しました");
    } catch (_) { toast("読み込めませんでした(形式が違います)"); }
  };
  reader.readAsText(file);
  input.value = "";
};
window.exportCsv = () => {
  const rows = [["date", "routine", "version", "feeling", "session_note", "run_no", "outcome", "reached_step", "excluded", "run_choices", "step_no", "step_name", "step_risk", "event_type", "hypothesis_tags", "event_note", "music_time_sec", "rec_time_sec", "video_time_sec"]];
  const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  for (const sess of state.sessions) {
    const rt = state.routines.find((r) => r.id === sess.routineId);
    if (!rt) continue;
    const ver = getVersion(rt, sess.versionId);
    const vno = rt.versions.findIndex((v) => v.id === ver.id) + 1;
    sess.runs.forEach((run, i) => {
      const choicesTxt = ver.steps.filter(isSlot).map((st) => {
        const o = st.options.find((o2) => o2.id === (run.choices || {})[st.id]);
        return `${stepLabel(st)}:${o ? o.name : "?"}`;
      }).join(";");
      const base = [sess.date, rt.name, `v${vno}`, sess.feeling, sess.note, i + 1, run.outcome, run.reachedIndex + 1,
        run.excluded ? 1 : "", choicesTxt];
      if (!run.events.length) rows.push([...base, "", "", "", "", "", "", "", "", ""]);
      for (const e of run.events) {
        const st = ver.steps[e.stepIndex];
        const opt = st && isSlot(st) && e.optionId ? st.options.find((o) => o.id === e.optionId) : null;
        const stName = st ? (opt ? `${stepLabel(st)}→${opt.name}` : stepLabel(st)) : "?";
        const stRisk = st ? ((opt ? opt.risk : st.risk) ?? "") : "";
        rows.push([...base, e.stepIndex + 1, stName, stRisk, e.type, (e.tags || []).join(";"), e.note,
          e.musicTime != null ? e.musicTime.toFixed(1) : "", e.recTime != null ? e.recTime.toFixed(1) : "",
          e.videoTime != null ? e.videoTime.toFixed(1) : ""]);
      }
    });
  }
  download(`routine-debugger-${today()}.csv`, "﻿" + rows.map((r) => r.map(q).join(",")).join("\n"), "text/csv");
  toast("CSVを書き出しました");
};

// ブラウザバック等で文書そのものを離れる場合はgo()を通らない。
// bfcacheに入った旧画面の区間ループや音源が、復帰後も鳴り続けないよう同期的に止める。
function stopPlaybackForPageExit() {
  musicLoadGeneration++;
  stopRunVideoAudioSync();
  clearRunCountdown();
  stopRunCameraNow();
  clearPendingRunVideo();
  activeFullRunRoutineId = null;
  stopPartLoop(true);
  setMusicPlaybackRate(1);
  musicPlayer.pause();
  musicSetTime(0);
  recPlayer.pause();
  libAudio.pause();
  document.querySelectorAll("audio,video").forEach((media) => media.pause());
}
window.addEventListener("pagehide", stopPlaybackForPageExit);
// Safariが戻る/進むキャッシュから文書を復元した場合も、旧再生状態を持ち越さない。
window.addEventListener("pageshow", (event) => { if (event.persisted) stopPlaybackForPageExit(); });

// ---------- 起動 ----------
window.go = go;
loadState().then(() => { hideLoading(); render(); }).catch((error) => {
  console.error("Failed to start Routine Note", error);
  removeLoadingOverlay();
  $app.innerHTML = `<main class="fatal-start-error" role="alert">
    <h1>ルーティンノートを開始できませんでした</h1>
    <p>画面を再読み込みしてください。繰り返す場合は、データを消さずに開発者へご連絡ください。</p>
    <button class="btn primary" onclick="location.reload()">再読み込み</button>
  </main>`;
  applyUiLanguage($app);
});
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch((error) => console.warn("Service Worker registration failed", error));
}
