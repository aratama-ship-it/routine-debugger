/* ルーティン・デバッガ β版 (フェーズ1: ランログ)
 * 設計原則:
 * - 成功(クリーン)も必ず記録する: 最頻操作を最大ボタンに
 * - 後半技の分母は「到達数」: reachedIndex >= i の通し数
 * - 原因タグは「本人の仮説」として扱い、必須入力にしない
 * - 率は k/n + Wilson 95%区間を必ず併記。少数サンプルで断定しない
 * - ルーティンの構成変更 = 新バージョン(統計を混ぜない)
 */
"use strict";

// ---------- 定数 ----------
const EVENT_TYPES = [
  { id: "drop_abort",     label: "ドロップ(中止)", desc: "落として通しを止めた", abort: true },
  { id: "drop_recovered", label: "ドロップ(復帰)", desc: "落としたが拾って続行", abort: false },
  { id: "wobble",         label: "乱れ(回収)",     desc: "崩れたが立て直した",   abort: false },
  { id: "avoid",          label: "回避",           desc: "安全のため技を飛ばした", abort: false },
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
const today = () => new Date().toISOString().slice(0, 10);

// ---------- 永続化 (IndexedDB, localStorageフォールバック) ----------
const DB_NAME = "routine-debugger", STORE = "kv";
let db = null;

function openDb() {
  return new Promise((resolve) => {
    if (!window.indexedDB) return resolve(null);
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
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
  if (!Array.isArray(state.tricks)) state.tricks = []; // 技ライブラリ(動画クリップ)
  // 技のトリム情報を補完(fullDuration=元動画の長さ, trimStart/trimEnd=有効区間, duration=有効区間の長さ)
  for (const t of state.tricks) {
    if (t.fullDuration == null) t.fullDuration = t.duration;
    if (t.trimStart == null) t.trimStart = 0;
    if (t.trimEnd == null) t.trimEnd = t.fullDuration;
  }
  for (const rt of state.routines || []) {
    for (const ver of rt.versions || []) {
      for (const st of ver.steps || []) {
        if (st.risk == null) {
          st.risk = st.load ? (LEGACY_LOAD_TO_RISK[st.load] || 3) : 3;
        }
        delete st.load;
      }
    }
  }
}
async function loadState() {
  db = await openDb();
  if (db) {
    const loaded = await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly").objectStore(STORE).get("state");
      tx.onsuccess = () => resolve(tx.result || null);
      tx.onerror = () => resolve(null);
    });
    if (loaded) { state = loaded; migrateState(); return; }
  }
  try {
    const raw = localStorage.getItem("rd_state");
    if (raw) state = JSON.parse(raw);
  } catch (_) { /* 初回 */ }
  migrateState();
}
let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (db) {
      try { db.transaction(STORE, "readwrite").objectStore(STORE).put(state, "state"); } catch (_) {}
    }
    try { localStorage.setItem("rd_state", JSON.stringify(state)); } catch (_) {}
  }, 120);
}

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
const stepLabel = (st) => isSlot(st) ? (st.name || st.options.map((o) => o.name).join("/")) : st.name;
const runChoice = (run, st) => run.choices ? run.choices[st.id] : undefined;

function versionStats(routine, versionId) {
  const ver = getVersion(routine, versionId);
  const allRuns = runsOfVersion(routine.id, versionId);
  const excluded = allRuns.filter((r) => r.excluded).length;
  const runs = allRuns.filter((r) => !r.excluded); // 集計除外を反映
  const total = runs.length;
  const clean = runs.filter((r) => r.outcome === "clean").length;
  // ステップ別: 到達数を分母にする(全通し数ではない)
  const steps = ver.steps.map((st, i) => {
    const reached = runs.filter((r) => r.reachedIndex >= i).length;
    const failRuns = runs.filter((r) => r.events.some((e) => e.stepIndex === i)).length;
    const row = { step: st, index: i, reached, failed: failRuns, ci: wilson(failRuns, reached) };
    if (isSlot(st)) {
      // 選択肢別: 分母 = そこに到達し、かつその選択肢を選んだ通し数
      row.options = st.options.map((opt) => {
        const optRuns = runs.filter((r) => r.reachedIndex >= i && runChoice(r, st) === opt.id);
        const optFailed = optRuns.filter((r) => r.events.some((e) => e.stepIndex === i)).length;
        return { opt, reached: optRuns.length, failed: optFailed, ci: wilson(optFailed, optRuns.length) };
      });
      row.choiceUnknown = runs.filter((r) => r.reachedIndex >= i && !runChoice(r, st)).length;
    }
    return row;
  });
  // 回復率 = 継続できた失敗 / 全失敗イベント(回避は除外)
  let recov = 0, fails = 0;
  for (const r of runs) for (const e of r.events) {
    if (e.type === "avoid") continue;
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
function showSheet(html) {
  $sheet.innerHTML = `<div class="grabber"></div>` + html;
  $sheet.classList.remove("hidden");
  $backdrop.classList.remove("hidden");
  if (typeof bindAllTrimVideos === "function") bindAllTrimVideos(); // シート内の技動画にトリム適用
}
function hideSheet() { $sheet.classList.add("hidden"); $backdrop.classList.add("hidden"); $sheet.innerHTML = ""; }
$backdrop.addEventListener("click", hideSheet);

let toastTimer = null;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.add("hidden"), 2200);
}

// ---------- 楽曲プレイヤー(グローバル: 再描画しても再生が途切れない) ----------
const musicPlayer = new Audio();
let musicLoadedFor = null;   // ロード済みのroutineId
let musicObjectUrl = null;
let musicMissing = false;    // バックアップ復元後などで音源Blobが無い場合

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

async function loadMusic(rt) {
  if (!rt.music) return;
  musicMissing = false;
  const blob = await blobGet(rt.music.blobId);
  if (!blob) { musicMissing = true; musicLoadedFor = rt.id; if (view.name === "record") render(); return; }
  if (musicObjectUrl) URL.revokeObjectURL(musicObjectUrl);
  musicObjectUrl = URL.createObjectURL(blob);
  musicPlayer.src = musicObjectUrl;
  musicLoadedFor = rt.id;
  if (view.name === "record" || view.name === "part") render();
  musicPlayer.addEventListener("loadedmetadata", () => {
    if (view.name === "part") render(); // ループ帯の表示に曲の長さが必要
  }, { once: true });
}
function updateMusicUI() {
  const cur = document.getElementById("music-cur");
  if (cur) cur.textContent = fmtTimeFine(musicPlayer.currentTime);
  const dur = document.getElementById("music-dur");
  if (dur) dur.textContent = fmtTime(musicPlayer.duration);
  const seek = document.getElementById("music-seek");
  if (seek && isFinite(musicPlayer.duration) && !seek.matches(":active")) {
    seek.max = musicPlayer.duration;
    seek.value = musicPlayer.currentTime;
  }
  const tg = document.getElementById("music-toggle-pill");
  if (tg) tg.innerHTML = musicPlayer.paused ? "▶ 再生" : "❚❚ 一時停止";
  const vol = document.getElementById("music-vol");
  if (vol && !vol.matches(":active")) vol.value = musicVolume;
  if (view.name === "builder") builderTickUI(); // タイムラインのプレイヘッドと現在技
  if (view.name === "record") recordTickUI();   // キュー指定に基づく「いまこの技」ハイライト
  if (view.name === "edit") { editorTickUI(); updateCueButtons(); } // 「いまこのへん」+キュー再生ボタン状態
}
// 編集画面: 再生位置がキューを過ぎた最後のステップを光らせる(draft基準なので編集内容に即追従)
let miniAutoLoading = null;        // 自動追従の多重ロード防止
const miniAutoFailed = new Set();  // 読み込みに失敗したstepId(毎tickのリトライ防止)
function editorTickUI() {
  if (!draft) return;
  const rows = document.querySelectorAll(".editor-step");
  if (!rows.length) return;
  const cur = musicPlayer.currentTime;
  let ai = -1, best = -1;
  if (!musicPlayer.paused || cur > 0.05) {
    draft.steps.forEach((s, i) => { if (s.cue != null && cur >= s.cue && s.cue >= best) { best = s.cue; ai = i; } });
  }
  rows.forEach((el, i) => el.classList.toggle("now", i === ai));
  // 再生に合わせて、いまの技の動画を上部ドックで自動再生(手動で開いた動画は上書きしない)
  if (musicPlayer.paused) return;
  const act = ai >= 0 ? draft.steps[ai] : null;
  if (act && act.trickId && !miniAutoFailed.has(act.id) &&
      (!miniVideo || (miniVideo.auto && miniVideo.stepId !== act.id))) {
    if (miniAutoLoading !== act.id) {
      miniAutoLoading = act.id;
      miniDockOpen(act, true)
        .then((ok) => { if (!ok) miniAutoFailed.add(act.id); })
        .finally(() => { if (miniAutoLoading === act.id) miniAutoLoading = null; });
    }
  } else if ((!act || !act.trickId) && miniVideo && miniVideo.auto) {
    // いまの位置に動画がない(移行など) → 自動で開いたものだけ閉じる
    miniVideoCloseSilent();
    syncMiniDock();
  }
}
// 編集画面用の楽曲ロード: 保存済み音源 or いま添付したばかりのファイル
async function loadEditorMusic() {
  let blob = null, key = null;
  if (draft && draft._newMusicFile) { blob = draft._newMusicFile; key = "edit:new:" + draft._for; }
  else {
    const rt = state.routines.find((r) => r.id === view.params.id);
    if (rt && rt.music) { key = "edit:" + rt.id; if (musicLoadedFor !== key) blob = await blobGet(rt.music.blobId); }
  }
  if (!key || musicLoadedFor === key) return;
  if (!blob) return;
  if (musicObjectUrl) URL.revokeObjectURL(musicObjectUrl);
  musicObjectUrl = URL.createObjectURL(blob);
  musicPlayer.src = musicObjectUrl;
  musicLoadedFor = key;
  if (view.name === "edit") updateMusicUI();
}
// 通し練習: 再生位置がキューを過ぎた最後のステップを「いまこの技」として光らせる
function recordTickUI() {
  const rows = document.querySelectorAll(".step-list .step-btn");
  if (!rows.length) return;
  const rt = state.routines.find((r) => r.id === view.params.id);
  if (!rt) return;
  const steps = latestVersion(rt).steps;
  const cur = musicPlayer.currentTime;
  let ai = -1, best = -1;
  if (!musicPlayer.paused || cur > 0.05) {
    steps.forEach((s, i) => { if (s.cue != null && cur >= s.cue && s.cue >= best) { best = s.cue; ai = i; } });
  }
  rows.forEach((el, i) => el.classList.toggle("now", i === ai));
}
["timeupdate", "loadedmetadata", "play", "pause", "ended"].forEach((ev) =>
  musicPlayer.addEventListener(ev, updateMusicUI));

