/* ルーティンノート — 保存済み通し映像の再生・書き出しと実施技の追従表示 */
"use strict";

function runVideoStorageBytes(videos = storedRunVideos()) {
  return videos.reduce((sum, video) => sum + (Number(video.size) || 0), 0);
}
function runVideoStorageActions(videos) {
  if (!videos.length) return "";
  const english = isEnglish();
  return `<div class="run-video-storage-actions">
    <div><b>${english ? "Free storage on this iPhone" : "iPhoneの容量を空ける"}</b>
      <span>${english
        ? `Delete ${videos.length} saved performance videos (${fmtBytes(runVideoStorageBytes(videos))}) from this app.`
        : `このアプリ内の演技映像${videos.length}本（${fmtBytes(runVideoStorageBytes(videos))}）をまとめて削除できます。`}</span></div>
    <button type="button" class="btn danger-ghost" onclick="showDeleteAllRunVideos()">${english ? "Delete all performance videos" : "演技映像をまとめて削除"}</button>
    <small>${english ? "Routines, practice records, skill videos, and music remain." : "ルーティン・練習記録・技動画・音源は残ります。"}</small>
  </div>`;
}

function runVideoReviewStepContext(video, found = findRunRecord(video.sessionId, video.runId)) {
  const routine = state.routines.find((item) => item.id === video.routineId);
  if (!routine || !found.sess) return null;
  const version = getVersion(routine, found.sess.versionId);
  if (!version || !version.steps || !version.steps.length) return null;
  return { routine, run: found.run || null, steps: version.steps };
}
function runVideoReviewStepName(context, step) {
  if (!isSlot(step)) return stepDisplayName(step) || (isEnglish() ? "Unnamed skill" : "名称未設定");
  const optionId = context.run ? runChoice(context.run, step) : null;
  const option = step.options.find((item) => item.id === optionId) || step.options[0];
  return (option && optionDisplayName(option)) || stepLabel(step) || (isEnglish() ? "Unnamed skill" : "名称未設定");
}
function runVideoCurrentStepMarkup(context) {
  if (!context) return "";
  const current = plannedPracticeStep(context.steps, 0);
  const name = current ? runVideoReviewStepName(context, current.step) : "—";
  return `<section class="run-video-current-step" id="run-video-current-step" aria-live="polite" aria-atomic="true">
    <span>${isEnglish() ? "Current skill" : "実施中の技"}</span>
    <strong id="run-video-current-step-name">${esc(name)}</strong>
    <small id="run-video-current-step-meta">${current ? `${current.index + 1}/${context.steps.length} · ♪${fmtTimeFine(current.start)}` : "—"}</small>
  </section>`;
}
function updateRunVideoCurrentStep(context) {
  const player = document.getElementById("run-video-player");
  const name = document.getElementById("run-video-current-step-name");
  const meta = document.getElementById("run-video-current-step-meta");
  if (!context || !player || !name || !meta) return;
  const current = plannedPracticeStep(context.steps, Math.max(0, Number(player.currentTime) || 0));
  if (!current) return;
  name.textContent = runVideoReviewStepName(context, current.step);
  meta.textContent = isEnglish()
    ? `Step ${current.index + 1} of ${context.steps.length} · ${fmtTimeFine(current.start)}`
    : `${current.index + 1}/${context.steps.length} · ♪${fmtTimeFine(current.start)}`;
}
function bindRunVideoCurrentStep(context) {
  if (!context) return;
  const player = document.getElementById("run-video-player");
  if (!player) return;
  for (const eventName of ["loadedmetadata", "timeupdate", "seeking", "seeked"]) {
    player.addEventListener(eventName, () => updateRunVideoCurrentStep(context));
  }
  updateRunVideoCurrentStep(context);
}

window.openRunVideo = async (id) => {
  const video = storedRunVideos().find((item) => item.id === id);
  if (!video) return toast("映像データが見つかりません");
  return withLoading("映像と音源を読み込み中…", async () => {
    const music = runVideoMusicMeta(video);
    const needsLinkedMusic = runVideoNeedsLinkedMusic(video);
    const [blob, musicBlob] = await Promise.all([
      blobGet(video.blobId),
      needsLinkedMusic && music ? blobGet(music.blobId) : Promise.resolve(null),
    ]);
    if (!blob) return toast("映像データが見つかりません");
    stopRunVideoAudioSync();
    if (sheetVideoUrl) URL.revokeObjectURL(sheetVideoUrl);
    if (sheetRunMusicUrl) URL.revokeObjectURL(sheetRunMusicUrl);
    sheetVideoUrl = URL.createObjectURL(blob);
    sheetRunMusicUrl = musicBlob ? URL.createObjectURL(musicBlob) : null;
    const found = findRunRecord(video.sessionId, video.runId);
    const stepContext = runVideoReviewStepContext(video, found);
    const markers = found.run ? (found.run.events || []).filter((event) => event.videoTime != null).map((event) => {
      const step = stepContext && stepContext.steps[event.stepIndex];
      return `<button class="time-chip tappable" onclick="runVideoSeek(${Number(event.videoTime)})">${esc(step ? stepLabel(step) : "記録地点")} ${fmtTime(event.videoTime)}</button>`;
    }).join("") : "";
    showSheet(`
      <h3>${esc(runVideoTitle(video))}</h3>
      <div class="sheet-sub">${uiText("インカメ")} / ${uiText(runVideoProfile(video).label)} / ${runVideoAudioLabel(video)} / ${fmtTimeFine(video.duration)}</div>
      <video id="run-video-player" class="run-video-review" style="${runVideoAspectStyle(video)}" src="${sheetVideoUrl}" controls playsinline preload="metadata"></video>
      ${needsLinkedMusic && sheetRunMusicUrl ? `<audio id="run-video-audio" src="${sheetRunMusicUrl}" preload="auto"></audio>` : ""}
      ${runVideoPlaybackAudioMarkup(video, music, !!sheetRunMusicUrl)}
      ${markers ? `<div class="time-chips run-video-markers">${markers}</div>` : `<div class="hint">この映像の失敗記録はありません</div>`}
      ${runVideoCurrentStepMarkup(stepContext)}
      <button class="btn" onclick="runVideoDownload('${video.id}')">映像を書き出す</button>
      <button class="btn danger-ghost" onclick="runVideoDelete('${video.id}')">この映像を削除</button>
      <button class="btn ghost" onclick="hideSheet()">閉じる</button>`);
    bindRunVideoCurrentStep(stepContext);
    if (needsLinkedMusic && sheetRunMusicUrl) bindRunVideoAudioSync(music);
  });
};
window.runVideoSeek = (time) => {
  const player = document.getElementById("run-video-player");
  if (!player) return;
  player.currentTime = Math.max(0, Number(time) - 3);
  syncRunVideoAudioPosition(true);
  playMedia(player, "映像を再生できませんでした");
};
window.runVideoDownload = async (id) => {
  const video = storedRunVideos().find((item) => item.id === id);
  if (!video) return toast("映像データが見つかりません");
  const blob = await blobGet(video.blobId);
  if (!blob) return toast("映像データが見つかりません");
  const ext = (blob.type || "").includes("mp4") ? "mp4" : "webm";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `full-run-${localDateString(video.at)}-${video.id}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast("映像を書き出しました");
};
