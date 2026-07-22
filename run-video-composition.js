/* ルーティンノート — 通し映像と音源を一つの完成映像へまとめる共通境界 */
"use strict";

// Web版は録画中に音源を収録する。将来のiOS／Android版は、このレシピを
// ネイティブの撮影後合成へ渡し、同じ完成形式（音源入りの単一動画）を返す。
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

// カメラの映像トラックと、Web Audioから分岐した楽曲トラックをMediaRecorder用にまとめる。
// 音源はモニター用フェーダーの手前から分岐するため、保存音量は常に一定になる。
function createWebRunVideoRecordingStream({
  videoStream, audioContext, musicSourceNode, includeMusic = false, audioDelaySeconds = 0,
} = {}) {
  const fallback = (reason = "") => ({
    stream: videoStream,
    audioEmbedded: false,
    recordingAudioDelaySeconds: 0,
    fallbackReason: reason,
    release() {},
  });
  if (!includeMusic) return fallback();
  if (!videoStream || !audioContext || !musicSourceNode || typeof MediaStream !== "function"
      || typeof audioContext.createMediaStreamDestination !== "function"
      || typeof audioContext.createGain !== "function") {
    return fallback("web-audio-capture-unavailable");
  }

  let recordGain = null;
  let recordDelay = null;
  let destination = null;
  let audioTrack = null;
  let sourceTarget = null;
  let sourceConnected = false;
  try {
    const requestedDelay = normalizeRunVideoAudioDelay(audioDelaySeconds);
    const appliedDelay = requestedDelay > 0 && typeof audioContext.createDelay !== "function" ? 0 : requestedDelay;
    recordGain = audioContext.createGain();
    destination = audioContext.createMediaStreamDestination();
    if (recordGain.gain) {
      if (typeof recordGain.gain.setValueAtTime === "function") {
        recordGain.gain.setValueAtTime(1, Number(audioContext.currentTime) || 0);
      } else {
        recordGain.gain.value = 1;
      }
    }
    if (appliedDelay > 0) {
      recordDelay = audioContext.createDelay(RUN_VIDEO_AUDIO_DELAY_MAX_SECONDS);
      if (recordDelay.delayTime && typeof recordDelay.delayTime.setValueAtTime === "function") {
        recordDelay.delayTime.setValueAtTime(appliedDelay, Number(audioContext.currentTime) || 0);
      } else if (recordDelay.delayTime) {
        recordDelay.delayTime.value = appliedDelay;
      }
      musicSourceNode.connect(recordDelay);
      sourceTarget = recordDelay;
      sourceConnected = true;
      recordDelay.connect(recordGain);
    } else {
      musicSourceNode.connect(recordGain);
      sourceTarget = recordGain;
      sourceConnected = true;
    }
    recordGain.connect(destination);
    audioTrack = destination.stream && destination.stream.getAudioTracks()[0];
    if (!audioTrack) throw new Error("music-audio-track-missing");

    const stream = new MediaStream();
    const videoTracks = typeof videoStream.getVideoTracks === "function"
      ? videoStream.getVideoTracks()
      : (videoStream.getTracks ? videoStream.getTracks().filter((track) => track.kind === "video") : []);
    for (const track of videoTracks) stream.addTrack(track);
    stream.addTrack(audioTrack);
    let released = false;
    return {
      stream,
      audioEmbedded: true,
      recordingAudioDelaySeconds: appliedDelay,
      fallbackReason: "",
      release() {
        if (released) return;
        released = true;
        try { musicSourceNode.disconnect(sourceTarget); } catch (_) {}
        try { if (recordDelay) recordDelay.disconnect(); } catch (_) {}
        try { recordGain.disconnect(); } catch (_) {}
        try { destination.disconnect(); } catch (_) {}
        stopRunVideoCompositionTrack(audioTrack);
      },
    };
  } catch (error) {
    if (sourceConnected) {
      try { musicSourceNode.disconnect(sourceTarget); } catch (_) {}
    }
    try { if (recordDelay) recordDelay.disconnect(); } catch (_) {}
    try { if (recordGain) recordGain.disconnect(); } catch (_) {}
    try { if (destination) destination.disconnect(); } catch (_) {}
    stopRunVideoCompositionTrack(audioTrack);
    return fallback(error && error.message ? error.message : "web-audio-capture-failed");
  }
}

// プラットフォーム差し替え点。Web版では録画済みBlobが完成物だが、将来の
// ネイティブ版では同じ入力をAVFoundation／Media3へ渡してから結果を返す。
async function finalizeRunVideoComposition(capture) {
  const music = runVideoCompositionMusicSnapshot(capture && capture.music);
  const audioMode = music ? (capture && capture.audioEmbedded ? "embedded" : "linked") : "none";
  const recordingAudioDelaySeconds = audioMode === "embedded"
    ? normalizeRunVideoAudioDelay(capture && capture.recordingAudioDelaySeconds) : 0;
  const composition = createRunVideoCompositionRecipe(music, {
    engine: "web-realtime",
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
  setRunVideoDesiredAudioDelay(result, recordingAudioDelaySeconds);
  return result;
}
