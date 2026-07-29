/* ルーティンノート Service Worker — アプリシェルをキャッシュして完全オフライン動作 */
const CACHE = "routine-debugger-v287";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=287",
  "./batch-sequence-import.css?v=287",
  "./tablet.css?v=287",
  "./app-update.css?v=287",
  "./i18n.js?v=287",
  "./sample-music.js?v=287",
  "./run-video-orientation.js?v=287",
  "./run-video-composition.js?v=287",
  "./run-video-sync.js?v=287",
  "./run-video-review.js?v=287",
  "./music-playback.js?v=287",
  "./batch-sequence-import.js?v=287",
  "./backup-archive.js?v=287",
  "./a11y-sheet.js?v=287",
  "./pwa-install.js?v=287",
  "./practice-dock.js?v=287",
  "./editor-time.js?v=287",
  "./tutorial.js?v=287",
  "./account.js?v=287",
  "./help-en.js?v=287",
  "./app.js?v=287",
  "./sample-repair.js?v=287",
  "./audio-preview.js?v=287",
  "./from-run-video.js?v=287",
  "./part-presets.js?v=287",
  "./sync.js?v=287",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./assets/wa-bg.svg",
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
