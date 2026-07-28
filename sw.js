/* ルーティンノート Service Worker — アプリシェルをキャッシュして完全オフライン動作 */
const CACHE = "routine-debugger-v264";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=264",
  "./batch-sequence-import.css?v=264",
  "./tablet.css?v=264",
  "./app-update.css?v=264",
  "./i18n.js?v=264",
  "./sample-music.js?v=264",
  "./run-video-orientation.js?v=264",
  "./run-video-composition.js?v=264",
  "./run-video-sync.js?v=264",
  "./run-video-review.js?v=264",
  "./music-playback.js?v=264",
  "./batch-sequence-import.js?v=264",
  "./backup-archive.js?v=264",
  "./a11y-sheet.js?v=264",
  "./pwa-install.js?v=264",
  "./practice-dock.js?v=264",
  "./editor-time.js?v=264",
  "./tutorial.js?v=264",
  "./account.js?v=264",
  "./app.js?v=264",
  "./sample-repair.js?v=264",
  "./audio-preview.js?v=264",
  "./sync.js?v=264",
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
