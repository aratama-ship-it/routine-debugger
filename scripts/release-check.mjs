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

const [app, runVideoSync, css, i18n, html, sw, manifestText] = await Promise.all([
  read("app.js"), read("run-video-sync.js"), read("styles.css"), read("i18n.js"), read("index.html"), read("sw.js"), read("manifest.webmanifest"),
]);

// 構文エラーはブラウザ起動前に止める。
for (const [name, source] of [["app.js", app], ["run-video-sync.js", runVideoSync], ["i18n.js", i18n], ["sw.js", sw]]) {
  try { new Function(source); } catch (error) { failures.push(`${name}: ${error.message}`); }
}

const appVersion = requireMatch(app, /APP_VERSION\s*=\s*"(v\d+)"/, "APP_VERSION");
const cacheVersion = requireMatch(sw, /CACHE\s*=\s*"routine-debugger-(v\d+)"/, "Service Worker版");
const swRunVideoSyncVersion = requireMatch(sw, /run-video-sync\.js\?v=(\d+)/, "Service Worker映像音源同期JS版");
const cssVersion = requireMatch(html, /styles\.css\?v=(\d+)/, "CSS版");
const i18nVersion = requireMatch(html, /i18n\.js\?v=(\d+)/, "i18n版");
const runVideoSyncVersion = requireMatch(html, /run-video-sync\.js\?v=(\d+)/, "映像音源同期JS版");
const jsVersion = requireMatch(html, /app\.js\?v=(\d+)/, "JS版");
const expected = appVersion && appVersion.slice(1);
for (const [label, value] of [["Service Worker", cacheVersion && cacheVersion.slice(1)], ["Service Worker映像音源同期JS", swRunVideoSyncVersion], ["CSS", cssVersion], ["i18n", i18nVersion], ["映像音源同期JS", runVideoSyncVersion], ["JS", jsVersion]]) {
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
if (!/musicPlayer\.preload\s*=\s*"metadata"/.test(app)
    || !/async function loadMusic\([\s\S]*?musicPlayer\.load\(\)/.test(app)) {
  failures.push("再生前に楽曲メタデータを読み込む設定がありません");
}
if (!/function renderRecord\([\s\S]*?recordMusicDuration[\s\S]*?Number\(rt\.music\.duration\)[\s\S]*?id="music-dur">\$\{fmtTime\(recordMusicDuration\)\}/.test(app)) {
  failures.push("通し練習で再生前から保存済みの楽曲長を表示できません");
}
if (!/RUN_VIDEO_LIMIT\s*=\s*5/.test(app)) {
  failures.push("通し映像の全体保存上限が5本ではありません");
}
if (!/getUserMedia\(\{[\s\S]*?facingMode:\s*"user"[\s\S]*?audio:\s*false[\s\S]*?\}\)/.test(app)) {
  failures.push("通し映像がインカメ・音声なしで設定されていません");
}
if (!/wide:\s*\{[\s\S]*?width:\s*960[\s\S]*?height:\s*720[\s\S]*?ratio:\s*4\s*\/\s*3/.test(app)
    || !/vertical:\s*\{[\s\S]*?ratio:\s*9\s*\/\s*16/.test(app)
    || !/selectRunCameraProfile/.test(app)
    || !/function runVideoAspect\(video\)[\s\S]*?RUN_CAMERA_PROFILES\[video\?\.cameraProfile\]/.test(app)
    || !/\.run-camera-preview\s*\{[\s\S]*?aspect-ratio:\s*var\(--run-camera-aspect,\s*4\/3\)/.test(css)
    || !/\.run-camera-live-preview\s*\{[\s\S]*?aspect-ratio:\s*var\(--run-camera-aspect,\s*4\/3\)/.test(css)
    || !/\.run-video-review\s*\{[\s\S]*?aspect-ratio:\s*var\(--run-camera-aspect,\s*4\/3\)/.test(css)) {
  failures.push("通し映像の4:3横長／9:16縦長選択と各プレビューへの反映がありません");
}
if (!/id="run-camera-live-preview"/.test(app) || !/bindRunCameraLivePreview\(\)/.test(app)) {
  failures.push("通し練習中のインカメプレビューがありません");
}
if (!/addEventListener\("playing"[\s\S]*?startRunVideoCapture/.test(app)
    || !/\["pause",\s*"ended"\][\s\S]*?stopRunVideoCaptureAtMusicStop/.test(app)) {
  failures.push("通し映像の録画開始・終了が楽曲再生と同期していません");
}
if (!/cap\.music\s*=\s*cloneRunVideoMusicMeta\(rt\s*&&\s*rt\.music\)/.test(app)
    || !/music:\s*cap\.music\s*\?\s*\{\s*\.\.\.cap\.music\s*\}\s*:\s*null/.test(app)
    || !/music:\s*pending\.music\s*\?\s*\{\s*\.\.\.pending\.music\s*\}\s*:\s*null/.test(app)
    || !/function runVideoMusicMeta\(video\)/.test(runVideoSync)) {
  failures.push("通し映像へ撮影時の対象音源が保存されていません");
}
if (!/window\.previewStoppedRunVideo\s*=\s*async/.test(runVideoSync)
    || !/stoppedRunVideoCapture\s*!==\s*capture/.test(runVideoSync)
    || !/onclick="previewStoppedRunVideo\('\$\{rt\.id\}'\)"/.test(app)
    || !/今撮った通し映像/.test(runVideoSync)
    || !/\.run-video-stopped \.run-video-instant-preview/.test(css)) {
  failures.push("音源停止直後の一時映像を、結果入力前に何度でもプレビューできません");
}
if (!/function bindRunVideoAudioSync\(music\)[\s\S]*?addEventListener\("play"[\s\S]*?tryPlayRunVideoAudio/.test(runVideoSync)
    || !/addEventListener\("pause"[\s\S]*?audio\.pause/.test(runVideoSync)
    || !/addEventListener\("seeking"[\s\S]*?syncRunVideoAudioPosition\(true\)/.test(runVideoSync)
    || !/addEventListener\("seeked"[\s\S]*?syncRunVideoAudioPosition\(true\)/.test(runVideoSync)
    || !/id="run-video-audio"/.test(app)) {
  failures.push("通し映像の再生・停止・シークへ対象音源を同期できません");
}
if (!/preserveRunVideoMusicSnapshots/.test(runVideoSync)
    || !/deleteRunVideoMusicBlobIfUnused/.test(runVideoSync)) {
  failures.push("映像が参照する対象音源の保持・解放処理がありません");
}
const tapStepSource = app.match(/window\.tapStep\s*=\s*\(stepIndex\)\s*=>\s*\{([\s\S]*?)\n\};\n\nwindow\.commitEvent/);
if (!/const EVENT_TYPES\s*=\s*\[\s*\{\s*id:\s*"drop_recovered"/.test(app)
    || !/\|\|\s*"drop_recovered"/.test(app)
    || !tapStepSource || /musicPlayer\.pause\(\)/.test(tapStepSource[1])) {
  failures.push("復帰できるミスが初期選択になっていないか、ミスタップ時に楽曲を停止しています");
}
if (!/openRun\.events\.filter\(\(e\)\s*=>\s*e\.stepIndex\s*===\s*i\)\.length/.test(app)) {
  failures.push("同じ通し・ステップの複数ミス件数を表示できません");
}
if (!/SHEET 00 \/ HOME · \$\{APP_VERSION\}/.test(app)) {
  failures.push("ホームに公開バージョン表示がありません");
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
if (!/function runVideoStorageActions\(videos\)/.test(runVideoSync)
    || !/window\.showDeleteAllRunVideos\s*=/.test(runVideoSync)
    || !/onclick="showDeleteAllRunVideos\(\)"/.test(runVideoSync)
    || !/window\.startRunVideoBulkDeleteSlide\s*=/.test(app)
    || !/window\.runVideoBulkDeleteKey\s*=/.test(app)
    || !/async function performRunVideoBulkDelete\(\)/.test(runVideoSync)
    || !/state\.runVideos\s*=\s*\[\]/.test(runVideoSync)
    || !/videoIds\.has\(run\.videoId\)[\s\S]*?delete run\.videoId/.test(runVideoSync)
    || !/Promise\.all\(videos\.map\(\(video\)\s*=>\s*blobDel\(video\.blobId\)\)\)/.test(runVideoSync)
    || !/映像の使用容量/.test(app)
    || !/onclick="go\('runvideos'\)">演技映像の保存を管理/.test(app)
    || !/\.run-video-storage-actions/.test(css)) {
  failures.push("演技映像の容量表示と、スライド確認付き一括削除が揃っていません");
}
if (!/showRoutinePracticeChoice\('\$\{rt\.id\}'\)/.test(app)
    || !/function routineCardHtml[\s\S]*?routineId:'\$\{rt\.id\}'[\s\S]*?演技映像を見る/.test(app)) {
  failures.push("ルーティンカードに練習選択とルーティン別演技映像の導線がありません");
}
if (!/window\.showRoutinePracticeChoice[\s\S]*?openRoutinePractice\('\$\{id\}','record'\)[\s\S]*?openRoutinePractice\('\$\{id\}','part'\)/.test(app)) {
  failures.push("練習入口から通し練習・パート練習を選択できません");
}
if (!/const routineFilter = view\.params\.routineId[\s\S]*?video\.routineId === routineFilter\.id/.test(app)
    || !/view\.params\.from === "routines" \? "go\('routines'\)"/.test(app)) {
  failures.push("演技映像ライブラリをルーティン単位で表示し、一覧へ戻れません");
}

const shellAssets = [...sw.matchAll(/^\s*"\.\/(.+?)",?$/gm)].map((match) => match[1].split("?")[0]);
for (const asset of shellAssets) {
  if (!asset || asset === "index.html") continue;
  try { await access(new URL(asset, root), constants.R_OK); }
  catch { failures.push(`Service Workerの対象が見つかりません: ${asset}`); }
}

const budgets = [
  ["app.js", 322_000], ["run-video-sync.js", 16_000], ["styles.css", 120_000], ["i18n.js", 50_000], ["assets/wa-bg.svg", 100_000],
];
for (const [name, max] of budgets) {
  const size = (await stat(new URL(name, root))).size;
  if (size > max) failures.push(`${name} がサイズ上限 ${max} bytes を超えています (${size})`);
  notes.push(`${name}: ${(size / 1024).toFixed(1)} KiB`);
}
const gzipShell = gzipSync(app).length + gzipSync(runVideoSync).length + gzipSync(css).length + gzipSync(i18n).length + gzipSync(sw).length + gzipSync(html).length;
notes.push(`主要コード gzip概算: ${(gzipShell / 1024).toFixed(1)} KiB`);
if (gzipShell > 140_000) failures.push(`主要コードのgzip概算が140KBを超えています (${gzipShell})`);

if (failures.length) {
  console.error("Release check failed:\n- " + failures.join("\n- "));
  process.exitCode = 1;
} else {
  console.log(`Release check passed (${appVersion})`);
}
console.log(notes.join("\n"));
