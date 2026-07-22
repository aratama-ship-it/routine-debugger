import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

class FakeVideo {
  constructor() { this.currentTime = 0; this.listeners = new Map(); }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(listener);
  }
  emit(name) { for (const listener of this.listeners.get(name) || []) listener({ type: name }); }
}

const player = new FakeVideo();
const name = { textContent: "" };
const meta = { textContent: "" };
const elements = new Map([
  ["run-video-player", player],
  ["run-video-current-step-name", name],
  ["run-video-current-step-meta", meta],
]);
const steps = [
  { id: "s1", name: "First skill", cue: 0 },
  { id: "s2", name: "Choice", cue: 8, options: [{ id: "a", name: "Choice A" }, { id: "b", name: "Choice B" }] },
];
const run = { id: "run-1", choices: { s2: "b" } };
const session = { id: "session-1", versionId: "version-1" };
const routine = { id: "routine-1", versions: [{ id: "version-1", steps }] };
const context = vm.createContext({
  window: {},
  document: { getElementById: (id) => elements.get(id) || null, createElement: () => ({}) },
  state: { routines: [routine] },
  findRunRecord: () => ({ sess: session, run }),
  getVersion: (item) => item.versions[0],
  isSlot: (step) => Array.isArray(step.options) && step.options.length >= 2,
  stepDisplayName: (step) => step.name,
  optionDisplayName: (option) => option.name,
  stepLabel: (step) => step.name,
  runChoice: (item, step) => item.choices && item.choices[step.id],
  isEnglish: () => false,
  esc: (value) => String(value),
  fmtTimeFine: (value) => `0:${String(value).padStart(4, "0")}`,
  plannedPracticeStep: (items, time) => {
    let index = 0;
    for (let i = 0; i < items.length; i++) if (items[i].cue <= time) index = i;
    return { step: items[index], index, start: items[index].cue };
  },
  setTimeout,
  Promise,
  Math,
  Number,
});

const source = await readFile(new URL("../run-video-review.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "run-video-review.js" });

const video = { routineId: "routine-1", sessionId: "session-1", runId: "run-1" };
const stepContext = context.runVideoReviewStepContext(video);
assert.equal(stepContext.steps, steps, "the review should use the version recorded by the session");
const markup = context.runVideoCurrentStepMarkup(stepContext);
assert.match(markup, /実施中の技/, "the current-skill label should be shown");
assert.doesNotMatch(markup, /<video\b/, "the current-skill area should not add a skill preview video");

context.bindRunVideoCurrentStep(stepContext);
assert.equal(name.textContent, "First skill", "the first skill should be shown at the start");
player.currentTime = 9;
player.emit("timeupdate");
assert.equal(name.textContent, "Choice B", "the recorded A/B choice should be shown after seeking");
assert.match(meta.textContent, /^2\/2/, "the step number should follow the playback position");

console.log("Run-video review test passed");
