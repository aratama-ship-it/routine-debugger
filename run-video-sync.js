/* ルーティンノート — 無音の通し映像と撮影時の音源を同期再生する */
"use strict";

let sheetRunMusicUrl = null;
let runVideoSyncState = null; // { video, audio, music }
let runVideoSyncRaf = 0;

// 映像へ「撮影時に使った音源」を軽量な参照として残す。音源Blob自体は複製しない。
function cloneRunVideoMusicMeta(meta) {
  if (!meta || !meta.blobId) return null;
  return normalizeMusicMeta({
    blobId: meta.blobId,
    name: meta.name || "",
    fullDuration: meta.fullDuration,
    trimStart: meta.trimStart,
    trimEnd: meta.trimEnd,
    duration: meta.duration,
  });
}
function runVideoMusicMeta(video) {
  // v162以降は null も「撮影時に楽曲なし」という確定情報。旧映像だけ現在の設定へフォールバックする。
  if (video && Object.prototype.hasOwnProperty.call(video, "music")) {
    return cloneRunVideoMusicMeta(video.music);
  }
  const rt = state.routines.find((routine) => routine.id === video?.routineId);
  return cloneRunVideoMusicMeta(rt && rt.music);
}
function preserveRunVideoMusicSnapshots(routineId, music) {
  const snapshot = cloneRunVideoMusicMeta(music);
  if (!routineId || !snapshot) return false;
  let referenced = false;
  for (const video of storedRunVideos()) {
    if (video.routineId !== routineId) continue;
    if (!Object.prototype.hasOwnProperty.call(video, "music")) video.music = { ...snapshot };
    if (video.music && video.music.blobId === snapshot.blobId) referenced = true;
  }
  return referenced;
}
function runVideoMusicBlobIsReferenced(blobId) {
  if (!blobId) return false;
  return state.routines.some((routine) => routine.music && routine.music.blobId === blobId)
    || (state.audios || []).some((audio) => audio.blobId === blobId)
    || storedRunVideos().some((video) => video.music && video.music.blobId === blobId);
}
async function deleteRunVideoMusicBlobIfUnused(blobId) {
  if (blobId && !runVideoMusicBlobIsReferenced(blobId)) await blobDel(blobId);
}
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

