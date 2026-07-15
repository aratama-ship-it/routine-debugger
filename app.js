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
const LOADS = ["low", "mid", "high"];
const LOAD_LABEL = { low: "負荷低", mid: "負荷中", high: "負荷高" };
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
async function loadState() {
  db = await openDb();
  if (db) {
    const loaded = await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly").objectStore(STORE).get("state");
      tx.onsuccess = () => resolve(tx.result || null);
      tx.onerror = () => resolve(null);
    });
    if (loaded) { state = loaded; return; }
  }
  try {
    const raw = localStorage.getItem("rd_state");
    if (raw) state = JSON.parse(raw);
  } catch (_) { /* 初回 */ }
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

function versionStats(routine, versionId) {
  const ver = getVersion(routine, versionId);
  const runs = runsOfVersion(routine.id, versionId);
  const total = runs.length;
  const clean = runs.filter((r) => r.outcome === "clean").length;
  // ステップ別: 到達数を分母にする(全通し数ではない)
  const steps = ver.steps.map((st, i) => {
    const reached = runs.filter((r) => r.reachedIndex >= i).length;
    const failRuns = runs.filter((r) => r.events.some((e) => e.stepIndex === i)).length;
    return { step: st, index: i, reached, failed: failRuns, ci: wilson(failRuns, reached) };
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
  return { ver, runs, total, clean, cleanCi: wilson(clean, total), steps, recov, fails, byRunNo, byFeeling, tagCount };
}

// ---------- シート/トースト ----------
function showSheet(html) {
  $sheet.innerHTML = `<div class="grabber"></div>` + html;
  $sheet.classList.remove("hidden");
  $backdrop.classList.remove("hidden");
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
  if (view.name === "record") render();
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
  if (view.name === "stats" && name !== "stats") recPlayer.pause();
  view = { name, params }; render(); window.scrollTo(0, 0);
}

function render() {
  const r = { home: renderHome, edit: renderEdit, record: renderRecord, stats: renderStats, settings: renderSettings }[view.name];
  $app.innerHTML = r ? r() : renderHome();
}

// ========== ホーム ==========
function renderHome() {
  const rows = state.routines.map((rt) => {
    const ver = latestVersion(rt);
    const runCount = state.sessions.filter((s) => s.routineId === rt.id).reduce((a, s) => a + s.runs.length, 0);
    return `<div class="routine-row">
      <div class="name">${esc(rt.name)}
        <span class="meta">${ver.steps.length}ステップ / v${rt.versions.length} / 通し${runCount}本</span></div>
      <div class="actions">
        <button class="btn small primary" onclick="go('record',{id:'${rt.id}'})">記録</button>
        <button class="btn small" onclick="go('stats',{id:'${rt.id}'})">統計</button>
        <button class="btn small ghost" onclick="go('edit',{id:'${rt.id}'})">編集</button>
      </div>
    </div>`;
  }).join("");
  return `
    <div class="topbar"><h1>ルーティン・デバッガ</h1>
      <button class="nav-action" onclick="go('settings')">設定</button></div>
    <div class="card">
      <h2>ルーティン</h2>
      ${rows || `<div class="empty">まだルーティンがありません。<br>技と移行を順番に登録するところから始めます。</div>`}
    </div>
    <button class="btn" onclick="go('edit',{})">＋ 新規ルーティン</button>
    <p class="hint">β版: 通し練習(ラン)を「クリーン1タップ / 失敗1タップ」で記録し、どこで落ちるかの偏りを見るためのアプリです。</p>`;
}

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
  const stepRows = draft.steps.map((s, i) => `
    <div class="editor-step">
      <div class="es-row1">
        <span class="no">${i + 1}</span>
        <input type="text" value="${esc(s.name)}" placeholder="${s.kind === "transition" ? "移行(例: 持ち替え)" : "技名"}"
          onchange="draft.steps[${i}].name=this.value">
      </div>
      <div class="es-row2">
        <button class="kind-toggle ${s.kind === "trick" ? "t" : ""}" onclick="toggleKind(${i})">${s.kind === "trick" ? "技" : "移行"}</button>
        <button class="load-toggle load-${s.load}" onclick="toggleLoad(${i})">${LOAD_LABEL[s.load]}</button>
        <span class="es-spacer"></span>
        <button class="mini-btn" onclick="moveStep(${i},-1)" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="mini-btn" onclick="moveStep(${i},1)" ${i === draft.steps.length - 1 ? "disabled" : ""}>↓</button>
        <button class="mini-btn del" onclick="delStep(${i})">✕</button>
      </div>
    </div>`).join("");
  return `
    <div class="topbar"><button class="back-btn" onclick="draft=null;go('home')">戻る</button>
      <h1>${rt ? "ルーティン編集" : "新規ルーティン"}</h1></div>
    <div class="card">
      <label class="fld">ルーティン名</label>
      <input type="text" value="${esc(draft.name)}" placeholder="例: 2026ステージ用 4分" onchange="draft.name=this.value">
    </div>
    <div class="card">
      <h2>ステップ(技と移行) — 上から実施順</h2>
      ${stepRows || `<div class="empty">「＋ 技」で最初の技を追加</div>`}
      <div class="row-2" style="margin-top:12px">
        <button class="btn small" onclick="addStep('trick')">＋ 技</button>
        <button class="btn small ghost" onclick="addStep('transition')">＋ 移行</button>
      </div>
      <p class="hint">「移行」= 持ち替え・立ち位置移動・視線移動など。失敗は技そのものではなく移行で起きることも多いので、怪しい箇所は移行もステップとして入れておくと分析対象になります。負荷(低/中/高)は本人の事前予想です。あとで結果を見て変えないこと(後付け説明になるため)。</p>
    </div>
    <div class="card">
      <h2>楽曲(任意)</h2>
      ${draft._newMusicFile || draft.music
        ? `<div class="bd-row"><span class="k">♪ ${esc(draft._newMusicFile ? draft._newMusicFile.name : draft.music.name)}</span>
             <button class="btn small danger-ghost" onclick="removeMusic()">削除</button></div>`
        : `<button class="btn small" onclick="document.getElementById('music-file').click()">＋ 音源を添付(MP3等)</button>`}
      <input type="file" id="music-file" accept="audio/*" class="hidden" onchange="attachMusic(this)">
      <p class="hint">曲に合わせて演技する場合に添付。記録画面で再生でき、失敗をタップした瞬間の曲位置(♪1:23など)が一緒に記録されます。音源はこの端末のブラウザ内にのみ保存され、JSONバックアップには含まれません。</p>
    </div>
    <button class="btn primary" onclick="saveRoutine()">保存</button>
    ${rt ? `<p class="hint">※ 記録済みの通しがある状態でステップ構成を変えると、新しいバージョン(v${rt.versions.length + 1})が作られ、統計は分かれます。順序や構成が違うデータを混ぜると条件付きの失敗率が壊れるためです。</p>` : ""}`;
}
window.toggleKind = (i) => { draft.steps[i].kind = draft.steps[i].kind === "trick" ? "transition" : "trick"; render(); };
window.toggleLoad = (i) => { const s = draft.steps[i]; s.load = LOADS[(LOADS.indexOf(s.load) + 1) % LOADS.length]; render(); };
window.moveStep = (i, d) => { const [s] = draft.steps.splice(i, 1); draft.steps.splice(i + d, 0, s); render(); };
window.delStep = (i) => { draft.steps.splice(i, 1); render(); };
window.addStep = (kind) => { draft.steps.push({ id: uid(), name: "", kind, load: kind === "transition" ? "low" : "mid" }); render(); };

const stepsSignature = (steps) => steps.map((s) => `${s.name}|${s.kind}|${s.load}`).join("//");

window.attachMusic = (input) => {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 40 * 1024 * 1024) { input.value = ""; return toast("40MB以下の音源にしてください"); }
  draft._newMusicFile = file;
  input.value = "";
  render();
};
window.removeMusic = () => { draft._newMusicFile = null; draft.music = null; render(); };

