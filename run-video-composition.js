/* ルーティンノート — 通し映像と音源を一つの完成映像へまとめる共通境界 */
"use strict";

// Web版はカメラ映像だけを先に記録し、保存時にCanvas＋Web Audioで音源を合成する。
// 将来のiOS／Android版は、このレシピをネイティブの撮影後合成へ渡し、
// 同じ完成形式（音源入りの単一動画）を返す。
const RUN_VIDEO_COMPOSITION_VERSION = 1;
const RUN_VIDEO_AUDIO_DELAY_MAX_SECONDS = 1;

function normalizeRunVideoAudioDelay(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const clamped = Math.max(0, Math.min(RUN_VIDEO_AUDIO_DELAY_MAX_SECONDS, number));
  return Math.round(clamped * 20) / 20; // UIと同じ0.05秒刻み
}

function runVideoRecordingAudioDelay(video) {
  const timelineValue = video && video.composition && video.composition.timeline
    ? video.composition.timeline.recordingAudioDelaySeconds : null;
  const value = timelineValue != null ? timelineValue : video && video.recordingAudioDelaySeconds;
  return normalizeRunVideoAudioDelay(value);
}

function runVideoDesiredAudioDelay(video) {
  if (video && video.syncAudioDelaySeconds != null) return normalizeRunVideoAudioDelay(video.syncAudioDelaySeconds);
  return normalizeRunVideoAudioDelay(runVideoRecordingAudioDelay(video)
    + Number(video && video.playbackAudioDelaySeconds || 0));
}

function runVideoPlaybackAudioDelay(video) {
  return normalizeRunVideoAudioDelay(Math.max(0,
    runVideoDesiredAudioDelay(video) - runVideoRecordingAudioDelay(video)));
}

function setRunVideoDesiredAudioDelay(video, value) {
  if (!video) return { desired: 0, recorded: 0, playback: 0, belowRecorded: false };
  const desired = normalizeRunVideoAudioDelay(value);
  const recorded = runVideoRecordingAudioDelay(video);
  const playback = normalizeRunVideoAudioDelay(Math.max(0, desired - recorded));
  video.syncAudioDelaySeconds = desired;
  video.playbackAudioDelaySeconds = playback;
  return { desired, recorded, playback, belowRecorded: desired < recorded };
}

function preferredRunVideoAudioDelay() {
  try { return normalizeRunVideoAudioDelay(localStorage.getItem("rd_run_video_audio_delay")); }
  catch (_) { return 0; }
}

function savePreferredRunVideoAudioDelay(value) {
  const normalized = normalizeRunVideoAudioDelay(value);
  try { localStorage.setItem("rd_run_video_audio_delay", String(normalized)); } catch (_) {}
  return normalized;
}

function runVideoCompositionMusicSnapshot(music) {
  if (!music || !music.blobId) return null;
  const numberOrNull = (value) => value == null || value === "" || !Number.isFinite(Number(value))
    ? null : Number(value);
  return {
    blobId: String(music.blobId),
    name: String(music.name || ""),
    fullDuration: numberOrNull(music.fullDuration),
    trimStart: Math.max(0, numberOrNull(music.trimStart) || 0),
    trimEnd: numberOrNull(music.trimEnd),
    duration: numberOrNull(music.duration),
  };
}

function createRunVideoCompositionRecipe(music, options = {}) {
  const snapshot = runVideoCompositionMusicSnapshot(music);
  const requestedMode = options.audioMode || (snapshot ? "embedded" : "none");
  const audioMode = snapshot && ["embedded", "linked"].includes(requestedMode) ? requestedMode : "none";
  const gain = Number.isFinite(Number(options.recordingGain)) ? Math.max(0, Number(options.recordingGain)) : 1;
  const recordingAudioDelaySeconds = audioMode === "embedded"
    ? normalizeRunVideoAudioDelay(options.recordingAudioDelaySeconds) : 0;
  const musicOffsetSeconds = Number.isFinite(Number(options.musicOffsetSeconds))
    ? Math.max(0, Number(options.musicOffsetSeconds)) : 0;
  return {
    version: RUN_VIDEO_COMPOSITION_VERSION,
    engine: String(options.engine || "web-realtime"),
    output: "single-video",
    audio: {
      mode: audioMode,
      source: snapshot ? "routine-music" : "none",
      recordingGain: gain,
      microphone: false,
    },
    timeline: {
      videoStartSeconds: 0,
      musicOffsetSeconds,
      trimStartSeconds: snapshot ? snapshot.trimStart : 0,
      trimEndSeconds: snapshot ? snapshot.trimEnd : null,
      recordingAudioDelaySeconds,
    },
    music: snapshot,
  };
}

