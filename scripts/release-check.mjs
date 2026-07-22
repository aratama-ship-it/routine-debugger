import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { gzipSync } from "node:zlib";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");
const failures = [];
const notes = [];
const requireMatch = (source, pattern, label) => {
  const match = source.match(pattern);
  if (!match) failures.push(`${label} を取得できません`);
  return match && match[1];
};

const [app, css, i18n, html, sw, manifestText] = await Promise.all([
  read("app.js"), read("styles.css"), read("i18n.js"), read("index.html"), read("sw.js"), read("manifest.webmanifest"),
]);

// 構文エラーはブラウザ起動前に止める。
for (const [name, source] of [["app.js", app], ["i18n.js", i18n], ["sw.js", sw]]) {
  try { new Function(source); } catch (error) { failures.push(`${name}: ${error.message}`); }
}

const appVersion = requireMatch(app, /APP_VERSION\s*=\s*"(v\d+)"/, "APP_VERSION");
const cacheVersion = requireMatch(sw, /CACHE\s*=\s*"routine-debugger-(v\d+)"/, "Service Worker版");
const cssVersion = requireMatch(html, /styles\.css\?v=(\d+)/, "CSS版");
const i18nVersion = requireMatch(html, /i18n\.js\?v=(\d+)/, "i18n版");
const jsVersion = requireMatch(html, /app\.js\?v=(\d+)/, "JS版");
const expected = appVersion && appVersion.slice(1);
for (const [label, value] of [["Service Worker", cacheVersion && cacheVersion.slice(1)], ["CSS", cssVersion], ["i18n", i18nVersion], ["JS", jsVersion]]) {
  if (expected && value !== expected) failures.push(`${label}の版 ${value || "?"} がAPP_VERSION ${expected} と不一致です`);
}

let manifest;
try { manifest = JSON.parse(manifestText); } catch (error) { failures.push(`manifest: ${error.message}`); }
if (manifest && manifest.display !== "standalone") failures.push("manifest.display が standalone ではありません");
if (html.includes("user-scalable=no")) failures.push("画面拡大が禁止されています");
if (/\bbuilder(?:State|TickUI|Export|AttachMusic)\b/.test(app)) failures.push("到達不能な旧ビルダーコードが残っています");

// 通し練習の描画は設定値を直接参照するため、宣言漏れを構文検査だけで見逃さない。
const renderRecordSource = app.match(/function renderRecord\(\) \{([\s\S]*?)\n\}\n\nfunction sheetStartSession/);
if (!renderRecordSource || !/\bconst showRisk\s*=/.test(renderRecordSource[1])) {
  failures.push("renderRecord内のshowRisk初期化がありません");
}
if (!/addEventListener\("pagehide", stopPlaybackForPageExit\)/.test(app)) {
  failures.push("ブラウザ離脱時の再生停止処理がありません");
}
if (!/featureSettings:\s*\{\s*showRisk:\s*false,\s*showSlots:\s*false\s*\}/.test(app)) {
  failures.push("サンプルルーティンのリスク度・A\/B分岐が初期OFFではありません");
}
for (const property of ["preservesPitch", "webkitPreservesPitch", "mozPreservesPitch"]) {
  if (!app.includes(property)) failures.push(`音程維持の互換設定がありません: ${property}`);
}
if (!/function setMusicPlaybackRate\([\s\S]*?preserveMediaPitch\(musicPlayer\)[\s\S]*?musicPlayer\.playbackRate/.test(app)) {
  failures.push("パート練習の速度変更に音程維持処理が適用されていません");
}
if (!/PART_PLAYBACK_STEP\s*=\s*0\.05/.test(app) || !/partNudgePlaybackRate/.test(app)) {
  failures.push("パート練習の再生速度を0.05倍刻みで調整できません");
}
if (!/RUN_VIDEO_LIMIT\s*=\s*5/.test(app)) {
  failures.push("通し映像の全体保存上限が5本ではありません");
}
if (!/getUserMedia\(\{[\s\S]*?facingMode:\s*"user"[\s\S]*?audio:\s*false[\s\S]*?\}\)/.test(app)) {
  failures.push("通し映像がインカメ・音声なしで設定されていません");
}
if (!/aspectRatio:\s*\{\s*ideal:\s*9\s*\/\s*16\s*\}/.test(app) || !/\.run-video-review\s*\{[\s\S]*?aspect-ratio:\s*9\/16/.test(css)) {
  failures.push("通し映像の撮影・再生が縦9:16で統一されていません");
}
if (!/id="run-camera-live-preview"/.test(app) || !/bindRunCameraLivePreview\(\)/.test(app)) {
  failures.push("通し練習中のインカメプレビューがありません");
}
if (!/storedRunVideos\(\)\.length\s*>=\s*RUN_VIDEO_LIMIT[\s\S]*?showRunVideoReplacement/.test(app)) {
  failures.push("通し映像6本目の入れ替え確認がありません");
}
if (!/onclick="go\('runvideos'\)"/.test(app) || !/runvideos:\s*renderRunVideos/.test(app)) {
  failures.push("ホームから演技映像ライブラリへの導線がありません");
}
if (!/function renderRunVideos\([\s\S]*?openRunVideo[\s\S]*?runVideoDelete/.test(app)) {
  failures.push("演技映像ライブラリに再生・削除操作がありません");
}

const shellAssets = [...sw.matchAll(/^\s*"\.\/(.+?)",?$/gm)].map((match) => match[1].split("?")[0]);
for (const asset of shellAssets) {
  if (!asset || asset === "index.html") continue;
  try { await access(new URL(asset, root), constants.R_OK); }
  catch { failures.push(`Service Workerの対象が見つかりません: ${asset}`); }
}

const budgets = [
  ["app.js", 310_000], ["styles.css", 120_000], ["i18n.js", 50_000], ["assets/wa-bg.svg", 100_000],
];
for (const [name, max] of budgets) {
  const size = (await stat(new URL(name, root))).size;
  if (size > max) failures.push(`${name} がサイズ上限 ${max} bytes を超えています (${size})`);
  notes.push(`${name}: ${(size / 1024).toFixed(1)} KiB`);
}
const gzipShell = gzipSync(app).length + gzipSync(css).length + gzipSync(i18n).length + gzipSync(sw).length + gzipSync(html).length;
notes.push(`主要コード gzip概算: ${(gzipShell / 1024).toFixed(1)} KiB`);
if (gzipShell > 140_000) failures.push(`主要コードのgzip概算が140KBを超えています (${gzipShell})`);

if (failures.length) {
  console.error("Release check failed:\n- " + failures.join("\n- "));
  process.exitCode = 1;
} else {
  console.log(`Release check passed (${appVersion})`);
}
console.log(notes.join("\n"));