// 添付/削除の差分を音声Blobストアに反映し、routine.musicメタを返す
async function applyMusicChange(prevMusic) {
  if (draft._newMusicFile) {
    const blobId = uid();
    const ok = await blobPut(blobId, draft._newMusicFile);
    if (!ok) { toast("音源を保存できませんでした(音源なしで保存します)"); return prevMusic || null; }
    if (prevMusic) blobDel(prevMusic.blobId);
    return { blobId, name: draft._newMusicFile.name };
  }
  if (!draft.music && prevMusic) { blobDel(prevMusic.blobId); return null; }
  return draft.music || null;
}

window.saveRoutine = async () => {
  draft.steps = draft.steps.filter((s) => s.name.trim());
  if (!draft.name.trim()) return toast("ルーティン名を入れてください");
  if (draft.steps.length < 2) return toast("ステップを2つ以上登録してください");
  if (draft.id) {
    const rt = state.routines.find((r) => r.id === draft.id);
    rt.name = draft.name.trim();
    rt.music = await applyMusicChange(rt.music);
    if (musicLoadedFor === rt.id) musicLoadedFor = null; // 次回記録画面で再ロード
    const cur = latestVersion(rt);
    const changed = stepsSignature(cur.steps) !== stepsSignature(draft.steps);
    const hasRuns = state.sessions.some((s) => s.versionId === cur.id && s.runs.length > 0);
    if (changed && hasRuns) {
      rt.versions.push({ id: uid(), createdAt: Date.now(), steps: draft.steps });
      toast(`構成が変わったので v${rt.versions.length} を作成しました(統計は分かれます)`);
    } else if (changed) {
      cur.steps = draft.steps;
    }
  } else {
    const music = await applyMusicChange(null);
    state.routines.push({ id: uid(), name: draft.name.trim(), music,
      versions: [{ id: uid(), createdAt: Date.now(), steps: draft.steps }] });
  }
  saveState(); draft = null; go("home");
};

