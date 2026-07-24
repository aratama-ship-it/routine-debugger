/* 長尺動画を見ながらキューを決め、同じ元動画を参照するクリップとして登録する。 */
let batchImportDraft = null;
let batchImportPlaying = false;

function batchText(ja, en) { return isEnglish() ? en : ja; }
function batchClamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }
function batchRound(value) { return Math.round(Number(value || 0) * 10) / 10; }

function uniqueTrickBlobBytes(items) {
  const seen = new Set();
  return (items || []).reduce((total, item) => {
    const key = item.blobId || item.id;
    if (!key || seen.has(key)) return total;
    seen.add(key);
    return total + (Number(item.size) || 0);
  }, 0);
}

function trickBlobStillReferenced(blobId) {
  return Boolean(blobId && (state.tricks || []).some((item) => item.blobId === blobId));
}

window.removeSampleTricks = async () => {
  const samples = (state.tricks || []).filter((item) => item.sample);
  if (!samples.length || !appConfirm(`サンプルの技${samples.length}個をまとめて削除しますか?`)) return;
  const blobIds = new Set(samples.map((item) => item.blobId).filter(Boolean));
  state.tricks = state.tricks.filter((item) => !item.sample);
  for (const blobId of blobIds) if (!trickBlobStillReferenced(blobId)) await blobDel(blobId);
  saveState(); render(); toast("サンプルを削除しました");
};

window.trickDelete = async (id) => {
  const trick = state.tricks.find((item) => item.id === id);
  if (!trick || !appConfirm(`「${trick.name}」を削除しますか?(元に戻せません)`)) return;
  state.tricks = state.tricks.filter((item) => item.id !== id);
  if (!trickBlobStillReferenced(trick.blobId)) await blobDel(trick.blobId);
  saveState(); render(); toast("削除しました");
};

function batchSequenceImportCleanup() {
  const video = document.getElementById("batch-import-video");
  if (video) video.pause();
  if (batchImportDraft && batchImportDraft.url) URL.revokeObjectURL(batchImportDraft.url);
  batchImportDraft = null;
  batchImportPlaying = false;
}

function batchRoutine() {
  return batchImportDraft
    ? (state.routines || []).find((routine) => routine.id === batchImportDraft.routineId) || null
    : null;
}

function batchLinkedTrick(target) {
  return target && target.trickId
    ? (state.tricks || []).find((item) => item.id === target.trickId) || null
    : null;
}

function batchTargetDuration(target) {
  const own = Number(target && target.dur);
  if (Number.isFinite(own) && own >= 0.3) return own;
  const linked = batchLinkedTrick(target);
  if (linked && Number(linked.duration) >= 0.3) return Number(linked.duration);
  return DEFAULT_STEP_DUR;
}

function batchTargetForStep(step, optionIndex) {
  return isSlot(step) ? step.options[optionIndex] : step;
}

function batchBuildSegments() {
  const routine = batchRoutine();
  if (!routine || !batchImportDraft || !batchImportDraft.duration) return [];
  const steps = latestVersion(routine).steps || [];
  return steps.map((step, stepIndex) => {
    const transition = step.kind === "transition";
    const optionIndex = 0;
    const target = batchTargetForStep(step, optionIndex);
    const linked = batchLinkedTrick(target);
    return {
      stepIndex,
      stepId: step.id,
      optionIndex,
      transition,
      name: optionDisplayName(target) || stepDisplayName(step) || batchText("名称未設定", "Untitled"),
      cueSet: false,
      start: null,
      end: null,
      trickId: target.trickId || null,
      action: transition ? "cue" : linked ? "skip" : "new",
      newName: optionDisplayName(target) || stepDisplayName(step) || batchText("名称未設定", "Untitled"),
    };
  });
}

function batchRebuildSegments() {
  if (!batchImportDraft) return;
  batchImportDraft.segments = batchBuildSegments();
  batchImportDraft.selected = 0;
  batchImportPlaying = false;
}

