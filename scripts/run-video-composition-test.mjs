import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const storedPreferences = new Map();
const context = vm.createContext({
  Promise, Object, Array, String, Number, Math, Error,
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
assert.equal(recipe.audio.recordingGain, 1, "saved music should use a fixed recording gain");
assert.equal(recipe.audio.microphone, false, "camera microphone should stay excluded");
assert.equal(recipe.timeline.trimStartSeconds, 3.5);
assert.equal(recipe.timeline.trimEndSeconds, 93.5);
assert.equal(recipe.timeline.recordingAudioDelaySeconds, 0.35);
assert.equal(context.normalizeRunVideoAudioDelay(2), 1, "sync correction should be capped at one second");
assert.equal(context.savePreferredRunVideoAudioDelay(0.27), 0.25, "the device preference should use 0.05-second steps");
assert.equal(context.preferredRunVideoAudioDelay(), 0.25);

const support = context.runVideoPostCompositionSupport();
assert.equal(support.supported, false, "Node has no browser composition APIs");
assert.equal(support.reason, "dom-unavailable");

const plan = context.createRunVideoPostCompositionPlan({
  duration: 2,
  captureWidth: 960,
  captureHeight: 720,
  music,
  syncAudioDelaySeconds: 0.35,
}, { duration: 2.1, width: 1280, height: 720 }, { duration: 120 });
assert.equal(plan.width, 960);
assert.equal(plan.height, 720);
assert.equal(plan.duration, 2);
assert.equal(plan.trimStart, 3.5);
assert.equal(plan.trimEnd, 93.5);
assert.equal(plan.audioDelaySeconds, 0.35);

const rawBlob = { size: 10, type: "video/mp4" };
const pending = await context.finalizeRunVideoComposition({
  blob: rawBlob,
  music,
  audioEmbedded: false,
  requestedAudioDelaySeconds: 0.35,
});
assert.equal(pending.audio, false);
assert.equal(pending.audioMode, "linked");
assert.equal(pending.composition.engine, "web-post-save-pending");
assert.equal(context.runVideoDesiredAudioDelay(pending), 0.35);
assert.equal(context.runVideoNeedsLinkedMusic(pending), true);

const outputBlob = { size: 24, type: "video/mp4" };
const completed = context.finalizeRunVideoPostComposition(pending, {
  blob: outputBlob,
  mimeType: "video/mp4",
  size: 24,
  duration: 2,
  width: 960,
  height: 720,
  audioDelaySeconds: 0.35,
  elapsedMs: 2200,
});
assert.equal(completed.blob, outputBlob);
assert.equal(completed.audio, true);
assert.equal(completed.audioMode, "embedded");
assert.equal(completed.composition.engine, "web-post-save");
assert.equal(completed.composition.timeline.recordingAudioDelaySeconds, 0.35);
assert.equal(context.runVideoDesiredAudioDelay(completed), 0.35);
assert.equal(context.runVideoPlaybackAudioDelay(completed), 0);
assert.equal(completed.postComposition.elapsedMs, 2200);
assert.equal(completed.postComposition.sourceBytes, 10);
assert.equal(completed.postComposition.outputBytes, 24);

console.log("Run-video post-composition test passed");
