import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const context = vm.createContext({ Number, Math });
const source = await readFile(new URL("../run-video-orientation.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "run-video-orientation.js" });

// v305から、判断の基準は「実際に返ってきた映像の向き」だけ。
// 背面カメラは端末を縦に構えても横長で返るため、持ち方では止めない。
const portraitViewport = context.runCameraOrientationState("wide", 390, 844);
assert.equal(portraitViewport.blocked, false, "holding the phone upright must not block on its own");
const portraitViewportLandscapeFeed = context.runCameraOrientationState("wide", 390, 844, 1280, 960);
assert.equal(portraitViewportLandscapeFeed.blocked, false, "a landscape feed is fine even on a portrait screen");

const landscapeBeforeCamera = context.runCameraOrientationState("wide", 844, 390);
assert.equal(landscapeBeforeCamera.blocked, false, "wide capture can prepare the camera in landscape");
assert.equal(landscapeBeforeCamera.frameKnown, false);

const portraitFeed = context.runCameraOrientationState("wide", 844, 390, 720, 1280);
assert.equal(portraitFeed.blocked, true, "a portrait camera feed must block wide capture even on a landscape screen");

const landscapeFeed = context.runCameraOrientationState("wide", 844, 390, 960, 720);
assert.equal(landscapeFeed.blocked, false, "a landscape feed can always start");

const verticalProfile = context.runCameraOrientationState("vertical", 390, 844, 720, 1280);
assert.equal(verticalProfile.blocked, false, "the portrait profile must remain available in portrait");

const invalidDimensions = context.runCameraOrientationState("wide", Number.NaN, -1, 0, Infinity);
assert.equal(invalidDimensions.frameKnown, false);

console.log("Run-video orientation test passed");
