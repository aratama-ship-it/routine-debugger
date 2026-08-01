import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const context = vm.createContext({ Number, Math });
const source = await readFile(new URL("../run-video-orientation.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "run-video-orientation.js" });

// 端末の向きでも映像の向きでも撮影を止めない。止めると縦持ちで撮れなくなるため。
const cases = [
  ["portrait screen, camera not started", ["wide", 390, 844]],
  ["portrait screen, landscape feed", ["wide", 390, 844, 1280, 960]],
  ["portrait screen, portrait feed", ["wide", 390, 844, 720, 1280]],
  ["landscape screen, portrait feed", ["wide", 844, 390, 720, 1280]],
  ["landscape screen, landscape feed", ["wide", 844, 390, 960, 720]],
  ["portrait profile", ["vertical", 390, 844, 720, 1280]],
];
for (const [label, args] of cases) {
  assert.equal(context.runCameraOrientationState(...args).blocked, false, `${label} must never block`);
}

// 実測した向きは、記録した映像の縦横を扱うために残す。
const portraitFeed = context.runCameraOrientationState("wide", 390, 844, 720, 1280);
assert.equal(portraitFeed.frameKnown, true);
assert.equal(portraitFeed.frameLandscape, false);

const beforeCamera = context.runCameraOrientationState("wide", 844, 390);
assert.equal(beforeCamera.frameKnown, false);
assert.equal(beforeCamera.frameLandscape, true, "an unknown feed is treated as landscape");

const invalidDimensions = context.runCameraOrientationState("wide", Number.NaN, -1, 0, Infinity);
assert.equal(invalidDimensions.frameKnown, false);

console.log("Run-video orientation test passed");
