/* ルーティンノート Service Worker — アプリシェルをキャッシュして完全オフライン動作 */
const CACHE = "routine-debugger-v330";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=330",
  "./batch-sequence-import.css?v=330",
  "./tablet.css?v=330",
  "./app-update.css?v=330",
  "./skin-blackboard.css?v=330",
  "./i18n.js?v=330",
  "./sample-music.js?v=330",
  "./run-video-orientation.js?v=330",
  "./run-camera-lens.js?v=330",
  "./run-video-delay.js?v=330",
  "./run-video-composition.js?v=330",
  "./run-video-sync.js?v=330",
  "./run-video-review.js?v=330",
  "./music-playback.js?v=330",
  "./batch-sequence-import.js?v=330",
  "./backup-archive.js?v=330",
  "./a11y-sheet.js?v=330",
  "./pwa-install.js?v=330",
  "./practice-dock.js?v=330",
  "./editor-time.js?v=330",
  "./tutorial.js?v=330",
  "./account.js?v=330",
  "./help-en.js?v=330",
  "./settings-view.js?v=330",
  "./app.js?v=330",
  "./sample-repair.js?v=330",
  "./audio-preview.js?v=330",
  "./from-run-video.js?v=330",
  "./part-presets.js?v=330",
  "./share-practice.js?v=330",
  "./sync.js?v=330",
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