function batchActionOptions(segment) {
  const linked = batchLinkedTrick({ trickId: segment.trickId });
  const options = linked
    ? [
      ["skip", batchText("スキップ", "Skip")],
      ["replace", batchText("差し替え", "Replace")],
      ["new", batchText("別シーケンスとして登録", "Save as another sequence")],
    ]
    : [
      ["new", batchText("新規登録", "Add new")],
      ["skip", batchText("スキップ", "Skip")],
    ];
  return options.map(([value, label]) =>
    `<option value="${value}" ${segment.action === value ? "selected" : ""}>${label}</option>`).join("");
}

function batchOptionPicker(step, segmentIndex, selectedIndex) {
  if (!isSlot(step)) return "";
  const options = step.options.map((option, optionIndex) =>
    `<option value="${optionIndex}" ${optionIndex === selectedIndex ? "selected" : ""}>${esc(optionDisplayName(option) || `Option ${String.fromCharCode(65 + optionIndex)}`)}</option>`).join("");
  return `<label class="batch-inline-select"><span>A/B</span><select onchange="batchChangeOption(${segmentIndex},this.value)">${options}</select></label>`;
}

function batchSegmentRows() {
  if (!batchImportDraft) return "";
  const routine = batchRoutine();
  const steps = routine ? latestVersion(routine).steps || [] : [];
  return batchImportDraft.segments.map((segment, index) => {
    const step = steps[segment.stepIndex];
    const linked = batchLinkedTrick({ trickId: segment.trickId });
    const clipLength = segment.cueSet && !segment.transition ? segment.end - segment.start : 0;
    const invalid = segment.cueSet && (segment.start < batchImportDraft.offset
      || (!segment.transition && segment.action !== "skip" && (clipLength < 0.3 || clipLength > TRICK_MAX_SEC)));
    const status = segment.transition
      ? batchText("キュー位置だけ設定・ライブラリ登録なし", "Cue only · not added to library")
      : linked
      ? batchText(`登録済み: ${trickDisplayName(linked)}`, `Linked: ${trickDisplayName(linked)}`)
      : batchText("動画未登録", "No video linked");
    const timing = segment.cueSet
      ? segment.transition
        ? `${batchText("キュー", "Cue")} ${fmtTimeFine(segment.start - batchImportDraft.offset)}`
        : `${batchText("キュー", "Cue")} ${fmtTimeFine(segment.start - batchImportDraft.offset)} · ${fmtTimeFine(segment.start)} – ${fmtTimeFine(segment.end)}`
      : batchText("キュー未設定", "Cue not set");
    return `<article class="batch-segment ${index === batchImportDraft.selected ? "selected" : ""} ${segment.cueSet ? "" : "unset"} ${segment.transition ? "transition" : ""} ${invalid ? "invalid" : ""}" onclick="batchSelectSegment(${index})">
      <div class="batch-segment-main">
        <span class="batch-segment-number">${index + 1}</span>
        <div><b data-user-text>${esc(segment.name)}</b><small>${timing}</small></div>
      </div>
      <small class="batch-link-status">${esc(status)}</small>
      ${segment.transition ? "" : batchOptionPicker(step, index, segment.optionIndex)}
      ${segment.transition ? "" : `<label class="batch-action-select" onclick="event.stopPropagation()">
        <span>${batchText("登録方法", "Action")}</span>
        <select onchange="batchSetAction(${index},this.value)">${batchActionOptions(segment)}</select>
      </label>`}
      ${segment.action === "new" ? `<label class="batch-new-name" onclick="event.stopPropagation()">
        <span>${batchText("登録名", "Name")}</span>
        <input type="text" value="${esc(segment.newName)}" oninput="batchSetName(${index},this.value)">
      </label>` : ""}
    </article>`;
  }).join("");
}

