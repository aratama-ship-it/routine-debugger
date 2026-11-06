/* ルーティンノート Service Worker — アプリシェルをキャッシュして完全オフライン動作 */
const CACHE = "routine-debugger-v351";
const ASSETS = [
  "./",
  "./index.html",
  "./backup.html",
  "./privacy.html",
  "./terms.html",
  "./about.html",
  "./beta.html",
  "./updates.html",
  "./routine-state-health.js?v=351",
  "./routine-state-health.css?v=351",
  "./styles.css?v=351",
  "./batch-sequence-import.css?v=351",
  "./tablet.css?v=351",
  "./app-update.css?v=351",
  "./skin-blackboard.css?v=351",
  "./i18n.js?v=351",
  "./i18n-zh.js?v=351",
  "./sample-music.js?v=351",
  "./run-video-orientation.js?v=351",
  "./run-camera-lens.js?v=351",
  "./run-video-delay.js?v=351",
  "./run-video-clock.js?v=351",
  "./run-video-composition.js?v=351",
  "./run-video-sync.js?v=351",
  "./run-video-review.js?v=351",
  "./music-playback.js?v=351",
  "./batch-sequence-import.js?v=351",
  "./backup-archive.js?v=351",
  "./a11y-sheet.js?v=351",
  "./pwa-install.js?v=351",
  "./practice-dock.js?v=351",
  "./editor-time.js?v=351",
  "./tutorial.js?v=351",
  "./account.js?v=351",
  "./help-en.js?v=351",
  "./help-zh.js?v=351",
  "./settings-view.js?v=351",
  "./app.js?v=351",
  "./sample-repair.js?v=351",
  "./audio-preview.js?v=351",
  "./from-run-video.js?v=351",
  "./part-presets.js?v=351",
  "./share-practice.js?v=351",
  "./part-from-failure.js?v=351",
  "./verify-card.js?v=351",
  "./verify-experiment.js?v=351",
  "./sync.js?v=351",
  "./manifest.webmanifest?v=351",
  "./icons/icon-180.png?v=351",
  "./icons/icon-192.png?v=351",
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