function runVideoMusicBounds(meta, audio) {
  const mediaDuration = audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
  const full = mediaDuration || Number(meta && meta.fullDuration) || 0;
  const start = Math.max(0, Math.min(Number(meta && meta.trimStart) || 0, full || Infinity));
  const rawEnd = meta && meta.trimEnd != null ? Number(meta.trimEnd) : full;
  const end = full
    ? Math.max(start, Math.min(Number.isFinite(rawEnd) ? rawEnd : full, full))
    : Math.max(start, Number.isFinite(rawEnd) ? rawEnd : start);
  return { start, end, duration: Math.max(0, end - start) };
}
function setRunVideoSyncStatus(message, needsTap = false) {
  const status = document.getElementById("run-video-audio-status");
  if (status) status.textContent = message;
  const unlock = document.getElementById("run-video-audio-unlock");
  if (unlock) unlock.hidden = !needsTap;
}
function syncRunVideoAudioPosition(force = false) {
  const sync = runVideoSyncState;
  if (!sync || !sync.audio || !sync.music) return;
  const bounds = runVideoMusicBounds(sync.music, sync.audio);
  const relative = Math.max(0, Math.min(sync.video.currentTime || 0, bounds.duration || Infinity));
  const expected = bounds.start + relative;
  if (!Number.isFinite(expected)) return;
  if (force || Math.abs((sync.audio.currentTime || 0) - expected) > 0.16) {
    try { sync.audio.currentTime = expected; } catch (_) {}
  }
}
function stopRunVideoSyncLoop() {
  if (runVideoSyncRaf) cancelAnimationFrame(runVideoSyncRaf);
  runVideoSyncRaf = 0;
}
function runVideoSyncTick() {
  const sync = runVideoSyncState;
  if (!sync || sync.video.paused || sync.video.ended) { runVideoSyncRaf = 0; return; }
  syncRunVideoAudioPosition(false);
  runVideoSyncRaf = requestAnimationFrame(runVideoSyncTick);
}
function startRunVideoSyncLoop() {
  if (!runVideoSyncRaf) runVideoSyncRaf = requestAnimationFrame(runVideoSyncTick);
}
function tryPlayRunVideoAudio() {
  const sync = runVideoSyncState;
  if (!sync || !sync.audio) return;
  syncRunVideoAudioPosition(true);
  sync.audio.playbackRate = sync.video.playbackRate || 1;
  sync.audio.volume = musicVolume;
  const playing = sync.audio.play();
  if (playing && playing.then) {
    playing.then(() => setRunVideoSyncStatus(isEnglish()
      ? "Music is synced to video playback and seeking"
      : "映像の再生・一時停止・シークに同期中"))
      .catch(() => setRunVideoSyncStatus(isEnglish()
        ? "Tap to start the synced music"
        : "音源を開始するにはタップしてください", true));
  }
}
function stopRunVideoAudioSync() {
  stopRunVideoSyncLoop();
  if (runVideoSyncState && runVideoSyncState.audio) runVideoSyncState.audio.pause();
  runVideoSyncState = null;
}
function bindRunVideoAudioSync(music) {
  stopRunVideoAudioSync();
  const video = document.getElementById("run-video-player");
  const audio = document.getElementById("run-video-audio");
  if (!video || !audio || !music) return;
  runVideoSyncState = { video, audio, music };
  preserveMediaPitch(audio);
  audio.volume = musicVolume;
  audio.addEventListener("loadedmetadata", () => syncRunVideoAudioPosition(true));
  audio.addEventListener("error", () => setRunVideoSyncStatus(isEnglish()
    ? "The linked music could not be played"
    : "紐づいた音源を再生できませんでした"));
  video.addEventListener("play", () => { tryPlayRunVideoAudio(); startRunVideoSyncLoop(); });
  video.addEventListener("playing", () => { tryPlayRunVideoAudio(); startRunVideoSyncLoop(); });
  video.addEventListener("pause", () => { audio.pause(); stopRunVideoSyncLoop(); });
  video.addEventListener("ended", () => { audio.pause(); stopRunVideoSyncLoop(); syncRunVideoAudioPosition(true); });
  video.addEventListener("seeking", () => syncRunVideoAudioPosition(true));
  video.addEventListener("seeked", () => {
    syncRunVideoAudioPosition(true);
    if (!video.paused && !video.ended) tryPlayRunVideoAudio();
  });
  video.addEventListener("ratechange", () => {
    audio.playbackRate = video.playbackRate || 1;
    preserveMediaPitch(audio);
  });
}
window.runVideoUnlockAudio = () => {
  const sync = runVideoSyncState;
  if (!sync) return;
  syncRunVideoAudioPosition(true);
  // iOSで別メディアの自動開始が抑止された場合も、この直接タップで映像と音源を同時に開始する。
  const audioPlay = sync.audio.play();
  const videoPlay = sync.video.paused ? sync.video.play() : null;
  Promise.allSettled([audioPlay, videoPlay].filter(Boolean)).then((results) => {
    if (results.some((result) => result.status === "rejected")) {
      setRunVideoSyncStatus(isEnglish() ? "Could not start the linked music" : "紐づいた音源を開始できませんでした", true);
    } else {
      setRunVideoSyncStatus(isEnglish()
        ? "Music is synced to video playback and seeking"
        : "映像の再生・一時停止・シークに同期中");
      startRunVideoSyncLoop();
    }
  });
};
function runVideoAudioSyncMarkup(music, musicAvailable) {
  if (!music) return `<div class="run-video-audio-sync is-video-only"><b>${isEnglish() ? "Video only" : "映像のみ"}</b><span>${isEnglish() ? "No music was assigned when this run was recorded" : "この通しには対象音源がありません"}</span></div>`;
  if (!musicAvailable) return `<div class="run-video-audio-sync is-missing"><b>♪ ${esc(music.name || (isEnglish() ? "Linked music" : "対象音源"))}</b><span>${isEnglish() ? "Music data is missing on this device" : "この端末に音源データが見つかりません"}</span></div>`;
  return `<div class="run-video-audio-sync">
    <div><b>♪ ${esc(music.name || (isEnglish() ? "Linked music" : "対象音源"))}</b><span id="run-video-audio-status">${isEnglish() ? "Playback, pause, and seeking follow the video" : "映像の再生・一時停止・シークに追従します"}</span></div>
    <button type="button" class="btn small" id="run-video-audio-unlock" hidden onclick="runVideoUnlockAudio()">${isEnglish() ? "Play music" : "♪ 音源を再生"}</button>
  </div>`;
}

// 音源終了直後の一時映像を、結果確定前でも繰り返し確認する。
// シートを閉じても stoppedRunVideoCapture は残し、結果入力後の保存確認へ引き継ぐ。
window.previewStoppedRunVideo = async (routineId) => {
  const capture = stoppedRunVideoCapture;
  if (!capture || capture.routineId !== routineId) return toast("確認できる撮影映像がありません");
  return withLoading("撮影映像を準備中…", async () => {
    const music = runVideoMusicMeta(capture);
    const musicBlob = music ? await blobGet(music.blobId) : null;
    if (stoppedRunVideoCapture !== capture) return toast("確認できる撮影映像がありません");
    releaseSheetMedia();
    sheetVideoUrl = URL.createObjectURL(capture.blob);
    sheetRunMusicUrl = musicBlob ? URL.createObjectURL(musicBlob) : null;
    showSheet(`
      <h3>今撮った通し映像</h3>
      <div class="sheet-sub">結果を記録する前の確認です。閉じると通し練習画面へ戻ります。</div>
      <div class="sheet-sub">${uiText(runVideoProfile(capture).label)} / ${isEnglish() ? "Recorded without audio" : "撮影音声なし"} / ${fmtTimeFine(capture.duration)} / ${fmtBytes(capture.size)}</div>
      <video id="run-video-player" class="run-video-review" style="${runVideoAspectStyle(capture)}" src="${sheetVideoUrl}" controls playsinline preload="metadata"></video>
      ${sheetRunMusicUrl ? `<audio id="run-video-audio" src="${sheetRunMusicUrl}" preload="auto"></audio>` : ""}
      ${runVideoAudioSyncMarkup(music, !!sheetRunMusicUrl)}
      <button class="btn primary" onclick="hideSheet()">通し結果の記録へ戻る</button>`);
    if (sheetRunMusicUrl) bindRunVideoAudioSync(music);
  });
};

