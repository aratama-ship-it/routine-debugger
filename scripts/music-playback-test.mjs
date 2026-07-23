import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

class FakeAudio {
  constructor() {
    this.currentSrc = "";
    this.src = "";
    this.currentTime = 0;
    this.readyState = 0;
    this.paused = true;
    this.listeners = new Map();
    this.preservesPitch = false;
    this.webkitPreservesPitch = false;
    this.mozPreservesPitch = false;
  }
  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ listener, once: !!options.once });
    this.listeners.set(type, listeners);
  }
  emit(type) {
    const listeners = [...(this.listeners.get(type) || [])];
    this.listeners.set(type, listeners.filter((entry) => !entry.once));
    listeners.forEach((entry) => entry.listener({ type, currentTarget: this }));
  }
  load() {
    this.currentSrc = this.src;
    this.readyState = this.src ? 1 : 0;
    if (this.readyState) this.emit("loadedmetadata");
  }
  play() { this.paused = false; this.emit("play"); this.emit("playing"); return Promise.resolve(); }
  pause() { if (!this.paused) { this.paused = true; this.emit("pause"); } }
  removeAttribute(name) {
    if (name === "src") { this.src = ""; this.currentSrc = ""; this.readyState = 0; }
  }
}

const source = await readFile(new URL("../music-playback.js", import.meta.url), "utf8");
const iphoneNavigator = {
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  platform: "iPhone",
  maxTouchPoints: 5,
};
const context = { window: {}, navigator: iphoneNavigator, Audio: FakeAudio };
vm.createContext(context);
vm.runInContext(source, context);

let switchedTo = null;
let resumeCount = 0;
const playback = context.window.RoutineMusicPlayback.create({
  onSwitch: (player) => { switchedTo = player; },
  onResume: (player) => { resumeCount++; player.play(); },
});
const { graphPlayer, nativeRatePlayer } = playback;
graphPlayer.src = "blob:music";
graphPlayer.load();
graphPlayer.currentTime = 12.3;
await graphPlayer.play();

assert.equal(playback.usesNative(0.75, true, iphoneNavigator), true);
assert.equal(playback.usesNative(1, true, iphoneNavigator), false);
assert.equal(playback.usesNative(0.75, false, iphoneNavigator), false);
assert.equal(playback.usesNative(0.75, true, {
  userAgent: "Mozilla/5.0 Chrome/126.0 Safari/537.36",
  platform: "Linux x86_64",
  maxTouchPoints: 0,
}), false);

assert.equal(playback.setRate(0.75, true), nativeRatePlayer);
assert.equal(switchedTo, nativeRatePlayer);
assert.equal(nativeRatePlayer.currentTime, 12.3);
assert.equal(nativeRatePlayer.playbackRate, 0.75);
assert.equal(nativeRatePlayer.preservesPitch, true);
assert.equal(graphPlayer.paused, true);
assert.equal(resumeCount, 1);

assert.equal(playback.setRate(1, true), graphPlayer);
assert.equal(graphPlayer.playbackRate, 1);
assert.equal(nativeRatePlayer.paused, true);
assert.equal(resumeCount, 2);

let updateCount = 0;
playback.bindEvents({ onMediaUpdate: () => { updateCount++; } });
nativeRatePlayer.emit("timeupdate");
assert.equal(updateCount, 0, "inactive player events must not update the UI");
graphPlayer.emit("timeupdate");
assert.equal(updateCount, 1);

console.log("Music playback quality-path test passed");
