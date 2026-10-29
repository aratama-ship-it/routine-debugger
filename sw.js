/* ルーティンノート Service Worker — アプリシェルをキャッシュして完全オフライン動作 */
const CACHE = "routine-debugger-v350";
const ASSETS = [
  "./",
  "./index.html",
  "./routine-state-health.js?v=350",
  "./routine-state-health.css?v=350",
  "./styles.css?v=350",
  "./batch-sequence-import.css?v=350",
  "./tablet.css?v=350",
  "./app-update.css?v=350",
  "./skin-blackboard.css?v=350",
  "./i18n.js?v=350",
  "./i18n-zh.js?v=350",
  "./sample-music.js?v=350",
  "./run-video-orientation.js?v=350",
  "./run-camera-lens.js?v=350",
  "./run-video-delay.js?v=350",
  "./run-video-composition.js?v=350",
  "./run-video-sync.js?v=350",
  "./run-video-review.js?v=350",
  "./music-playback.js?v=350",
  "./batch-sequence-import.js?v=350",
  "./backup-archive.js?v=350",
  "./a11y-sheet.js?v=350",
  "./pwa-install.js?v=350",
  "./practice-dock.js?v=350",
  "./editor-time.js?v=350",
  "./tutorial.js?v=350",
  "./account.js?v=350",
  "./help-en.js?v=350",
  "./help-zh.js?v=350",
  "./settings-view.js?v=350",
  "./app.js?v=350",
  "./sample-repair.js?v=350",
  "./audio-preview.js?v=350",
  "./from-run-video.js?v=350",
  "./part-presets.js?v=350",
  "./share-practice.js?v=350",
  "./part-from-failure.js?v=350",
  "./verify-card.js?v=350",
  "./verify-experiment.js?v=350",
  "./sync.js?v=350",
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