function runVideoAudioMode(video) {
  const recipeMode = video && video.composition && video.composition.audio && video.composition.audio.mode;
  if (["embedded", "linked", "none"].includes(recipeMode)) return recipeMode;
  if (video && (video.audioMode === "embedded" || video.audio === true || video.audioEmbedded === true)) return "embedded";
  if (video && (video.music || video.audioMode === "linked")) return "linked";
  if (video && !Object.prototype.hasOwnProperty.call(video, "audioMode")
      && !Object.prototype.hasOwnProperty.call(video, "audio")
      && !Object.prototype.hasOwnProperty.call(video, "composition")) return "linked";
  return "none";
}

function runVideoHasEmbeddedAudio(video) { return runVideoAudioMode(video) === "embedded"; }
function runVideoNeedsLinkedMusic(video) { return runVideoAudioMode(video) === "linked"; }

function stopRunVideoCompositionTrack(track) {
  try { if (track && track.readyState !== "ended") track.stop(); } catch (_) {}
}

function runVideoPostCompositionSupport() {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return { supported: false, reason: "dom-unavailable" };
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  const canvas = document.createElement("canvas");
  if (typeof MediaRecorder !== "function" || typeof MediaStream !== "function") {
    return { supported: false, reason: "media-recorder-unavailable" };
  }
  if (!canvas || typeof canvas.captureStream !== "function") {
    return { supported: false, reason: "canvas-capture-unavailable" };
  }
  if (!AC) return { supported: false, reason: "web-audio-unavailable" };
  return { supported: true, reason: "", AudioContext: AC };
}

function runVideoPostCompositionMimeType() {
  if (typeof MediaRecorder !== "function") return "";
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  if (typeof MediaRecorder.isTypeSupported !== "function") return "";
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function createRunVideoPostCompositionPlan(capture = {}, videoMeta = {}, audioMeta = {}) {
  const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
  const music = runVideoCompositionMusicSnapshot(capture.music);
  const mediaDuration = positive(videoMeta.duration);
  const requestedDuration = positive(capture.duration);
  const duration = requestedDuration && mediaDuration
    ? Math.min(requestedDuration, mediaDuration) : (requestedDuration || mediaDuration);
  const audioDuration = positive(audioMeta.duration) || positive(music && music.fullDuration);
  const trimStart = Math.max(0, Number(music && music.trimStart) || 0);
  const rawTrimEnd = music && music.trimEnd != null ? Number(music.trimEnd) : audioDuration;
  const trimEnd = audioDuration
    ? Math.max(trimStart, Math.min(Number.isFinite(rawTrimEnd) ? rawTrimEnd : audioDuration, audioDuration))
    : Math.max(trimStart, Number.isFinite(rawTrimEnd) ? rawTrimEnd : trimStart + duration);
  return {
    width: Math.max(2, Math.round(positive(capture.captureWidth) || positive(videoMeta.width) || 960)),
    height: Math.max(2, Math.round(positive(capture.captureHeight) || positive(videoMeta.height) || 720)),
    duration,
    trimStart,
    trimEnd,
    audioDelaySeconds: normalizeRunVideoAudioDelay(capture.syncAudioDelaySeconds != null
      ? capture.syncAudioDelaySeconds : capture.requestedAudioDelaySeconds),
    music,
  };
}

function runVideoPostCompositionError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function waitForRunVideoMedia(media, minimumReadyState, signal, timeoutMs = 30000) {
  if (media.readyState >= minimumReadyState) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const eventName = minimumReadyState >= 2 ? "loadeddata" : "loadedmetadata";
    let timer = null;
    const cleanup = () => {
      clearTimeout(timer);
      media.removeEventListener(eventName, ready);
      media.removeEventListener("error", failed);
      if (signal) signal.removeEventListener("abort", aborted);
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(runVideoPostCompositionError("media-load-failed", "Source media could not be loaded")); };
    const aborted = () => { cleanup(); reject(runVideoPostCompositionError("aborted", "Composition was cancelled")); };
    media.addEventListener(eventName, ready, { once: true });
    media.addEventListener("error", failed, { once: true });
    if (signal) signal.addEventListener("abort", aborted, { once: true });
    timer = setTimeout(() => { cleanup(); reject(runVideoPostCompositionError("media-load-timeout", "Source media timed out")); }, timeoutMs);
  });
}

