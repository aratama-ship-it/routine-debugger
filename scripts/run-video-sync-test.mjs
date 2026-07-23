import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

class FakeMedia {
  constructor() {
    this.listeners = new Map();
    this.currentTime = 0;
    this.duration = 200;
    this.playbackRate = 1;
    this.volume = 1;
    this.paused = true;
    this.ended = false;
    this.seeking = false;
    this.playCalls = 0;
    this.pauseCalls = 0;
  }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(listener);
  }
  emit(name) {
    for (const listener of this.listeners.get(name) || []) listener({ type: name });
  }
  play() {
    this.playCalls++;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.pauseCalls++;
    this.paused = true;
  }
}

const delayContexts = [];
class FakeDelayAudioContext {
  constructor() {
    this.currentTime = 1;
    this.state = "running";
    this.destination = {};
    this.source = { connected: null, disconnectCalls: 0, connect: (node) => { this.source.connected = node; }, disconnect: () => { this.source.disconnectCalls++; } };
    this.delay = {
      delayTime: { value: 0, setValueAtTime(value) { this.value = value; } }, connected: null, disconnectCalls: 0,
      connect: (node) => { this.delay.connected = node; }, disconnect: () => { this.delay.disconnectCalls++; },
    };
    this.closeCalls = 0;
    delayContexts.push(this);
  }
  createMediaElementSource() { return this.source; }
  createDelay() { return this.delay; }
  resume() { this.state = "running"; return Promise.resolve(); }
  close() { this.closeCalls++; this.state = "closed"; return Promise.resolve(); }
}

const video = new FakeMedia();
const audio = new FakeMedia();
const status = { textContent: "" };
const unlock = { hidden: true };
const elements = new Map([
  ["run-video-player", video],
  ["run-video-audio", audio],
  ["run-video-audio-status", status],
  ["run-video-audio-unlock", unlock],
]);
const runVideos = [];
const deletedBlobIds = [];
let shownSheet = "";
let releasedSheetMedia = 0;
let createdObjectUrl = 0;
const context = vm.createContext({
  window: { AudioContext: FakeDelayAudioContext },
  document: { getElementById: (id) => elements.get(id) || null },
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
  setTimeout,
  clearTimeout,
  Promise,
  Object,
  Number,
  Math,
  musicVolume: 0.72,
  isEnglish: () => false,
  esc: (value) => String(value),
  preserveMediaPitch: () => {},
  normalizeMusicMeta: (meta) => ({ trimStart: 0, ...meta }),
  state: { routines: [{ id: "r1", music: { blobId: "music-1", name: "Test", trimStart: 10, trimEnd: 110, fullDuration: 200 } }], audios: [] },
  storedRunVideos: () => runVideos,
  blobDel: async (id) => { deletedBlobIds.push(id); },
  blobGet: async (id) => id === "music-1" ? { id } : null,
  withLoading: async (_message, work) => work(),
  releaseSheetMedia: () => { releasedSheetMedia++; },
  showSheet: (html) => { shownSheet = html; },
  runVideoProfile: () => ({ label: "4:3 横長" }),
  runVideoAspectStyle: () => "--run-camera-aspect:1.333",
  fmtTimeFine: () => "0:12.3",
  fmtBytes: () => "1.0 MB",
  uiText: (value) => value,
  toast: () => {},
  sheetVideoUrl: null,
  URL: { createObjectURL: () => `blob:test-${++createdObjectUrl}` },
  localStorage: { getItem: () => null, setItem: () => {} },
});
const compositionSource = await readFile(new URL("../run-video-composition.js", import.meta.url), "utf8");
const source = await readFile(new URL("../run-video-sync.js", import.meta.url), "utf8");
vm.runInContext(compositionSource, context, { filename: "run-video-composition.js" });
vm.runInContext(source, context, { filename: "run-video-sync.js" });

const music = { blobId: "music-1", name: "Test", trimStart: 10, trimEnd: 110, fullDuration: 200 };
context.bindRunVideoAudioSync(music);
video.currentTime = 20;
video.seeking = true;
video.emit("seeking");
assert.equal(audio.currentTime, 0, "audio should not be repeatedly moved while the seek handle is active");
video.seeking = false;
video.emit("seeked");
assert.equal(audio.currentTime, 30, "video seek should include the music trim offset");

video.paused = false;
video.emit("play");
await Promise.resolve();
assert.equal(audio.playCalls, 1, "video play should start the linked music");
assert.equal(audio.volume, 0.72, "linked music should use the shared music volume");

