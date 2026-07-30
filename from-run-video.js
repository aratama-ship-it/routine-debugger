/* ルーティンノート — 保存した演技映像から構成を起こす
 *
 * 新しいルーティンを作るとき、いちばん確実な資料は「すでに撮ってある自分の通し」である。
 * 映像を見ながら区切りでキューを打てば、順番も長さも曲位置も一度に決まる。
 * 名前を思い出しながら手で並べるより速く、実際の演技とずれない。
 *
 * 流れ:
 *   新規ルーティン(名前を決める) → 編集画面。まだ何も無いときだけ入口が出る
 *   → 保存済みの演技映像を選ぶ → 再生しながら区切りでキューを打つ
 *   → 決定すると、区間ごとにステップができる
 *      同時に、その区間を参照するシーケンスがライブラリにも入る
 *
 * 映像は切り出さない。元の1本を参照し、区間(trimStart/trimEnd)だけを持つ。
 * 一括カットと同じ考え方で、端末の容量を食わずに済む。
 *
 * app.js が容量上限に近いため、UIも処理もここに置く。
 */
(() => {
  "use strict";

  const en = () => (typeof isEnglish === "function" ? isEnglish() : false);
  const t = (ja, eng) => (en() ? eng : ja);

  // 打ったキュー(秒)。昇順で保つ
  let marks = [];
  let sourceVideo = null;   // state.runVideos の1件、または端末から選んだ映像
  let objectUrl = null;
  // 端末から取り込んだ映像は、決定するまで宙に浮いている。
  // やめたときに消さないと、参照のないデータが端末に残り続ける。
  let 未確定のblobId = null;

  const videoEl = () => document.getElementById("frv-video");

  function cleanup() {
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    if (未確定のblobId) { blobDel(未確定のblobId); 未確定のblobId = null; }
    marks = []; sourceVideo = null;
  }

  // ---------- 入口(編集画面) ----------
  // まだ1つもステップが無いときだけ出す。並べ始めた後に出すと、
  // 「押したら今の構成が消えるのでは」と手が止まる。
  function renderEntry() {
    const slot = document.getElementById("from-run-video");
    if (!slot) return;
    // アプリで撮った映像が無くても、端末のライブラリから選べる。
    // 映像を持っている人にとっては、ここが最短の入口になる。
    const empty = draft && (draft.steps || []).length === 0;
    if (!empty) { if (slot.innerHTML) slot.innerHTML = ""; return; }
    const html = `<button class="frv-entry" onclick="sheetPickRunVideo()">
      <span class="frv-kicker">${t("ここから始められます", "A faster start")}</span>
      <b>${t("撮ってある演技映像から構成を起こす", "Build from a recorded run")}</b>
      <span class="frv-sub">${t(
        "映像を見ながら区切りでキューを打つと、順番・長さ・曲位置がまとめて決まります。端末の動画も選べます。",
        "Tap at each break while watching; order, length and cues are set at once. Device videos work too.")}</span>
    </button>`;
    if (slot.innerHTML !== html) slot.innerHTML = html;
  }
  window.renderFromRunVideoEntry = renderEntry;

  // ---------- 映像を選ぶ ----------
  window.sheetPickRunVideo = () => {
    const videos = storedRunVideos().slice().sort((a, b) => (b.at || 0) - (a.at || 0));
    const rows = videos.map((v) => {
      const rt = (state.routines || []).find((r) => r.id === v.routineId);
      return `<div class="pick-trick-row" onclick="startRunVideoCue('${v.id}')">
        <span class="nm">${esc(rt ? routineDisplayName(rt) : t("(削除された演目)", "(deleted routine)"))}</span>
        <span class="kn">${fmtTime(v.duration || 0)}</span>
      </div>`;
    }).join("");
    // 通し練習の記録に限らない。過去に別のカメラで撮った映像からも起こせるようにする
    showSheet(`<h3>${t("どの映像から起こしますか", "Which video?")}</h3>
      ${rows ? `<div class="sheet-sub">${t("アプリで撮った演技映像(新しい順)", "Recorded in this app (newest first)")}</div>${rows}`
        : `<div class="empty">${t("アプリで撮った演技映像はまだありません。",
          "No runs recorded in this app yet.")}</div>`}
      <div class="sheet-sub">${t("端末のライブラリから", "From this device")}</div>
      <button class="btn" onclick="document.getElementById('frv-file').click()">${
        t("＋ 端末の動画を選ぶ", "+ Choose a video")}</button>
      <input type="file" id="frv-file" accept="video/*" class="hidden" onchange="startRunVideoCueFromFile(this)">
      <p class="frv-note">${t(
        `${Math.round(TRICK_MAX_BYTES / 1024 / 1024)}MBまで。映像は切り出さず、区間だけを記録します。`,
        `Up to ${Math.round(TRICK_MAX_BYTES / 1024 / 1024)}MB. The video is not cut; only ranges are stored.`)}</p>
      <button class="btn ghost" onclick="hideSheet()">${t("やめる", "Cancel")}</button>`);
  };

  // 端末から選んだ映像。アプリ内の演技映像と同じ形へそろえてから同じ流れに乗せる
  window.startRunVideoCueFromFile = async (input) => {
    const file = input && input.files && input.files[0];
    input.value = "";
    if (!file) return;
    if (file.size > TRICK_MAX_BYTES) {
      return toast(t(`${fmtBytes(TRICK_MAX_BYTES)}以下の動画にしてください(現在${fmtBytes(file.size)})`,
        `Use a video under ${fmtBytes(TRICK_MAX_BYTES)} (this one is ${fmtBytes(file.size)})`));
    }
    await withLoading(t("動画を確認中…", "Reading the video…"), async () => {
      const duration = await probeVideoDuration(file);
      if (!duration || duration < 0.3) {
        return toast(t("動画の長さを確認できませんでした", "Could not read the video duration"));
      }
      const blobId = uid();
      if (!(await blobPut(blobId, file))) {
        return toast(t("動画を保存できませんでした。端末の空き容量を確認してください",
          "Could not save the video. Check device storage."));
      }
      cleanup();
      未確定のblobId = blobId;
      sourceVideo = { id: blobId, blobId, duration, size: file.size, routineId: null };
      objectUrl = URL.createObjectURL(file);
      marks = [];
      renderCueSheet();
    });
  };

  // ---------- キューを打つ ----------
  window.startRunVideoCue = async (videoId) => {
    const v = storedRunVideos().find((x) => x.id === videoId);
    if (!v) return;
    const blob = await blobGet(v.blobId);
    if (!blob) return toast(t("映像データが見つかりません", "Video data not found"));
    cleanup();
    sourceVideo = v;
    objectUrl = URL.createObjectURL(blob);
    marks = [];
    renderCueSheet();
  };

  function markRows() {
    if (!marks.length) {
      return `<div class="frv-empty">${t(
        "まだ区切りがありません。再生して、シーケンスの変わり目で「ここで区切る」を押します。",
        "No marks yet. Play, and tap at each change.")}</div>`;
    }
    return marks.map((m, i) => {
      const el = videoEl();
      const tail = (Number.isFinite(el && el.duration) && el.duration > 0)
        ? el.duration : (sourceVideo.duration || m.at);
      const end = i + 1 < marks.length ? marks[i + 1].at : tail;
      return `<div class="frv-mark">
        <span class="frv-no">${i + 1}</span>
        <input type="text" class="frv-name" value="${esc(m.name || "")}"
          placeholder="${t("名前(なくてもよい)", "Name (optional)")}"
          oninput="renameRunVideoMark(${i},this.value)">
        <span class="frv-time">${fmtTimeFine(m.at)} – ${fmtTimeFine(end)}</span>
        <span class="frv-len">${(Math.round((end - m.at) * 10) / 10).toFixed(1)}${t("秒", "s")}</span>
        <button class="frv-del" onclick="dropRunVideoMark(${i})"
          aria-label="${t("この区切りを消す", "Remove this mark")}">✕</button>
      </div>`;
    }).join("");
  }

  // 打ち直しのたびに描き直すと、打っている途中の名前が消える。値だけ控える
  window.renameRunVideoMark = (i, value) => {
    if (marks[i]) marks[i].name = value;
  };

  // 打つたびに映像まで作り直すと、再生が止まって位置も戻る。
  // 変わるのは一覧と決定ボタンだけなので、そこだけ差し替える。
  function refreshMarks() {
    const list = document.getElementById("frv-marks");
    if (!list) return renderCueSheet();
    list.innerHTML = markRows();
    const go = document.getElementById("frv-commit");
    if (!go) return;
    go.disabled = marks.length < 2;
    go.textContent = marks.length < 2
      ? t("区切りを2つ以上打ってください", "Add at least two marks")
      : t(`${marks.length}個のシーケンスを作る`, `Create ${marks.length} sequences`);
  }

  function renderCueSheet(keepTime) {
    const at = keepTime != null ? keepTime : (videoEl() ? videoEl().currentTime : 0);
    showSheet(`
      <h3>${t("区切りでキューを打つ", "Tap at each break")}</h3>
      <div class="sheet-sub">${t(
        "再生しながら、シーケンスの変わり目で押します。あとから消せます。",
        "Play and tap at each change. You can remove marks later.")}</div>
      <video id="frv-video" class="frv-video" src="${objectUrl}" playsinline controls preload="metadata"></video>
      <div class="frv-nudge" role="group" aria-label="${t("再生位置の微調整", "Fine-tune position")}">
        <button onclick="nudgeRunVideo(-1)">−1${t("秒", "s")}</button>
        <button onclick="nudgeRunVideo(-0.1)">−0.1</button>
        <button onclick="nudgeRunVideo(0.1)">＋0.1</button>
        <button onclick="nudgeRunVideo(1)">＋1${t("秒", "s")}</button>
      </div>
      <button class="btn primary frv-mark-btn" onclick="addRunVideoMark()">${
        t("ここで区切る", "Mark here")}</button>
      <p class="frv-note">${t(
        "※ ここで完璧に合わせなくて大丈夫です。区切りの位置も名前も、あとから編集画面で細かく直せます。",
        "You don't need to be exact here — positions and names can be adjusted later in the editor.")}</p>
      <div class="frv-marks" id="frv-marks">${markRows()}</div>
      <button class="btn primary" id="frv-commit" onclick="commitRunVideoCues()" ${marks.length < 2 ? "disabled" : ""}>${
        marks.length < 2
          ? t("区切りを2つ以上打ってください", "Add at least two marks")
          : t(`${marks.length}個のシーケンスを作る`, `Create ${marks.length} sequences`)}</button>
      <button class="btn ghost" onclick="hideSheet()">${t("やめる", "Cancel")}</button>`, "");
    const el = videoEl();
    if (el && at) setTimeout(() => { try { el.currentTime = at; } catch (_) {} }, 0);
  }

  window.addRunVideoMark = () => {
    const el = videoEl();
    if (!el) return;
    const sec = Math.round(el.currentTime * 10) / 10;
    // 近すぎる区切りは、押し間違いとみなして受けない
    if (marks.some((m) => Math.abs(m.at - sec) < 0.3)) {
      return toast(t("すぐ近くに区切りがあります", "There is already a mark here"));
    }
    marks.push({ at: sec, name: "" });
    marks.sort((a, b) => a.at - b.at);
    refreshMarks();
  };

  window.nudgeRunVideo = (delta) => {
    const el = videoEl();
    if (!el) return;
    // 記録された長さより、実際に読み込めた長さを信じる(食い違うことがある)
    const max = Number.isFinite(el.duration) && el.duration > 0
      ? el.duration : (sourceVideo && sourceVideo.duration) || 0;
    el.currentTime = Math.max(0, Math.min(max, Math.round((el.currentTime + delta) * 10) / 10));
  };

  window.dropRunVideoMark = (i) => {
    marks.splice(i, 1);
    refreshMarks();
  };

  // ---------- 決定 ----------
  window.commitRunVideoCues = async () => {
    if (!draft || marks.length < 2 || !sourceVideo) return;
    const el = videoEl();
    const total = (Number.isFinite(el && el.duration) && el.duration > 0)
      ? Math.round(el.duration * 10) / 10
      : (sourceVideo.duration || marks[marks.length - 1].at);
    const steps = [];
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].at;
      const end = i + 1 < marks.length ? marks[i + 1].at : total;
      const dur = Math.round((end - start) * 10) / 10;
      if (dur <= 0) continue;
      // 区間ごとにシーケンスを1本作る。映像は切り出さず、元の1本を参照する
      const trickId = uid();
      state.tricks.push({
        id: trickId, name: marks[i].name.trim() || `${t("シーケンス", "Sequence")} ${steps.length + 1}`,
        blobId: sourceVideo.blobId, duration: dur, fullDuration: total,
        trimStart: start, trimEnd: end, lineColor: "blue",
        size: sourceVideo.size || 0, fromRunVideo: true, createdAt: Date.now(),
      });
      steps.push({
        id: uid(), name: marks[i].name.trim() || `${t("シーケンス", "Sequence")} ${steps.length + 1}`,
        kind: "trick", trickId, lineColor: "blue",
        // 最初の区切りを0秒として曲位置を置く。映像の頭から曲が鳴っている前提
        cue: Math.round((start - marks[0].at) * 10) / 10,
        dur,
      });
    }
    if (!steps.length) return;
    未確定のblobId = null;   // ここから先はシーケンスが参照する
    draft.steps = steps;
    saveState(); hideSheet(); cleanup(); render();
    toast(t(`${steps.length}個のシーケンスを作りました`, `Created ${steps.length} sequences`));
  };

  // シートを閉じたら後始末。映像の参照だけでなく、決定せずに終えたときの
  // 取り込み済み動画も消す(残すと参照のないデータが端末に溜まる)。
  if (typeof window.hideSheet === "function") {
    const original = window.hideSheet;
    window.hideSheet = function wrappedHideSheet() {
      const el = videoEl();
      if (el) { el.pause(); cleanup(); }
      return original.apply(this, arguments);
    };
  }

  const appEl = document.getElementById("app");
  if (appEl) {
    new MutationObserver(() => {
      if (document.getElementById("from-run-video")) renderEntry();
    }).observe(appEl, { childList: true });
  }
})();