function seekRunVideoMedia(media, time, signal) {
  const target = Math.max(0, Number(time) || 0);
  if (Math.abs((Number(media.currentTime) || 0) - target) < 0.02) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer = null;
    const cleanup = () => {
      clearTimeout(timer);
      media.removeEventListener("seeked", done);
      media.removeEventListener("error", failed);
      if (signal) signal.removeEventListener("abort", aborted);
    };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(runVideoPostCompositionError("media-seek-failed", "Source media could not seek")); };
    const aborted = () => { cleanup(); reject(runVideoPostCompositionError("aborted", "Composition was cancelled")); };
    media.addEventListener("seeked", done, { once: true });
    media.addEventListener("error", failed, { once: true });
    if (signal) signal.addEventListener("abort", aborted, { once: true });
    timer = setTimeout(() => { cleanup(); reject(runVideoPostCompositionError("media-seek-timeout", "Source media seek timed out")); }, 15000);
    try { media.currentTime = target; } catch (_) { failed(); }
  });
}

// 保存操作の時点で、カメラ映像をCanvasへ再描画し、対象音源をWeb Audioから加えて
// 一つのMediaStreamとして再録画する。MP3全体をPCMへ展開しないため、音源はmedia要素から逐次再生する。
async function composeRunVideoAfterCapture({
  capture, musicBlob, frameRate = 24, videoBitsPerSecond = 1500000,
  audioBitsPerSecond = 128000, signal = null, onProgress = null,
} = {}) {
  const support = runVideoPostCompositionSupport();
  if (!support.supported) throw runVideoPostCompositionError(support.reason, "Post composition is not supported");
  if (!capture || !capture.blob || !capture.blob.size || !musicBlob || !musicBlob.size || !capture.music) {
    throw runVideoPostCompositionError("source-missing", "Video or music source is missing");
  }
  if (signal && signal.aborted) throw runVideoPostCompositionError("aborted", "Composition was cancelled");

  const host = document.createElement("div");
  const video = document.createElement("video");
  const audio = document.createElement("audio");
  const canvas = document.createElement("canvas");
  const videoUrl = URL.createObjectURL(capture.blob);
  const musicUrl = URL.createObjectURL(musicBlob);
  let context = null;
  let source = null;
  let gain = null;
  let destination = null;
  let canvasStream = null;
  let combinedStream = null;
  let recorder = null;
  let drawRaf = 0;
  let frameCallback = 0;
  let audioStartTimer = null;
  let watchdog = null;
  let abortHandler = null;
  let lastProgressAt = 0;
  const chunks = [];
  const startedAt = Date.now();
  const cleanup = () => {
    clearTimeout(audioStartTimer);
    clearTimeout(watchdog);
    if (drawRaf) cancelAnimationFrame(drawRaf);
    if (frameCallback && typeof video.cancelVideoFrameCallback === "function") {
      try { video.cancelVideoFrameCallback(frameCallback); } catch (_) {}
    }
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
    try { video.pause(); } catch (_) {}
    try { audio.pause(); } catch (_) {}
    try { if (source) source.disconnect(); } catch (_) {}
    try { if (gain) gain.disconnect(); } catch (_) {}
    try { if (destination) destination.disconnect(); } catch (_) {}
    if (canvasStream) canvasStream.getTracks().forEach(stopRunVideoCompositionTrack);
    if (combinedStream) combinedStream.getAudioTracks().forEach(stopRunVideoCompositionTrack);
    try { if (context) context.close(); } catch (_) {}
    video.removeAttribute("src");
    audio.removeAttribute("src");
    try { video.load(); audio.load(); } catch (_) {}
    host.remove();
    URL.revokeObjectURL(videoUrl);
    URL.revokeObjectURL(musicUrl);
  };

  try {
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.setAttribute("playsinline", "");
    audio.preload = "auto";
    video.src = videoUrl;
    audio.src = musicUrl;
    host.append(video, audio, canvas);
    document.body.appendChild(host);

    context = new support.AudioContext();
    source = context.createMediaElementSource(audio);
    gain = context.createGain();
    destination = context.createMediaStreamDestination();
    if (gain.gain) gain.gain.value = 1;
    source.connect(gain);
    gain.connect(destination);
    const resumePromise = context.state === "suspended" ? context.resume() : Promise.resolve();
    // 保存ボタンの直接操作中に一度play()を要求し、iPhoneのメディア再生許可を確保する。
    let unlockPromise = Promise.resolve();
    try {
      const unlocking = audio.play();
      if (unlocking && unlocking.then) unlockPromise = unlocking.then(() => { audio.pause(); }).catch(() => {});
    } catch (_) {}
    await Promise.all([
      waitForRunVideoMedia(video, 2, signal),
      waitForRunVideoMedia(audio, 1, signal),
      resumePromise,
      unlockPromise,
    ]);
    audio.pause();

    const plan = createRunVideoPostCompositionPlan(capture, {
      duration: video.duration, width: video.videoWidth, height: video.videoHeight,
    }, { duration: audio.duration });
    if (!plan.duration) throw runVideoPostCompositionError("duration-missing", "Video duration is unavailable");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const drawing = canvas.getContext("2d", { alpha: false });
    if (!drawing) throw runVideoPostCompositionError("canvas-context-unavailable", "Canvas context is unavailable");
    await Promise.all([
      seekRunVideoMedia(video, 0, signal),
      seekRunVideoMedia(audio, plan.trimStart, signal),
    ]);
    drawing.fillStyle = "#000";
    drawing.fillRect(0, 0, plan.width, plan.height);
    drawing.drawImage(video, 0, 0, plan.width, plan.height);

    canvasStream = canvas.captureStream(Math.max(1, Number(frameRate) || 24));
    const canvasTrack = canvasStream.getVideoTracks()[0];
    const audioTrack = destination.stream && destination.stream.getAudioTracks()[0];
    if (!canvasTrack || !audioTrack) throw runVideoPostCompositionError("composition-track-missing", "Composition track is unavailable");
    combinedStream = new MediaStream();
    combinedStream.addTrack(canvasTrack);
    combinedStream.addTrack(audioTrack);
    const mimeType = runVideoPostCompositionMimeType();
    const recorderOptions = { videoBitsPerSecond, audioBitsPerSecond };
    if (mimeType) recorderOptions.mimeType = mimeType;
    try { recorder = new MediaRecorder(combinedStream, recorderOptions); }
    catch (_) { recorder = mimeType ? new MediaRecorder(combinedStream, { mimeType }) : new MediaRecorder(combinedStream); }
    recorder.addEventListener("dataavailable", (event) => { if (event.data && event.data.size) chunks.push(event.data); });

    let finishResolve;
    let finishReject;
    let finished = false;
    const finishPromise = new Promise((resolve, reject) => { finishResolve = resolve; finishReject = reject; });
    const finish = (error = null) => {
      if (finished) return;
      finished = true;
      error ? finishReject(error) : finishResolve();
    };
    abortHandler = () => finish(runVideoPostCompositionError("aborted", "Composition was cancelled"));
    if (signal) signal.addEventListener("abort", abortHandler, { once: true });
    video.addEventListener("ended", () => finish(), { once: true });
    video.addEventListener("error", () => finish(runVideoPostCompositionError("video-playback-failed", "Video playback failed")), { once: true });
    audio.addEventListener("error", () => finish(runVideoPostCompositionError("audio-playback-failed", "Music playback failed")), { once: true });
    audio.addEventListener("timeupdate", () => {
      if (plan.trimEnd > plan.trimStart && audio.currentTime >= plan.trimEnd) audio.pause();
    });
    video.addEventListener("timeupdate", () => {
      const current = Math.max(0, Number(video.currentTime) || 0);
      if (current >= plan.duration - 0.02) finish();
      const now = Date.now();
      if (typeof onProgress === "function" && now - lastProgressAt >= 180) {
        lastProgressAt = now;
        try { onProgress(Math.max(0, Math.min(0.995, current / plan.duration)), current, plan.duration); } catch (_) {}
      }
    });
    const drawFrame = () => {
      if (finished) return;
      try { drawing.drawImage(video, 0, 0, plan.width, plan.height); } catch (_) {}
      if (typeof video.requestVideoFrameCallback === "function") frameCallback = video.requestVideoFrameCallback(drawFrame);
      else drawRaf = requestAnimationFrame(drawFrame);
    };
    drawFrame();
    recorder.start(1000);
    if (typeof onProgress === "function") onProgress(0, 0, plan.duration);
    const playVideo = video.play();
    const playMusic = () => {
      if (finished) return;
      const playing = audio.play();
      if (playing && playing.catch) playing.catch(() => finish(runVideoPostCompositionError("audio-playback-blocked", "Music playback was blocked")));
    };
    if (plan.audioDelaySeconds > 0) audioStartTimer = setTimeout(playMusic, plan.audioDelaySeconds * 1000);
    else playMusic();
    if (playVideo && playVideo.catch) playVideo.catch(() => finish(runVideoPostCompositionError("video-playback-blocked", "Video playback was blocked")));
    watchdog = setTimeout(() => finish(runVideoPostCompositionError("composition-timeout", "Composition timed out")),
      Math.max(30000, (plan.duration + plan.audioDelaySeconds + 15) * 2000));
    await finishPromise;
    video.pause();
    audio.pause();
    if (typeof onProgress === "function") onProgress(1, plan.duration, plan.duration);
    if (recorder.state !== "inactive") {
      await new Promise((resolve) => {
        recorder.addEventListener("stop", resolve, { once: true });
        try { recorder.stop(); } catch (_) { resolve(); }
      });
    }
    const outputType = recorder.mimeType || mimeType || "video/mp4";
    const blob = new Blob(chunks, { type: outputType });
    if (!blob.size) throw runVideoPostCompositionError("output-empty", "Composed video is empty");
    return {
      blob,
      mimeType: outputType,
      size: blob.size,
      duration: plan.duration,
      width: plan.width,
      height: plan.height,
      audioDelaySeconds: plan.audioDelaySeconds,
      elapsedMs: Math.max(0, Date.now() - startedAt),
    };
  } catch (error) {
    try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch (_) {}
    throw error;
  } finally {
    cleanup();
  }
}