function batchSelectedEditor() {
  const draft = batchImportDraft;
  const segment = draft && draft.segments[draft.selected];
  if (!segment) return "";
  const max = draft.duration || 0;
  const cueValue = segment.cueSet ? fmtTimeFine(segment.start - draft.offset) : batchText("未設定", "Not set");
  const markLabel = segment.cueSet
    ? batchText("今の位置へキューを更新", "Move cue to current position")
    : draft.selected < draft.segments.length - 1
      ? batchText("今の位置をキューに設定して次へ", "Set cue here and go next")
      : batchText("今の位置をキューに設定", "Set cue at current position");
  return `<section class="batch-cut-editor">
    <div class="batch-cut-heading">
      <div><small>${batchText(`ステップ${draft.selected + 1}を設定`, `Set step ${draft.selected + 1}`)}</small><b data-user-text>${esc(segment.name)}</b></div>
      ${segment.cueSet && !segment.transition ? `<button class="btn small" onclick="batchPlaySegment()">▶ ${batchText("区間を確認", "Play clip")}</button>` : ""}
    </div>
    <label class="batch-video-seek">
      <span>${batchText("動画内の位置", "Video position")} <b id="batch-current-time">0:00.0</b></span>
      <input id="batch-video-seek" type="range" min="0" max="${max}" step="0.1" value="${draft.previewTime || 0}" oninput="batchSeekPreview(this.value)">
    </label>
    <button class="btn primary batch-cue-mark" onclick="batchSetCueFromPreview()">${markLabel}</button>
    <div class="batch-cue-result">${batchText("ルーティン上のキュー", "Routine cue")} <b>${cueValue}</b>${segment.transition ? ` · ${batchText("移行はキューだけ保存", "Transition saves cue only")}` : ""}</div>
    ${segment.cueSet ? batchPointEditor("start", segment.start, segment.transition) : `<p class="batch-cue-prompt">${batchText("動画を再生し、このシーケンスが始まる瞬間で上のボタンを押してください。", "Play the video and press the button when this sequence begins.")}</p>`}
    ${segment.cueSet && !segment.transition ? batchPointEditor("end", segment.end, false) : ""}
    ${segment.cueSet && !segment.transition ? `<div class="batch-duration-note">${batchText("動画区間", "Clip")} <b>${fmtTimeFine(segment.end - segment.start)}</b> / ${batchText(`最大${TRICK_MAX_SEC}秒`, `max ${TRICK_MAX_SEC}s`)}</div>` : ""}
  </section>`;
}

function batchPointEditor(kind, value, transition) {
  const isStart = kind === "start";
  return `<div class="batch-point-row">
    <b>${isStart ? transition ? batchText("キュー", "Cue") : batchText("キュー/始点", "Cue/start") : batchText("終点", "End")}</b>
    <output>${fmtTimeFine(value)}</output>
    <button class="mini-btn" onclick="batchNudgePoint('${kind}',-0.1)">−</button>
    <button class="mini-btn" onclick="batchNudgePoint('${kind}',0.1)">＋</button>
    <button class="btn small" onclick="batchSetPointFromPreview('${kind}')">${batchText("今の位置", "Use current")}</button>
  </div>`;
}

function batchSetupHtml() {
  const routines = (state.routines || []);
  const selectedId = batchImportDraft && batchImportDraft.routineId || routines[0]?.id || "";
  const options = routines.map((routine) =>
    `<option value="${routine.id}" ${routine.id === selectedId ? "selected" : ""}>${esc(routineDisplayName(routine))} · v${routine.versions.length}</option>`).join("");
  return `<div class="card batch-setup">
    <h2>${batchText("1. ルーティンを選ぶ", "1. Choose a routine")}</h2>
    <p>${batchText("最新バージョンからシーケンスの順番だけを読み込みます。既存のキュー位置は使いません。", "Only the sequence order is loaded from the latest version. Existing cue positions are ignored.")}</p>
    ${routines.length ? `<select class="batch-routine-select" onchange="batchSelectRoutine(this.value)">${options}</select>` : `<div class="empty">${batchText("先にルーティンを作成してください。", "Create a routine first.")}</div>`}
    <h2>${batchText("2. 長尺動画を選ぶ", "2. Choose the full video")}</h2>
    <button class="btn primary" ${routines.length ? "" : "disabled"} onclick="document.getElementById('batch-video-file').click()">＋ ${batchText("動画ファイルを選択", "Choose video")}</button>
    <input id="batch-video-file" class="hidden" type="file" accept="video/*" onchange="batchLoadVideo(this)">
    <p class="batch-storage-note">${batchText("元動画は1本だけ端末内へ保存し、各シーケンスは区間を参照します。", "The source video is stored once; each sequence references a time range.")}</p>
  </div>`;
}

