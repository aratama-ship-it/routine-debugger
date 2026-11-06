// 付属サンプル音源の一覧。
// 実体のファイル名はURLで扱いやすいASCIIに統一し、表示名(n)は原題のまま持つ。
// 初回表示では取得せず、利用者が選んだときだけ読み込む(初期の転送量を増やさないため)。
// app.js がサイズ上限に達しているため、ここに分離している。app.js より前に読み込むこと。
const SAMPLE_MUSIC = [
  { f: "samples/spiral-of-light.mp3", n: "Spiral of Light" },
  { f: "samples/clockwork-duet.mp3", n: "Clockwork Duet" },
  { f: "samples/brushstroke-silence.mp3", n: "Brushstroke Silence" },
  { f: "samples/sumi-no-kokyu.mp3", n: "墨の呼吸" },
  { f: "samples/same-train-strangers.mp3", n: "Same Train Strangers" },
  { f: "samples/challie-lav.mp3", n: "challie lav" },
  { f: "samples/verse1.mp3", n: "Verse 1" },
];

// Capacitor iOS serves bundled media as URLResponse, so fetch reports status 0.
// Accept that only for this app's local sample files; HTTP failures stay failures.
function nativeSampleURL(path) {
  if (!window.Capacitor?.isNativePlatform?.() || location.protocol !== "capacitor:") return null;
  const url = new URL(path, location.href);
  return url.protocol === location.protocol && url.host === location.host &&
    !url.username && !url.password && !url.search && !url.hash &&
    /^\/samples\/[a-zA-Z0-9_-]+\.(mp3|mp4)$/.test(url.pathname) ? url : null;
}
function canLoadSampleAssets() {
  return /^https?:$/.test(location.protocol) || !!nativeSampleURL(SAMPLE_MUSIC[0].f);
}
async function fetchSampleAsset(path) {
  const response = await fetch(path);
  const local = nativeSampleURL(path);
  if (!response.ok && !(local && response.status === 0 && !response.redirected)) return null;
  const blob = await response.blob();
  if (!blob.size || /^text\/html\b/i.test(blob.type)) return null;
  if (local && !blob.type) {
    return new Blob([blob], { type: local.pathname.endsWith(".mp3") ? "audio/mpeg" : "video/mp4" });
  }
  return blob;
}
