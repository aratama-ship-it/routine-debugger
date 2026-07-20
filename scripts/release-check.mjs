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

const shellAssets = [...sw.matchAll(/^\s*"\.\/(.+?)",?$/gm)].map((match) => match[1].split("?")[0]);
for (const asset of shellAssets) {
  if (!asset || asset === "index.html") continue;
  try { await access(new URL(asset, root), constants.R_OK); }
  catch { failures.push(`Service Workerの対象が見つかりません: ${asset}`); }
}

const budgets = [
  ["app.js", 300_000], ["styles.css", 120_000], ["i18n.js", 50_000], ["assets/wa-bg.svg", 100_000],
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