function renderBatchSequenceImport() {
  if (!batchImportDraft) {
    batchImportDraft = {
      routineId: (state.routines || [])[0]?.id || "",
      file: null, url: null, duration: 0, offset: 0, previewTime: 0, segments: [], selected: 0,
    };
  }
  const draft = batchImportDraft;
  const routine = batchRoutine();
  const back = `<div class="topbar"><button class="back-btn" onclick="go('tricks')">${batchText("戻る", "Back")}</button><h1>${batchText("長尺動画から一括追加", "Batch import from video")}</h1></div>`;
  if (!draft.file) return `${back}${batchSetupHtml()}`;
  const activeCount = draft.segments.filter((segment) => !segment.transition && segment.action !== "skip").length;
  const cueCount = draft.segments.filter((segment) => segment.cueSet).length;
  return `${back}
    <div class="batch-import-layout">
      <section class="card batch-source">
        <div class="batch-source-title">
          <div><small>${batchText("選択したルーティン", "Routine")}</small><b data-user-text>${esc(routine ? routineDisplayName(routine) : "")}</b></div>
          <button class="btn small ghost" onclick="batchChooseAnotherVideo()">${batchText("動画を変更", "Change video")}</button>
        </div>
        <video id="batch-import-video" src="${draft.url}" controls playsinline preload="metadata"></video>
        <div class="batch-source-meta">${esc(draft.file.name)} · ${fmtTime(draft.duration)} · ${fmtBytes(draft.file.size)}</div>
        <div class="batch-offset">
          <div><b>${batchText("動画内の演技開始位置", "Routine start in video")}</b><small>${batchText("この位置を0秒として各キューを記録します", "Each cue is measured from this position")}</small></div>
          <output>${fmtTimeFine(draft.offset)}</output>
          <button class="mini-btn" onclick="batchNudgeOffset(-0.1)">−</button>
          <button class="mini-btn" onclick="batchNudgeOffset(0.1)">＋</button>
          <button class="btn small" onclick="batchSetOffsetFromPreview()">${batchText("今の位置", "Use current")}</button>
        </div>
      </section>
      ${batchSelectedEditor()}
      <section class="card batch-list-card">
        <h2>${batchText("キューと動画の登録", "Cues and video registration")}</h2>
        <p>${batchText("動画を見ながら上から順にキューを設定します。移行はキューだけを保存し、シーケンス・技ライブラリには追加しません。", "Set each cue in order while watching the video. Transitions save only their cue and are not added to the Sequence Library.")}</p>
        <p>${batchText("動画が登録済みのシーケンスは、間違って置き換えないよう初期状態でスキップします。", "Sequences with a video are skipped by default to prevent accidental replacement.")}</p>
        <p class="batch-action-note">${batchText("差し替えは同じライブラリ項目を使う他のルーティンにも反映されます。別シーケンスは新しい項目を作り、このルーティンだけをそちらへ紐づけます。", "Replace affects every routine using that library item. Save as another sequence creates a new item and switches only this routine to it.")}</p>
        <div class="batch-segment-list">${batchSegmentRows()}</div>
      </section>
      <section class="batch-save-panel">
        <div><b>${batchText(`キュー ${cueCount}/${draft.segments.length} · 動画${activeCount}件`, `Cues ${cueCount}/${draft.segments.length} · ${activeCount} videos`)}</b><small>${batchText("全キューを設定すると保存できます", "Set every cue to save")}</small></div>
        <button class="btn primary" ${cueCount === draft.segments.length ? "" : "disabled"} onclick="batchSaveAll()">${batchText("キューと動画を保存", "Save cues and videos")}</button>
      </section>
    </div>`;
}

