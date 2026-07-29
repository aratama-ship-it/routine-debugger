/* ルーティンノート Service Worker — アプリシェルをキャッシュして完全オフライン動作 */
const CACHE = "routine-debugger-v315";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=315",
  "./batch-sequence-import.css?v=315",
  "./tablet.css?v=315",
  "./app-update.css?v=315",
  "./skin-blackboard.css?v=315",
  "./i18n.js?v=315",
  "./sample-music.js?v=315",
  "./run-video-orientation.js?v=315",
  "./run-camera-lens.js?v=315",
  "./run-video-delay.js?v=315",
  "./run-video-composition.js?v=315",
  "./run-video-sync.js?v=315",
  "./run-video-review.js?v=315",
  "./music-playback.js?v=315",
  "./batch-sequence-import.js?v=315",
  "./backup-archive.js?v=315",
  "./a11y-sheet.js?v=315",
  "./pwa-install.js?v=315",
  "./practice-dock.js?v=315",
  "./editor-time.js?v=315",
  "./tutorial.js?v=315",
  "./account.js?v=315",
  "./help-en.js?v=315",
  "./settings-view.js?v=315",
  "./app.js?v=315",
  "./sample-repair.js?v=315",
  "./audio-preview.js?v=315",
  "./from-run-video.js?v=315",
  "./part-presets.js?v=315",
  "./sync.js?v=315",
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
