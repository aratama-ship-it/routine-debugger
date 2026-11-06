/* Monotonic estimates; these are not camera hardware timestamps. */
"use strict";

function initRunVideoClock(cap, recorder) {
  const requested = performance.now();
  cap.captureClock = { requested, started: null, stopped: null, musicOrigin: null };
  cap.audioStartedAt = null;
  recorder.addEventListener("start", (event) => {
    const now = performance.now();
    const stamp = Number(event.timeStamp);
    cap.captureClock.started = Number.isFinite(stamp) && stamp >= requested && stamp <= now
      ? stamp : now;
    updateRunVideoClockDelay(cap);
  }, { once: true });
}

function updateRunVideoClockDelay(cap) {
  const clock = cap.captureClock;
  if (!clock || clock.musicOrigin == null) return;
  cap.recordingAudioDelaySeconds = Math.max(0,
    (clock.musicOrigin - (clock.started ?? clock.requested)) / 1000);
}

function markRunVideoMusicStart(cap, player, relativeTime) {
  if (!cap || cap.audioStartedAt || player.muted || player.paused) return;
  const now = performance.now();
  cap.audioStartedAt = Date.now();
  if (!cap.captureClock) return;
  cap.captureClock.musicOrigin = now - Math.max(0, Number(relativeTime) || 0) * 1000;
  updateRunVideoClockDelay(cap);
}

function finishRunVideoClock(cap) {
  const clock = cap.captureClock;
  const estimate = Math.max(0, Number(cap.recordingAudioDelaySeconds) || 0);
  const start = clock && (clock.started ?? clock.requested);
  return {
    duration: clock ? Math.max(0, ((clock.stopped ?? performance.now()) - start) / 1000)
      : Math.max(0, (Date.now() - cap.startedAt) / 1000),
    estimatedAudioDelaySeconds: normalizeRunVideoAudioDelay(estimate),
    syncAudioDelaySeconds: normalizeRunVideoAudioDelay(estimate + (Number(cap.requestedAudioDelaySeconds) || 0)),
    captureTiming: clock ? {
      source: clock.started == null ? "recorder-request-fallback" : "recorder-start-event",
      recorderStartupMs: clock.started == null ? null : Math.round(clock.started - clock.requested),
      musicDelayMs: Math.round(estimate * 1000),
      hardwareClockVerified: false,
    } : null,
  };
}