function bindBatchSequenceImportUi() {
  const video = document.getElementById("batch-import-video");
  if (!video || video._batchBound) return;
  video._batchBound = true;
  let restored = false;
  const restorePosition = () => {
    if (!batchImportDraft || restored) return;
    restored = true;
    try { video.currentTime = batchClamp(batchImportDraft.previewTime, 0, batchImportDraft.duration); } catch (_) {}
    if (batchImportDraft.resumePlayback) {
      batchImportDraft.resumePlayback = false;
      video.play().catch(() => {});
    }
  };
  video.addEventListener("loadedmetadata", restorePosition, { once: true });
  if (video.readyState >= 1) restorePosition();
  video.addEventListener("timeupdate", () => {
    const label = document.getElementById("batch-current-time");
    const seek = document.getElementById("batch-video-seek");
    if (label) label.textContent = fmtTimeFine(video.currentTime);
    if (batchImportDraft) batchImportDraft.previewTime = video.currentTime;
    if (seek && document.activeElement !== seek) seek.value = video.currentTime;
    const segment = batchImportDraft && batchImportDraft.segments[batchImportDraft.selected];
    if (batchImportPlaying && segment && segment.cueSet && !segment.transition && video.currentTime >= segment.end - 0.03) {
      video.pause();
      batchImportPlaying = false;
    }
  });
}

window.batchSelectRoutine = (routineId) => {
  if (!batchImportDraft) return;
  if (batchImportDraft.file && routineId !== batchImportDraft.routineId
      && !appConfirm(batchText("調整中のカット位置を破棄してルーティンを変更しますか？", "Discard the current cut adjustments and change routine?"))) {
    return render();
  }
  batchImportDraft.routineId = routineId;
  if (batchImportDraft.file) batchRebuildSegments();
  render();
};

window.batchLoadVideo = async (input) => {
  const file = input && input.files && input.files[0];
  if (!file || !batchImportDraft) return;
  await withLoading(batchText("動画を確認中…", "Reading video…"), async () => {
    const duration = await probeVideoDuration(file);
    if (!duration || duration < 0.3) return toast(batchText("動画の長さを確認できませんでした", "Could not read the video duration"));
    if (batchImportDraft.url) URL.revokeObjectURL(batchImportDraft.url);
    batchImportDraft.file = file;
    batchImportDraft.url = URL.createObjectURL(file);
    batchImportDraft.duration = duration;
    batchImportDraft.offset = 0;
    batchImportDraft.previewTime = 0;
    batchRebuildSegments();
    render();
  });
};

window.batchChooseAnotherVideo = () => {
  if (!appConfirm(batchText("調整中のカット位置を破棄して動画を変更しますか？", "Discard the current cut adjustments and change video?"))) return;
  if (batchImportDraft.url) URL.revokeObjectURL(batchImportDraft.url);
  batchImportDraft.file = null;
  batchImportDraft.url = null;
  batchImportDraft.duration = 0;
  batchImportDraft.previewTime = 0;
  batchImportDraft.segments = [];
  render();
  document.getElementById("batch-video-file")?.click();
};

window.batchSelectSegment = (index) => {
  if (!batchImportDraft || !batchImportDraft.segments[index]) return;
  const video = document.getElementById("batch-import-video");
  if (video) { batchImportDraft.previewTime = video.currentTime; video.pause(); }
  batchImportPlaying = false;
  batchImportDraft.selected = index;
  render();
};

window.batchSetAction = (index, action) => {
  const segment = batchImportDraft && batchImportDraft.segments[index];
  if (!segment || !["skip", "replace", "new"].includes(action)) return;
  segment.action = action;
  if (action === "new") {
    const linked = batchLinkedTrick({ trickId: segment.trickId });
    if (!segment.newName.trim() || (linked && segment.newName === segment.name)) {
      segment.newName = linked ? `${segment.name}${batchText(" 別テイク", " alternate")}` : segment.name;
    }
  }
  render();
};

window.batchSetName = (index, value) => {
  const segment = batchImportDraft && batchImportDraft.segments[index];
  if (segment) segment.newName = value;
};

window.batchChangeOption = (index, rawOptionIndex) => {
  const segment = batchImportDraft && batchImportDraft.segments[index];
  const routine = batchRoutine();
  const step = routine && latestVersion(routine).steps[segment && segment.stepIndex];
  const optionIndex = Number(rawOptionIndex);
  if (!segment || !step || !isSlot(step) || !step.options[optionIndex]) return;
  const target = step.options[optionIndex];
  segment.optionIndex = optionIndex;
  segment.name = optionDisplayName(target) || `Option ${String.fromCharCode(65 + optionIndex)}`;
  segment.newName = segment.name;
  segment.trickId = target.trickId || null;
  segment.action = batchLinkedTrick(target) ? "skip" : "new";
  if (segment.cueSet) {
    segment.end = batchRound(Math.min(batchImportDraft.duration,
      segment.start + Math.min(TRICK_MAX_SEC, batchTargetDuration(target))));
  }
  render();
};

