"use strict";

// 判断の基準は「実際に返ってきた映像が横長かどうか」だけにする。
// 背面カメラは端末を縦に構えても横長で返るため、持ち方で縛ると撮れなくなる。
// インカメは持ち方に追従して縦で返るので、その場合はここで止まる。
const RUN_CAMERA_LANDSCAPE_PROFILE_ID = "wide";

function normalizedRunCameraDimension(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

// 端末の持ち方(viewport)は見ない。背面カメラは縦に構えても横長で返るため。
function runCameraOrientationState(profileId, viewportWidth, viewportHeight, frameWidth = 0, frameHeight = 0) {
  const fw = normalizedRunCameraDimension(frameWidth);
  const fh = normalizedRunCameraDimension(frameHeight);
  const requiresLandscape = profileId === RUN_CAMERA_LANDSCAPE_PROFILE_ID;
  const frameKnown = fw > 0 && fh > 0;
  return {
    requiresLandscape,
    frameKnown,
    frameLandscape: !frameKnown || fw >= fh,
    blocked: requiresLandscape && frameKnown && fw < fh,
  };
}
