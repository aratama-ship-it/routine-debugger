/* ルーティンノート Service Worker — アプリシェルをキャッシュして完全オフライン動作 */
const CACHE = "routine-debugger-v322";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=322",
  "./batch-sequence-import.css?v=322",
  "./tablet.css?v=322",
  "./app-update.css?v=322",
  "./skin-blackboard.css?v=322",
  "./i18n.js?v=322",
  "./sample-music.js?v=322",
  "./run-video-orientation.js?v=322",
  "./run-camera-lens.js?v=322",
  "./run-video-delay.js?v=322",
  "./run-video-composition.js?v=322",
  "./run-video-sync.js?v=322",
  "./run-video-review.js?v=322",
  "./music-playback.js?v=322",
  "./batch-sequence-import.js?v=322",
  "./backup-archive.js?v=322",
  "./a11y-sheet.js?v=322",
  "./pwa-install.js?v=322",
  "./practice-dock.js?v=322",
  "./editor-time.js?v=322",
  "./tutorial.js?v=322",
  "./account.js?v=322",
  "./help-en.js?v=322",
  "./settings-view.js?v=322",
  "./app.js?v=322",
  "./sample-repair.js?v=322",
  "./audio-preview.js?v=322",
  "./from-run-video.js?v=322",
  "./part-presets.js?v=322",
  "./sync.js?v=322",
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