window.batchSeekPreview = (value) => {
  const video = document.getElementById("batch-import-video");
  if (!video) return;
  batchImportPlaying = false;
  batchImportDraft.previewTime = batchClamp(value, 0, batchImportDraft.duration);
  try { video.currentTime = batchImportDraft.previewTime; } catch (_) {}
};

window.batchPlaySegment = () => {
  const video = document.getElementById("batch-import-video");
  const segment = batchImportDraft && batchImportDraft.segments[batchImportDraft.selected];
  if (!video || !segment || !segment.cueSet || segment.transition) return;
  try { video.currentTime = segment.start; } catch (_) {}
  batchImportPlaying = true;
  playMedia(video, batchText("区間を再生できませんでした", "Could not play this clip"));
};

window.batchSetCueFromPreview = () => {
  const draft = batchImportDraft;
  const video = document.getElementById("batch-import-video");
  const segment = draft && draft.segments[draft.selected];
  const routine = batchRoutine();
  const step = routine && latestVersion(routine).steps[segment && segment.stepIndex];
  if (!video || !segment || !step) return;
  const target = batchTargetForStep(step, segment.optionIndex);
  const start = batchRound(batchClamp(video.currentTime, 0, draft.duration));
  const wasSet = segment.cueSet;
  segment.cueSet = true;
  segment.start = start;
  segment.end = segment.transition ? null : batchRound(Math.min(draft.duration,
    start + Math.min(TRICK_MAX_SEC, batchTargetDuration(target))));
  draft.previewTime = start;
  draft.resumePlayback = !video.paused;
  if (!wasSet && draft.selected < draft.segments.length - 1) draft.selected++;
  render();
  toast(batchText(wasSet ? "キューを更新しました" : "キューを設定しました", wasSet ? "Cue updated" : "Cue set"));
};

function batchUpdatePoint(kind, value) {
  const draft = batchImportDraft;
  const segment = draft && draft.segments[draft.selected];
  if (!segment || !segment.cueSet) return;
  const next = batchRound(batchClamp(value, 0, draft.duration));
  if (kind === "start") {
    segment.start = segment.transition ? next : Math.min(next, segment.end - 0.3);
  } else if (!segment.transition) {
    segment.end = Math.max(next, segment.start + 0.3);
  }
  segment.start = batchRound(batchClamp(segment.start, 0, draft.duration));
  if (!segment.transition) segment.end = batchRound(batchClamp(segment.end, 0, draft.duration));
  render();
}

window.batchNudgePoint = (kind, delta) => {
  const segment = batchImportDraft && batchImportDraft.segments[batchImportDraft.selected];
  if (segment) batchUpdatePoint(kind, segment[kind] + Number(delta));
};

window.batchSetPointFromPreview = (kind) => {
  const video = document.getElementById("batch-import-video");
  if (video) batchUpdatePoint(kind, video.currentTime);
};

window.batchNudgeOffset = (delta) => {
  if (!batchImportDraft) return;
  batchImportDraft.offset = batchRound(batchClamp(
    batchImportDraft.offset + Number(delta), 0, batchImportDraft.duration));
  render();
};

window.batchSetOffsetFromPreview = () => {
  const video = document.getElementById("batch-import-video");
  if (!video || !batchImportDraft) return;
  batchImportDraft.offset = batchRound(batchClamp(video.currentTime, 0, batchImportDraft.duration));
  batchImportDraft.previewTime = video.currentTime;
  render();
};

