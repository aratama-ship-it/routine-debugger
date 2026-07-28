/* ルーティンノート Service Worker — アプリシェルをキャッシュして完全オフライン動作 */
const CACHE = "routine-debugger-v272";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=272",
  "./batch-sequence-import.css?v=272",
  "./tablet.css?v=272",
  "./app-update.css?v=272",
  "./i18n.js?v=272",
  "./sample-music.js?v=272",
  "./run-video-orientation.js?v=272",
  "./run-video-composition.js?v=272",
  "./run-video-sync.js?v=272",
  "./run-video-review.js?v=272",
  "./music-playback.js?v=272",
  "./batch-sequence-import.js?v=272",
  "./backup-archive.js?v=272",
  "./a11y-sheet.js?v=272",
  "./pwa-install.js?v=272",
  "./practice-dock.js?v=272",
  "./editor-time.js?v=272",
  "./tutorial.js?v=272",
  "./account.js?v=272",
  "./help-en.js?v=272",
  "./app.js?v=272",
  "./sample-repair.js?v=272",
  "./audio-preview.js?v=272",
  "./part-presets.js?v=272",
  "./sync.js?v=272",
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
