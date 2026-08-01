"use strict";

// 端末の持ち方でも、返ってきた映像の向きでも、撮影を止めない。
// iPhoneは縦に構えるとインカメ・背面ともに縦長のフレームを返すことがあるが、
// センサーは4:3のままなので、止めるとただ撮れなくなるだけだった。
// 実際に録れた縦横は captureAspectRatio として保存し、再生側がそれに合わせる。
const RUN_CAMERA_LANDSCAPE_PROFILE_ID = "wide";

function normalizedRunCameraDimension(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function runCameraOrientationState(profileId, viewportWidth, viewportHeight, frameWidth = 0, frameHeight = 0) {
  const fw = normalizedRunCameraDimension(frameWidth);
  const fh = normalizedRunCameraDimension(frameHeight);
  const frameKnown = fw > 0 && fh > 0;
  return {
    requiresLandscape: profileId === RUN_CAMERA_LANDSCAPE_PROFILE_ID,
    frameKnown,
    frameLandscape: !frameKnown || fw >= fh,
    blocked: false,
  };
}