// 生のカメラ映像を、保存前の一時データとして共通形式へそろえる。
// ネイティブ版でも同じ中間形式からAVFoundation／Media3の合成処理へ渡せる。
async function finalizeRunVideoComposition(capture) {
  const music = runVideoCompositionMusicSnapshot(capture && capture.music);
  const audioMode = music ? (capture && capture.audioEmbedded ? "embedded" : "linked") : "none";
  const recordingAudioDelaySeconds = audioMode === "embedded"
    ? normalizeRunVideoAudioDelay(capture && capture.recordingAudioDelaySeconds) : 0;
  const desiredAudioDelaySeconds = normalizeRunVideoAudioDelay(capture && capture.syncAudioDelaySeconds != null
    ? capture.syncAudioDelaySeconds
    : capture && capture.requestedAudioDelaySeconds != null
      ? capture.requestedAudioDelaySeconds : recordingAudioDelaySeconds);
  const composition = createRunVideoCompositionRecipe(music, {
    engine: audioMode === "linked" ? "web-post-save-pending" : "web-realtime",
    audioMode,
    recordingGain: 1,
    musicOffsetSeconds: 0,
    recordingAudioDelaySeconds,
  });
  const result = {
    ...capture,
    audio: audioMode === "embedded",
    audioMode,
    recordingAudioDelaySeconds,
    composition,
  };
  setRunVideoDesiredAudioDelay(result, desiredAudioDelaySeconds);
  return result;
}

