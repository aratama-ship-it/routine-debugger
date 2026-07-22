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
  createMediaStreamDestination: () => destination,
};
const context = vm.createContext({
  MediaStream: FakeMediaStream,
  Promise,
  Object,
  Array,
  String,
  Number,
  Math,
  Error,
});
const source = await readFile(new URL("../run-video-composition.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "run-video-composition.js" });

const music = { blobId: "music-1", name: "Verse 1", trimStart: 3.5, trimEnd: 93.5, fullDuration: 120 };
const recipe = context.createRunVideoCompositionRecipe(music);
assert.equal(recipe.version, 1);
assert.equal(recipe.output, "single-video");
assert.equal(recipe.audio.mode, "embedded");
assert.equal(recipe.audio.recordingGain, 1, "saved music should not follow the listening fader");
assert.equal(recipe.audio.microphone, false, "camera microphone should stay excluded");
assert.equal(recipe.timeline.trimStartSeconds, 3.5);
assert.equal(recipe.timeline.trimEndSeconds, 93.5);

const mixed = context.createWebRunVideoRecordingStream({
  videoStream, audioContext, musicSourceNode: sourceNode, includeMusic: true,
});
assert.equal(mixed.audioEmbedded, true);
assert.deepEqual(mixed.stream.getVideoTracks(), [videoTrack]);
assert.deepEqual(mixed.stream.getAudioTracks(), [audioTrack]);
assert.equal(recordGain.gain.value, 1);
assert.equal(sourceNode.connected[0], recordGain);
mixed.release();
mixed.release();
assert.equal(sourceNode.disconnected.length, 1, "the recording branch should be disconnected once");
assert.equal(audioTrack.stopCalls, 1, "only the generated recording audio track should be stopped");
assert.equal(videoTrack.stopCalls, 0, "composition cleanup must not stop the camera track");

const fallback = context.createWebRunVideoRecordingStream({ videoStream, includeMusic: true });
assert.equal(fallback.audioEmbedded, false);
assert.equal(fallback.stream, videoStream);
assert.equal(fallback.fallbackReason, "web-audio-capture-unavailable");

const finalized = await context.finalizeRunVideoComposition({ blob: { size: 10 }, music, audioEmbedded: true });
assert.equal(finalized.audio, true);
assert.equal(finalized.audioMode, "embedded");
assert.equal(finalized.composition.engine, "web-realtime");
assert.equal(context.runVideoHasEmbeddedAudio(finalized), true);
assert.equal(context.runVideoNeedsLinkedMusic(finalized), false);

const linkedFallback = await context.finalizeRunVideoComposition({ blob: { size: 10 }, music, audioEmbedded: false });
assert.equal(linkedFallback.audioMode, "linked");
assert.equal(context.runVideoNeedsLinkedMusic(linkedFallback), true);

console.log("Run-video composition test passed");