window.batchSaveAll = async () => {
  const draft = batchImportDraft;
  const routine = batchRoutine();
  if (!draft || !draft.file || !routine) return;
  if (draft.segments.some((segment) => !segment.cueSet)) {
    return toast(batchText("すべてのキュー位置を設定してください", "Set every cue position"));
  }
  const cueValues = draft.segments.map((segment) => batchRound(segment.start - draft.offset));
  if (cueValues.some((cue) => cue < 0)) {
    return toast(batchText("演技開始位置より前にあるキューを修正してください", "Move cues that are before the routine start"));
  }
  if (cueValues.some((cue, index) => index > 0 && cue < cueValues[index - 1])) {
    return toast(batchText("キューをルーティンの順番どおりに設定してください", "Set cues in routine order"));
  }
  const active = draft.segments.filter((segment) => !segment.transition && segment.action !== "skip");
  const invalid = active.find((segment) => {
    const length = segment.end - segment.start;
    return length < 0.3 || length > TRICK_MAX_SEC || (segment.action === "new" && !segment.newName.trim());
  });
  if (invalid) return toast(batchText(`各区間を0.3〜${TRICK_MAX_SEC}秒にし、登録名を入力してください`, `Use 0.3–${TRICK_MAX_SEC}s clips and enter each name`));
  await withLoading(batchText("キューとシーケンスを保存中…", "Saving cues and sequences…"), async () => {
    const sourceBlobId = active.length ? uid() : null;
    if (sourceBlobId && !(await blobPut(sourceBlobId, draft.file))) {
      return toast(batchText("動画を保存できませんでした。端末の空き容量を確認してください", "Could not save the video. Check device storage."));
    }
    const currentVersion = latestVersion(routine);
    const steps = cloneRoutineSteps(currentVersion.steps || []);
    const previousCurrentSteps = cloneRoutineSteps(currentVersion.steps || []);
    const makeNewVersion = runsOfVersion(routine.id, currentVersion.id).length > 0;
    const oldBlobIds = new Set();
    const previousTricks = state.tricks.map((item) => ({ ...item }));
    const previousVersions = routine.versions.slice();
    try {
      for (const segment of draft.segments) {
        const step = steps[segment.stepIndex];
        if (!step) throw new Error("missing step");
        step.cue = batchRound(segment.start - draft.offset);
      }
      for (const segment of active) {
        const step = steps[segment.stepIndex];
        const target = batchTargetForStep(step, segment.optionIndex);
        const duration = batchRound(segment.end - segment.start);
        let trickId = segment.trickId;
        if (segment.action === "replace") {
          const trick = (state.tricks || []).find((item) => item.id === segment.trickId);
          if (!trick) throw new Error("missing linked sequence");
          if (trick.blobId && trick.blobId !== sourceBlobId) oldBlobIds.add(trick.blobId);
          Object.assign(trick, {
            blobId: sourceBlobId, duration, fullDuration: draft.duration,
            trimStart: segment.start, trimEnd: segment.end, size: draft.file.size,
            batchSource: true, updatedAt: Date.now(),
          });
        } else {
          trickId = uid();
          state.tricks.push({
            id: trickId, name: segment.newName.trim(), blobId: sourceBlobId,
            duration, fullDuration: draft.duration, lineColor: "blue",
            trimStart: segment.start, trimEnd: segment.end, size: draft.file.size,
            batchSource: true, createdAt: Date.now(),
          });
        }
        target.trickId = trickId;
      }
      if (makeNewVersion) {
        routine.versions.push({
          id: uid(), createdAt: Date.now(),
          label: batchText("長尺動画からキュー設定", "Cues from full video"),
          steps,
        });
      } else {
        currentVersion.steps = steps;
      }
      saveState();
      for (const oldBlobId of oldBlobIds) {
        if (!trickBlobStillReferenced(oldBlobId)) await blobDel(oldBlobId);
      }
      const count = active.length;
      const cueCount = draft.segments.length;
      batchSequenceImportCleanup();
      go("tricks");
      toast(batchText(`キュー${cueCount}件・動画${count}件を保存しました`, `Saved ${cueCount} cues and ${count} videos`));
    } catch (error) {
      state.tricks = previousTricks;
      routine.versions = previousVersions;
      if (!makeNewVersion) currentVersion.steps = previousCurrentSteps;
      if (sourceBlobId) await blobDel(sourceBlobId);
      toast(batchText("保存中に問題が起きました。もう一度お試しください", "Something went wrong while saving"));
    }
  });
};