// 保存済み演技映像の容量管理。映像本体だけを削除し、ルーティンと練習記録は保持する。
async function removeRunVideo(id, shouldRender = true) {
  const video = storedRunVideos().find((item) => item.id === id);
  if (!video) return false;
  const musicBlobId = video.music && video.music.blobId;
  const found = findRunRecord(video.sessionId, video.runId);
  if (found.run && found.run.videoId === id) delete found.run.videoId;
  state.runVideos = storedRunVideos().filter((item) => item.id !== id);
  await blobDel(video.blobId);
  await deleteRunVideoMusicBlobIfUnused(musicBlobId);
  saveState();
  if (shouldRender) render();
  return true;
}
window.runVideoDelete = async (id) => {
  if (!appConfirm("この通し映像を削除しますか？元に戻せません。")) return;
  hideSheet();
  if (await removeRunVideo(id)) toast("通し映像を削除しました");
};
window.showDeleteAllRunVideos = () => {
  const videos = storedRunVideos();
  if (!videos.length) return toast(isEnglish() ? "No performance videos to delete" : "削除する演技映像はありません");
  const totalBytes = runVideoStorageBytes(videos);
  const countText = isEnglish()
    ? `${videos.length} performance videos · ${fmtBytes(totalBytes)}`
    : `演技映像${videos.length}本・${fmtBytes(totalBytes)}`;
  showSheet(`
    <h3>${isEnglish() ? "Delete all performance videos" : "演技映像をまとめて削除"}</h3>
    <div class="delete-media-summary"><span aria-hidden="true">▣</span><b>${countText}</b></div>
    <div class="delete-routine-warning">
      <strong>${isEnglish() ? "This cannot be undone" : "この操作は元に戻せません"}</strong>
      <span>${isEnglish() ? "Only the saved full-run video files will be deleted." : "アプリ内に保存した通し練習の映像だけを削除します。"}</span>
      <p>${isEnglish()
        ? "Routines, practice records, issue markers, skill videos, music, and files already exported to Photos or Files will remain."
        : "ルーティン・練習記録・失敗地点・技動画・音源・写真やファイルへ書き出した映像は残ります。"}</p>
    </div>
    <div class="delete-slide-wrap">
      <div class="delete-slide-track" id="delete-run-videos-slide" role="slider" tabindex="0"
        aria-label="${isEnglish() ? "Slide all the way right to delete performance videos" : "右端までスライドして演技映像を削除"}"
        aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" onkeydown="runVideoBulkDeleteKey(event)">
        <div class="delete-slide-fill"></div>
        <span class="delete-slide-copy">${isEnglish() ? "Slide right to delete" : "右へスライドして削除"}</span>
        <button class="delete-slide-handle" type="button"
          aria-label="${isEnglish() ? "Performance video delete slider" : "演技映像の削除スライダー"}"
          onpointerdown="startRunVideoBulkDeleteSlide(event)">✕</button>
      </div>
      <div class="delete-slide-help">${isEnglish() ? "Move to the right edge and release to delete" : "右端まで動かして指を離すと削除されます"}</div>
    </div>
    <button class="btn ghost" onclick="hideSheet()">${isEnglish() ? "Cancel" : "キャンセル"}</button>`);
};

async function performRunVideoBulkDelete() {
  const videos = [...storedRunVideos()];
  if (!videos.length) {
    hideSheet();
    return toast(isEnglish() ? "No performance videos to delete" : "削除する演技映像はありません");
  }
  const videoIds = new Set(videos.map((video) => video.id));
  const musicBlobIds = new Set(videos.map((video) => video.music && video.music.blobId).filter(Boolean));
  hideSheet();
  state.runVideos = [];
  for (const session of state.sessions) {
    for (const run of session.runs || []) {
      if (videoIds.has(run.videoId)) delete run.videoId;
    }
  }
  await Promise.all(videos.map((video) => blobDel(video.blobId)));
  for (const blobId of musicBlobIds) await deleteRunVideoMusicBlobIfUnused(blobId);
  saveState();
  render();
  toast(isEnglish()
    ? `Deleted ${videos.length} performance video${videos.length === 1 ? "" : "s"}`
    : `${videos.length}本の演技映像を削除しました`);
}
