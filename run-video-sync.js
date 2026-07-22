/* ルーティンノート — 音源入り通し映像と旧別音源映像の再生互換 */
"use strict";

let sheetRunMusicUrl = null;
let runVideoSyncState = null; // { video, audio, music, wantsPlayback, seeking, resumeAfterSeek, playRequest }
let runVideoSyncRaf = 0;
let runVideoEmbeddedDelayState = null; // { video, context, source, delayNode }

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
  if (video && video.composition && video.composition.music) {
    return cloneRunVideoMusicMeta(video.composition.music);
  }
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
    // 音源入り映像は単体で再生できるため、元音源Blobを保持し続ける必要はない。
    if (!Object.prototype.hasOwnProperty.call(video, "music") && !runVideoHasEmbeddedAudio(video)) {
      video.music = { ...snapshot };
    }
    if (runVideoNeedsLinkedMusic(video) && video.music && video.music.blobId === snapshot.blobId) referenced = true;
  }
  return referenced;
}
function runVideoMusicBlobIsReferenced(blobId) {
  if (!blobId) return false;
  return state.routines.some((routine) => routine.music && routine.music.blobId === blobId)
    || (state.audios || []).some((audio) => audio.blobId === blobId)
    || storedRunVideos().some((video) => runVideoNeedsLinkedMusic(video)
      && video.music && video.music.blobId === blobId);
}
async function deleteRunVideoMusicBlobIfUnused(blobId) {
  if (blobId && !runVideoMusicBlobIsReferenced(blobId)) await blobDel(blobId);
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
function tryPlayRunVideoAudio(syncPosition = true) {
  const sync = runVideoSyncState;
  if (!sync || !sync.audio) return;
  if (syncPosition) syncRunVideoAudioPosition(true);
  sync.audio.playbackRate = sync.video.playbackRate || 1;
  sync.audio.volume = musicVolume;
  if (!sync.audio.paused) {
    setRunVideoSyncStatus(isEnglish() ? "Music is synced to video playback and seeking" : "映像の再生・一時停止・シークに同期中");
    return;
  }
  const request = ++sync.playRequest;
  let playing;
  try { playing = sync.audio.play(); }
  catch (_) { setRunVideoSyncStatus(isEnglish() ? "Tap to resume video and music" : "映像と音源を再開するにはタップしてください", true); return; }
  if (playing && playing.then) {
    playing.then(() => {
      if (runVideoSyncState === sync && request === sync.playRequest) setRunVideoSyncStatus(isEnglish()
        ? "Music is synced to video playback and seeking" : "映像の再生・一時停止・シークに同期中");
    }).catch(() => {
      if (runVideoSyncState === sync && request === sync.playRequest) setRunVideoSyncStatus(isEnglish()
        ? "Tap to resume video and music" : "映像と音源を再開するにはタップしてください", true);
    });
  }
  return playing;
}
function beginRunVideoSeek(sync) {
  sync.resumeAfterSeek = sync.wantsPlayback || (!sync.video.paused && !sync.video.ended);
  sync.seeking = true;
  sync.audio.pause();
  stopRunVideoSyncLoop();
  setRunVideoSyncStatus(isEnglish() ? "Moving to the selected position…" : "選んだ位置へ同期中…");
}
function finishRunVideoSeek(sync) {
  syncRunVideoAudioPosition(true);
  const shouldResume = sync.resumeAfterSeek && !sync.video.ended;
  sync.resumeAfterSeek = false;
  if (!shouldResume) { sync.seeking = false; return; }
  sync.wantsPlayback = true;
  const tasks = [];
  try { if (sync.video.paused) tasks.push(sync.video.play()); } catch (_) {}
  const audioPlay = tryPlayRunVideoAudio(false);
  if (audioPlay) tasks.push(audioPlay);
  sync.seeking = false;
  startRunVideoSyncLoop();
  Promise.allSettled(tasks.filter(Boolean)).then((results) => {
    if (runVideoSyncState === sync && results.some((result) => result.status === "rejected")) {
      setRunVideoSyncStatus(isEnglish() ? "Tap to resume video and music" : "映像と音源を再開するにはタップしてください", true);
    }
  });
}
function stopRunVideoAudioSync() {
  stopRunVideoSyncLoop();
  if (runVideoSyncState && runVideoSyncState.audio) runVideoSyncState.audio.pause();
  runVideoSyncState = null;
  stopRunVideoEmbeddedAudioDelay();
}
function bindRunVideoAudioSync(music) {
  stopRunVideoAudioSync();
  const video = document.getElementById("run-video-player");
  const audio = document.getElementById("run-video-audio");
  if (!video || !audio || !music) return;
  runVideoSyncState = { video, audio, music, wantsPlayback: false, seeking: false, resumeAfterSeek: false, playRequest: 0 };
  const sync = runVideoSyncState;
  preserveMediaPitch(audio);
  audio.volume = musicVolume;
  audio.addEventListener("loadedmetadata", () => syncRunVideoAudioPosition(true));
  audio.addEventListener("error", () => setRunVideoSyncStatus(isEnglish()
    ? "The linked music could not be played"
    : "紐づいた音源を再生できませんでした"));
  const onPlay = () => {
    sync.wantsPlayback = true;
    if (sync.seeking || video.seeking) return;
    tryPlayRunVideoAudio(); startRunVideoSyncLoop();
  };
  video.addEventListener("play", onPlay);
  video.addEventListener("playing", onPlay);
  video.addEventListener("pause", () => {
    audio.pause(); stopRunVideoSyncLoop();
    if (!sync.seeking && !video.seeking) { sync.wantsPlayback = false; sync.resumeAfterSeek = false; }
  });
  video.addEventListener("ended", () => {
    sync.wantsPlayback = false; sync.resumeAfterSeek = false;
    audio.pause(); stopRunVideoSyncLoop(); syncRunVideoAudioPosition(true);
  });
  video.addEventListener("seeking", () => beginRunVideoSeek(sync));
  video.addEventListener("seeked", () => finishRunVideoSeek(sync));
  video.addEventListener("ratechange", () => {
    audio.playbackRate = video.playbackRate || 1;
    preserveMediaPitch(audio);
  });
}
window.runVideoUnlockAudio = () => {
  const sync = runVideoSyncState;
  if (!sync) return;
  sync.wantsPlayback = true;
  sync.seeking = false;
  sync.resumeAfterSeek = false;
  syncRunVideoAudioPosition(true);
  // iOSで別メディアの自動開始が抑止された場合も、この直接タップで映像と音源を同時に開始する。
  const audioPlay = tryPlayRunVideoAudio(false);
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
    <button type="button" class="btn small" id="run-video-audio-unlock" hidden onclick="runVideoUnlockAudio()">${isEnglish() ? "Resume video and music" : "▶ 映像と音源を再開"}</button>
  </div>`;
}
function runVideoAudioLabel(video) {
  const mode = runVideoAudioMode(video);
  if (mode === "embedded") return isEnglish() ? "Music embedded" : "音源入り";
  if (mode === "linked") return isEnglish() ? "Linked music playback" : "別音源同期";
  return isEnglish() ? "Video only" : "映像のみ";
}
function runVideoPlaybackAudioMarkup(video, music, musicAvailable) {
  if (!runVideoHasEmbeddedAudio(video)) return runVideoAudioSyncMarkup(music, musicAvailable);
  return `<div class="run-video-audio-sync is-embedded">
    <div><b>♪ ${esc((music && music.name) || (isEnglish() ? "Recorded music" : "収録音源"))}</b>
      <span>${isEnglish() ? "The music is recorded in this video. Playback and seeking use one timeline." : "音源は映像に収録済みです。再生・一時停止・シークは一つの時間軸で動きます。"}</span></div>
  </div>`;
}

function stopRunVideoEmbeddedAudioDelay() {
  const active = runVideoEmbeddedDelayState;
  runVideoEmbeddedDelayState = null;
  if (!active) return;
  try { active.source.disconnect(); } catch (_) {}
  try { active.delayNode.disconnect(); } catch (_) {}
  try { active.context.close(); } catch (_) {}
}

function resumeRunVideoEmbeddedAudioDelay() {
  const active = runVideoEmbeddedDelayState;
  if (!active || active.context.state !== "suspended") return;
  try {
    const resumed = active.context.resume();
    if (resumed && resumed.catch) resumed.catch(() => {});
  } catch (_) {}
}

function bindRunVideoEmbeddedAudioDelay(video) {
  const player = document.getElementById("run-video-player");
  if (!player || !runVideoHasEmbeddedAudio(video)) return false;
  const playbackDelay = runVideoPlaybackAudioDelay(video);
  if (runVideoEmbeddedDelayState && runVideoEmbeddedDelayState.video === player) {
    const active = runVideoEmbeddedDelayState;
    if (active.delayNode.delayTime) {
      if (typeof active.delayNode.delayTime.setValueAtTime === "function") {
        active.delayNode.delayTime.setValueAtTime(playbackDelay, Number(active.context.currentTime) || 0);
      } else active.delayNode.delayTime.value = playbackDelay;
    }
    resumeRunVideoEmbeddedAudioDelay();
    return true;
  }
  if (playbackDelay <= 0) return false;
  stopRunVideoEmbeddedAudioDelay();
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  let context = null;
  let source = null;
  let delayNode = null;
  try {
    context = new AC();
    source = context.createMediaElementSource(player);
    delayNode = context.createDelay(RUN_VIDEO_AUDIO_DELAY_MAX_SECONDS);
    if (delayNode.delayTime && typeof delayNode.delayTime.setValueAtTime === "function") {
      delayNode.delayTime.setValueAtTime(playbackDelay, Number(context.currentTime) || 0);
    } else if (delayNode.delayTime) delayNode.delayTime.value = playbackDelay;
    source.connect(delayNode);
    delayNode.connect(context.destination);
    runVideoEmbeddedDelayState = { video: player, context, source, delayNode };
    player.addEventListener("play", resumeRunVideoEmbeddedAudioDelay);
    player.addEventListener("playing", resumeRunVideoEmbeddedAudioDelay);
    player.addEventListener("pointerdown", resumeRunVideoEmbeddedAudioDelay);
    resumeRunVideoEmbeddedAudioDelay();
    return true;
  } catch (_) {
    try { if (source) source.disconnect(); } catch (_) {}
    try { if (delayNode) delayNode.disconnect(); } catch (_) {}
    try { if (context) context.close(); } catch (_) {}
    return false;
  }
}

function runVideoSyncDelayNote(video) {
  const desired = runVideoDesiredAudioDelay(video);
  const recorded = runVideoRecordingAudioDelay(video);
  if (desired < recorded) {
    return isEnglish()
      ? `This video already contains ${recorded.toFixed(2)} sec of delay, so it cannot be reduced without rebuilding the file. ${desired.toFixed(2)} sec will be used for the next recording.`
      : `この映像には${recorded.toFixed(2)}秒を収録済みのため、ファイルを作り直さずには戻せません。次回撮影には${desired.toFixed(2)}秒を使います。`;
  }
  return isEnglish()
    ? "This video is corrected during in-app playback. The same value is built into the next recording; the current file is not rebuilt."
    : "この映像はアプリ内再生で補正します。同じ値を次回撮影へ収録時から反映し、現在のファイル自体は作り直しません。";
}

function runVideoSyncDelayMarkup(video, target, id = "") {
  if (!runVideoHasEmbeddedAudio(video)) return "";
  const value = runVideoDesiredAudioDelay(video);
  return `<section class="run-video-sync-adjust" aria-labelledby="run-video-sync-delay-title">
    <div class="run-video-sync-adjust-head">
      <div><b id="run-video-sync-delay-title">${isEnglish() ? "Audio sync correction" : "映像と音源の同期補正"}</b>
        <span>${isEnglish() ? "If the video looks late, move the music later." : "映像が遅く見えるとき、音源を後ろへ送ります。"}</span></div>
      <output id="run-video-sync-delay-value">${value.toFixed(2)}${isEnglish() ? " sec" : "秒"}</output>
    </div>
    <input id="run-video-sync-delay" type="range" min="0" max="${RUN_VIDEO_AUDIO_DELAY_MAX_SECONDS}" step="0.05" value="${value.toFixed(2)}"
      aria-label="${isEnglish() ? "Delay recorded music" : "収録音源を遅らせる"}"
      oninput="runVideoSetSyncDelay('${target}','${esc(id)}',this.value)">
    <div class="run-video-sync-adjust-scale"><span>${isEnglish() ? "No correction" : "補正なし"}</span><span>${isEnglish() ? "Music +1.00 sec" : "音源を1.00秒遅らせる"}</span></div>
    <small id="run-video-sync-delay-note">${esc(runVideoSyncDelayNote(video))}</small>
  </section>`;
}

function runVideoSyncDelayTarget(target, id) {
  if (target === "stopped") return stoppedRunVideoCapture;
  if (target === "pending") return pendingRunVideo;
  if (target === "saved") return storedRunVideos().find((video) => video.id === id) || null;
  return null;
}

window.runVideoSetSyncDelay = (target, id, value) => {
  const video = runVideoSyncDelayTarget(target, id);
  if (!video || !runVideoHasEmbeddedAudio(video)) return;
  const result = setRunVideoDesiredAudioDelay(video, value);
  savePreferredRunVideoAudioDelay(result.desired);
  if (target === "saved") saveState();
  const output = document.getElementById("run-video-sync-delay-value");
  if (output) output.textContent = `${result.desired.toFixed(2)}${isEnglish() ? " sec" : "秒"}`;
  const note = document.getElementById("run-video-sync-delay-note");
  if (note) note.textContent = runVideoSyncDelayNote(video);
  bindRunVideoEmbeddedAudioDelay(video);
};

// 音源終了直後の一時映像を、結果確定前でも繰り返し確認する。
// シートを閉じても stoppedRunVideoCapture は残し、結果入力後の保存確認へ引き継ぐ。
window.previewStoppedRunVideo = async (routineId) => {
  const capture = stoppedRunVideoCapture;
  if (!capture || capture.routineId !== routineId) return toast("確認できる撮影映像がありません");
  return withLoading("撮影映像を準備中…", async () => {
    const music = runVideoMusicMeta(capture);
    const needsLinkedMusic = runVideoNeedsLinkedMusic(capture);
    const musicBlob = needsLinkedMusic && music ? await blobGet(music.blobId) : null;
    if (stoppedRunVideoCapture !== capture) return toast("確認できる撮影映像がありません");
    releaseSheetMedia();
    sheetVideoUrl = URL.createObjectURL(capture.blob);
    sheetRunMusicUrl = musicBlob ? URL.createObjectURL(musicBlob) : null;
    showSheet(`
      <h3>今撮った通し映像</h3>
      <div class="sheet-sub">結果を記録する前の確認です。閉じると通し練習画面へ戻ります。</div>
      <div class="sheet-sub">${uiText(runVideoProfile(capture).label)} / ${runVideoAudioLabel(capture)} / ${fmtTimeFine(capture.duration)} / ${fmtBytes(capture.size)}</div>
      <video id="run-video-player" class="run-video-review" style="${runVideoAspectStyle(capture)}" src="${sheetVideoUrl}" controls playsinline preload="metadata"></video>
      ${needsLinkedMusic && sheetRunMusicUrl ? `<audio id="run-video-audio" src="${sheetRunMusicUrl}" preload="auto"></audio>` : ""}
      ${runVideoPlaybackAudioMarkup(capture, music, !!sheetRunMusicUrl)}
      ${runVideoSyncDelayMarkup(capture, "stopped")}
      <button class="btn primary" onclick="hideSheet()">通し結果の記録へ戻る</button>`);
    if (needsLinkedMusic && sheetRunMusicUrl) bindRunVideoAudioSync(music);
    else bindRunVideoEmbeddedAudioDelay(capture);
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