// 音量: iOS Safariは audio.volume を無視するため、Web Audio APIのGainNodeを通して制御する
let musicVolume = Number(localStorage.getItem("rd_volume") || 1);
let audioCtx = null, gainNode = null;
function ensureAudioGraph() {
  if (audioCtx) { if (audioCtx.state === "suspended") audioCtx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    audioCtx = new AC();
    const src = audioCtx.createMediaElementSource(musicPlayer);
    gainNode = audioCtx.createGain();
    src.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    gainNode.gain.value = musicVolume;
  } catch (_) { audioCtx = null; gainNode = null; }
}
window.musicSetVolume = (v) => {
  musicVolume = Number(v);
  if (gainNode) gainNode.gain.value = musicVolume;
  musicPlayer.volume = musicVolume; // GainNodeが使えない環境向けのフォールバック
  try { localStorage.setItem("rd_volume", String(musicVolume)); } catch (_) {}
};
window.musicToggle = () => {
  if (musicPlayer.paused) { ensureAudioGraph(); musicPlayer.play(); }
  else musicPlayer.pause();
};
window.musicStop = () => { musicPlayer.pause(); musicPlayer.currentTime = 0; updateMusicUI(); };
window.musicSeek = (v) => { musicPlayer.currentTime = Number(v); updateMusicUI(); };
// 通しの記録が確定したら曲を頭に戻す(次の通しは▶を押すだけ)
function musicResetForNextRun() {
  if (!musicPlayer.src) return;
  musicPlayer.pause();
  musicPlayer.currentTime = 0;
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

// ---------- 録音の聴き返し(統計画面) ----------
const recPlayer = new Audio();
let recLoadedId = null;
let recObjectUrl = null;
recPlayer.addEventListener("timeupdate", () => {
  const el = document.getElementById(`recplay-${recLoadedId}`);
  if (el) el.textContent = `再生中 ${fmtTime(recPlayer.currentTime)}`;
});
recPlayer.addEventListener("ended", () => {
  const el = document.getElementById(`recplay-${recLoadedId}`);
  if (el) el.textContent = "▶ 再生";
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
  recPlayer.play();
};
window.recSeekTo = async (recId, t) => {
  if (!(await ensureRecLoaded(recId))) return;
  recPlayer.currentTime = Math.max(0, t - 3); // 失敗の3秒前から
  recPlayer.play();
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
  if (!confirm("この録音を削除しますか?(元に戻せません)")) return;
  const sess = state.sessions.find((s) => s.id === sessId);
  if (sess) sess.recordings = (sess.recordings || []).filter((r) => r.id !== recId);
  if (recLoadedId === recId) { recPlayer.pause(); recLoadedId = null; }
  await blobDel(recId);
  saveState(); render(); toast("録音を削除しました");
};

// ---------- 画面遷移 ----------
function go(name, params = {}) {
  // 記録画面を離れるとき: 楽曲は一時停止、録音中なら保存して終了
  if (view.name === "record" && name !== "record") {
    musicPlayer.pause();
    if (recState) stopRecording();
  }
  // パート練習を離れるとき: ループ停止+一時停止
  if (view.name === "part" && name !== "part") stopPartLoop(true);
  if (view.name === "builder" && name !== "builder") musicPlayer.pause();
  if (view.name === "edit" && name !== "edit") { musicPlayer.pause(); miniVideoCloseSilent(); miniAutoFailed.clear(); miniAutoLoading = null; cuePlayStepId = null; }
  if (view.name === "stats" && name !== "stats") recPlayer.pause();
  // 技撮影を離れるとき: カメラ解放
  if (view.name === "trickrec" && name !== "trickrec") releaseTrickCam();
  view = { name, params }; render(); window.scrollTo(0, 0);
}

function render() {
  const r = { home: renderHome, routines: renderRoutines, edit: renderEdit, record: renderRecord,
    stats: renderStats, settings: renderSettings, history: renderHistory, stepdetail: renderStepDetail,
    part: renderPart, help: renderHelp, tricks: renderTricks, trickrec: renderTrickRec,
    builder: renderBuilder }[view.name];
  $app.innerHTML = r ? r() : renderHome();
  if (typeof bindAllTrimVideos === "function") bindAllTrimVideos(); // 技動画にトリム区間を適用
}

// ========== ホーム(二択メニュー) ==========
function renderHome() {
  const trickCount = (state.tricks || []).length;
  const routineCount = state.routines.length;
  const runTotal = state.sessions.reduce((a, s) => a + s.runs.length, 0);
  return `
    <div class="topbar"><h1>ルーティン・デバッガ</h1>
      <button class="nav-action" onclick="go('help')">使い方</button>
      <button class="nav-action" onclick="go('settings')">設定</button></div>
    <button class="menu-card" onclick="go('routines')">
      <span class="mc-title">ルーティン練習</span>
      <span class="mc-sub">${routineCount ? `${routineCount}ルーティン / 通し${runTotal}本` : "通し練習・パート練習・分析"}</span>
      <span class="mc-arrow">›</span>
    </button>
    <button class="menu-card" onclick="go('tricks')">
      <span class="mc-title">技ライブラリ</span>
      <span class="mc-sub">${trickCount ? `${trickCount}本の技を登録済み` : "技を動画で撮影・登録(最大10秒)"}</span>
      <span class="mc-arrow">›</span>
    </button>`;
}

// ========== ルーティン一覧 ==========
function renderRoutines() {
  const rows = state.routines.map((rt) => {
    const ver = latestVersion(rt);
    const runCount = state.sessions.filter((s) => s.routineId === rt.id).reduce((a, s) => a + s.runs.length, 0);
    return `<div class="swipe-wrap">
      <button class="swipe-del" onclick="deleteRoutine('${rt.id}')">削除</button>
      <div class="routine-row">
        <div class="name">${esc(rt.name)}
          <span class="meta">${ver.steps.length}ステップ / v${rt.versions.length} / 通し${runCount}本</span></div>
        <div class="actions">
          <button class="btn small primary" onclick="go('record',{id:'${rt.id}'})">通し練習</button>
          <button class="btn small" onclick="go('part',{id:'${rt.id}'})">パート練習</button>
          <button class="btn small" onclick="go('stats',{id:'${rt.id}'})">分析</button>
          <button class="btn small ghost" onclick="go('edit',{id:'${rt.id}'})">編集</button>
        </div>
      </div>
    </div>`;
  }).join("");
  return `
    <div class="topbar"><button class="back-btn" onclick="go('home')">戻る</button>
      <h1>ルーティン練習</h1></div>
    <div class="card">
      <h2>ルーティン</h2>
      ${rows || `<div class="empty">まだルーティンがありません。<br>技と移行を順番に登録するところから始めます。</div>`}
    </div>
    <button class="btn" onclick="go('edit',{})">＋ 新規ルーティン</button>
    <button class="btn" onclick="go('builder')">♪ タイムラインで組む</button>
    ${state.routines.some((r) => r.sampleSet) ? "" :
      `<button class="btn ghost" onclick="loadSampleSet()">サンプルルーティンを読み込む</button>`}
`;
}

// ルーティン削除(行の左スワイプ→削除)。セッション記録・音源・録音Blobまで完全に消す
window.deleteRoutine = async (id) => {
  const rt = state.routines.find((r) => r.id === id);
  if (!rt) return;
  const sessions = state.sessions.filter((s) => s.routineId === id);
  const runCount = sessions.reduce((a, s) => a + s.runs.length, 0);
  const msg = `「${rt.name}」を削除しますか?\n` +
    (runCount ? `セッション${sessions.length}件・通し${runCount}本の記録と音声も一緒に削除されます。元に戻せません。\n(残したい場合は先に設定からJSONバックアップを)` : "元に戻せません。");
  if (!confirm(msg)) { closeAllSwipes(); return; }
  // 音声Blobの後始末(楽曲+このルーティンのセッション録音)
  if (rt.music) blobDel(rt.music.blobId);
  for (const s of sessions) for (const rec of s.recordings || []) blobDel(rec.blobId);
  state.routines = state.routines.filter((r) => r.id !== id);
  state.sessions = state.sessions.filter((s) => s.routineId !== id);
  if (musicLoadedFor === id) { musicPlayer.pause(); musicPlayer.removeAttribute("src"); musicLoadedFor = null; }
  saveState(); render(); toast("削除しました");
};

// ---------- 行の左スワイプ(メーラー式)。縦スクロールを妨げないよう横優位のときだけ動かす ----------
const SWIPE_W = 88;
let swipeDrag = null;
let swipeSuppressClick = false;
function closeAllSwipes() {
  document.querySelectorAll(".swipe-wrap.open").forEach((w) => {
    w.classList.remove("open");
    const row = w.querySelector(".routine-row");
    if (row) row.style.transform = "";
  });
}
document.addEventListener("pointerdown", (e) => {
  const wrap = e.target.closest(".swipe-wrap");
  if (!wrap) { closeAllSwipes(); return; }
  const row = wrap.querySelector(".routine-row");
  swipeDrag = { wrap, row, startX: e.clientX, startY: e.clientY, dx: 0, moved: false,
    baseOpen: wrap.classList.contains("open") };
}, true);
document.addEventListener("pointermove", (e) => {
  if (!swipeDrag) return;
  const dx = e.clientX - swipeDrag.startX, dy = e.clientY - swipeDrag.startY;
  if (!swipeDrag.moved) {
    if (Math.abs(dx) < 8) return;
    if (Math.abs(dy) > Math.abs(dx)) { swipeDrag = null; return; } // 縦スクロール優先
    swipeDrag.moved = true;
  }
  const base = swipeDrag.baseOpen ? -SWIPE_W : 0;
  const t = Math.min(0, Math.max(-SWIPE_W, base + dx));
  swipeDrag.row.style.transition = "none";
  swipeDrag.row.style.transform = `translateX(${t}px)`;
  swipeDrag.dx = dx;
});
document.addEventListener("pointerup", () => {
  if (!swipeDrag) return;
  const s = swipeDrag; swipeDrag = null;
  if (!s.moved) return;
  s.row.style.transition = "";
  const open = ((s.baseOpen ? -SWIPE_W : 0) + s.dx) < -SWIPE_W / 2;
  s.wrap.classList.toggle("open", open);
  s.row.style.transform = open ? `translateX(-${SWIPE_W}px)` : "";
  // スワイプ直後のclickが行内ボタンに落ちるのを防ぐ
  swipeSuppressClick = true;
  setTimeout(() => { swipeSuppressClick = false; }, 80);
});
document.addEventListener("click", (e) => {
  if (swipeSuppressClick) { e.stopPropagation(); e.preventDefault(); }
}, true);

// ========== ルーティン編集 ==========
let draft = null; // { id?, name, steps: [{id,name,kind,load}] }

function renderEdit() {
  const rt = view.params.id ? state.routines.find((r) => r.id === view.params.id) : null;
  if (!draft || draft._for !== (view.params.id || "new")) {
    draft = rt
      ? { _for: rt.id, id: rt.id, name: rt.name, steps: latestVersion(rt).steps.map((s) => ({ ...s })),
          music: rt.music ? { ...rt.music } : null, _newMusicFile: null }
      : { _for: "new", name: "", steps: [], music: null, _newMusicFile: null };
  }
  const riskSeg = (selected, onclickTpl) => `
    <div class="risk-seg">
      ${RISK_LEVELS.map((n) => `<button class="risk-seg-btn risk-${n} ${selected === n ? "selected" : ""}"
        onclick="${onclickTpl.replace("%N%", n)}">${n}</button>`).join("")}
    </div>`;
  const hasEditorMusic = !!(draft._newMusicFile || (rt && rt.music && draft.music));
  const stepRows = draft.steps.map((s, i) => `
    <div class="editor-step">
      <div class="es-row1">
        <span class="no">${i + 1}</span>
        <input type="text" value="${esc(s.name)}" placeholder="${isSlot(s) ? "分岐の名前(例: ラスト技)" : s.kind === "transition" ? "移行(例: 持ち替え)" : "技名"}"
          onchange="draft.steps[${i}].name=this.value">
        <input type="text" class="cue-input" inputmode="numeric" data-i="${i}" value="${s.cue != null ? fmtCue(s.cue) : ""}"
          placeholder="♪何秒" onchange="setCue(${i},this.value)">
        ${hasEditorMusic && s.cue != null
          ? `<button class="mini-btn cue-play ${cuePlayStepId === s.id && !musicPlayer.paused ? "on" : ""}" data-cue-step="${s.id}" onclick="editorPlayFromCue(${i})">${cuePlayStepId === s.id && !musicPlayer.paused ? "♪❚❚" : "♪▶"}</button>` : ""}
      </div>
      <div class="es-row2">
        <button class="kind-toggle ${s.kind === "trick" ? "t" : ""}" onclick="toggleKind(${i})">${s.kind === "trick" ? "技" : "移行"}</button>
        <button class="kind-toggle ${isSlot(s) ? "t" : ""}" onclick="toggleSlot(${i})">${isSlot(s) ? "A/B解除" : "A/B化"}</button>
        ${s.trickId && (state.tricks || []).some((t) => t.id === s.trickId)
          ? `<button class="mini-btn play ${miniVideo && miniVideo.stepId === s.id ? "on" : ""}" onclick="editorPlayTrick(${i})">▶</button>
             <button class="mini-btn" onclick="sheetTrimTrick('${s.trickId}')">✂</button>`
          : s.kind === "trick" && !isSlot(s)
            ? `<button class="mini-btn link" onclick="sheetLinkTrick(${i})">🔗</button>` : ""}
        <span class="es-spacer"></span>
        <button class="mini-btn" onclick="moveStep(${i},-1)" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="mini-btn" onclick="moveStep(${i},1)" ${i === draft.steps.length - 1 ? "disabled" : ""}>↓</button>
        <button class="mini-btn del" onclick="delStep(${i})">✕</button>
      </div>
      ${isSlot(s) ? s.options.map((o, oi) => `
        <div class="es-opt">
          <span class="es-opt-mark">${String.fromCharCode(65 + oi)}</span>
          <input type="text" value="${esc(o.name)}" placeholder="選択肢${String.fromCharCode(65 + oi)}の技名"
            onchange="draft.steps[${i}].options[${oi}].name=this.value">
          ${s.options.length > 2 ? `<button class="mini-btn del" onclick="delOpt(${i},${oi})">✕</button>` : ""}
        </div>
        <div class="es-risk opt">
          <span class="es-risk-label">リスク度</span>
          ${riskSeg(o.risk || 3, `setOptRisk(${i},${oi},%N%)`)}
        </div>`).join("") + (s.options.length < 3 ? `
        <button class="btn small ghost" style="margin:8px 0 0 32px" onclick="addOpt(${i})">＋ 選択肢を追加</button>` : "")
      : `
      <div class="es-risk">
        <span class="es-risk-label">リスク度</span>
        ${riskSeg(s.risk || 3, `setRisk(${i},%N%)`)}
      </div>`}
    </div>`).join("");
  // 編集中の試聴プレイヤー(音源があれば)。再生すると♪キューに沿って該当ステップが光る
  if (hasEditorMusic) setTimeout(loadEditorMusic, 0);
  const editorPlayer = hasEditorMusic ? `
    <div class="card music-card">
      <div class="music-row">
        <button class="music-pill primary" style="flex:0 0 auto;min-height:40px;padding:0 16px" id="music-toggle-pill"
          onclick="ensureAudioGraph();musicToggle()">▶ 再生</button>
        <div class="music-time" style="font-size:19px"><span id="music-cur">${fmtTimeFine(musicPlayer.currentTime)}</span><span class="dur"> / <span id="music-dur">${fmtTime(musicPlayer.duration)}</span></span></div>
        <button class="music-btn text" onclick="musicStop()">■ 停止</button>
      </div>
      <input type="range" id="music-seek" min="0" max="100" step="0.1" value="0" oninput="musicSeek(this.value)">
    </div>` : "";
  return `
    <div class="topbar"><button class="back-btn" onclick="draft=null;go('routines')">戻る</button>
      <h1>${rt ? "ルーティン編集" : "新規ルーティン"}</h1></div>
    ${miniDockHtml()}
    <div class="card">
      <label class="fld">ルーティン名</label>
      <input type="text" value="${esc(draft.name)}" placeholder="例: 2026ステージ用 4分" onchange="draft.name=this.value">
    </div>
    ${editorPlayer}
    <div class="card">
      <h2>ステップ(技と移行) — 上から実施順</h2>
      ${stepRows || `<div class="empty">「＋ 技」で最初の技を追加</div>`}
      <div class="row-2" style="margin-top:12px">
        <button class="btn small" onclick="addStep('trick')">＋ 技</button>
        <button class="btn small" onclick="sheetPickTrick()">＋ 技リストから</button>
        <button class="btn small ghost" onclick="addStep('transition')">＋ 移行</button>
      </div>
    </div>
    <div class="card">
      <h2>楽曲(任意)</h2>
      ${draft._newMusicFile || draft.music
        ? `<div class="bd-row"><span class="k">♪ ${esc(draft._newMusicFile ? draft._newMusicFile.name : draft.music.name)}</span>
             <button class="btn small danger-ghost" onclick="removeMusic()">削除</button></div>`
        : `<button class="btn small" onclick="document.getElementById('music-file').click()">＋ 音源を添付(MP3等)</button>`}
      <input type="file" id="music-file" accept="audio/*" class="hidden" onchange="attachMusic(this)">
    </div>
    <button class="btn primary" onclick="saveRoutine()">保存</button>
    ${rt ? `<button class="btn" onclick="duplicateRoutine('${rt.id}')">このルーティンを複製</button>` : ""}`;
}
window.toggleKind = (i) => { draft.steps[i].kind = draft.steps[i].kind === "trick" ? "transition" : "trick"; render(); };
window.setRisk = (i, n) => { draft.steps[i].risk = n; render(); };
// このステップの♪キュー位置から曲を再生/一時停止。押した技のボタンだけ再生↔停止でトグルする
let cuePlayStepId = null;
window.editorPlayFromCue = (i) => {
  const s = draft && draft.steps[i];
  if (!s || s.cue == null || !musicPlayer.src) return;
  if (cuePlayStepId === s.id) {
    // 同じ技のボタン: 再生中なら一時停止、停止中なら再開(位置はそのまま)
    if (musicPlayer.paused) { ensureAudioGraph(); musicPlayer.play(); } else musicPlayer.pause();
  } else {
    // 別の技のボタン: その技の位置へ頭出しして再生
    cuePlayStepId = s.id;
    ensureAudioGraph();
    try { musicPlayer.currentTime = s.cue; } catch (_) {}
    musicPlayer.play();
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
  const cue = parseCue(v);
  if (Number.isNaN(cue)) { toast("秒指定は「1:23」か「83」の形式で"); render(); return; }
  if (cue == null) delete draft.steps[i].cue;
  else draft.steps[i].cue = cue;
  render();
};
// ♪欄の横スワイプで秒数を微調整(20px=1秒、0.1秒刻み)。タップなら従来どおりキーボード入力
let cueDrag = null;
document.addEventListener("pointerdown", (e) => {
  const inp = e.target.closest(".cue-input");
  if (!inp || view.name !== "edit" || !draft) return;
  const i = Number(inp.dataset.i);
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

// A/B化: 既存の技名を選択肢Aに移し、スロット(分岐)にする。解除は選択肢Aを技に戻す
window.toggleSlot = (i) => {
  const s = draft.steps[i];
  if (isSlot(s)) {
    const a = s.options[0];
    s.name = a.name || s.name; s.risk = a.risk || 3;
    delete s.options;
  } else {
    s.options = [{ id: uid(), name: s.name, risk: s.risk || 3 }, { id: uid(), name: "", risk: 3 }];
    s.name = "";
  }
  render();
};
window.setOptRisk = (i, oi, n) => { draft.steps[i].options[oi].risk = n; render(); };
window.duplicateRoutine = async (id) => {
  const src = state.routines.find((r) => r.id === id);
  if (!src) return;
  const ver = latestVersion(src);
  let music = null;
  if (src.music) {
    const blob = await blobGet(src.music.blobId);
    if (blob) { const bid = uid(); if (await blobPut(bid, blob)) music = { blobId: bid, name: src.music.name }; }
  }
  state.routines.push({
    id: uid(), name: `${src.name} (コピー)`, music, copiedFrom: src.id,
    partLoop: src.partLoop ? { ...src.partLoop } : undefined,
    versions: [{ id: uid(), createdAt: Date.now(),
      steps: ver.steps.map((s) => ({ ...s, id: uid(),
        options: s.options ? s.options.map((o) => ({ ...o, id: uid() })) : undefined })) }],
  });
  saveState(); draft = null; go("routines");
  toast("複製しました(記録・分析データは引き継ぎません)");
};
window.addOpt = (i) => { draft.steps[i].options.push({ id: uid(), name: "", risk: 3 }); render(); };
window.delOpt = (i, oi) => { draft.steps[i].options.splice(oi, 1); render(); };
window.moveStep = (i, d) => { const [s] = draft.steps.splice(i, 1); draft.steps.splice(i + d, 0, s); render(); };
window.delStep = (i) => { draft.steps.splice(i, 1); render(); };
window.addStep = (kind) => { draft.steps.push({ id: uid(), name: "", kind, risk: kind === "transition" ? 2 : 3 }); render(); };

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
    <div class="sheet-sub">タップで追加 / ▶で動画を確認</div>
    ${tricks.map((t) => `
      <div class="pick-trick-row" onclick="addStepFromTrick('${t.id}')">
        <span class="nm">${esc(t.name)}</span>
        <span class="kn">${fmtTime(t.duration)}</span>
        <button class="mini-btn play" onclick="event.stopPropagation();playTrickVideo('${t.id}',true)">▶</button>
      </div>`).join("")}
    <div style="height:10px"></div>
    <button class="btn ghost" onclick="hideSheet()">閉じる</button>`);
};
window.addStepFromTrick = (trickId) => {
  const t = (state.tricks || []).find((x) => x.id === trickId);
  if (!t || !draft) return hideSheet();
  draft.steps.push({ id: uid(), name: t.name, kind: "trick", risk: 3, trickId: t.id });
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
  draft._removeMusic = false;
  input.value = "";
  render();
};
window.removeMusic = () => { draft._newMusicFile = null; draft.music = null; draft._removeMusic = true; render(); };

// 添付/削除の差分を音声Blobストアに反映し、routine.musicメタを返す。
// 安全側の原則: 「削除」を明示的に押したときだけ既存Blobを消す。
// それ以外は draft の状態がどうであれ既存の楽曲を維持する(想定外のdraft破損で音源を失わないため)
async function applyMusicChange(prevMusic) {
  if (draft._newMusicFile) {
    const blobId = uid();
    const ok = await blobPut(blobId, draft._newMusicFile);
    if (!ok) { toast("音源を保存できませんでした(既存の音源を維持します)"); return prevMusic || null; }
    if (prevMusic) blobDel(prevMusic.blobId);
    return { blobId, name: draft._newMusicFile.name };
  }
  if (draft._removeMusic && prevMusic) { blobDel(prevMusic.blobId); return null; }
  return prevMusic || null;
}

window.saveRoutine = async () => {
  // スロットは選択肢名があれば残す(ラベル自体は任意)。空の選択肢は落とす
  for (const s of draft.steps) {
    if (Array.isArray(s.options)) {
      s.options = s.options.filter((o) => o.name.trim());
      if (s.options.length === 1) { s.name = s.name || s.options[0].name; s.risk = s.options[0].risk; delete s.options; }
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
  if (draft.id) {
    const rt = state.routines.find((r) => r.id === draft.id);
    rt.name = draft.name.trim();
    rt.music = await applyMusicChange(rt.music);
    if (musicLoadedFor === rt.id) musicLoadedFor = null; // 次回記録画面で再ロード
    const cur = latestVersion(rt);
    const structuralChange = stepsSignature(cur.steps) !== stepsSignature(draft.steps);
    const hasRuns = state.sessions.some((s) => s.versionId === cur.id && s.runs.length > 0);
    if (structuralChange && hasRuns) {
      // 技名・順序・種別が変わった → 新バージョン(統計を混ぜない)
      rt.versions.push({ id: uid(), createdAt: Date.now(), steps: draft.steps });
      toast(`構成が変わったので v${rt.versions.length} を作成しました(分析は分かれます)`);
    } else {
      // 構成は同じ(リスク度だけの変更を含む)、または記録がまだない → 在版をその場で更新
      cur.steps = draft.steps;
    }
  } else {
    const music = await applyMusicChange(null);
    state.routines.push({ id: uid(), name: draft.name.trim(), music,
      versions: [{ id: uid(), createdAt: Date.now(), steps: draft.steps }] });
  }
  saveState(); draft = null; go("routines");
};

// ========== 記録 ==========
function activeSession(routineId) {
  return state.sessions.find((s) => s.routineId === routineId && !s.endedAt);
}
// スロットの現在の選択(セッションの既定値。演技中に変えたらチップで切り替える)
function currentChoice(sess, st) {
  return (sess && sess.slotDefaults && sess.slotDefaults[st.id]) || st.options[0].id;
}
function currentChoices(ver, sess) {
  const out = {};
  for (const st of ver.steps) if (isSlot(st)) out[st.id] = currentChoice(sess, st);
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
  const runCount = sess ? sess.runs.length : 0;
  const cleanCount = sess ? sess.runs.filter((r) => r.outcome === "clean").length : 0;
  const isOpen = openRun && openRun.routineId === rt.id;

  // 楽曲プレイヤー(添付がある場合のみ)
  if (rt.music && musicLoadedFor !== rt.id) setTimeout(() => loadMusic(rt), 0);
  const musicCard = rt.music ? `
    <div class="card music-card">
      ${musicMissing && musicLoadedFor === rt.id
        ? `<div class="hint">♪ 音源データが見つかりません(バックアップ復元後は編集画面で再添付してください)</div>`
        : `<div class="music-name">♪ ${esc(rt.music.name)}</div>
           <div class="music-time big"><span id="music-cur">0:00.0</span><span class="dur"> / <span id="music-dur">-:--</span></span></div>
           <input type="range" id="music-seek" min="0" max="100" step="0.1" value="0" oninput="musicSeek(this.value)">
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

  // 録音コントロール
  const recCard = `
    <div class="card rec-card">
      ${recState
        ? `<div class="music-row">
             <button class="music-btn rec-on" onclick="toggleRecording()">■</button>
             <div class="music-time"><span class="rec-dot"></span><span id="rec-elapsed">0:00.0</span></div>
             <span class="hint" style="margin:0">録音中 — 停止で保存</span>
           </div>`
        : `<button class="btn small" onclick="toggleRecording()">● 練習を録音する</button>`}
    </div>`;

  const stepBtns = ver.steps.map((s, i) => {
    const hit = isOpen && openRun.events.some((e) => e.stepIndex === i);
    if (isSlot(s)) {
      const sel = currentChoice(sess, s);
      const selOpt = s.options.find((o) => o.id === sel) || s.options[0];
      const risk = selOpt.risk || 3;
      return `<div class="step-btn slot" onclick="tapStep(${i})">
        <span class="no">${i + 1}</span>
        <div class="slot-body">
          ${s.name || s.cue != null ? `<span class="slot-label">${s.cue != null ? `♪${fmtCue(s.cue)} ` : ""}${esc(s.name)}</span>` : ""}
          <div class="slot-chips">${s.options.map((o) => `<button class="opt-chip ${sel === o.id ? "selected" : ""}"
            onclick="event.stopPropagation();setSlotChoice('${s.id}','${o.id}')">${esc(o.name)}</button>`).join("")}</div>
        </div>
        ${hit ? `<span class="badge hit">記録済</span>` : risk >= 3 ? `<span class="badge risk-${risk}">${RISK_LABEL[risk]}</span>` : ""}
      </div>`;
    }
    const risk = s.risk || 3;
    const hasVideo = s.trickId && (state.tricks || []).some((t) => t.id === s.trickId);
    return `<div class="step-btn ${s.kind}" onclick="tapStep(${i})">
      <span class="no">${i + 1}</span><span class="nm">${s.cue != null ? `<span class="cue-chip">♪${fmtCue(s.cue)}</span> ` : ""}${esc(s.name)}</span>
      ${hasVideo ? `<button class="mini-btn play" onclick="event.stopPropagation();playTrickVideo('${s.trickId}')">▶</button>` : ""}
      ${hit ? `<span class="badge hit">記録済</span>` : risk >= 3 ? `<span class="badge risk-${risk}">${RISK_LABEL[risk]}</span>` : ""}
    </div>`;
  }).join("");

  return `
    <div class="topbar"><button class="back-btn" onclick="endSessionAsk('${rt.id}')">戻る</button>
      <h1>${esc(rt.name)}</h1><span class="sub">v${rt.versions.length}</span></div>
    <div class="runbar">
      <span class="stat">今日 <b>${runCount}</b> 本</span>
      <span class="stat">クリーン <b>${cleanCount}</b></span>
      ${sess ? `<span class="stat">体調 <b>${(FEELINGS.find((f) => f.v === sess.feeling) || {}).label || "-"}</b></span>` : ""}
    </div>
    ${musicCard}
    ${recCard}
    ${isOpen ? `<div class="openrun-note">この通しは失敗を記録して続行中 → 最後までいったら「完走」、また落ちたら該当の技をタップ</div>` : ""}
    <button class="clean-btn" onclick="${isOpen ? "finishOpenRun()" : "recordClean()"}">
      ${isOpen ? "完走" : "クリーン"}<span class="sub">${isOpen ? "(失敗ありで最後まで)" : "ノーミスで完走 = 1タップ"}</span>
    </button>
    <div class="card">
      <h2>失敗した場所をタップ</h2>
      <div class="step-list">${stepBtns}</div>
    </div>
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
    <div class="sheet-sub">${esc(rt.name)} / ${today()}</div>
    ${recap}
    <div class="tag-label">今日の体調(開始時の主観)</div>
    <div class="segmented" id="feel-grid">
      ${FEELINGS.map((f) => `<button class="choice ${f.v === 2 ? "selected" : ""}" data-v="${f.v}"
        onclick="selectOne('feel-grid',this)">${f.label}</button>`).join("")}
    </div>
    <label class="fld">条件メモ(任意: 会場・道具・風など)</label>
    <input type="text" id="sess-note" placeholder="例: 屋外、やや風あり">
    <div style="height:14px"></div>
    <button class="btn primary" onclick="startSession('${rt.id}')">開始</button>
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
  saveState(); hideSheet(); render();
};

window.recordClean = () => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  const sess = activeSession(rt.id);
  if (!sess) return sheetStartSession(rt);
  const verC = latestVersion(rt);
  sess.runs.push({ id: uid(), at: Date.now(), outcome: "clean", events: [],
    reachedIndex: verC.steps.length - 1, choices: currentChoices(verC, sess) });
  musicResetForNextRun();
  saveState(); render(); toast(`クリーン記録 (今日${sess.runs.length}本目)`);
};

window.finishOpenRun = () => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  const sess = activeSession(rt.id);
  if (!openRun || !sess) return;
  const verF = latestVersion(rt);
  sess.runs.push({
    id: uid(), at: Date.now(), outcome: "finished",
    events: openRun.events, reachedIndex: verF.steps.length - 1, choices: currentChoices(verF, sess),
  });
  openRun = null; musicResetForNextRun();
  saveState(); render(); toast("完走(失敗あり)を記録");
};

let pendingCapture = null; // 失敗タップ瞬間の曲位置/録音位置

window.tapStep = (stepIndex) => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  if (!activeSession(rt.id)) return sheetStartSession(rt);
  const step = latestVersion(rt).steps[stepIndex];
  // タップした瞬間の時刻を先に確保(シート操作中に時間が進まないように)
  pendingCapture = {};
  if (rt.music && musicLoadedFor === rt.id && !musicMissing &&
      (musicPlayer.currentTime > 0.05 || !musicPlayer.paused)) {
    pendingCapture.musicTime = musicPlayer.currentTime;
    musicPlayer.pause(); // 落とした=演技中断なので曲も止める
  }
  if (recState) {
    pendingCapture.recId = recState.id;
    pendingCapture.recTime = (Date.now() - recState.startedAt) / 1000;
  }
  const capBadges = [
    pendingCapture.musicTime != null ? `♪ 曲 ${fmtTime(pendingCapture.musicTime)}` : "",
    pendingCapture.recTime != null ? `● 録音 ${fmtTime(pendingCapture.recTime)}` : "",
  ].filter(Boolean).join(" / ");
  const sessNow = activeSession(rt.id);
  const slotChips = isSlot(step) ? `
    <div class="tag-label">どちらをやった?</div>
    <div class="slot-chips" id="opt-grid" style="margin-bottom:12px">
      ${step.options.map((o) => `<button class="opt-chip choice ${currentChoice(sessNow, step) === o.id ? "selected" : ""}"
        data-o="${o.id}" onclick="selectOne('opt-grid',this)">${esc(o.name)}</button>`).join("")}
    </div>` : "";
  showSheet(`
    <h3>${stepIndex + 1}. ${esc(stepLabel(step))}</h3>
    <div class="sheet-sub">何が起きた?(初期値: ドロップして中止)${capBadges ? ` — <b>${capBadges}</b> を記録` : ""}</div>
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

window.commitEvent = (stepIndex) => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  const ver = latestVersion(rt);
  const sess = activeSession(rt.id);
  const typeId = document.querySelector("#type-grid .selected")?.dataset.t || "drop_abort";
  const type = EVENT_TYPES.find((t) => t.id === typeId);
  const tags = [...document.querySelectorAll("#tag-row .tag.selected")].map((el) => el.dataset.t);
  const note = document.getElementById("ev-note").value.trim();
  const ev = { stepId: ver.steps[stepIndex].id, stepIndex, type: typeId, tags, note, ...(pendingCapture || {}) };
  pendingCapture = null;
  // スロットで失敗した場合: どちらをやったかを記録し、セッションの既定選択も追随させる
  const stepObj = ver.steps[stepIndex];
  if (isSlot(stepObj)) {
    const optId = document.querySelector("#opt-grid .selected")?.dataset.o || currentChoice(sess, stepObj);
    ev.optionId = optId;
    sess.slotDefaults = { ...(sess.slotDefaults || {}), [stepObj.id]: optId };
  }

  if (type.abort) {
    // 中止: 前段は成功扱い(到達済み)、後段は未到達
    const events = (openRun && openRun.routineId === rt.id) ? [...openRun.events, ev] : [ev];
    sess.runs.push({ id: uid(), at: Date.now(), outcome: "aborted", events, reachedIndex: stepIndex,
      choices: currentChoices(ver, sess) });
    openRun = null;
    musicResetForNextRun();
    toast(`中止を記録 (${stepIndex + 1}. ${ver.steps[stepIndex].name})`);
  } else {
    // 続行: 通しを開いたまま追加失敗を待つ
    if (!openRun || openRun.routineId !== rt.id) openRun = { routineId: rt.id, versionId: ver.id, events: [] };
    openRun.events.push(ev);
    toast("記録して続行中 — 最後までいったら「完走」");
  }
  saveState(); hideSheet(); render();
};

window.undo = () => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  const sess = activeSession(rt.id);
  if (openRun && openRun.routineId === rt.id && openRun.events.length) {
    openRun.events.pop();
    if (!openRun.events.length) openRun = null;
    render(); return toast("直前の失敗記録を取り消しました");
  }
  if (sess && sess.runs.length) {
    const r = sess.runs.pop();
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
  showSheet(`
    <h3>セッション終了</h3>
    <div class="sheet-sub">今日 ${sess.runs.length} 本 / クリーン ${sess.runs.filter((r) => r.outcome === "clean").length} 本</div>
    <label class="fld">振り返りメモ(任意 — 気づいた仮説など)</label>
    <textarea id="end-note" rows="2" placeholder="例: 3本目以降、腕が重くなってからリング系が怪しい"></textarea>
    <label class="fld">次回試すこと(任意 — 次のセッション開始時に表示されます)</label>
    <textarea id="end-plan" rows="2" placeholder="例: 持ち替え→ソロクラブの移行だけ10回反復してから通す"></textarea>
    <div style="height:14px"></div>
    <button class="btn primary" onclick="endSession('${routineId}')">終了する</button>
    <button class="btn ghost" onclick="hideSheet()">まだ続ける</button>`);
};
window.endSession = async (routineId) => {
  if (recState) await stopRecording(); // 録音中なら先に保存(セッションを閉じる前に)
  const sess = activeSession(routineId);
  sess.endedAt = Date.now();
  sess.review = document.getElementById("end-note").value.trim();
  sess.nextPlan = document.getElementById("end-plan").value.trim();
  saveState(); hideSheet(); go("stats", { id: routineId });
};

// ========== 統計 ==========
function renderStats() {
  const rt = state.routines.find((r) => r.id === view.params.id);
  if (!rt) return renderHome();
  const versionId = view.params.versionId || latestVersion(rt).id;
  const st = versionStats(rt, versionId);
  const verIndex = rt.versions.findIndex((v) => v.id === st.ver.id) + 1;

  const verSelect = rt.versions.length > 1 ? `
    <select onchange="go('stats',{id:'${rt.id}',versionId:this.value})" style="margin-bottom:12px">
      ${rt.versions.map((v, i) => `<option value="${v.id}" ${v.id === st.ver.id ? "selected" : ""}>
        v${i + 1} (${new Date(v.createdAt).toLocaleDateString("ja-JP")}〜)</option>`).join("")}
    </select>` : "";

  if (st.total === 0) {
    return `
      <div class="topbar"><button class="back-btn" onclick="go('routines')">戻る</button>
        <h1>${esc(rt.name)} 分析</h1></div>
      ${verSelect}
      <div class="empty">v${verIndex} の通し記録はまだありません。<br>「通し練習」からクリーン/失敗を記録すると、ここに偏りが表示されます。</div>`;
  }

  const cleanCiTxt = st.cleanCi ? `${pct(st.cleanCi[0])}〜${pct(st.cleanCi[1])}%` : "-";
  const overview = `
    <div class="stat-overview">
      <div class="stat-box"><div class="v">${st.total}</div><div class="l">通し数</div></div>
      <div class="stat-box"><div class="v">${st.clean}/${st.total}</div><div class="l">クリーン率 ${pct(st.clean / st.total)}%</div>
        <div class="ci">95%区間 ${cleanCiTxt}</div></div>
      <div class="stat-box"><div class="v">${st.fails ? `${st.recov}/${st.fails}` : "-"}</div><div class="l">乱れ/ドロップ<br>からの回復</div></div>
    </div>`;

  // パターン候補: 到達が十分あり、失敗率の下限が全体平均failレートを上回るステップ
  const overallFailRate = st.steps.reduce((a, s) => a + s.failed, 0) / Math.max(1, st.steps.reduce((a, s) => a + s.reached, 0));
  const stepRows = st.steps.map((s) => {
    const rate = s.reached ? s.failed / s.reached : 0;
    let evidence, evClass = "";
    if (s.reached < MIN_N_FOR_PATTERN) {
      evidence = `観測不足(到達${s.reached}本)`;
    } else if (s.ci && s.ci[0] > overallFailRate && s.failed >= 2) {
      evidence = "パターン候補(直前の技/位置/疲労は未分離)";
      evClass = "candidate";
    } else {
      evidence = "";
    }
    const bar = s.ci ? `
      <div class="ci-bar">
        <div class="range" style="left:${pct(s.ci[0])}%;width:${Math.max(1, pct(s.ci[1]) - pct(s.ci[0]))}%"></div>
        <div class="pt" style="left:${pct(rate)}%"></div>
      </div>` : "";
    // 失敗時の曲位置(昇順で並べると「同じ箇所で落ちている」が見える)
    const musicTimes = st.runs
      .flatMap((r) => r.events.filter((e) => e.stepIndex === s.index && e.musicTime != null).map((e) => e.musicTime))
      .sort((a, b) => a - b).slice(0, 10);
    const timeChips = musicTimes.length
      ? `<div class="time-chips">${musicTimes.map((t) => `<span class="time-chip">♪ ${fmtTime(t)}</span>`).join("")}</div>` : "";
    // 認識と結果のズレ: 事前のリスク度(自己評価)と実際の失敗率を突き合わせる
    const gapNote = (risk, failed, reached, r) => {
      if (reached < MIN_N_FOR_PATTERN) return "";
      if (risk <= 2 && failed >= 2 && r >= 0.25)
        return `⚠︎ 認識とのズレ: 自己評価は<b>リスク${risk}(低め)</b>なのに失敗<b>${pct(r)}%</b> — 思っているより難しい技かも`;
      if (risk >= 4 && failed === 0)
        return `✓ 認識とのズレ: 自己評価は<b>リスク${risk}(高め)</b>だが失敗<b>0</b> — 思っているより安定している`;
      return "";
    };
    const knTxt = (o) => `${o.failed}/${o.reached}${o.ci && o.reached ? ` (${pct(o.ci[0])}〜${pct(o.ci[1])}%)` : ""}`;
    const openDetail = `onclick="go('stepdetail',{id:'${rt.id}',versionId:'${st.ver.id}',stepIndex:${s.index}})"`;

    if (s.options) {
      // スロット: 選択肢別に分母を分けて表示
      const optRows = s.options.map((o) => {
        const oRate = o.reached ? o.failed / o.reached : 0;
        const oGap = gapNote(o.opt.risk || 3, o.failed, o.reached, oRate);
        const oBar = o.ci ? `<div class="ci-bar"><div class="range" style="left:${pct(o.ci[0])}%;width:${Math.max(1, pct(o.ci[1]) - pct(o.ci[0]))}%"></div><div class="pt" style="left:${pct(oRate)}%"></div></div>` : "";
        return `<div class="slot-opt-stat">
          <div class="head"><span class="nm">└ ${esc(o.opt.name)}</span>
            <span class="risk-chip risk-${o.opt.risk || 3}">${RISK_LABEL[o.opt.risk || 3]}</span>
            <span class="kn">${knTxt(o)}</span></div>
          ${o.reached ? oBar : ""}
          ${oGap ? `<div class="gap-note">${oGap}</div>` : ""}
        </div>`;
      }).join("");
      return `<div class="step-stat ${s.step.kind}" ${openDetail}>
        <div class="head"><span class="nm">${s.index + 1}. ${esc(stepLabel(s.step))} <span class="slot-mark">A/B</span></span>
          <span class="kn">${knTxt(s)} ›</span></div>
        ${optRows}
        ${s.choiceUnknown ? `<div class="evidence">選択未記録 ${s.choiceUnknown}本(履歴から修正可)</div>` : ""}
        <div class="evidence">※選択肢間の失敗率の直接比較には偏りがあります</div>
        ${timeChips}
        ${evidence ? `<div class="evidence ${evClass}">${evidence}</div>` : ""}
      </div>`;
    }

    const risk = s.step.risk || 3;
    const gap = gapNote(risk, s.failed, s.reached, rate);
    return `<div class="step-stat ${s.step.kind}" ${openDetail}>
      <div class="head"><span class="nm">${s.index + 1}. ${esc(s.step.name)}</span>
        <span class="risk-chip risk-${risk}">${RISK_LABEL[risk]}</span>
        <span class="kn">${knTxt(s)} ›</span></div>
      ${s.reached ? bar : ""}
      ${timeChips}
      ${gap ? `<div class="gap-note">${gap}</div>` : ""}
      ${evidence ? `<div class="evidence ${evClass}">${evidence}</div>` : ""}
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

  const bdRows = (arr) => arr.filter((b) => b.n > 0).map((b) =>
    `<div class="bd-row"><span class="k">${b.label}</span><span class="v">クリーン ${b.clean}/${b.n} (${pct(b.clean / b.n)}%)</span></div>`).join("") || `<div class="empty">データなし</div>`;

  const tagRows = Object.entries(st.tagCount).sort((a, b) => b[1] - a[1]).map(([t, c]) =>
    `<div class="bd-row"><span class="k">${esc(t)}</span><span class="v">${c}回</span></div>`).join("");

  return `
    <div class="topbar"><button class="back-btn" onclick="go('routines')">戻る</button>
      <h1>${esc(rt.name)} 分析</h1><span class="sub">v${verIndex}</span></div>
    ${verSelect}
    ${overview}
    <div class="card">
      <h2>ステップ別の失敗 (分母 = そのステップに到達した通し数)</h2>
      ${stepRows}
    </div>
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
let partLoopActive = false;

function stopPartLoop(pauseMusic) {
  clearInterval(partLoopTimer);
  partLoopTimer = null;
  partLoopActive = false;
  if (pauseMusic) musicPlayer.pause();
}
function partRange(rt) {
  const p = rt.partLoop || {};
  const dur = isFinite(musicPlayer.duration) ? musicPlayer.duration : null;
  return { a: p.a ?? 0, b: p.b ?? dur }; // B未設定は曲末まで
}
function partTick() {
  const rt = state.routines.find((r) => r.id === view.params.id);
  if (!rt || view.name !== "part") return stopPartLoop(false);
  const { a, b } = partRange(rt);
  if (b != null && b > a && musicPlayer.currentTime >= b - 0.05) {
    musicPlayer.currentTime = a;
    if (musicPlayer.paused) musicPlayer.play();
  }
}
window.partSetPoint = (which) => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  rt.partLoop = rt.partLoop || {};
  rt.partLoop[which] = Math.round(musicPlayer.currentTime * 10) / 10;
  saveState(); render();
};
window.partNudge = (which, d) => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  rt.partLoop = rt.partLoop || {};
  const cur = which === "a" ? partRange(rt).a : partRange(rt).b;
  if (cur == null) return toast("先に位置を設定してください");
  rt.partLoop[which] = Math.max(0, Math.round((cur + d) * 10) / 10);
  saveState(); render();
};
window.partClear = () => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  delete rt.partLoop;
  saveState(); render();
};
window.partPlayFromA = () => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  const { a } = partRange(rt);
  ensureAudioGraph();
  musicPlayer.currentTime = a;
  musicPlayer.play();
  if (partLoopActive && !partLoopTimer) partLoopTimer = setInterval(partTick, 80);
};
window.partToggleLoop = () => {
  partLoopActive = !partLoopActive;
  if (partLoopActive) {
    if (!partLoopTimer) partLoopTimer = setInterval(partTick, 80);
  } else {
    clearInterval(partLoopTimer); partLoopTimer = null;
  }
  render();
};

function renderPart() {
  const rt = state.routines.find((r) => r.id === view.params.id);
  if (!rt) return renderHome();
  if (!rt.music) {
    return `
      <div class="topbar"><button class="back-btn" onclick="go('routines')">戻る</button>
        <h1>${esc(rt.name)} パート練習</h1></div>
      <div class="empty">パート練習は登録した楽曲の一部をループ再生する機能です。<br>まず「編集」から音源(MP3等)を添付してください。</div>
      <button class="btn" onclick="go('edit',{id:'${rt.id}'})">編集画面へ</button>`;
  }
  if (musicLoadedFor !== rt.id) setTimeout(() => loadMusic(rt), 0);
  const { a, b } = partRange(rt);
  const dur = isFinite(musicPlayer.duration) ? musicPlayer.duration : null;
  const bandStyle = dur && b != null
    ? `left:${(a / dur) * 100}%;width:${Math.max(1, ((b - a) / dur) * 100)}%` : "left:0;width:0";
  const abInvalid = b != null && b <= a;
  const pointRow = (which, val, label) => `
    <div class="part-point">
      <span class="pp-label">${label}</span>
      <span class="pp-time">${val != null ? fmtTimeFine(val) : "未設定(曲末)"}</span>
      <button class="mini-btn" onclick="partNudge('${which}',-1)">−1s</button>
      <button class="mini-btn" onclick="partNudge('${which}',1)">＋1s</button>
      <button class="btn small" onclick="partSetPoint('${which}')">今の位置</button>
    </div>`;
  return `
    <div class="topbar"><button class="back-btn" onclick="go('routines')">戻る</button>
      <h1>${esc(rt.name)} パート練習</h1></div>
    <div class="card music-card">
      <div class="music-name">♪ ${esc(rt.music.name)}</div>
      <div class="music-time big"><span id="music-cur">${fmtTimeFine(musicPlayer.currentTime)}</span><span class="dur"> / <span id="music-dur">${fmtTime(musicPlayer.duration)}</span></span></div>
      <input type="range" id="music-seek" min="0" max="100" step="0.1" value="0" oninput="musicSeek(this.value)">
      <div class="ci-bar part-band-bar"><div class="range" style="${bandStyle}"></div></div>
      <div class="music-controls">
        <button class="music-pill primary" id="music-toggle-pill" onclick="musicToggle()">▶ 再生</button>
        <button class="music-pill" onclick="musicStop()">■ 停止</button>
      </div>
      <div class="volume-row">
        <span class="vol-ico">🔈</span>
        <input type="range" id="music-vol" min="0" max="1" step="0.02" value="${musicVolume}" oninput="musicSetVolume(this.value)">
        <span class="vol-ico">🔊</span>
      </div>
    </div>
    <div class="card">
      <h2>ループ区間</h2>
      ${pointRow("a", rt.partLoop && rt.partLoop.a != null ? rt.partLoop.a : 0, "A 始点")}
      ${pointRow("b", rt.partLoop ? rt.partLoop.b : null, "B 終点")}
      ${abInvalid ? `<div class="gap-note">⚠︎ 終点Bが始点Aより前です。ループしません。</div>` : ""}
      <div class="row-2" style="margin-top:12px">
        <button class="btn primary" style="margin:0" onclick="partPlayFromA()">Aから再生</button>
        <button class="btn ${partLoopActive ? "ok" : ""}" style="margin:0" onclick="partToggleLoop()">ループ ${partLoopActive ? "ON" : "OFF"}</button>
      </div>
      ${rt.partLoop ? `<button class="btn ghost" style="margin-top:10px" onclick="partClear()">区間をリセット</button>` : ""}
    </div>`;
}

// ========== 技の詳細(ステップ別のミス内訳) ==========
const typeLabel = (id) => (EVENT_TYPES.find((t) => t.id === id) || {}).label || id;

function renderStepDetail() {
  const rt = state.routines.find((r) => r.id === view.params.id);
  if (!rt) return renderHome();
  const ver = getVersion(rt, view.params.versionId);
  const i = view.params.stepIndex;
  const step = ver.steps[i];
  if (!step) return renderStats();
  const runs = runsOfVersion(rt.id, ver.id).filter((r) => !r.excluded);
  const reached = runs.filter((r) => r.reachedIndex >= i).length;
  const evs = [];
  for (const r of runs) for (const e of r.events) if (e.stepIndex === i) evs.push({ ...e, run: r });
  const failRuns = runs.filter((r) => r.events.some((e) => e.stepIndex === i)).length;
  const ci = wilson(failRuns, reached);

  const optName = (e) => {
    if (!isSlot(step) || !e.optionId) return "";
    const o = step.options.find((o2) => o2.id === e.optionId);
    return o ? `[${o.name}] ` : "";
  };
  // 最新メモを上に(Codex指摘: 細かいチャートより実用価値が高い)
  const noteRows = evs.slice().sort((a, b) => b.run.at - a.run.at).slice(0, 15).map((e) => `
    <div class="bd-row"><span class="k">${e.run.session.date} ${optName(e)}${typeLabel(e.type)}${(e.tags || []).length ? ` / ${e.tags.join("・")}` : ""}${e.musicTime != null ? ` / ♪${fmtTime(e.musicTime)}` : ""}</span>
      <span class="v">${e.note ? "" : ""}</span></div>
    ${e.note ? `<div class="note-line">${esc(e.note)}</div>` : ""}`).join("");

  const typeCounts = EVENT_TYPES.map((t) => ({ t, n: evs.filter((e) => e.type === t.id).length })).filter((x) => x.n);
  const tagCounts = {};
  for (const e of evs) for (const tg of e.tags || []) tagCounts[tg] = (tagCounts[tg] || 0) + 1;
  const musicTimes = evs.filter((e) => e.musicTime != null).map((e) => e.musicTime).sort((a, b) => a - b);

  const optBreakdown = isSlot(step) ? step.options.map((o) => {
    const oReached = runs.filter((r) => r.reachedIndex >= i && runChoice(r, step) === o.id).length;
    const oFailed = runs.filter((r) => r.reachedIndex >= i && runChoice(r, step) === o.id && r.events.some((e) => e.stepIndex === i)).length;
    return `<div class="bd-row"><span class="k">${esc(o.name)}</span><span class="v">失敗 ${oFailed}/${oReached}</span></div>`;
  }).join("") : "";

  return `
    <div class="topbar"><button class="back-btn" onclick="go('stats',{id:'${rt.id}',versionId:'${ver.id}'})">戻る</button>
      <h1>${esc(stepLabel(step))}</h1></div>
    <div class="stat-overview" style="grid-template-columns:1fr 1fr">
      <div class="stat-box"><div class="v">${reached}</div><div class="l">到達した通し</div></div>
      <div class="stat-box"><div class="v">${failRuns}/${reached}</div><div class="l">失敗した通し</div>
        <div class="ci">${ci && reached ? `95%区間 ${pct(ci[0])}〜${pct(ci[1])}%` : ""}</div></div>
    </div>
    ${step.trickId && (state.tricks || []).some((t) => t.id === step.trickId)
      ? `<button class="btn" onclick="playTrickVideo('${step.trickId}')">▶ 技の動画を見る</button>` : ""}
    ${optBreakdown ? `<div class="card"><h2>選択肢別</h2>${optBreakdown}</div>` : ""}
    ${noteRows ? `<div class="card"><h2>この技の失敗の記録(新しい順)</h2>${noteRows}</div>` : `<div class="empty">この技の失敗記録はまだありません</div>`}
    ${typeCounts.length ? `<div class="card"><h2>失敗の種類(全${evs.length}件中)</h2>
      ${typeCounts.map((x) => `<div class="bd-row"><span class="k">${x.t.label}</span><span class="v">${x.n}件</span></div>`).join("")}</div>` : ""}
    ${Object.keys(tagCounts).length ? `<div class="card"><h2>原因の仮説タグ(複数選択・推測)</h2>
      ${Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).map(([t, c]) => `<div class="bd-row"><span class="k">${esc(t)}</span><span class="v">${c}回</span></div>`).join("")}</div>` : ""}
    ${musicTimes.length ? `<div class="card"><h2>失敗した曲位置</h2>
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
      <h1>履歴</h1></div><div class="empty">まだセッションがありません</div>`;
  }
  const blocks = sessions.map((sess) => {
    const ver = getVersion(rt, sess.versionId);
    const vno = rt.versions.findIndex((v) => v.id === ver.id) + 1;
    const feel = (FEELINGS.find((f) => f.v === sess.feeling) || {}).label || "-";
    const runRows = sess.runs.map((run, ri) => {
      const outcomeTxt = run.outcome === "clean" ? "クリーン"
        : run.outcome === "finished" ? "完走(失敗あり)"
        : `中止 @${ri >= 0 && ver.steps[run.reachedIndex] ? esc(stepLabel(ver.steps[run.reachedIndex])) : "?"}`;
      const evRows = run.events.map((e, ei) => {
        const st = ver.steps[e.stepIndex];
        const oName = st && isSlot(st) && e.optionId ? (st.options.find((o) => o.id === e.optionId) || {}).name : "";
        return `<div class="ev-row" onclick="sheetEditEvent('${sess.id}','${run.id}',${ei})">
          <span class="k">${e.stepIndex + 1}. ${st ? esc(stepLabel(st)) : "?"}${oName ? ` [${esc(oName)}]` : ""} — ${typeLabel(e.type)}${e.musicTime != null ? ` ♪${fmtTime(e.musicTime)}` : ""}</span>
          ${(e.tags || []).length ? `<span class="ev-tags">${e.tags.join("・")}</span>` : ""}
          ${e.note ? `<div class="note-line">${esc(e.note)}</div>` : ""}
          <span class="ev-edit">タップで編集 ›</span>
        </div>`;
      }).join("");
      // スロットの選択修正チップ(その場で変えたのに記録し損ねた通しを直す)
      const slotFix = ver.steps.filter(isSlot).map((st) => {
        const cur = run.choices ? run.choices[st.id] : undefined;
        return `<div class="run-choice"><span class="k">${esc(stepLabel(st))}:</span>
          ${st.options.map((o) => `<button class="opt-chip small ${cur === o.id ? "selected" : ""}"
            onclick="setRunChoice('${sess.id}','${run.id}','${st.id}','${o.id}')">${esc(o.name)}</button>`).join("")}
          ${!cur ? `<span class="ev-tags">未記録</span>` : ""}</div>`;
      }).join("");
      return `<div class="run-block ${run.excluded ? "excluded" : ""}">
        <div class="head"><span class="k">${ri + 1}本目 — ${outcomeTxt}${run.editedAt ? " (編集済)" : ""}</span>
          <button class="btn small ghost" onclick="toggleExcludeRun('${sess.id}','${run.id}')">${run.excluded ? "集計に戻す" : "集計から除外"}</button></div>
        ${evRows}${slotFix}
      </div>`;
    }).join("");
    return `<div class="card">
      <h2>${sess.date} — v${vno} / 体調${feel} / ${sess.runs.length}本
        <button class="btn small ghost" style="float:right" onclick="sheetEditSession('${sess.id}')">メモ編集</button></h2>
      ${sess.note ? `<div class="note-line">条件: ${esc(sess.note)}</div>` : ""}
      ${sess.review ? `<div class="note-line">振り返り: ${esc(sess.review)}</div>` : ""}
      ${sess.nextPlan ? `<div class="note-line plan">次回試すこと: ${esc(sess.nextPlan)}</div>` : ""}
      ${runRows || `<div class="hint">通しの記録なし</div>`}
    </div>`;
  }).join("");
  return `
    <div class="topbar"><button class="back-btn" onclick="go('stats',{id:'${rt.id}'})">戻る</button>
      <h1>${esc(rt.name)} 履歴</h1></div>
    ${blocks}
    `;
}

window.toggleExcludeRun = (sessId, runId) => {
  const sess = state.sessions.find((s) => s.id === sessId);
  const run = sess && sess.runs.find((r) => r.id === runId);
  if (!run) return;
  if (!run.excluded && !confirm("この通しを集計から除外しますか?(データは残り、いつでも戻せます)")) return;
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
// RDB-05の第一歩。技を最大10秒の動画として蓄積する。将来: 音楽タイムラインへの配置
const TRICK_MAX_SEC = 10;      // 技の最大長(とりあえず)。超過は登録を弾く
const TRICK_MAX_BYTES = 100 * 1024 * 1024; // 登録動画の上限100MB
const fmtBytes = (n) => n >= 1e9 ? `${(n / 1e9).toFixed(1)}GB` : n >= 1e6 ? `${(n / 1e6).toFixed(0)}MB` : `${Math.ceil(n / 1e3)}KB`;

let trickPlayingId = null; // 一覧でインライン再生中の技
let trickObjUrl = null;

// サンプル技(ボール軌道のループアニメ)。samples/ に同梱、http(s)配信時のみ読み込み可
const SAMPLE_TRICKS = [
  { f: "samples/s1.mp4", n: "3ボールカスケード" }, { f: "samples/s2.mp4", n: "リバースカスケード" },
  { f: "samples/s3.mp4", n: "シャワー" },           { f: "samples/s4.mp4", n: "4ボールファウンテン" },
  { f: "samples/s5.mp4", n: "コラムス" },           { f: "samples/s6.mp4", n: "ミルズメス風" },
  { f: "samples/s7.mp4", n: "5ボールハイトス" },    { f: "samples/s8.mp4", n: "サークルトス" },
  { f: "samples/s9.mp4", n: "5ボールカスケード" },
];
window.loadSampleTricks = async () => {
  if (!location.protocol.startsWith("http")) return toast("サンプル読み込みは公開版(https)で使えます");
  if (!confirm("サンプルの技9個(アニメーション)を技ライブラリに追加しますか?")) return;
  let ok = 0;
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
          fullDuration: d, trimStart: 0, trimEnd: d, size: blob.size, createdAt: Date.now(), sample: true });
        ok++;
      }
    } catch (_) { /* 個別失敗はスキップ */ }
  }
  saveState(); render();
  toast(ok ? `サンプル${ok}個を追加しました` : "サンプルを読み込めませんでした");
};
// サンプル一式: 技9個(既にあれば再利用)+サンプル楽曲+全機能入りのサンプルルーティン
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
            trimStart: 0, trimEnd: d, size: blob.size, createdAt: Date.now(), sample: true };
          state.tricks.push(t);
        }
      } catch (_) {}
    }
    if (t) byName[s.n] = t;
  }
  return byName;
}
window.loadSampleSet = async () => {
  if (!location.protocol.startsWith("http")) return toast("サンプル読み込みは公開版(https)で使えます");
  if (!confirm("サンプル一式(技9個+楽曲付きサンプルルーティン)を追加しますか?")) return;
  const byName = await ensureSampleTricks();
  if (state.routines.some((r) => r.sampleSet)) {
    saveState(); render();
    return toast("サンプルルーティンは既にあります(技のみ確認しました)");
  }
  // サンプル楽曲
  let music = null;
  try {
    const resp = await fetch("samples/music.m4a");
    if (resp.ok) {
      const blob = await resp.blob();
      const mid = uid();
      if (await blobPut(mid, blob)) music = { blobId: mid, name: "サンプル楽曲.m4a" };
    }
  } catch (_) {}
  // 全機能入りの構成: 技リンク/移行/リスク度/♪キュー/A/Bスロット
  const T = (n) => (byName[n] ? byName[n].id : undefined);
  const steps = [
    { id: uid(), name: "3ボールカスケード", kind: "trick", risk: 1, cue: 0, trickId: T("3ボールカスケード") },
    { id: uid(), name: "リバースカスケード", kind: "trick", risk: 2, cue: 8, trickId: T("リバースカスケード") },
    { id: uid(), name: "持ち替え(間)", kind: "transition", risk: 1, cue: 15 },
    { id: uid(), name: "4ボールファウンテン", kind: "trick", risk: 3, cue: 18, trickId: T("4ボールファウンテン") },
    { id: uid(), name: "ラスト前(調子で選ぶ)", kind: "trick", cue: 28, options: [
      { id: uid(), name: "5ボールハイトス", risk: 5 },
      { id: uid(), name: "シャワー(安牌)", risk: 2 },
    ] },
    { id: uid(), name: "5ボールカスケード", kind: "trick", risk: 4, cue: 40, trickId: T("5ボールカスケード") },
    { id: uid(), name: "フィニッシュポーズ", kind: "transition", risk: 1, cue: 50 },
  ];
  state.routines.push({
    id: uid(), name: "サンプル: はじめてのルーティン", music, sampleSet: true,
    partLoop: { a: 18, b: 28 }, // パート練習のデモ区間(4ボールの部分)
    versions: [{ id: uid(), createdAt: Date.now(), steps }],
  });
  saveState(); render();
  toast("サンプル一式を追加しました");
};
window.removeSampleTricks = async () => {
  const samples = (state.tricks || []).filter((t) => t.sample);
  if (!samples.length) return;
  if (!confirm(`サンプルの技${samples.length}個をまとめて削除しますか?`)) return;
  for (const t of samples) await blobDel(t.blobId);
  state.tricks = state.tricks.filter((t) => !t.sample);
  if (trickPlayingId && samples.some((t) => t.id === trickPlayingId)) trickPlayingId = null;
  saveState(); render(); toast("サンプルを削除しました");
};

