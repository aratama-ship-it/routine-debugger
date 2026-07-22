import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

class FakeTrack {
  constructor(kind) { this.kind = kind; this.readyState = "live"; this.stopCalls = 0; }
  stop() { this.stopCalls++; this.readyState = "ended"; }
}
class FakeMediaStream {
  constructor(tracks = []) { this.tracks = [...tracks]; }
  addTrack(track) { this.tracks.push(track); }
  getTracks() { return [...this.tracks]; }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
}

const videoTrack = new FakeTrack("video");
const audioTrack = new FakeTrack("audio");
const videoStream = new FakeMediaStream([videoTrack]);
const recordGain = {
  gain: { value: 0, setValueAtTime(value) { this.value = value; } },
  connections: [], disconnectCalls: 0,
  connect(node) { this.connections.push(node); },
  disconnect() { this.disconnectCalls++; },
};
const recordDelay = {
  delayTime: { value: 0, setValueAtTime(value) { this.value = value; } },
  connections: [], disconnectCalls: 0,
  connect(node) { this.connections.push(node); },
  disconnect() { this.disconnectCalls++; },
};
const destination = {
  stream: new FakeMediaStream([audioTrack]),
  disconnectCalls: 0,
  disconnect() { this.disconnectCalls++; },
};
const sourceNode = {
  connected: [], disconnected: [],
  connect(node) { this.connected.push(node); },
  disconnect(node) { this.disconnected.push(node); },
};
const audioContext = {
  currentTime: 2,
  createGain: () => recordGain,
  createDelay: () => recordDelay,
  createMediaStreamDestination: () => destination,
};
const storedPreferences = new Map();
const context = vm.createContext({
  MediaStream: FakeMediaStream,
  Promise,
  Object,
  Array,
  String,
  Number,
  Math,
  Error,
  localStorage: {
    getItem: (key) => storedPreferences.get(key) ?? null,
    setItem: (key, value) => storedPreferences.set(key, String(value)),
  },
});
const source = await readFile(new URL("../run-video-composition.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "run-video-composition.js" });

const music = { blobId: "music-1", name: "Verse 1", trimStart: 3.5, trimEnd: 93.5, fullDuration: 120 };
const recipe = context.createRunVideoCompositionRecipe(music, { recordingAudioDelaySeconds: 0.35 });
assert.equal(recipe.version, 1);
assert.equal(recipe.output, "single-video");
assert.equal(recipe.audio.mode, "embedded");
assert.equal(recipe.audio.recordingGain, 1, "saved music should not follow the listening fader");
assert.equal(recipe.audio.microphone, false, "camera microphone should stay excluded");
assert.equal(recipe.timeline.trimStartSeconds, 3.5);
assert.equal(recipe.timeline.trimEndSeconds, 93.5);
assert.equal(recipe.timeline.recordingAudioDelaySeconds, 0.35);
assert.equal(context.normalizeRunVideoAudioDelay(2), 1, "sync correction should be capped at one second");
assert.equal(context.savePreferredRunVideoAudioDelay(0.27), 0.25, "the device preference should use 0.05-second steps");
assert.equal(context.preferredRunVideoAudioDelay(), 0.25);

const mixed = context.createWebRunVideoRecordingStream({
  videoStream, audioContext, musicSourceNode: sourceNode, includeMusic: true, audioDelaySeconds: 0.35,
});
assert.equal(mixed.audioEmbedded, true);
assert.equal(mixed.recordingAudioDelaySeconds, 0.35);
assert.deepEqual(mixed.stream.getVideoTracks(), [videoTrack]);
assert.deepEqual(mixed.stream.getAudioTracks(), [audioTrack]);
assert.equal(recordGain.gain.value, 1);
assert.equal(recordDelay.delayTime.value, 0.35);
assert.equal(sourceNode.connected[0], recordDelay);
assert.equal(recordDelay.connections[0], recordGain);
mixed.release();
mixed.release();
assert.equal(sourceNode.disconnected.length, 1, "the recording branch should be disconnected once");
assert.equal(recordDelay.disconnectCalls, 1, "the recording delay node should be disconnected once");
assert.equal(audioTrack.stopCalls, 1, "only the generated recording audio track should be stopped");
assert.equal(videoTrack.stopCalls, 0, "composition cleanup must not stop the camera track");

const fallback = context.createWebRunVideoRecordingStream({ videoStream, includeMusic: true });
assert.equal(fallback.audioEmbedded, false);
assert.equal(fallback.stream, videoStream);
assert.equal(fallback.fallbackReason, "web-audio-capture-unavailable");

const finalized = await context.finalizeRunVideoComposition({
  blob: { size: 10 }, music, audioEmbedded: true, recordingAudioDelaySeconds: 0.35,
});
assert.equal(finalized.audio, true);
assert.equal(finalized.audioMode, "embedded");
assert.equal(finalized.composition.engine, "web-realtime");
assert.equal(finalized.composition.timeline.recordingAudioDelaySeconds, 0.35);
assert.equal(context.runVideoDesiredAudioDelay(finalized), 0.35);
const adjusted = context.setRunVideoDesiredAudioDelay(finalized, 0.55);
assert.equal(adjusted.playback, 0.2, "only the delay beyond the baked-in value should be added during playback");
assert.equal(context.runVideoPlaybackAudioDelay(finalized), 0.2);
const reduced = context.setRunVideoDesiredAudioDelay(finalized, 0.1);
assert.equal(reduced.belowRecorded, true, "a baked-in delay cannot be removed from the existing file without rebuilding it");
assert.equal(reduced.playback, 0);
assert.equal(context.runVideoHasEmbeddedAudio(finalized), true);
assert.equal(context.runVideoNeedsLinkedMusic(finalized), false);

const linkedFallback = await context.finalizeRunVideoComposition({ blob: { size: 10 }, music, audioEmbedded: false });
assert.equal(linkedFallback.audioMode, "linked");
assert.equal(context.runVideoNeedsLinkedMusic(linkedFallback), true);

console.log("Run-video composition test passed");