// iPhoneのネイティブシークが一時的なpauseを挟んでも、シーク前に再生中なら両方を再開する。
video.currentTime = 40;
video.seeking = true;
video.emit("seeking");
video.paused = true;
video.emit("pause");
assert.equal(audio.paused, true, "seeking should pause the linked music until the final position is known");
video.seeking = false;
video.emit("seeked");
await Promise.resolve();
await Promise.resolve();
assert.equal(video.playCalls, 1, "a transient seek pause should resume the video");
assert.equal(audio.playCalls, 2, "a transient seek pause should resume the linked music");
assert.equal(audio.currentTime, 50, "seek completion should align music once at the final position");

// 停止中に位置だけ変えた場合は、勝手に再生を始めない。
video.paused = true;
video.emit("pause");
const videoPlayCount = video.playCalls;
const audioPlayCount = audio.playCalls;
video.currentTime = 60;
video.seeking = true;
video.emit("seeking");
video.seeking = false;
video.emit("seeked");
await Promise.resolve();
assert.equal(video.playCalls, videoPlayCount, "a paused video should stay paused after seeking");
assert.equal(audio.playCalls, audioPlayCount, "paused seeking should not start the linked music");

assert.equal(context.runVideoMusicMeta({ routineId: "r1" }).blobId, "music-1", "legacy videos should use the routine music");
assert.equal(context.runVideoMusicMeta({ routineId: "r1", music: null }), null, "new videos recorded without music should stay video-only");

runVideos.push({ id: "v1", routineId: "r1" });
assert.equal(context.preserveRunVideoMusicSnapshots("r1", music), true);
assert.equal(runVideos[0].music.blobId, "music-1", "legacy video should preserve its music before a routine music change");

const stoppedCapture = {
  routineId: "r1", blob: { id: "video-blob" }, duration: 12.3, size: 1_000_000,
  cameraProfile: "wide", music,
};
context.stoppedRunVideoCapture = stoppedCapture;
await context.window.previewStoppedRunVideo("r1");
assert.equal(releasedSheetMedia, 1, "instant preview should release any previous sheet media");
assert.match(shownSheet, /今撮った通し映像/, "instant preview should open the just-recorded video sheet");
assert.match(shownSheet, /run-video-player/, "instant preview should include a video player");
assert.equal(context.stoppedRunVideoCapture, stoppedCapture, "previewing must keep the capture for result logging and save confirmation");

const embeddedCapture = {
  ...stoppedCapture,
  audio: true,
  audioMode: "embedded",
  audioEmbedded: true,
  composition: context.createRunVideoCompositionRecipe(music),
};
context.stoppedRunVideoCapture = embeddedCapture;
await context.window.previewStoppedRunVideo("r1");
assert.doesNotMatch(shownSheet, /<audio id="run-video-audio"/, "embedded recordings should use the video player's single timeline");
assert.match(shownSheet, /音源は映像に収録済みです/, "embedded recordings should explain that the music is inside the video");
assert.match(shownSheet, /映像と音源の同期補正/, "embedded recordings should expose the post-run sync control");
assert.equal(context.stoppedRunVideoCapture, embeddedCapture, "embedded preview should also preserve the capture until result logging");
context.window.runVideoSetSyncDelay("stopped", "", 0.25);
assert.equal(context.runVideoDesiredAudioDelay(embeddedCapture), 0.25, "the post-run correction should stay with the capture");
assert.equal(context.runVideoPlaybackAudioDelay(embeddedCapture), 0.25, "an uncorrected existing file should add the selected delay during playback");
assert.equal(delayContexts.length, 1, "changing the correction should route embedded audio through one delay graph");
assert.equal(delayContexts[0].delay.delayTime.value, 0.25);
context.stopRunVideoAudioSync();
assert.equal(delayContexts[0].closeCalls, 1, "closing the preview should release its audio context");

const postSaveCapture = await context.finalizeRunVideoComposition({
  ...stoppedCapture,
  audioEmbedded: false,
  requestedAudioDelaySeconds: 0.1,
});
context.stoppedRunVideoCapture = postSaveCapture;
await context.window.previewStoppedRunVideo("r1");
assert.match(shownSheet, /映像と音源の同期補正/, "post-save composition should keep the sync control before saving");
assert.match(shownSheet, /保存時の合成へ反映します/, "the control should explain that the value is baked in on save");
context.window.runVideoSetSyncDelay("stopped", "", 0.3);
assert.equal(context.runVideoDesiredAudioDelay(postSaveCapture), 0.3, "post-save composition should use the selected correction");
context.stopRunVideoAudioSync();

console.log("Run-video music sync test passed");