function renderTricks() {
  const tricks = (state.tricks || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  const totalBytes = tricks.reduce((a, t) => a + (t.size || 0), 0);
  const rows = tricks.map((t) => `
    <div class="trick-row">
      <div class="head">
        <span class="nm" onclick="sheetRenameTrick('${t.id}')">${esc(t.name)}</span>
        <span class="kn">${t.duration.toFixed(1)}s${(t.trimStart || 0) > 0.05 || (t.trimEnd != null && t.fullDuration != null && t.trimEnd < t.fullDuration - 0.05) ? "✂" : ""}</span>
        <button class="btn small" onclick="sheetTrimTrick('${t.id}')">長さ</button>
        <button class="btn small" onclick="trickPlay('${t.id}')">${trickPlayingId === t.id ? "閉じる" : "▶"}</button>
        <button class="mini-btn del" onclick="trickDelete('${t.id}')">✕</button>
      </div>
      ${trickPlayingId === t.id ? `<video id="trick-video" class="trick-video" data-trim-trick="${t.id}" controls autoplay playsinline></video>` : ""}
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
  const blob = await blobGet(t.blobId);
  if (!blob) return toast("動画データが見つかりません");
  if (sheetVideoUrl) URL.revokeObjectURL(sheetVideoUrl);
  sheetVideoUrl = URL.createObjectURL(blob);
  const actions = typeof ctx === "number"
    ? `<button class="btn primary" onclick="linkTrickToStep(${ctx},'${t.id}')">この動画を紐づける</button>
       <button class="btn ghost" onclick="sheetLinkTrick(${ctx})">戻る</button>`
    : ctx === true
    ? `<button class="btn primary" onclick="addStepFromTrick('${t.id}')">この技をルーティンに追加</button>
       <button class="btn ghost" onclick="sheetPickTrick()">技リストに戻る</button>`
    : `<button class="btn ghost" onclick="hideSheet()">閉じる</button>`;
  showSheet(`
    <h3>${esc(t.name)}</h3>
    <div class="sheet-sub">${fmtTime(t.duration)}</div>
    <video class="trick-video" style="margin-top:0" src="${sheetVideoUrl}" data-trim-trick="${t.id}" controls autoplay playsinline loop></video>
    <div style="height:14px"></div>
    ${actions}`);
};

// ---------- 編集画面の上部ミニ動画ドック ----------
// ▶で開き、編集を続けながら小さくループ再生。stepIdで追跡(並べ替えに強い)。
// auto=true は音楽再生への自動追従で開いたもの(手動で開いた動画は自動切替で上書きしない)
let miniVideo = null; // { trickId, stepId, objUrl, auto }
function miniVideoCloseSilent() {
  if (!miniVideo) return;
  if (miniVideo.objUrl) URL.revokeObjectURL(miniVideo.objUrl);
  miniVideo = null;
}
window.miniVideoClose = () => { miniVideoCloseSilent(); syncMiniDock(); };

function miniDockHtml() {
  if (!miniVideo || !draft) return "";
  const t = (state.tricks || []).find((x) => x.id === miniVideo.trickId);
  if (!t) return "";
  const idx = draft.steps.findIndex((s) => s.id === miniVideo.stepId);
  return `
    <div class="mini-dock">
      <video src="${miniVideo.objUrl}" data-trim-trick="${miniVideo.trickId}" autoplay loop muted playsinline></video>
      <div class="md-info">
        <span class="nm">${idx >= 0 ? `${idx + 1}. ` : ""}${esc(t.name)}</span>
        <span class="kn">${fmtTime(t.duration)}</span>
      </div>
      <button class="mini-btn" onclick="sheetTrimTrick('${miniVideo.trickId}')">✂</button>
      ${idx >= 0 ? `<button class="mini-btn link" onclick="sheetLinkTrick(${idx})">🔗</button>` : ""}
      <button class="mini-btn" onclick="miniVideoClose()">✕</button>
    </div>`;
}
// ドックだけをDOM差し替え(render()しない=入力中のフォーカスやスクロールを壊さない)
function syncMiniDock() {
  if (view.name !== "edit") return;
  const html = miniDockHtml();
  const dock = document.querySelector(".mini-dock");
  if (!html) { if (dock) dock.remove(); }
  else if (dock) dock.outerHTML = html;
  else document.querySelector(".topbar")?.insertAdjacentHTML("afterend", html);
  bindAllTrimVideos(); // ドック動画にトリム区間を適用
  document.querySelectorAll(".editor-step").forEach((row, i) => {
    const btn = row.querySelector(".mini-btn.play");
    if (btn) btn.classList.toggle("on", !!(miniVideo && draft && draft.steps[i] && draft.steps[i].id === miniVideo.stepId));
  });
}
async function miniDockOpen(step, auto) {
  const t = (state.tricks || []).find((x) => x.id === step.trickId);
  if (!t) { if (!auto) toast("動画が見つかりません(技ライブラリから削除されています)"); return false; }
  const blob = await blobGet(t.blobId);
  if (!blob) { if (!auto) toast("動画データが見つかりません"); return false; }
  miniVideoCloseSilent();
  miniVideo = { trickId: step.trickId, stepId: step.id, objUrl: URL.createObjectURL(blob), auto: !!auto };
  syncMiniDock();
  return true;
}
window.editorPlayTrick = async (i) => {
  const s = draft && draft.steps[i];
  if (!s || !s.trickId) return;
  // 同じ技をもう一度タップ→閉じる(トグル)
  if (miniVideo && miniVideo.stepId === s.id) return miniVideoClose();
  await miniDockOpen(s, false);
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
    <h3>「${esc(s.name || "この技")}」に動画を紐づけ</h3>
    <div class="sheet-sub">タップで紐づけ / ▶で動画を確認</div>
    ${tricks.map((t) => `
      <div class="pick-trick-row" onclick="linkTrickToStep(${i},'${t.id}')">
        <span class="nm">${esc(t.name)}</span>
        <span class="kn">${fmtTime(t.duration)}</span>
        <button class="mini-btn play" onclick="event.stopPropagation();playTrickVideo('${t.id}',${i})">▶</button>
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
  if (!s.name.trim()) s.name = t.name;
  hideSheet(); render();
  toast(`「${t.name}」の動画を紐づけました`);
};
window.unlinkTrickFromStep = (i) => {
  const s = draft && draft.steps[i];
  if (!s) return hideSheet();
  if (miniVideo && miniVideo.stepId === s.id) miniVideoCloseSilent();
  delete s.trickId;
  hideSheet(); render();
  toast("紐づけを解除しました");
};

window.trickPlay = async (id) => {
  if (trickPlayingId === id) { trickPlayingId = null; render(); return; }
  const blob = await blobGet(id);
  if (!blob) return toast("動画データが見つかりません");
  trickPlayingId = id;
  render();
  if (trickObjUrl) URL.revokeObjectURL(trickObjUrl);
  trickObjUrl = URL.createObjectURL(blob);
  const v = document.getElementById("trick-video");
  if (v) { v.src = trickObjUrl; bindTrimVideo(v, state.tricks.find((x) => x.id === id)); }
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
let trimDraft = null; // { id, start, end, full }
window.sheetTrimTrick = async (id) => {
  const t = (state.tricks || []).find((x) => x.id === id);
  if (!t) return;
  const blob = await blobGet(t.blobId);
  if (!blob) return toast("動画データが見つかりません");
  musicPlayer.pause(); // カット中は曲を止める(編集画面から開いた場合)
  if (trimUrl) URL.revokeObjectURL(trimUrl);
  trimUrl = URL.createObjectURL(blob);
  const full = t.fullDuration != null ? t.fullDuration : t.duration;
  trimDraft = { id, start: t.trimStart || 0, end: t.trimEnd != null ? t.trimEnd : full, full };
  showSheet(trimSheetHtml());
  const v = document.getElementById("trim-video");
  if (v) {
    v.addEventListener("timeupdate", () => {
      if (!trimDraft) return;
      if (v.currentTime >= trimDraft.end - 0.03 || v.currentTime < trimDraft.start - 0.1) {
        v.currentTime = trimDraft.start; if (v.paused) v.play().catch(() => {});
      }
    });
    v.addEventListener("loadedmetadata", () => { try { v.currentTime = trimDraft.start; } catch (_) {} });
  }
};
function trimSheetHtml() {
  const d = trimDraft;
  const left = d.full ? (d.start / d.full) * 100 : 0;
  const w = d.full ? Math.max(1, ((d.end - d.start) / d.full) * 100) : 0;
  return `
    <h3>長さを調整</h3>
    <div class="sheet-sub">動画を再生しながら「今の位置」で始点・終点を決めます</div>
    <video id="trim-video" class="trick-video" style="margin-top:0" src="${trimUrl}" controls autoplay playsinline></video>
    <div class="ci-bar part-band-bar"><div class="range" id="trim-bar" style="left:${left}%;width:${w}%"></div></div>
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
    <button class="btn ghost" onclick="hideSheet()">キャンセル</button>`;
}
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
  if (!confirm(`「${t.name}」を削除しますか?(元に戻せません)`)) return;
  await blobDel(id);
  state.tricks = state.tricks.filter((x) => x.id !== id);
  if (trickPlayingId === id) trickPlayingId = null;
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
    v.onloadedmetadata = () => { const d = v.duration; URL.revokeObjectURL(url); resolve(isFinite(d) ? d : null); };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    v.src = url;
  });
}
async function saveTrick(blob, duration, defaultName) {
  const id = uid();
  if (!(await blobPut(id, blob))) return toast("動画を保存できませんでした");
  state.tricks.push({ id, name: defaultName, blobId: id, duration, fullDuration: duration,
    trimStart: 0, trimEnd: duration, size: blob.size, createdAt: Date.now() });
  saveState();
  go("tricks");
  setTimeout(() => sheetRenameTrick(id), 80); // 保存直後に名前を付けさせる
}
window.trickImport = async (input) => {
  const file = input.files[0];
  input.value = "";
  if (!file) return;
  if (file.size > TRICK_MAX_BYTES) return toast(`${fmtBytes(TRICK_MAX_BYTES)}以下の動画にしてください(現在${fmtBytes(file.size)})`);
  const dur = await probeVideoDuration(file);
  if (dur == null) return toast("動画を読み込めませんでした");
  if (dur > TRICK_MAX_SEC + 0.5) return toast(`技は最大${TRICK_MAX_SEC}秒です(この動画は${fmtTime(dur)})。トリミングしてから登録してください`);
  await saveTrick(file, dur, file.name.replace(/\.[^.]+$/, "") || "新しい技");
};

