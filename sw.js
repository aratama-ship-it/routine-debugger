/* ルーティンノート Service Worker — アプリシェルをキャッシュして完全オフライン動作 */
const CACHE = "routine-debugger-v352";
const ASSETS = [
  "./",
  "./index.html",
  "./backup.html",
  "./privacy.html",
  "./terms.html",
  "./about.html",
  "./beta.html",
  "./updates.html",
  "./routine-state-health.js?v=352",
  "./routine-state-health.css?v=352",
  "./styles.css?v=352",
  "./batch-sequence-import.css?v=352",
  "./tablet.css?v=352",
  "./app-update.css?v=352",
  "./skin-blackboard.css?v=352",
  "./i18n.js?v=352",
  "./i18n-zh.js?v=352",
  "./sample-music.js?v=352",
  "./run-video-orientation.js?v=352",
  "./run-camera-lens.js?v=352",
  "./run-video-delay.js?v=352",
  "./run-video-clock.js?v=352",
  "./run-video-composition.js?v=352",
  "./run-video-sync.js?v=352",
  "./run-video-review.js?v=352",
  "./music-playback.js?v=352",
  "./batch-sequence-import.js?v=352",
  "./backup-archive.js?v=352",
  "./a11y-sheet.js?v=352",
  "./pwa-install.js?v=352",
  "./practice-dock.js?v=352",
  "./editor-time.js?v=352",
  "./tutorial.js?v=352",
  "./account.js?v=352",
  "./help-en.js?v=352",
  "./help-zh.js?v=352",
  "./settings-view.js?v=352",
  "./app.js?v=352",
  "./sample-repair.js?v=352",
  "./audio-preview.js?v=352",
  "./from-run-video.js?v=352",
  "./part-presets.js?v=352",
  "./share-practice.js?v=352",
  "./part-from-failure.js?v=352",
  "./verify-card.js?v=352",
  "./verify-experiment.js?v=352",
  "./sync.js?v=352",
  "./manifest.webmanifest?v=352",
  "./icons/icon-180.png?v=352",
  "./icons/icon-192.png?v=352",
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
