"use strict";

// iPhone Safariでは要求したwidth/heightより端末の向きが優先される場合がある。
// 4:3横長は、画面と実カメラフレームの両方が横向きのときだけ録画を許可する。
const RUN_CAMERA_LANDSCAPE_PROFILE_ID = "wide";

function normalizedRunCameraDimension(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function runCameraOrientationState(profileId, viewportWidth, viewportHeight, frameWidth = 0, frameHeight = 0) {
  const vw = normalizedRunCameraDimension(viewportWidth);
  const vh = normalizedRunCameraDimension(viewportHeight);
  const fw = normalizedRunCameraDimension(frameWidth);
  const fh = normalizedRunCameraDimension(frameHeight);
  const requiresLandscape = profileId === RUN_CAMERA_LANDSCAPE_PROFILE_ID;
  const viewportKnown = vw > 0 && vh > 0;
  const frameKnown = fw > 0 && fh > 0;
  const viewportLandscape = !viewportKnown || vw >= vh;
  const frameLandscape = !frameKnown || fw >= fh;
  return {
    requiresLandscape,
    viewportKnown,
    viewportLandscape,
    frameKnown,
    frameLandscape,
    blocked: requiresLandscape && (!viewportLandscape || !frameLandscape),
  };
}