// --- アプリ内カメラ撮影(720p固定=容量対策、10秒で自動停止) ---
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
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
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
  const rec = mime
    ? new MediaRecorder(trickCam.stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 })
    : new MediaRecorder(trickCam.stream, { videoBitsPerSecond: 2_500_000 });
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
  await saveTrick(blob, dur, `技 ${new Date().toLocaleDateString("ja-JP")}`);
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
        <span class="sub">${trickCam && trickCam.recording ? `${TRICK_MAX_SEC}秒で自動停止` : "720pで撮影されます"}</span>
      </button>`}`;
}

// ========== 構成ビルダー(RDB-05③: 技を音楽タイムラインに配置してルーティンを組む) ==========
// 作業内容は state.builder に永続化(1ワークスペース)。書き出すと通常のルーティンになる
function builderState() {
  if (!state.builder) state.builder = { music: null, items: [] };
  return state.builder;
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
const fmtCue = (sec) => sec % 1 ? fmtTimeFine(sec) : fmtTime(sec);
function builderStarts(b) { let t = 0; return b.items.map((x) => { const s = t; t += x.duration; return s; }); }
function builderTotal(b) { return round1(b.items.reduce((a, x) => a + x.duration, 0)); }

async function loadBuilderMusic() {
  const b = builderState();
  if (!b.music) return;
  musicMissing = false;
  const blob = await blobGet(b.music.blobId);
  if (!blob) { musicMissing = true; musicLoadedFor = "builder"; if (view.name === "builder") render(); return; }
  if (musicObjectUrl) URL.revokeObjectURL(musicObjectUrl);
  musicObjectUrl = URL.createObjectURL(blob);
  musicPlayer.src = musicObjectUrl;
  musicLoadedFor = "builder";
  if (view.name === "builder") render();
  musicPlayer.addEventListener("loadedmetadata", () => {
    if (view.name === "builder") render(); // タイムライン帯の縮尺に曲の長さが必要
  }, { once: true });
}
window.builderAttachMusic = async (input) => {
  const file = input.files[0];
  input.value = "";
  if (!file) return;
  if (file.size > 40 * 1024 * 1024) return toast("40MB以下の音源にしてください");
  const b = builderState();
  const blobId = uid();
  if (!(await blobPut(blobId, file))) return toast("音源を保存できませんでした");
  if (b.music) blobDel(b.music.blobId);
  b.music = { blobId, name: file.name };
  musicLoadedFor = null;
  saveState();
  loadBuilderMusic();
};
window.builderPickTrick = () => {
  const tricks = (state.tricks || []).slice().sort((a, b2) => b2.createdAt - a.createdAt);
  if (!tricks.length) {
    return showSheet(`
      <h3>技を配置</h3>
      <div class="empty">技ライブラリが空です。<br>先に技を撮影・登録してください。</div>
      <button class="btn" onclick="hideSheet();go('tricks')">技ライブラリへ</button>
      <button class="btn ghost" onclick="hideSheet()">閉じる</button>`);
  }
  showSheet(`
    <h3>技を配置</h3>
    <div class="sheet-sub">タップで末尾に追加 / ▶で動画を確認</div>
    ${tricks.map((t) => `
      <div class="pick-trick-row" onclick="builderAddTrick('${t.id}')">
        <span class="nm">${esc(t.name)}</span>
        <span class="kn">${t.duration.toFixed(1)}s</span>
        <button class="mini-btn play" onclick="event.stopPropagation();playTrickVideo('${t.id}')">▶</button>
      </div>`).join("")}
    <div style="height:10px"></div>
    <button class="btn ghost" onclick="hideSheet()">閉じる</button>`);
};
window.builderAddTrick = (trickId) => {
  const t = (state.tricks || []).find((x) => x.id === trickId);
  if (!t) return;
  builderState().items.push({ id: uid(), trickId: t.id, name: t.name, duration: round1(t.duration) });
  saveState(); hideSheet(); render();
};
window.builderAddGap = () => {
  builderState().items.push({ id: uid(), trickId: null, name: "間", duration: 2 });
  saveState(); render();
};
window.builderAdjDur = (i, d) => {
  const item = builderState().items[i];
  item.duration = Math.max(0.5, round1(item.duration + d));
  saveState(); render();
};
window.builderMove = (i, d) => {
  const items = builderState().items;
  const [x] = items.splice(i, 1);
  items.splice(i + d, 0, x);
  saveState(); render();
};
window.builderDel = (i) => { builderState().items.splice(i, 1); saveState(); render(); };
window.builderSeekItem = (i) => {
  const b = builderState();
  if (!b.music || musicLoadedFor !== "builder" || musicMissing) return;
  musicPlayer.currentTime = builderStarts(b)[i];
  ensureAudioGraph();
  musicPlayer.play();
};
window.builderClearAsk = () => {
  if (!confirm("タイムラインを空にしますか?(音源は残ります)")) return;
  builderState().items = [];
  saveState(); render();
};
// 再生位置に合わせて現在の技をハイライト(再描画せずDOMだけ更新)
function builderTickUI() {
  const b = state.builder;
  if (!b) return;
  const cur = musicPlayer.currentTime;
  const starts = builderStarts(b);
  let active = -1;
  for (let i = 0; i < b.items.length; i++) {
    if (cur >= starts[i] && cur < starts[i] + b.items[i].duration) { active = i; break; }
  }
  document.querySelectorAll(".bi-row").forEach((el, i) => el.classList.toggle("current", i === active));
  const ph = document.getElementById("tl-playhead");
  if (ph && isFinite(musicPlayer.duration) && musicPlayer.duration > 0) {
    ph.style.left = `${Math.min(100, (cur / musicPlayer.duration) * 100)}%`;
  }
  const now = document.getElementById("b-now");
  if (now) now.textContent = active >= 0 ? b.items[active].name : "";
}
window.builderExportAsk = () => {
  const b = builderState();
  if (b.items.length < 2) return toast("ステップを2つ以上配置してください");
  showSheet(`
    <h3>ルーティンとして書き出し</h3>
    <div class="sheet-sub">通し練習・分析ができる通常のルーティンになります(タイムラインは残ります)</div>
    <input type="text" id="builder-name" value="新ルーティン ${today()}">
    <div style="height:14px"></div>
    <button class="btn primary" onclick="builderExport()">書き出す</button>
    <button class="btn ghost" onclick="hideSheet()">キャンセル</button>`);
};
window.builderExport = async () => {
  const b = builderState();
  const name = document.getElementById("builder-name").value.trim() || `新ルーティン ${today()}`;
  let music = null;
  if (b.music) {
    const blob = await blobGet(b.music.blobId);
    if (blob) { const bid = uid(); if (await blobPut(bid, blob)) music = { blobId: bid, name: b.music.name }; }
  }
  const starts = builderStarts(b);
  const steps = b.items.map((it, i) => it.trickId
    ? { id: uid(), name: it.name, kind: "trick", risk: 3, trickId: it.trickId, cue: round1(starts[i]) }
    : { id: uid(), name: it.name, kind: "transition", risk: 2, cue: round1(starts[i]) });
  state.routines.push({ id: uid(), name, music,
    versions: [{ id: uid(), createdAt: Date.now(), steps }] });
  saveState(); hideSheet(); go("routines");
  toast(`「${name}」を作成しました`);
};

function renderBuilder() {
  const b = builderState();
  if (b.music && musicLoadedFor !== "builder") setTimeout(loadBuilderMusic, 0);
  const songDur = musicLoadedFor === "builder" && isFinite(musicPlayer.duration) ? musicPlayer.duration : null;
  const starts = builderStarts(b);
  const total = builderTotal(b);
  const over = songDur && total > songDur + 0.5;

  // タイムラインバー(曲の長さに対する各技の帯)
  const base = songDur || Math.max(total, 1);
  const segs = b.items.map((it, i) => {
    const left = (starts[i] / base) * 100;
    const w = Math.max(0.5, (it.duration / base) * 100);
    return `<div class="tl-seg ${it.trickId ? "" : "gap"}" style="left:${left}%;width:${Math.min(w, 100 - left)}%" title="${esc(it.name)}"></div>`;
  }).join("");

  const rows = b.items.map((it, i) => `
    <div class="bi-row" onclick="builderSeekItem(${i})">
      <span class="bi-time">♪${fmtTime(starts[i])}</span>
      <span class="nm">${it.trickId ? "" : "␣ "}${esc(it.name)}</span>
      <span class="kn">${it.duration.toFixed(1)}s</span>
      ${it.trickId
        ? `<button class="mini-btn play" onclick="event.stopPropagation();playTrickVideo('${it.trickId}')">▶</button>`
        : `<button class="mini-btn" onclick="event.stopPropagation();builderAdjDur(${i},-0.5)">−</button>
           <button class="mini-btn" onclick="event.stopPropagation();builderAdjDur(${i},0.5)">＋</button>`}
      <button class="mini-btn" onclick="event.stopPropagation();builderMove(${i},-1)" ${i === 0 ? "disabled" : ""}>↑</button>
      <button class="mini-btn" onclick="event.stopPropagation();builderMove(${i},1)" ${i === b.items.length - 1 ? "disabled" : ""}>↓</button>
      <button class="mini-btn del" onclick="event.stopPropagation();builderDel(${i})">✕</button>
    </div>`).join("");

  return `
    <div class="topbar"><button class="back-btn" onclick="go('routines')">戻る</button>
      <h1>タイムラインで組む</h1></div>
    <div class="card music-card">
      ${b.music ? (musicMissing && musicLoadedFor === "builder"
        ? `<div class="hint">♪ 音源データが見つかりません。再添付してください。</div>
           <button class="btn small" onclick="document.getElementById('builder-music').click()">音源を添付</button>`
        : `<div class="music-name">♪ ${esc(b.music.name)}</div>
           <div class="music-time big"><span id="music-cur">${fmtTimeFine(musicPlayer.currentTime)}</span><span class="dur"> / <span id="music-dur">${fmtTime(musicPlayer.duration)}</span></span></div>
           <div class="tl-bar">${segs}<div id="tl-playhead"></div></div>
           <div class="b-now-line" id="b-now"></div>
           <input type="range" id="music-seek" min="0" max="100" step="0.1" value="0" oninput="musicSeek(this.value)">
           <div class="music-controls">
             <button class="music-pill primary" id="music-toggle-pill" onclick="ensureAudioGraph();musicToggle()">▶ 再生</button>
             <button class="music-pill" onclick="musicStop()">■ 停止</button>
           </div>`)
      : `<button class="btn small" onclick="document.getElementById('builder-music').click()">＋ 音源を添付(MP3等)</button>`}
      <input type="file" id="builder-music" accept="audio/*" class="hidden" onchange="builderAttachMusic(this)">
    </div>
    <div class="card">
      <h2>構成 (合計 ${fmtTime(total)}${songDur ? ` / 曲 ${fmtTime(songDur)}` : ""})${over ? ` <span style="color:var(--danger)">曲より長い</span>` : ""}</h2>
      ${rows || `<div class="empty">「＋ 技を配置」で技ライブラリから並べていきます。<br>行をタップするとその技の曲位置から再生されます。</div>`}
      <div class="row-2" style="margin:12px 0 10px">
        <button class="btn small" onclick="builderPickTrick()">＋ 技を配置</button>
        <button class="btn small ghost" onclick="builderAddGap()">＋ 間(2秒)</button>
      </div>
    </div>
    <button class="btn primary" onclick="builderExportAsk()">ルーティンとして書き出す</button>
    ${b.items.length ? `<button class="btn ghost" onclick="builderClearAsk()">タイムラインを空にする</button>` : ""}`;
}

// ========== 使い方(UIから追い出した説明の集約先) ==========
function renderHelp() {
  return `
    <div class="topbar"><button class="back-btn" onclick="go('home')">戻る</button><h1>使い方</h1></div>
    <div class="card">
      <h2>このアプリ</h2>
      <div class="help-body">通し練習を「クリーン1タップ / 失敗1タップ」で記録して、ルーティンの<b>どこで落ちるか</b>の偏りを見るためのアプリです。ルーティン一覧の行を左にスワイプすると削除できます。</div>
    </div>
    <div class="card">
      <h2>通し練習の流れ</h2>
      <div class="help-body">
        1. セッション開始(体調と条件メモ)<br>
        2. 通しがノーミスなら「クリーン」を1タップ<br>
        3. 失敗したら、落ちた技をタップ → 種類を選ぶ(初期値: ドロップして中止)。中止なら前の技まで成功・後ろは未到達として自動処理。復帰して続けたら最後に「完走」<br>
        4. 終わったら「セッション終了」で振り返りと「次回試すこと」をメモ → 次回の開始時に表示されます
      </div>
    </div>
    <div class="card">
      <h2>楽曲と録音</h2>
      <div class="help-body">編集画面で音源(MP3等)を添付すると、通し練習中に再生できます。<b>失敗をタップした瞬間の曲位置(♪1:23)が自動で記録</b>され、曲は自動停止。クリーン/中止を記録すると曲は頭に戻るので、次の通しは▶を押すだけです。<br><br>「● 練習を録音する」でマイク録音もできます。録音中の失敗タップには録音内の位置が付き、分析画面から失敗の3秒前にジャンプして聴き返せます。<br><br>音源・録音はこの端末のブラウザ内にのみ保存され、JSONバックアップには含まれません。残したい録音は分析画面の「↓」で書き出せます。</div>
    </div>
    <div class="card">
      <h2>パート練習</h2>
      <div class="help-body">楽曲のA点→B点をループ再生する練習モード。曲を再生しながら「今の位置」でA/Bを決めて、ループON。Bに達すると自動でAに戻ります。区間はルーティンに保存されます。<br><br>パート練習の結果は分析に入りません(通しと条件が違うため)。失敗を記録したいときは通し練習で。</div>
    </div>
    <div class="card">
      <h2>ステップの登録(編集画面)</h2>
      <div class="help-body"><b>移行</b> = 持ち替え・立ち位置移動・視線移動など。失敗は技そのものではなく移行で起きることも多いので、怪しい箇所は移行もステップに入れると分析対象になります。<br><br><b>リスク度(1〜5)</b> = 「この技はどれくらい失敗しそうか」という自分の事前予想。実際の失敗率とのズレ(思い込みと結果の乖離)が分析に表示されます。結果を見て数字を合わせに行くとズレが消えるので、基本は最初の感覚のまま。<br><br><b>♪何秒(キュー)</b> = 技名の右の欄に「1:23」や「83」と入れると、その技を曲のどこに入れるかの目標を指定できます。<b>♪欄を横にスライドすると0.1秒刻みで微調整</b>できます(タップすればキーボード入力)。音源があれば編集画面上部のプレイヤーで曲を流せて、再生位置に合わせて「いまこのへん」のステップが緑に光ります(通し練習でも同様)。順番と秒指定が時系列的に矛盾していると保存できません。タイムラインから書き出したルーティンには自動で入ります。<br><br><b>A/B化</b> = 調子で技を入れ替える箇所は「選択スロット」にできます。通し練習画面のチップでいつでも切替でき、選択肢ごとに失敗率が分かれて集計されます。<br><br>記録済みの通しがある状態で構成(技名・順序・種別・選択肢)を変えると新しいバージョンが作られ、分析は分かれます。条件の違うデータを混ぜないためです。リスク度の変更では分かれません。「複製」は好調版/安牌版のように別ルーティンとして育てたいときに(記録は引き継ぎません)。</div>
    </div>
    <div class="card">
      <h2>分析の数字の読み方</h2>
      <div class="help-body">「2/6 (9〜65%)」= そのステップに到達した6本中2回失敗、真の失敗率の95%区間は9〜65%。<b>本数が少ないうちは幅が広い=まだ断定できない</b>という意味です。0/3は「失敗率0%」ではありません。<br><br>分母は全通し数ではなく「そのステップに到達した通し数」です(途中で中止した通しは、その先のステップの分母に入りません)。<br><br>色付きチップは自分で付けたリスク度。実際の失敗率とズレている技には注意書きが出ます(到達8本以上)。<br><br>このアプリが示すのは「どこに偏りがあるか」まで。「なぜか」(直前の大技のせい等)は、順序を変えた比較実験で確かめる必要があります。</div>
    </div>
    <div class="card">
      <h2>記録の編集と削除</h2>
      <div class="help-body">分析→「セッション履歴・メモを見る」から、タグ・メモはいつでも編集できます。通しの成否そのものは書き換えられません。間違えた通しは「集計から除外」して記録し直してください(除外は分析に件数表示され、いつでも戻せます)。スロットの選択の記録し損ねも履歴から直せます。</div>
    </div>
    <div class="card">
      <h2>技ライブラリ</h2>
      <div class="help-body">技を最大10秒の動画クリップとして貯めておく場所です(ホームの「技ライブラリ」)。アプリ内カメラ(720p・10秒で自動停止)で撮るか、撮ってある動画を登録します。10秒を超える動画は登録できないので、先にトリミングしてください。名前はタップで変更できます。各技の<b>「長さ」</b>ボタンから、始点・終点を決めて<b>動画の使う区間を後からいつでも調整</b>できます(前後の余分をカット)。<br><br>ルーティン編集の「＋ 技リストから」でライブラリの技をステップとして追加できます。手で入力した技にも<b>🔗</b>でライブラリの動画を後から紐づけられます(🔗のシートから解除も可能)。<br><br>紐づいた技は各画面の<b>▶</b>からワンタップで動画を確認できます。編集画面では▶を押すと<b>画面上部に小さくループ再生</b>され、スクロールしても残るので、動画を見ながら順番やリスク度を調整できます(もう一度▶で閉じる)。編集画面の<b>✂</b>(行または上部ドック)から、その場で動画の長さ(始点・終点)も調整できます。通し練習では▶を押しても失敗記録にはなりません。<br><br>将来的には、この技リストを音楽のタイムラインに並べてルーティンを組み立てる機能につなげる予定です。</div>
    </div>
    <div class="card">
      <h2>タイムラインで組む(構成ビルダー)</h2>
      <div class="help-body">ルーティン一覧の「♪ タイムラインで組む」から。音源を添付し、技ライブラリの技を順に配置すると、<b>各技が曲の何分何秒に当たるか</b>が自動で計算されます。技と技の間には「間」(長さ調整可)を挟めます。<br><br>再生すると緑のプレイヘッドがタイムライン上を動き、いま曲のどこ=どの技かがハイライトされます。行をタップするとその技の曲位置から再生。<br><br>組み上がったら「ルーティンとして書き出す」で通常のルーティンになり、そのまま通し練習・分析に使えます(タイムラインの作業内容は残ります)。</div>
    </div>
    <div class="card">
      <h2>データの保存</h2>
      <div class="help-body">データはこの端末のブラウザ内に保存されます。iPhoneは長期間使わないと保存データを消すことがあるため、<b>定期的に設定からJSONバックアップを書き出してください</b>。機種変更時もJSONで移行できます(音声は含まれないため楽曲は再添付)。</div>
    </div>`;
}

// ========== 設定(バックアップ) ==========
function renderSettings() {
  const runTotal = state.sessions.reduce((a, s) => a + s.runs.length, 0);
  return `
    <div class="topbar"><button class="back-btn" onclick="go('home')">戻る</button><h1>設定 / バックアップ</h1></div>
    <div class="card">
      <h2>データ</h2>
      <div class="bd-row"><span class="k">ルーティン</span><span class="v">${state.routines.length}</span></div>
      <div class="bd-row"><span class="k">セッション</span><span class="v">${state.sessions.length}</span></div>
      <div class="bd-row"><span class="k">通し合計</span><span class="v">${runTotal}本</span></div>
    </div>
    <div class="card">
      <h2>バックアップ</h2>
      <button class="btn" onclick="exportJson()">JSONバックアップを書き出す</button>
      <button class="btn" onclick="document.getElementById('import-file').click()">JSONから復元する</button>
      <input type="file" id="import-file" accept=".json" class="hidden" onchange="importJson(this)">
      <button class="btn ghost" onclick="exportCsv()">CSVエクスポート(表計算用)</button>
      <p class="hint">iPhoneは長期間使わないと保存データを消すことがあります。定期的にJSONを書き出してください(音声は含まれません)。</p>
    </div>
    <button class="btn" onclick="go('help')">使い方を見る</button>`;
}

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
window.importJson = (input) => {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.routines) || !Array.isArray(data.sessions)) throw new Error("bad format");
      if (!confirm("現在のデータをバックアップの内容で置き換えます。よいですか?")) return;
      state = data; saveState(); render(); toast("復元しました");
    } catch (_) { toast("読み込めませんでした(形式が違います)"); }
  };
  reader.readAsText(file);
  input.value = "";
};
window.exportCsv = () => {
  const rows = [["date", "routine", "version", "feeling", "session_note", "run_no", "outcome", "reached_step", "excluded", "run_choices", "step_no", "step_name", "step_risk", "event_type", "hypothesis_tags", "event_note", "music_time_sec", "rec_time_sec"]];
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
      if (!run.events.length) rows.push([...base, "", "", "", "", "", "", "", ""]);
      for (const e of run.events) {
        const st = ver.steps[e.stepIndex];
        const opt = st && isSlot(st) && e.optionId ? st.options.find((o) => o.id === e.optionId) : null;
        const stName = st ? (opt ? `${stepLabel(st)}→${opt.name}` : stepLabel(st)) : "?";
        const stRisk = st ? (opt ? (opt.risk || 3) : (st.risk || 3)) : "";
        rows.push([...base, e.stepIndex + 1, stName, stRisk, e.type, (e.tags || []).join(";"), e.note,
          e.musicTime != null ? e.musicTime.toFixed(1) : "", e.recTime != null ? e.recTime.toFixed(1) : ""]);
      }
    });
  }
  download(`routine-debugger-${today()}.csv`, "﻿" + rows.map((r) => r.map(q).join(",")).join("\n"), "text/csv");
  toast("CSVを書き出しました");
};

// ---------- 起動 ----------
window.go = go;
loadState().then(() => render());
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