function finalizeRunVideoPostComposition(capture, composed) {
  if (!capture || !composed || !composed.blob || !composed.blob.size) {
    throw runVideoPostCompositionError("output-empty", "Composed video is empty");
  }
  const music = runVideoCompositionMusicSnapshot(capture.music);
  const recordingAudioDelaySeconds = normalizeRunVideoAudioDelay(composed.audioDelaySeconds);
  const composition = createRunVideoCompositionRecipe(music, {
    engine: "web-post-save",
    audioMode: music ? "embedded" : "none",
    recordingGain: 1,
    musicOffsetSeconds: 0,
    recordingAudioDelaySeconds,
  });
  const result = {
    ...capture,
    blob: composed.blob,
    mimeType: composed.mimeType || composed.blob.type || "video/mp4",
    size: composed.size || composed.blob.size,
    duration: composed.duration || capture.duration,
    captureWidth: composed.width || capture.captureWidth,
    captureHeight: composed.height || capture.captureHeight,
    audio: !!music,
    audioEmbedded: !!music,
    audioMode: music ? "embedded" : "none",
    recordingAudioDelaySeconds,
    composition,
    postComposition: {
      engine: "canvas-web-audio-media-recorder",
      elapsedMs: Math.max(0, Number(composed.elapsedMs) || 0),
      sourceBytes: Number(capture.blob.size) || 0,
      outputBytes: Number(composed.size || composed.blob.size) || 0,
    },
  };
  setRunVideoDesiredAudioDelay(result, recordingAudioDelaySeconds);
  return result;
}
