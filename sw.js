/* ルーティンノート Service Worker — アプリシェルをキャッシュして完全オフライン動作 */
const CACHE = "routine-debugger-v349";
const ASSETS = [
  "./",
  "./index.html",
  "./backup.html",
  "./privacy.html",
  "./terms.html",
  "./about.html",
  "./beta.html",
  "./updates.html",
  "./styles.css?v=349",
  "./batch-sequence-import.css?v=349",
  "./tablet.css?v=349",
  "./app-update.css?v=349",
  "./skin-blackboard.css?v=349",
  "./i18n.js?v=349",
  "./i18n-zh.js?v=349",
  "./sample-music.js?v=349",
  "./run-video-orientation.js?v=349",
  "./run-camera-lens.js?v=349",
  "./run-video-delay.js?v=349",
  "./run-video-clock.js?v=349",
  "./run-video-composition.js?v=349",
  "./run-video-sync.js?v=349",
  "./run-video-review.js?v=349",
  "./music-playback.js?v=349",
  "./batch-sequence-import.js?v=349",
  "./backup-archive.js?v=349",
  "./a11y-sheet.js?v=349",
  "./pwa-install.js?v=349",
  "./practice-dock.js?v=349",
  "./editor-time.js?v=349",
  "./tutorial.js?v=349",
  "./account.js?v=349",
  "./help-en.js?v=349",
  "./help-zh.js?v=349",
  "./settings-view.js?v=349",
  "./app.js?v=349",
  "./sample-repair.js?v=349",
  "./audio-preview.js?v=349",
  "./from-run-video.js?v=349",
  "./part-presets.js?v=349",
  "./share-practice.js?v=349",
  "./part-from-failure.js?v=349",
  "./verify-card.js?v=349",
  "./verify-experiment.js?v=349",
  "./sync.js?v=349",
  "./manifest.webmanifest?v=349",
  "./icons/icon-180.png?v=349",
  "./icons/icon-192.png?v=349",
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
    e.respondWith(fetch(e.request).catch(async () =>
      await caches.match(e.request, { ignoreSearch: true }) || caches.match("./index.html")));
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
