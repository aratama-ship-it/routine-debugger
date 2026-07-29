/* ルーティンノート — 通し映像と音源の「遅れ」を扱う
 *
 * 録画はカウントダウン中から回すので、映像は曲より数秒先に始まる。
 * その差を測って曲の開始位置にし、耳で合わないぶんを本人が前後へずらす。
 *
 * 値の役割:
 *   estimated … アプリが実測したカウントダウン分。つまみの中心。動かしても揺れない
 *   offset    … 本人の微調整。中心からの前後で、負にもなる
 *   desired   … 中心＋微調整。合成でここから曲を鳴らす
 *   recorded  … すでにファイルへ焼き込んだ分。ここから先は再生時補正でしか動かせない
 *
 * run-video-composition.js より先に読み込む(定数を参照するため)。
 */
"use strict";

// 遅れ = 手動の微調整(つまみ0〜1秒) + カウントダウン分。1秒で頭打ちだと曲が頭から鳴る。
const RUN_VIDEO_AUDIO_DELAY_MAX_SECONDS = 20;
const RUN_VIDEO_AUDIO_DELAY_SLIDER_MAX = 1;

function normalizeRunVideoAudioDelay(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const clamped = Math.max(0, Math.min(RUN_VIDEO_AUDIO_DELAY_MAX_SECONDS, number));
  return Math.round(clamped * 20) / 20; // つまみと同じ0.05秒刻み
}

function runVideoRecordingAudioDelay(video) {
  const timelineValue = video && video.composition && video.composition.timeline
    ? video.composition.timeline.recordingAudioDelaySeconds : null;
  const value = timelineValue != null ? timelineValue : video && video.recordingAudioDelaySeconds;
  return normalizeRunVideoAudioDelay(value);
}

// つまみの中心。アプリが実測したカウントダウン分で、動かしても揺れない
function runVideoEstimatedAudioDelay(video) {
  if (video && video.estimatedAudioDelaySeconds != null) {
    return normalizeRunVideoAudioDelay(video.estimatedAudioDelaySeconds);
  }
  return runVideoRecordingAudioDelay(video);
}

// 本人の微調整は中心からの前後ぶんなので、負の値も持てる
function normalizeRunVideoAudioOffset(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const clamped = Math.max(-RUN_VIDEO_AUDIO_DELAY_SLIDER_MAX,
    Math.min(RUN_VIDEO_AUDIO_DELAY_SLIDER_MAX, number));
  return Math.round(clamped * 20) / 20;
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
  try { return normalizeRunVideoAudioOffset(localStorage.getItem("rd_run_video_audio_delay")); }
  catch (_) { return 0; }
}

function savePreferredRunVideoAudioDelay(value) {
  const normalized = normalizeRunVideoAudioOffset(value);
  try { localStorage.setItem("rd_run_video_audio_delay", String(normalized)); } catch (_) {}
  return normalized;
}

// ---- 確認画面のつまみ ----

function runVideoSyncDelayNote(video) {
  if (video && video.composition && video.composition.engine === "web-post-save-pending") {
    return isEnglish()
      ? "This value is built into the finished video when you save. The original camera recording stays unchanged."
      : "ここで決めた値を保存時の合成へ反映します。元のカメラ映像は変更せず、完成映像を作ります。";
  }
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
  const postSavePending = video && video.composition && video.composition.engine === "web-post-save-pending"
    && (target === "pending" || target === "stopped");
  if (!runVideoHasEmbeddedAudio(video) && !postSavePending) return "";
  // アプリが実測したカウントダウン分を中心に置き、前後1秒だけ動かせるようにする。
  // 0秒から始めると、5秒台の実測値がつまみの外側に出て動かせなくなる。
  const centre = runVideoEstimatedAudioDelay(video);
  const min = Math.max(0, Math.round((centre - RUN_VIDEO_AUDIO_DELAY_SLIDER_MAX) * 20) / 20);
  const max = Math.round((centre + RUN_VIDEO_AUDIO_DELAY_SLIDER_MAX) * 20) / 20;
  const value = Math.min(max, Math.max(min, runVideoDesiredAudioDelay(video)));
  return `<section class="run-video-sync-adjust" aria-labelledby="run-video-sync-delay-title">
    <div class="run-video-sync-adjust-head">
      <div><b id="run-video-sync-delay-title">${isEnglish() ? "Audio sync correction" : "映像と音源の同期補正"}</b>
        <span>${isEnglish() ? "Nudge the music earlier or later." : "曲が早い・遅いと感じたら前後へずらします。"}</span></div>
      <output id="run-video-sync-delay-value">${value.toFixed(2)}${isEnglish() ? " sec" : "秒"}</output>
    </div>
    <input id="run-video-sync-delay" type="range" min="${min}" max="${max}" step="0.05" value="${value.toFixed(2)}"
      aria-label="${isEnglish() ? "Delay recorded music" : "収録音源を遅らせる"}"
      oninput="runVideoSetSyncDelay('${target}','${esc(id)}',this.value)">
    <div class="run-video-sync-adjust-scale"><span>${isEnglish() ? "Music earlier" : "音源を早める"} ${min.toFixed(2)}</span><b>${isEnglish() ? "Estimate" : "推定"} ${centre.toFixed(2)}</b><span>${isEnglish() ? "Later" : "遅らせる"} ${max.toFixed(2)}</span></div>
    <small id="run-video-sync-delay-note">${esc(runVideoSyncDelayNote(video))}</small>
  </section>`;
}

function runVideoSyncDelayTarget(target, id) {
  if (target === "stopped") return stoppedRunVideoCapture;
  if (target === "pending") return pendingRunVideo;
  if (target === "saved") return storedRunVideos().find((video) => video.id === id) || null;
  return null;
}

const runVideoSetSyncDelay = (target, id, value) => {
  const video = runVideoSyncDelayTarget(target, id);
  const postSavePending = video && video.composition && video.composition.engine === "web-post-save-pending"
    && (target === "pending" || target === "stopped");
  if (!video || (!runVideoHasEmbeddedAudio(video) && !postSavePending)) return;
  const result = setRunVideoDesiredAudioDelay(video, value);
  // 次回へ引き継ぐのは中心からのずれ。実測は毎回変わるので秒数そのものは持ち越さない
  savePreferredRunVideoAudioDelay(result.desired - runVideoEstimatedAudioDelay(video));
  if (target === "saved") saveState();
  const output = document.getElementById("run-video-sync-delay-value");
  if (output) output.textContent = `${result.desired.toFixed(2)}${isEnglish() ? " sec" : "秒"}`;
  const note = document.getElementById("run-video-sync-delay-note");
  if (note) note.textContent = runVideoSyncDelayNote(video);
  if (postSavePending && runVideoSyncState && runVideoSyncState.sourceVideo === video) {
    clearTimeout(runVideoSyncState.audioStartTimer);
    runVideoSyncState.audioStartTimer = null;
    runVideoSyncState.audio.pause();
    syncRunVideoAudioPosition(true);
    if (runVideoSyncState.wantsPlayback && !runVideoSyncState.video.paused) tryPlayRunVideoAudio(true);
  } else {
    bindRunVideoEmbeddedAudioDelay(video);
  }
};

// 計算だけを使う場面でも読めるよう、公開はブラウザのときだけ
if (typeof window !== "undefined") window.runVideoSetSyncDelay = runVideoSetSyncDelay;