// ========== 記録 ==========
function activeSession(routineId) {
  return state.sessions.find((s) => s.routineId === routineId && !s.endedAt);
}

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
           </div>
           <div class="hint" style="margin-top:8px">使い方: 通しを始めるとき「▶ 再生」(曲は毎回頭から) → 失敗したら下の技をタップ=曲は自動停止し、その瞬間の曲位置が記録されます。クリーン/中止を記録すると曲は自動で頭に戻ります。</div>`}
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
        : `<div class="music-row">
             <button class="btn small" style="flex-shrink:0" onclick="toggleRecording()">● 練習を録音する</button>
             <span class="hint" style="margin:0;flex:1">失敗タップに録音内の位置も残ります</span>
           </div>`}
    </div>`;

  const stepBtns = ver.steps.map((s, i) => {
    const hit = isOpen && openRun.events.some((e) => e.stepIndex === i);
    return `<button class="step-btn ${s.kind}" onclick="tapStep(${i})">
      <span class="no">${i + 1}</span><span class="nm">${esc(s.name)}</span>
      ${hit ? `<span class="badge hit">記録済</span>` : s.load !== "low" ? `<span class="badge load-${s.load}">${LOAD_LABEL[s.load]}</span>` : ""}
    </button>`;
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
  showSheet(`
    <h3>セッション開始</h3>
    <div class="sheet-sub">${esc(rt.name)} / ${today()}</div>
    <div class="tag-label">今日の体調(開始時の主観)</div>
    <div class="segmented" id="feel-grid">
      ${FEELINGS.map((f) => `<button class="choice ${f.v === 2 ? "selected" : ""}" data-v="${f.v}"
        onclick="selectOne('feel-grid',this)">${f.label}</button>`).join("")}
    </div>
    <label class="fld">条件メモ(任意: 会場・道具・風など)</label>
    <input type="text" id="sess-note" placeholder="例: 屋外、やや風あり">
    <div style="height:14px"></div>
    <button class="btn primary" onclick="startSession('${rt.id}')">開始</button>
    <button class="btn ghost" onclick="hideSheet();go('home')">やめる</button>`);
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
  sess.runs.push({ id: uid(), at: Date.now(), outcome: "clean", events: [], reachedIndex: latestVersion(rt).steps.length - 1 });
  musicResetForNextRun();
  saveState(); render(); toast(`クリーン記録 (今日${sess.runs.length}本目)`);
};

window.finishOpenRun = () => {
  const rt = state.routines.find((r) => r.id === view.params.id);
  const sess = activeSession(rt.id);
  if (!openRun || !sess) return;
  sess.runs.push({
    id: uid(), at: Date.now(), outcome: "finished",
    events: openRun.events, reachedIndex: latestVersion(rt).steps.length - 1,
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
  showSheet(`
    <h3>${stepIndex + 1}. ${esc(step.name)}</h3>
    <div class="sheet-sub">何が起きた?(初期値: ドロップして中止)${capBadges ? ` — <b>${capBadges}</b> を記録` : ""}</div>
    <div class="choice-grid" id="type-grid">
      ${EVENT_TYPES.map((t, i) => `<button class="choice ${t.abort ? "abort" : ""} ${i === 0 ? "selected" : ""}"
        data-t="${t.id}" onclick="selectOne('type-grid',this)">${t.label}<span class="d">${t.desc}</span></button>`).join("")}
    </div>
    <div class="tag-label">原因の仮説(任意 — これは観測ではなく本人の推測として保存されます)</div>
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

  if (type.abort) {
    // 中止: 前段は成功扱い(到達済み)、後段は未到達
    const events = (openRun && openRun.routineId === rt.id) ? [...openRun.events, ev] : [ev];
    sess.runs.push({ id: uid(), at: Date.now(), outcome: "aborted", events, reachedIndex: stepIndex });
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
  if (!sess) return go("home");
  if (openRun && openRun.routineId === routineId) {
    return toast("続行中の通しがあります。「完走」か失敗記録で確定してください");
  }
  showSheet(`
    <h3>セッション終了</h3>
    <div class="sheet-sub">今日 ${sess.runs.length} 本 / クリーン ${sess.runs.filter((r) => r.outcome === "clean").length} 本</div>
    <label class="fld">振り返りメモ(任意 — 気づいた仮説など)</label>
    <textarea id="end-note" rows="3" placeholder="例: 3本目以降、腕が重くなってからリング系が怪しい"></textarea>
    <div style="height:14px"></div>
    <button class="btn primary" onclick="endSession('${routineId}')">終了する</button>
    <button class="btn ghost" onclick="hideSheet()">まだ続ける</button>`);
};
window.endSession = async (routineId) => {
  if (recState) await stopRecording(); // 録音中なら先に保存(セッションを閉じる前に)
  const sess = activeSession(routineId);
  sess.endedAt = Date.now();
  const memo = document.getElementById("end-note").value.trim();
  if (memo) sess.note = sess.note ? `${sess.note} / 振り返り: ${memo}` : `振り返り: ${memo}`;
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
      <div class="topbar"><button class="back-btn" onclick="go('home')">戻る</button>
        <h1>${esc(rt.name)} 統計</h1></div>
      ${verSelect}
      <div class="empty">v${verIndex} の通し記録はまだありません。<br>「記録」からクリーン/失敗を記録すると、ここに偏りが表示されます。</div>`;
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
      evidence = `観測不足(到達${s.reached}本) — 件数のみ参考`;
    } else if (s.ci && s.ci[0] > overallFailRate && s.failed >= 2) {
      evidence = "パターン候補 — 偏りあり。ただし直前の技/位置/疲労の影響は未分離";
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
    return `<div class="step-stat ${s.step.kind}">
      <div class="head"><span class="nm">${s.index + 1}. ${esc(s.step.name)}</span>
        <span class="kn">${s.failed}/${s.reached}${s.ci && s.reached ? ` (${pct(s.ci[0])}〜${pct(s.ci[1])}%)` : ""}</span></div>
      ${s.reached ? bar : ""}
      ${timeChips}
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
    <div class="topbar"><button class="back-btn" onclick="go('home')">戻る</button>
      <h1>${esc(rt.name)} 統計</h1><span class="sub">v${verIndex}</span></div>
    ${verSelect}
    ${overview}
    <div class="card">
      <h2>ステップ別の失敗 (分母 = そのステップに到達した通し数)</h2>
      ${stepRows}
      <div class="note-caveat">数字の読み方: 「2/6 (9〜65%)」= 到達6本中2回失敗、真の失敗率の95%区間は9〜65%。本数が少ないうちは幅が広い=まだ断定できない、という意味です。0/3は「失敗率0%」ではありません。</div>
    </div>
    ${recCard}
    <div class="card"><h2>何本目で崩れるか</h2>${bdRows(st.byRunNo)}</div>
    <div class="card"><h2>体調別</h2>${bdRows(st.byFeeling)}</div>
    ${tagRows ? `<div class="card"><h2>原因の仮説タグ(本人の推測の集計 — 客観データではありません)</h2>${tagRows}</div>` : ""}
    <div class="note-caveat">このアプリが示すのは「どこに偏りがあるか」までです。「なぜか」の帰属(例: 直前の大技のせい)は、順序を変えた比較実験で確かめる必要があります(フェーズ2で実装予定)。</div>
    <div style="height:10px"></div>
    <button class="btn" onclick="go('record',{id:'${rt.id}'})">この構成で記録する</button>`;
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
      <p class="hint">重要: iPhoneはしばらく使わないとブラウザ保存データを消すことがあります。データが溜まってきたら定期的にJSONを書き出して保存してください。なお音声(楽曲・練習録音)は容量が大きいためJSONには含まれません。残したい録音は統計画面の「↓」ボタンで個別に書き出せます。</p>
    </div>`;
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
  const rows = [["date", "routine", "version", "feeling", "session_note", "run_no", "outcome", "reached_step", "step_no", "step_name", "event_type", "hypothesis_tags", "event_note", "music_time_sec", "rec_time_sec"]];
  const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  for (const sess of state.sessions) {
    const rt = state.routines.find((r) => r.id === sess.routineId);
    if (!rt) continue;
    const ver = getVersion(rt, sess.versionId);
    const vno = rt.versions.findIndex((v) => v.id === ver.id) + 1;
    sess.runs.forEach((run, i) => {
      const base = [sess.date, rt.name, `v${vno}`, sess.feeling, sess.note, i + 1, run.outcome, run.reachedIndex + 1];
      if (!run.events.length) rows.push([...base, "", "", "", "", "", "", ""]);
      for (const e of run.events) {
        const stName = ver.steps[e.stepIndex] ? ver.steps[e.stepIndex].name : "?";
        rows.push([...base, e.stepIndex + 1, stName, e.type, (e.tags || []).join(";"), e.note,
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
