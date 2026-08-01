/* ルーティンノート Service Worker — アプリシェルをキャッシュして完全オフライン動作 */
const CACHE = "routine-debugger-v332";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=332",
  "./batch-sequence-import.css?v=332",
  "./tablet.css?v=332",
  "./app-update.css?v=332",
  "./skin-blackboard.css?v=332",
  "./i18n.js?v=332",
  "./sample-music.js?v=332",
  "./run-video-orientation.js?v=332",
  "./run-camera-lens.js?v=332",
  "./run-video-delay.js?v=332",
  "./run-video-composition.js?v=332",
  "./run-video-sync.js?v=332",
  "./run-video-review.js?v=332",
  "./music-playback.js?v=332",
  "./batch-sequence-import.js?v=332",
  "./backup-archive.js?v=332",
  "./a11y-sheet.js?v=332",
  "./pwa-install.js?v=332",
  "./practice-dock.js?v=332",
  "./editor-time.js?v=332",
  "./tutorial.js?v=332",
  "./account.js?v=332",
  "./help-en.js?v=332",
  "./settings-view.js?v=332",
  "./app.js?v=332",
  "./sample-repair.js?v=332",
  "./audio-preview.js?v=332",
  "./from-run-video.js?v=332",
  "./part-presets.js?v=332",
  "./share-practice.js?v=332",
  "./sync.js?v=332",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // 画面遷移だけはネットワーク優先。オフライン時に限りアプリ本体へ戻す。
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("./index.html")));
    return;
  }

  // JS/CSS/画像/サンプル音源はキャッシュ優先。206 Range応答や失敗応答は保存しない。
  e.respondWith(caches.match(e.request, { ignoreSearch: false }).then(async (hit) => {
    if (hit) return hit;
    const res = await fetch(e.request);
    if (res.status === 200 && !e.request.headers.has("range")) {
      const cache = await caches.open(CACHE);
      await cache.put(e.request, res.clone());
    }
    return res;
  }));
});
