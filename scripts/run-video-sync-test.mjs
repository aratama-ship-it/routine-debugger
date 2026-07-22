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
  window: {},
  document: { getElementById: (id) => elements.get(id) || null },
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
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
});
const source = await readFile(new URL("../run-video-sync.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "run-video-sync.js" });

const music = { blobId: "music-1", name: "Test", trimStart: 10, trimEnd: 110, fullDuration: 200 };
context.bindRunVideoAudioSync(music);
video.currentTime = 20;
video.emit("seeking");
assert.equal(audio.currentTime, 30, "video seek should include the music trim offset");

video.paused = false;
video.emit("play");
await Promise.resolve();
assert.equal(audio.playCalls, 1, "video play should start the linked music");
assert.equal(audio.volume, 0.72, "linked music should use the shared music volume");

video.emit("pause");
assert.equal(audio.paused, true, "video pause should pause the linked music");

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

console.log("Run-video music sync test passed");
