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

const [app, runVideoOrientation, runCameraLens, skinBlackboard, fromRunVideo, runVideoDelay, runVideoComposition, runVideoSync, runVideoReview, musicPlayback, batchSequenceImport, css, batchSequenceImportCss, tabletCss, i18n, i18nZh, html, sw, manifestText, updateCss, editorTime, practiceDock, pwaInstall, helpEn, helpZh, sharePractice, settingsView, sync] = await Promise.all([
  read("app.js"), read("run-video-orientation.js"), read("run-camera-lens.js"), read("skin-blackboard.css"), read("from-run-video.js"), read("run-video-delay.js"), read("run-video-composition.js"), read("run-video-sync.js"), read("run-video-review.js"), read("music-playback.js"), read("batch-sequence-import.js"), read("styles.css"), read("batch-sequence-import.css"), read("tablet.css"), read("i18n.js"), read("i18n-zh.js"), read("index.html"), read("sw.js"), read("manifest.webmanifest"), read("app-update.css"), read("editor-time.js"), read("practice-dock.js"), read("pwa-install.js"), read("help-en.js"), read("help-zh.js"), read("share-practice.js"), read("settings-view.js"), read("sync.js"),
]);

// 構文エラーはブラウザ起動前に止める。
for (const [name, source] of [["app.js", app], ["run-video-orientation.js", runVideoOrientation], ["run-camera-lens.js", runCameraLens], ["run-video-delay.js", runVideoDelay], ["run-video-composition.js", runVideoComposition], ["run-video-sync.js", runVideoSync], ["run-video-review.js", runVideoReview], ["music-playback.js", musicPlayback], ["batch-sequence-import.js", batchSequenceImport], ["i18n.js", i18n], ["sw.js", sw], ["editor-time.js", editorTime], ["practice-dock.js", practiceDock], ["pwa-install.js", pwaInstall], ["help-zh.js", helpZh], ["share-practice.js", sharePractice], ["help-en.js", helpEn], ["settings-view.js", settingsView]]) {
  try { new Function(source); } catch (error) { failures.push(`${name}: ${error.message}`); }
}

const appVersion = requireMatch(app, /APP_VERSION\s*=\s*"(v\d+)"/, "APP_VERSION");
const cacheVersion = requireMatch(sw, /CACHE\s*=\s*"routine-debugger-(v\d+)"/, "Service Worker版");
const swRunVideoOrientationVersion = requireMatch(sw, /run-video-orientation\.js\?v=(\d+)/, "Service Worker映像向き判定JS版");
const swRunVideoCompositionVersion = requireMatch(sw, /run-video-composition\.js\?v=(\d+)/, "Service Worker映像音源合成JS版");
const swRunVideoSyncVersion = requireMatch(sw, /run-video-sync\.js\?v=(\d+)/, "Service Worker映像音源同期JS版");
const swRunVideoReviewVersion = requireMatch(sw, /run-video-review\.js\?v=(\d+)/, "Service Worker通し映像レビューJS版");
const swMusicPlaybackVersion = requireMatch(sw, /music-playback\.js\?v=(\d+)/, "Service Worker楽曲再生JS版");
const swBatchSequenceImportVersion = requireMatch(sw, /batch-sequence-import\.js\?v=(\d+)/, "Service Worker一括カットJS版");
const cssVersion = requireMatch(html, /styles\.css\?v=(\d+)/, "CSS版");
const batchSequenceImportCssVersion = requireMatch(html, /batch-sequence-import\.css\?v=(\d+)/, "一括カットCSS版");
const tabletCssVersion = requireMatch(html, /tablet\.css\?v=(\d+)/, "iPad CSS版");
const swTabletCssVersion = requireMatch(sw, /tablet\.css\?v=(\d+)/, "Service Worker iPad CSS版");
const i18nVersion = requireMatch(html, /i18n\.js\?v=(\d+)/, "i18n版");
const runVideoOrientationVersion = requireMatch(html, /run-video-orientation\.js\?v=(\d+)/, "映像向き判定JS版");
const runVideoCompositionVersion = requireMatch(html, /run-video-composition\.js\?v=(\d+)/, "映像音源合成JS版");
const runVideoSyncVersion = requireMatch(html, /run-video-sync\.js\?v=(\d+)/, "映像音源同期JS版");
const runVideoReviewVersion = requireMatch(html, /run-video-review\.js\?v=(\d+)/, "通し映像レビューJS版");
const musicPlaybackVersion = requireMatch(html, /music-playback\.js\?v=(\d+)/, "楽曲再生JS版");
const batchSequenceImportVersion = requireMatch(html, /batch-sequence-import\.js\?v=(\d+)/, "一括カットJS版");
const jsVersion = requireMatch(html, /app\.js\?v=(\d+)/, "JS版");
const expected = appVersion && appVersion.slice(1);
for (const [label, value] of [["Service Worker", cacheVersion && cacheVersion.slice(1)], ["Service Worker映像向き判定JS", swRunVideoOrientationVersion], ["Service Worker映像音源合成JS", swRunVideoCompositionVersion], ["Service Worker映像音源同期JS", swRunVideoSyncVersion], ["Service Worker通し映像レビューJS", swRunVideoReviewVersion], ["Service Worker楽曲再生JS", swMusicPlaybackVersion], ["Service Worker一括カットJS", swBatchSequenceImportVersion], ["Service Worker iPad CSS", swTabletCssVersion], ["CSS", cssVersion], ["一括カットCSS", batchSequenceImportCssVersion], ["iPad CSS", tabletCssVersion], ["i18n", i18nVersion], ["映像向き判定JS", runVideoOrientationVersion], ["映像音源合成JS", runVideoCompositionVersion], ["映像音源同期JS", runVideoSyncVersion], ["通し映像レビューJS", runVideoReviewVersion], ["楽曲再生JS", musicPlaybackVersion], ["一括カットJS", batchSequenceImportVersion], ["JS", jsVersion]]) {
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
if (!/featureSettings:\s*\{\s*showRisk:\s*false,\s*showSlots:\s*false,\s*showPracticeVideo:\s*true\s*\}/.test(app)) {
  failures.push("サンプルルーティンのリスク度・A\/B分岐が初期OFF、プレビュー動画が初期ONではありません");
}
for (const property of ["preservesPitch", "webkitPreservesPitch", "mozPreservesPitch"]) {
  if (!musicPlayback.includes(property)) failures.push(`音程維持の互換設定がありません: ${property}`);
}
if (!/function setMusicPlaybackRate\([\s\S]*?musicPlayback\.setRate\(safeRate, view\.name === "part"\)/.test(app)
    || !/const applyRate = \(player, rate\)[\s\S]*?preservePitch\(player\)[\s\S]*?player\.playbackRate = rate/.test(musicPlayback)) {
  failures.push("パート練習の速度変更に音程維持処理が適用されていません");
}
if (!/const musicPlayback = window\.RoutineMusicPlayback\.create/.test(app)
    || !/const musicGraphPlayer = musicPlayback\.graphPlayer/.test(app)
    || !/const musicNativeRatePlayer = musicPlayback\.nativeRatePlayer/.test(app)
    || !/function hasAffectedApplePlaybackEngine\(/.test(musicPlayback)
    || !/const usesNative = \(rate, partView,[\s\S]*?hasAffectedApplePlaybackEngine\(nav\)/.test(musicPlayback)
    || !/const target = usesNative\(rate, partView\) \? nativeRatePlayer : graphPlayer/.test(musicPlayback)
    || !/musicPlayback\.bindEvents/.test(app)
    || !/function bindEvents\(/.test(musicPlayback)
    || !/function ensureAudioGraph\(\)[\s\S]*?musicPlayer === musicNativeRatePlayer[\s\S]*?createMediaElementSource\(musicGraphPlayer\)/.test(app)
    || !/\.part-speed-quality/.test(css)
    || !/\["スロー音質優先", "Slow-play quality mode"\]/.test(i18n)) {
  failures.push("Safari/iPhoneの速度変更時にWeb Audioを迂回する音質対策が揃っていません");
}
if (!/PART_PLAYBACK_STEP\s*=\s*0\.05/.test(app) || !/partNudgePlaybackRate/.test(app)) {
  failures.push("パート練習の再生速度を0.05倍刻みで調整できません");
}
// プレビュー動画は v270 から画面ごと(通し/パート/編集)に切り替える。
// 旧 showPracticeVideo は、既存ルーティンの設定を引き継ぐための受け皿として残す。
if (!/showPracticeVideo:\s*true/.test(app)
    || !/rt\.featureSettings\.showPracticeVideo\s*=\s*true/.test(app)
    || !/delete state\.settings\.practicePreviewMode/.test(app)
    || !/PREVIEW_KEYS = \{ record: "previewRecord", part: "previewPart", edit: "previewEdit" \}/.test(app)
    || !/routineSwitchRow\("プレビュー動画\(通し練習\)",[\s\S]*?"previewRecord"/.test(app)
    || !/routineSwitchRow\("プレビュー動画\(パート練習\)",[\s\S]*?"previewPart"/.test(app)
    || !/routineSwitchRow\("プレビュー動画\(編集\)",[\s\S]*?"previewEdit"/.test(app)
    || !/rt\.featureSettings\.previewRecord = was/.test(app)
    || !/function practicePreviewNameOnly\(\)[\s\S]*?routineFeatureEnabled\(rt, key\)/.test(app)
    || /function practicePreviewModeHtml\(\)|window\.setPracticePreviewMode/.test(app)
    || !/if \(practicePreviewNameOnly\(\)\) return;/.test(app)
    || !/\.practice-now\.name-only/.test(css)
    || !/\["プレビュー動画\(通し練習\)", "Preview video \(Full Run\)"\]/.test(i18n)) {
  failures.push("プレビュー動画が通し・パート・編集ごとに初期ONで、個別設定から切り替えられる仕様ではありません");
}
// 設定画面は settings-view.js にある(app.js の容量上限のため分離した)
const renderSettingsSource = settingsView.match(/renderSettings = function renderSettings\(\) \{([\s\S]*?)\n\};/);
if (!renderSettingsSource
    || /すべてのルーティンに適用|switchRow\("リスク度"|switchRow\("A\/B分岐"/.test(renderSettingsSource[1])
    || !/function defaultRoutineFeatures\(\)[\s\S]*?showRisk:\s*false[\s\S]*?showSlots:\s*false/.test(app)
    || !/routineSwitchRow\("リスク度"/.test(app)
    || !/routineSwitchRow\("A\/B分岐"/.test(app)) {
  failures.push("リスク度・A/B分岐が全体設定では非表示で、個別設定だけから変更できる仕様ではありません");
}
if (/シーケンス名という語の誤用|Sequence name/.test(app) || /シーケンス名という語の誤用|Skill name|skill name/.test(i18n)
    || !/placeholder="選択肢\$\{String\.fromCharCode\(65 \+ oi\)\}のシーケンス名"/.test(app)
    || !/\["シーケンス名", "Sequence"\]/.test(i18n)
    || !/\[\/\^選択肢\(\[A-Z\]\)のシーケンス名\$\/, "Option \$1 sequence"\]/.test(i18n)) {
  failures.push("名称を示す用語が、日本語はシーケンス名、英語はSequenceに統一されていません");
}
if (!/\["練習", "Run"\]/.test(i18n)
    || !/\["＋ シーケンス", "\+ Sequence"\]/.test(i18n)
    || !/Add a sequence in this gap[\s\S]*?\? "Sequence" : "シーケンス"/.test(app)
    || !/routine-quick-note-label">簡易メモ <span aria-hidden="true">✎<\/span>/.test(app)) {
  failures.push("英語のRun・Sequence表記、またはQuick memoの編集マークが揃っていません");
}
// 長さはシーケンス名の右側に置く。v248から表示専用ではなく、押すと変更でき、
// 横スライドでも変えられる操作になっている(動画を紐づけていないシーケンス・移行の
// 長さを変える手段が他に無いため)。
// v249から、名前が長くても隠さない。隠すと操作そのものへ辿り着けなくなる。
if (!/<div class="es-name-field">[\s\S]*?<button type="button" class="es-duration" onclick="sheetStepDuration\(\$\{i\}\)" data-i="\$\{i\}"[\s\S]*?>\$\{editorDurationLabel\(s, showSlots\)\}<\/button>/.test(app)
    || !/oninput="\$\{nameOninput\};updateEditorSequenceDuration\(this\)"/.test(app)
    || !/function updateEditorSequenceDuration\(input\)/.test(app)
    || !/field\.classList\.add\("duration-visible"\)/.test(app)
    || /classList\.toggle\("duration-visible"/.test(app)
    || !/\.es-name-field\.duration-visible input\[type=text\]/.test(css)
    || !/\.es-name-field\.duration-visible \.es-duration/.test(css)
    || !/button\.es-duration\.sliding/.test(updateCss)
    || !/window\.sheetStepDuration/.test(editorTime)) {
  failures.push("編集行の長さが、シーケンス名右側に常に出て、押す・横スライドで変更できる仕様ではありません");
}
if (/function draftTotal\(|durationSummary|class="tl-caption"/.test(app)
    || !/function cueIntervalAt\(index\)[\s\S]*?nextCue - currentCue - duration/.test(app)
    || !/terminal \? editorMusicEndForDraft\(\)/.test(app)
    || !/function cueIntervalWarningHtml\(index\)/.test(app)
    || !/楽曲終了まで \$\{seconds\}秒の空間あり/.test(app)
    || !/class="cue-gap-actions"/.test(app)
    || !/sheetAddTrick\(\$\{insertAt\}\)/.test(app)
    || !/addStep\('transition',\$\{insertAt\}\)/.test(app)
    || !/window\.sheetAddTrick\s*=/.test(editorTime)
    || !/window\.addTrickByName\s*=/.test(editorTime)
    || !/class="cue-overlap-actions"/.test(app)
    || !/次のシーケンスを遅らせてFIT/.test(app)
    || !/onclick="fitCueToPrevious\(\$\{insertAt\}\)"/.test(app)
    || !/window\.dismissCueInterval\s*=/.test(app)
    || !/window\.addStep = \(kind, insertAt = null\)/.test(app)
    || !/window\.sheetPickTrick = \(insertAt = null\)/.test(app)
    || !/window\.addStepFromTrick = \(trickId, insertAt = null\)/.test(app)
    || !/draft\.steps\.splice\(at, 0, step\)/.test(app)
    || !/window\.fitCueToPrevious\s*=\s*\(i\)[\s\S]*?Number\(previous\.cue\) \+ stepDur\(previous\)/.test(app)
    || !/class="cue-position-actions"/.test(app)
    || !/\.cue-interval-alert\.gap/.test(css)
    || !/\.cue-interval-alert\.overlap/.test(css)
    || !/\.cue-gap-actions button/.test(css)
    || !/\.cue-overlap-actions button/.test(css)
    || !/\.editor-step \.cue-fit/.test(css)) {
  failures.push("キュー間と楽曲末尾の空白・マイナス区間警告、空白内追加、閉じる操作、FIT整列が揃っていません");
}
if (/onclick="editorAutoCue\(\)"/.test(app)
    || !/const emptyStepActions = `[\s\S]*?sheetAddTrick\(0\)[\s\S]*?addStep\('transition',0\)/.test(app)
    || !/\$\{stepRows \|\| `[\s\S]*?\$\{emptyStepActions\}`\}/.test(app)) {
  failures.push("編集末尾の追加・自動セット領域が非表示で、空のルーティンだけに初回追加導線を残す仕様ではありません");
}
if (/stepsSignature/.test(app)
    || !/function showRoutineSaveChoice\(rt\)/.test(app)
    || !/保存方法を選ぶ/.test(app)
    || !/runsOfVersion\(rt\.id, currentVersion\.id\)\.length/.test(app)
    || !/commitRoutineSave\('version'\)/.test(app)
    || !/commitRoutineSave\('overwrite'\)/.test(app)
    || !/window\.commitRoutineSave = async \(mode\)/.test(app)
    || !/if \(mode === "version"\)[\s\S]*?rt\.versions\.push/.test(app)
    || !/current\.steps = cloneRoutineSteps\(draft\.steps\)/.test(app)
    || !/現在のv\$\{currentNo\}には通し\$\{runCount\}本の記録/.test(app)
    || !/保存時に、新しいバージョンとして残すか/.test(app)
    || !/分析を分けて残す<b>新しいバージョン<\/b>か、現在版の上書き/.test(helpEn)) {
  failures.push("既存ルーティンの保存時に、新バージョン保存と現在版の上書きを影響説明付きで選べません");
}
// 英語版の使い方は help-en.js にある(app.js の容量上限のため分離した)
if (!/renderHelpEnglish = function renderHelpEnglish\(\)[\s\S]*?Start here[\s\S]*?Keep your data safe/.test(helpEn)
    || !/renderHelp = function renderHelp\(\)[\s\S]*?まずはこの流れ[\s\S]*?データを守る/.test(helpEn)
    || !/Build the routine\.[\s\S]*?Review and refine\.[\s\S]*?repeat the cycle/.test(helpEn)
    || !/ルーティンを組み立てる。[\s\S]*?振り返り、細かく練習する。[\s\S]*?またこの流れを繰り返して精度を高める/.test(helpEn)
    || ((app + helpEn).match(/class="card help-guide-card"/g) || []).length !== 10
    || !/class="help-quick-steps"/.test(helpEn)
    || !/\.help-quick-steps li/.test(css)) {
  failures.push("使い方が日英とも、準備・練習・振り返り・次の練習の循環として整理されていません");
}
if (/st\.fails\s*\?\s*`\$\{st\.recov\}/.test(app)
    || !/let recov = 0, fails = 0;[\s\S]*?if \(e\.type !== "drop_abort"\) recov\+\+/.test(app)) {
  failures.push("乱れ・ドロップ後の回復は記録・集計を維持しつつ、分析概要から非表示になっていません");
}
if (!/const runFailureEventCount\s*=/.test(app)
    || !/failureCountDistribution\s*=\s*\[/.test(app)
    || !/failuresPerRun\s*=\s*total \? fails \/ total : 0/.test(app)
    || !/class="stat-overview analysis-overview"/.test(app)
    || !/class="failure-count-estimate"/.test(app)
    || !/平均ミス回数/.test(app)
    || !/これまでの通しから推定。回避・実施できずは含みません。/.test(app)
    || /openConfidenceLevelSheet|saveConfidenceLevel|analysisConfidenceLevel/.test(app)
    || !/\.failure-count-grid/.test(css)) {
  failures.push("95%区間が、1通しの平均失敗回数と0回・1回・2回・3回以上の実測確率へ置き換わっていません");
}
if (!/function failureRateClass\(item\)[\s\S]*?rate >= 0\.5[\s\S]*?failure-rate-red[\s\S]*?rate >= 0\.3[\s\S]*?failure-rate-orange[\s\S]*?rate >= 0\.1[\s\S]*?failure-rate-yellow/.test(app)
    || !/step-stat \$\{s\.step\.kind\} \$\{failureRateClass\(s\)\}/.test(app)
    || !/slot-opt-stat \$\{failureRateClass\(o\)\}/.test(app)
    || !/\.failure-rate-yellow/.test(css) || !/\.failure-rate-orange/.test(css) || !/\.failure-rate-red/.test(css)
    || !/SAMPLE_HISTORY_SCHEMA\s*=\s*3/.test(app)
    || !/Array\.isArray\(fail\[0\]\) \? fail : \[fail\]/.test(app)
    || !/ミルズメス風は半数で乱れ/.test(app)) {
  failures.push("失敗率10%・30%・50%の背景色分けと、それを確認できるサンプル履歴がありません");
}
if (!/SAMPLE_SEQUENCE_SCHEMA\s*=\s*2/.test(app)
    || !/function ensureSampleSequenceDemo\(rt\)/.test(app)
    || !/function remapExpandedSampleSessions\(rt, version, previousSteps\)/.test(app)
    || !/sampleSequenceSchema:\s*SAMPLE_SEQUENCE_SCHEMA/.test(app)
    || !/["']コラムス["']/.test(app)
    || !/["']ミルズメス風["']/.test(app)
    || !/v3 A\/B分岐とシーケンスを追加/.test(app)
    || !/A\/B分岐とシーケンスを追加/.test(i18n)) {
  failures.push("旧サンプルをv3構成へ移行できません");
}
if (!/SAMPLE_TRANSITION_COLOR_SCHEMA\s*=\s*1/.test(app)
    || !/function ensureSampleTransitionColors\(rt\)/.test(app)
    || !/step\.kind === "transition" \? "rust" : "blue"/.test(app)
    || !/sampleTransitionColorSchema:\s*SAMPLE_TRANSITION_COLOR_SCHEMA/.test(app)) {
  failures.push("サンプルルーティンの移行だけを朱色の識別線にできません");
}
if (!/PART_LOOP_DELAY_DEFAULT\s*=\s*3/.test(app)
    || !/if \(stored == null\) return PART_LOOP_DELAY_DEFAULT/.test(app)
    || !/rt\.partLoop\.delaySeconds\s*=\s*next/.test(app)) {
  failures.push("パート練習のループ間隔が初期3秒で、0秒も明示保存できる仕様ではありません");
}
if (!/el\.textContent = fmtTime\(libAudioCurrentTime\(\)\)/.test(app)
    || /id="lib-pos">\$\{fmtTimeFine\(/.test(app)) {
  failures.push("音源ライブラリの試聴時間に0.1秒表示が残っています");
}
if (!/if \(name === "part" && view\.name !== "part"\) \{ partLoopActive = true; partFullTrackActive = false; \}/.test(app)
    || !/window\.partPlayWhole\s*=\s*\(\)\s*=>/.test(app)
    || !/let partFullTrackActive = false/.test(app)
    || !/onclick="partPlayWhole\(\)">▶ 全体を再生/.test(app)
    || !/onclick="partPlayFromA\(\)">▶ ループ再生/.test(app)
    || !/<section class="part-loop-section">[\s\S]*?<h2>ループ区間/.test(app)) {
  failures.push("パート練習のループ初期ON・全体再生・統合されたループ区間UIがありません");
}
if (!/player\.preload\s*=\s*"metadata"/.test(musicPlayback)
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
  failures.push("通し映像がインカメ・カメラマイクOFFで設定されていません");
}
if (!/wide:\s*\{[\s\S]*?width:\s*960[\s\S]*?height:\s*720[\s\S]*?ratio:\s*4\s*\/\s*3/.test(app)
    || !/vertical:\s*\{[\s\S]*?ratio:\s*3\s*\/\s*4/.test(app)
    || !/function runVideoAspect\(video\)[\s\S]*?RUN_CAMERA_PROFILES\[video\?\.cameraProfile\]/.test(app)
    || !/\.run-camera-preview\s*\{[\s\S]*?aspect-ratio:\s*var\(--run-camera-aspect,\s*4\/3\)/.test(css)
    || !/\.run-camera-live-preview\s*\{[\s\S]*?aspect-ratio:\s*var\(--run-camera-aspect,\s*4\/3\)/.test(css)
    || !/\.run-video-review\s*\{[\s\S]*?aspect-ratio:\s*var\(--run-camera-aspect,\s*4\/3\)/.test(css)) {
  failures.push("通し映像の4:3横長／3:4縦長選択と各プレビューへの反映がありません");
}
// v335から、端末の持ち方でも映像の向きでも撮影を止めない。
// 止めると縦持ちで撮れなくなるため、ブロックが復活していないことを検査する。
if (!/function runCameraOrientationState\(profileId, viewportWidth, viewportHeight, frameWidth = 0, frameHeight = 0\)/.test(runVideoOrientation)
    || (runVideoOrientation.match(/blocked:/g) || []).length !== 1
    || !/blocked: false,/.test(runVideoOrientation)
    || /orientation\.blocked/.test(app)
    || !/wide:\s*\{[\s\S]*?orientation:\s*"landscape"/.test(app)
    || !/id="run-camera-orientation"/.test(app)
    || !/id="run-confirm-start"/.test(app)
    || !/addEventListener\("resize", scheduleRunCameraOrientationUi\)/.test(app)
    || !/addEventListener\("orientationchange", scheduleRunCameraOrientationUi\)/.test(app)
    || !/captureAspectRatio:\s*pending\.captureAspectRatio/.test(app)
    || !/縦に構えたままでも撮影できます。/.test(app)
    || !/function selectedRunCameraProfileId\(\) \{\s*return "wide";/.test(app)
    || !/\.run-camera-orientation/.test(css)) {
  failures.push("縦横どちらの向きでも撮影を止めない作りが壊れています");
}
// 確認映像の枠は、実測の縦横へ追従させる(v336)。固定したままだと映像が枠内で縮む。
if (!/loadedmetadata[\s\S]*?updateFrameOrientation/.test(app)
    || !/updateFrameOrientation = \(\) => \{[\s\S]*?setProperty\("--run-camera-aspect"/.test(app)) {
  failures.push("確認映像の枠が実際の映像の縦横に追従しません");
}
if (!/id="run-camera-live-preview"/.test(app) || !/bindRunCameraLivePreview\(\)/.test(app)) {
  failures.push("通し練習中のインカメプレビューがありません");
}
if (!/musicPlayback\.bindEvents\(\{[\s\S]*?onStop:[\s\S]*?stopRunVideoCaptureAtMusicStop[\s\S]*?onPlaying:[\s\S]*?startRunVideoCapture/.test(app)
    || !/player\.addEventListener\("playing", active\(onPlaying\)\)/.test(musicPlayback)
    || !/\["pause", "ended"\][\s\S]*?active\(onStop\)/.test(musicPlayback)) {
  failures.push("通し映像の録画開始・終了が楽曲再生と同期していません");
}
if (!/cap\.music\s*=\s*cloneRunVideoMusicMeta\(rt\s*&&\s*rt\.music\)/.test(app)
    || !/music:\s*cap\.music\s*\?\s*\{\s*\.\.\.cap\.music\s*\}\s*:\s*null/.test(app)
    || !/music:\s*pending\.music\s*\?\s*\{\s*\.\.\.pending\.music\s*\}\s*:\s*null/.test(app)
    || !/function runVideoMusicMeta\(video\)/.test(runVideoSync)) {
  failures.push("通し映像へ撮影時の対象音源が保存されていません");
}
if (!/RUN_VIDEO_COMPOSITION_VERSION\s*=\s*1/.test(runVideoComposition)
    || !/function createRunVideoCompositionRecipe\(music, options/.test(runVideoComposition)
    || !/output:\s*"single-video"/.test(runVideoComposition)
    || !/function finalizeRunVideoComposition\(capture\)/.test(runVideoComposition)
    || !/function composeRunVideoAfterCapture/.test(runVideoComposition)
    || !/canvas\.captureStream/.test(runVideoComposition)
    || !/createMediaElementSource\(audio\)/.test(runVideoComposition)
    || !/createMediaStreamDestination/.test(runVideoComposition)
    || !/engine:\s*"web-post-save"/.test(runVideoComposition)
    || !/function finalizeRunVideoPostComposition/.test(runVideoComposition)
    || !/function estimateRunVideoComposition/.test(runVideoComposition)
    || !/recordingGain:\s*1/.test(runVideoComposition)
    || !/microphone:\s*false/.test(runVideoComposition)) {
  failures.push("将来のネイティブ後合成へ差し替えられる通し映像の合成レシピがありません");
}
if (!/function startRunVideoCapture\([\s\S]*?new MediaRecorder\(cap\.stream, options\)/.test(app)
    || !/cap\.audioEmbedded\s*=\s*false/.test(app)
    || !/await finalizeRunVideoComposition\(\{/.test(app)
    || !/composeRunVideoAfterCapture\(\{[\s\S]*?pendingRunVideoMusicBlob[\s\S]*?onProgress:\s*updateRunVideoCompositionProgress/.test(app)
    || !/finalizeRunVideoPostComposition\(pending, composed\)/.test(app)
    || !/window\.cancelRunVideoPostComposition/.test(app)
    || !/window\.savePendingRunVideoLinked/.test(app)
    || !/window\.deferPendingRunVideoComposition/.test(app)
    || !/runVideoDeferredCompositionAction\(video\)/.test(app)
    || !/function runVideoCompositionSaveMarkup/.test(runVideoReview)
    || !/function runVideoComposeIntroMarkup/.test(runVideoReview)
    || !/推定時間/.test(runVideoReview)
    || !/runVideoComposeIntroMarkup\(pending\)/.test(runVideoReview)
    || !/window\.prepareStoredRunVideoComposition/.test(runVideoReview)
    || !/id="run-video-compose-bar"/.test(app)
    || !/audioMode:\s*pending\.audioMode/.test(app)
    || !/composition:\s*pending\.composition/.test(app)
    || !/postComposition:\s*pending\.postComposition/.test(app)) {
  failures.push("Web版の新規通し映像をカメラ単独で記録し、保存時に音源合成・進捗・退避保存まで行えません");
}
if (!/function runVideoPlaybackAudioMarkup\(video, music, musicAvailable\)/.test(runVideoSync)
    || !/runVideoHasEmbeddedAudio\(video\)/.test(runVideoSync)
    || !/runVideoNeedsLinkedMusic\(video\)/.test(runVideoReview)
    || !/needsLinkedMusic && music \? blobGet/.test(runVideoReview)
    || !/runVideoPlaybackAudioMarkup\(video, music/.test(runVideoReview)) {
  failures.push("音源入り映像を単一プレイヤーで再生し、旧別音源方式だけ同期処理へ戻せません");
}
if (!/RUN_VIDEO_AUDIO_DELAY_MAX_SECONDS\s*=\s*20/.test(runVideoDelay)
    || !/RUN_VIDEO_AUDIO_DELAY_SLIDER_MAX\s*=\s*1/.test(runVideoDelay)
    || !/function normalizeRunVideoAudioDelay\(value\)/.test(runVideoDelay)
    || !/cap\.requestedAudioDelaySeconds\s*=\s*preferredRunVideoAudioDelay\(\)/.test(app)
    || !/audioDelaySeconds:\s*normalizeRunVideoAudioDelay\(capture\.syncAudioDelaySeconds/.test(runVideoComposition)
    || !/requestedAudioDelaySeconds:\s*cap\.requestedAudioDelaySeconds/.test(app)
    || !/composition\.engine === "web-post-save-pending"/.test(runVideoDelay)
    || !/function runVideoSyncDelayMarkup\(video, target/.test(runVideoDelay)
    // つまみは実測値を中心に置き、前後1秒だけ動かす。
    // ただし今の値が中心から離れている映像(保存済みで本人が寄せた後)は、両方が入る幅にする。
    // 端に張り付くと＋0.1が効かず、押した拍子に端の値へ落ちる(2026-08-01 v332)
    || !/const centre = runVideoEstimatedAudioDelay\(video\)/.test(runVideoDelay)
    || !/Math\.min\(centre, value\) - RUN_VIDEO_AUDIO_DELAY_SLIDER_MAX/.test(runVideoDelay)
    || !/Math\.max\(centre, value\) \+ RUN_VIDEO_AUDIO_DELAY_SLIDER_MAX/.test(runVideoDelay)
    // ±0.1は、つまみの表示値ではなく保存されている補正値から動かす
    || !/runVideoDesiredAudioDelay\(video\) \+ step/.test(runVideoDelay)
    // 保存する記録へ実測(中心)まで写す。落とすと開き直しで中心がずれる
    || !/function runVideoSavedDelayFields\(video\)[\s\S]*?estimatedAudioDelaySeconds: runVideoEstimatedAudioDelay\(video\)/.test(runVideoDelay)
    || !/min="\$\{min\}" max="\$\{max\}" step="0\.05"/.test(runVideoDelay)
    || !/runVideoStepSyncDelay\('\$\{target\}','\$\{esc\(id\)\}',-0\.1\)/.test(runVideoDelay)
    || !/\.run-video-sync-step/.test(updateCss)
    || !/function bindRunVideoEmbeddedAudioDelay\(video\)[\s\S]*?createMediaElementSource\(player\)[\s\S]*?createDelay/.test(runVideoSync)
    || !/runVideoSyncDelayMarkup\(capture, "stopped"\)/.test(runVideoSync)
    || !/audioDelaySeconds:\s*normalizeRunVideoAudioDelay\(capture\.syncAudioDelaySeconds/.test(runVideoComposition)
    || !/runVideoSyncDelayMarkup\(pending, "pending"\)/.test(app)
    || !/runVideoSyncDelayMarkup\(video, "saved", video\.id\)/.test(runVideoReview)
    || !/\.\.\.runVideoSavedDelayFields\(pending\)/.test(app)
    || !/\.run-video-sync-adjust/.test(css)) {
  failures.push("演技直後の同期補正(実測±1秒)を試聴・保存し、次回録画へ反映できません");
// カウントダウン中の再生権限取りは、Web Audio側も含めて完全に無音であること
if (!/if \(gainNode\) gainNode\.gain\.value = 0;/.test(app)
    || !/const unmute = \(\) => \{ musicPlayer\.muted = false; musicSetVolume\(musicVolume\); \};/.test(app)) {
  failures.push("カウントダウン中の再生権限取りが無音になっていません");
}
// 背面カメラとレンズを選べること。iOSのdeviceIdは開くたびに変わるので保存しない
if (!/localStorage\.getItem\(key\)/.test(runCameraLens)
    || !/rd_run_camera_facing/.test(runCameraLens)
    || !/rd_run_camera_lens/.test(runCameraLens)
    || /setItem\("rd_run_camera_device_id"/.test(runCameraLens)
    || !/deviceId: \{ exact: hit\.deviceId \}/.test(runCameraLens)
    || !/facingMode: \{ ideal: facing\(\) \}/.test(runCameraLens)
    || !/\? runCameraVideoConstraints\(profile\)/.test(app)
    // 許可の確認は操作直後にしか出ない。ここにawaitが戻ると出なくなる
    || /await runCameraVideoConstraints/.test(app)
    || !/refreshRunCameraDevices\(\)/.test(app)
    || !/window\.closeRunCameraPicker = \(routineId\)/.test(runCameraLens)
    // Dual/Triple は撮影中に勝手にレンズが変わる。選ばせる前に知らせる
    || !/const looksCombined = \(label\) =>/.test(runCameraLens)
    // Dual/Triple は撮影中にレンズが変わる。一覧に出さず、保存済みの値も捨てる
    || !/const named = 全部\.filter\(\(d\) => !looksCombined\(d\.label\)\)/.test(runCameraLens)
    || !/if \(value && looksCombined\(value\)\) \{ write\(LENS_KEY, ""\)/.test(runCameraLens)
    // レンズ名指しで縦横の希望が無視されることがある。開いた直後に実測して直す
    || !/window\.correctRunCameraStream = async \(stream, profile\)/.test(runCameraLens)
    || !/stream = await correctRunCameraStream\(stream, profile\)/.test(app)
    || !/run-camera-frame/.test(app)
    // プレビューは実フレームの縦横のまま、切り取らずに見せる
    || !/window\.runCameraFrameRatioCss = \(cap, fallback\)/.test(runCameraLens)
    || !/runCameraFrameRatioCss\(runCamera, selectedProfile\.cssRatio\)/.test(app)
    // 技の撮影でも同じ仕組みでカメラを選べる(設定は通し練習と別)
    || !/rd_trick_camera_lens/.test(runCameraLens)
    // 名前の取れたレンズがあるときは、包括的な2項目を出さない(同じものが二重に並ぶ)
    || !/\$\{named\.length \? rows :/.test(runCameraLens)
    || !/const 役割名 = \(label\) =>/.test(runCameraLens)
    || !/runCameraVideoConstraints\(画質, "trick"\)/.test(app)
    || !/runCameraLensRowHtml\("", "trick"\)/.test(app)
    || !/\.run-camera-preview \{[\s\S]*?object-fit: contain/.test(css)
    // 合成は録れたファイルの寸法を守る。引き伸ばして絵を潰さない
    || !/positive\(videoMeta\.width\) \|\| positive\(capture\.captureWidth\)/.test(runVideoComposition)
    || !/run-video-size/.test(runVideoReview)
    // 画質は本人が選ぶ。上げると合成も保存も重くなるため既定は標準
    || !/const QUALITY_KEY = "rd_run_video_quality"/.test(runCameraLens)
    || !/read\(QUALITY_KEY, "std"\) === "high"/.test(runCameraLens)
    || !/width: \{ ideal: profile\.width \* scale \}/.test(runCameraLens)
    || !/videoBitsPerSecond: runVideoBps\(\)/.test(app)
    || !/<div id="run-camera-lens">\$\{/.test(app)
    || !/runCameraLensRowHtml\(routineId\)/.test(app)
    // 撮影OFFのうちは「ONにする」だけを見せる
    || !/\$\{ready \? `<div id="run-camera-lens">/.test(app)
    || !/renderRunCameraLensRow\(routineId\)/.test(app)
    || !/\.run-camera-preview\.is-rear/.test(updateCss)) {
  failures.push("背面カメラ・レンズの選択ができません");
}
// 背面では画面が見えないので、カウントダウンを音で知らせる
if (!/window\.runCountdownBeep = \(remaining\)/.test(runCameraLens)
    || !/rd_countdown_beep/.test(runCameraLens)
    || !/if \(mode === "on"\) return true;/.test(runCameraLens)
    || !/return isRear\(\);/.test(runCameraLens)
    || !/runCountdownBeep\(remaining\)/.test(app)
    || !/runCountdownBeep\(seconds\)/.test(app)) {
  failures.push("カウントダウンを音で知らせられません");
}
// 要望はまずSupabaseへ。メールアプリ引き継ぎは失敗時の予備
if (!/rest\/v1\/feedback/.test(app) || !/if \(!ok && FEEDBACK_ENDPOINT\)/.test(app)) {
  failures.push("フィードバックがSupabaseへ送られません");
}
// 表示言語は ja/en/zh の3つ。初回だけブラウザ設定から初期値を決める
if (!/window\.RoutineI18nZh = \{ apply, text \}/.test(i18nZh)
    || !/const uiLanguage = \(\) =>/.test(app)
    || !/uiLanguage\(\) === "zh" \? window\.RoutineI18nZh/.test(app)
    || !/setLanguage\('zh'\)/.test(settingsView)
    || !/preferred\.startsWith\("ja"\) \? "ja"/.test(app)
    || !/state\.routines \|\| \[\]\)\.length === 0 && \(state\.sessions \|\| \[\]\)\.length === 0/.test(app)) {
  failures.push("繁体字の表示言語(自動判定つき)が機能しません");
}
// 使い方・?説明・公開ページの繁体字版
if (!/window\.renderHelpZh = function renderHelpZh/.test(helpZh)
    || !/window\.INFO_ZH = \{/.test(helpZh)
    || !/uiLanguage\(\) === "zh" && window\.renderHelpZh/.test(helpEn)
    || !/INFO_ZH : INFO/.test(app)
    || !/about\|backup\|beta\|terms\|privacy/.test(app)) {
  failures.push("繁体字のガイド・説明・公開ページ分岐がありません");
}
// 練習のシェア。勝手に投稿せず、本人がボタンを押したときだけ共有へ進む
if (!/window\.offerPracticeShare = \(sessionId\)/.test(sharePractice)
    || !/navigator\.canShare && navigator\.canShare\(\{ files: \[file\] \}\)/.test(sharePractice)
    || !/twitter\.com\/intent\/tweet/.test(sharePractice)
    || !/offerPracticeShare\(sess\.id\)/.test(app)
    || !/\.share-card-preview/.test(updateCss)) {
  failures.push("練習シェアが組み込まれていません");
}
for (const page of ["about-zh.html", "backup-zh.html", "beta-zh.html", "terms-zh.html", "privacy-zh.html"]) {
  try { await access(new URL(page, root), constants.R_OK); }
  catch { failures.push(`繁体字ページが見つかりません: ${page}`); }
}
// 構成の起こし元は、アプリで撮った映像に限らない
if (!/accept="video\/\*" class="hidden" onchange="startRunVideoCueFromFile/.test(fromRunVideo)
    || !/file\.size > TRICK_MAX_BYTES/.test(fromRunVideo)
    // 決定せずにやめたとき、参照のない動画を端末に残さない
    || !/if \(未確定のblobId\) \{ blobDel\(未確定のblobId\)/.test(fromRunVideo)
    || !/未確定のblobId = null;\s*\/\/ ここから先はシーケンスが参照する/.test(fromRunVideo)
    || !/if \(el\) \{ el\.pause\(\); cleanup\(\); \}/.test(fromRunVideo)) {
  failures.push("端末の動画から構成を起こせません");
}
// スキンは外観だけ。文言・DOM・配置・寸法を変える指定が混ざっていないこと
// (詳細は docs/skin-lab/blackboard-v1/SKIN_CONTRACT.md)
{
  const skinBody = skinBlackboard.replace(/\/\*[\s\S]*?\*\//g, "");
  const allowed = new Set(["accent-color", "background", "background-color", "background-image",
    "background-position", "background-repeat", "background-size", "border", "border-bottom-color",
    "border-color", "border-left-color", "border-radius", "border-right-color", "border-top-color",
    "box-shadow", "caret-color", "color", "color-scheme", "font-family", "outline-color",
    "text-decoration-color"]);
  const bad = [];
  for (const block of skinBody.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const declaration of block[2].split(";")) {
      const trimmed = declaration.trim();
      if (!trimmed) continue;
      const property = trimmed.slice(0, trimmed.indexOf(":")).trim();
      if (!property || property.startsWith("--") || allowed.has(property)) continue;
      bad.push(`${block[1].trim()}: ${property}`);
    }
  }
  if (/@media\b|@container\b|@supports\b/.test(skinBody)) bad.push("スキン専用のメディアクエリ");
  if (/\bcontent\s*:/.test(skinBody)) bad.push("疑似要素での文字追加");
  if (!/body\[data-skin="blackboard"\]/.test(skinBody)) bad.push("スキン識別セレクタが無い");
  if (!/function applyRoutineSkin\(\)/.test(app)) bad.push("本体でスキン属性を付けていない");
  // 既定はルーズリーフ。選択は全体設定にあり、端末内にだけ保存する
  if (!/const ROUTINE_SKINS = \["", "blackboard"\]/.test(app)) bad.push("既定がルーズリーフでない");
  if (!/localStorage\.setItem\("rd_skin"/.test(app)) bad.push("選択を端末内に保存していない");
  if (/rd_skin/.test(sync)) bad.push("スキンを同期対象にしている");
  if (!/chooseRoutineSkin\('blackboard'\)/.test(settingsView)) bad.push("全体設定に選択が無い");
  if (bad.length) failures.push(`黒板スキンが外観の範囲を超えています: ${bad.join(" / ")}`);
}

// 同期のpullが「自分のpushの反響」や端末側で編集済みのデータを上書きしない(2026-08-01 v331)。
// これが無いと、ログイン中の編集・記録が数秒後の同期でひとつ前の状態へ巻き戻る。
// 挙動の検証は tests/sync-echo-revert.test.mjs(擬似サーバーで同期2周)。
{
  const bad = [];
  if (!/known\.version === row\.entity_version/.test(sync)) bad.push("反響(version一致)を取り込まない分岐が無い");
  if (!/hashOf\(current\.body\) !== known\.hash[\s\S]{0,600}hashOf\(current\.body\) !== known\.hash/.test(sync)) {
    bad.push("端末側で編集済みのデータを上書きしない分岐が無い(墓石側と更新側の2箇所)");
  }
  if (bad.length) failures.push(`同期pullの巻き戻し防止が壊れています: ${bad.join(" / ")}`);
}
}
if (!/window\.previewStoppedRunVideo\s*=\s*async/.test(runVideoSync)
    || !/stoppedRunVideoCapture\s*!==\s*capture/.test(runVideoSync)
    || !/onclick="previewStoppedRunVideo\('\$\{rt\.id\}'\)"/.test(app)
    || !/今撮った通し映像/.test(runVideoSync)
    || !/\.run-video-stopped \.run-video-instant-preview/.test(css)) {
  failures.push("音源停止直後の一時映像を、結果入力前に何度でもプレビューできません");
}
// 通し結果の入力前でも、その場で音源を合成して保存できる(v338)。
// 待ち時間の明示と、保存済み映像を通し記録へ結び付ける経路までを一組で検査する。
if (!/window\.composeStoppedRunVideo\s*=\s*async/.test(app)
    || !/function stoppedRunVideoActionsMarkup\(capture, musicReady\)/.test(app)
    || !/onclick="composeStoppedRunVideo\('\$\{esc\(capture\.routineId\)\}'\)"/.test(app)
    || !/stoppedRunVideoActionsMarkup\(capture, needsLinkedMusic && !!musicBlob\)/.test(runVideoSync)
    || !/fromStoppedCapture: true/.test(app)
    || !/await savePendingRunVideo\(""\)/.test(app)
    || !/pending\.fromStoppedCapture && stoppedRunVideoCapture/.test(app)
    || !/function linkSavedRunVideoToRun\(videoId, sess, run\)/.test(app)
    || !/if \(capture\.savedVideoId\) return linkSavedRunVideoToRun\(capture\.savedVideoId, sess, run\)/.test(app)) {
  failures.push("撮影直後のシートから音源を合成して保存し、通し記録へ結び付ける流れがありません");
}
if (!/function bindRunVideoAudioSync\(music, sourceVideo = null\)[\s\S]*?addEventListener\("play"[\s\S]*?tryPlayRunVideoAudio/.test(runVideoSync)
    || !/addEventListener\("pause"[\s\S]*?audio\.pause/.test(runVideoSync)
    || !/function beginRunVideoSeek\(sync\)[\s\S]*?resumeAfterSeek[\s\S]*?sync\.audio\.pause/.test(runVideoSync)
    || !/function finishRunVideoSeek\(sync\)[\s\S]*?syncRunVideoAudioPosition\(true\)[\s\S]*?shouldResume[\s\S]*?sync\.video\.play/.test(runVideoSync)
    || !/!sync\.seeking && !video\.seeking[\s\S]*?sync\.wantsPlayback = false/.test(runVideoSync)
    || !/id="run-video-audio"/.test(app)) {
  failures.push("通し映像の再生・停止・シークへ対象音源を同期できません");
}
const currentStepMarkup = runVideoReview.match(/function runVideoCurrentStepMarkup\(context\) \{([\s\S]*?)\n\}/);
if (!/function runVideoReviewStepContext\(video,[\s\S]*?found\.sess\.versionId/.test(runVideoReview)
    || !/function runVideoReviewStepName\(context, step\)[\s\S]*?runChoice\(context\.run, step\)/.test(runVideoReview)
    || !currentStepMarkup || /<video\b/.test(currentStepMarkup[1])
    || !/実施中のシーケンス/.test(currentStepMarkup[1])
    || !/\$\{runVideoCurrentStepMarkup\(stepContext\)\}[\s\S]*?runVideoDownload/.test(runVideoReview)
    || !/\["loadedmetadata", "timeupdate", "seeking", "seeked"\]/.test(runVideoReview)
    || !/bindRunVideoCurrentStep\(stepContext\)/.test(runVideoReview)
    || !/\.run-video-current-step/.test(css)) {
  failures.push("保存済み通し映像で、撮影時の構成とA/B選択に基づく実施中のシーケンスを文字だけで追従表示できません");
}
if (!/function preserveMediaPitch\(media\)/.test(runVideoSync)
    || !/preserveRunVideoMusicSnapshots/.test(runVideoSync)
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
if (!renderRecordSource || !/<progress id="music-seek"[\s\S]*?aria-label=/.test(renderRecordSource[1])
    || /<input type="range" id="music-seek"/.test(renderRecordSource[1])
    || /oninput="musicSeek/.test(renderRecordSource[1])) {
  failures.push("通し練習の楽曲位置が、操作不能な進行バーとして表示されていません");
}
if (!renderRecordSource || !/const missButton = \(label, i\)[\s\S]*?>ミス記録<\/button>/.test(renderRecordSource[1])
    || (renderRecordSource[1].match(/\$\{missButton\(/g) || []).length !== 3) {
  failures.push("通し練習の各シーケンスにミス記録ボタンがありません");
}
if (!/SHEET 00 \/ HOME · \$\{APP_VERSION\}/.test(app)) {
  failures.push("ホームに公開バージョン表示がありません");
}
if (!/document\.body\.dataset\.view = view\.name/.test(app)
    || !/\.tablet-edit-layout/.test(tabletCss)
    || !/grid-template-columns:\s*minmax\(340px/.test(tabletCss)
    || !/\.tablet-record-layout/.test(tabletCss)
    || !/\.tablet-part-layout/.test(tabletCss)) {
  failures.push("iPad横向きの編集・通し・パート練習の見開きレイアウトが揃っていません");
}
if (!/\.topbar \.back-btn\s*\{[\s\S]*?width:\s*max-content[\s\S]*?min-height:\s*44px/.test(tabletCss)
    || !/\.routine-stack-list\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(tabletCss)
    || !/\.routine-stack-list \.routine-row \.actions\s*\{[\s\S]*?display:\s*grid[\s\S]*?repeat\(4,\s*minmax\(0,\s*1fr\)\)/.test(tabletCss)) {
  failures.push("iPadの戻るボタンが適正サイズで、ルーティン一覧が横幅いっぱいの一行表示になっていません");
}
if (!/@media \(min-width:\s*900px\) and \(orientation:\s*landscape\),\s*\(min-width:\s*1200px\)/.test(tabletCss)
    || !/\.home-simple-main\s*\{\s*display:\s*none/.test(tabletCss)
    || !/\.home-wide-routines\s*\{[\s\S]*?display:\s*block/.test(tabletCss)
    || !/const wideRoutines = previousRoutine[\s\S]*?\[previousRoutine,\s*\.\.\.routines\.filter/.test(app)
    || !/class="home-wide-previous-label">前回のルーティン/.test(app)
    || !/@media \(min-width:\s*1200px\)[\s\S]*?max-width:\s*1380px/.test(tabletCss)
    || !/\.tablet-edit-layout,[\s\S]*?\.tablet-record-layout\s*\{[\s\S]*?minmax\(360px,\s*440px\)/.test(tabletCss)
    || !/\.batch-import-layout > \.batch-source\s*\{[\s\S]*?position:\s*sticky/.test(tabletCss)) {
  failures.push("PCと横向きiPadで共通のワイドUIへ切り替わる指定が揃っていません");
}
if (!/function pcWideSidePanelEnabled\(\)[\s\S]*?min-width:\s*1200px/.test(app)
    || !/function openWideSidePanel\(kind\)/.test(app)
    || !/window\.openHelp = \(\) =>[\s\S]*?openWideSidePanel\("help"\)[\s\S]*?go\("help"\)/.test(app)
    || !/window\.openGlobalSettings = \(\) =>[\s\S]*?openWideSidePanel\("settings"\)[\s\S]*?go\("settings"/.test(app)
    || !/#sheet\.wide-side-sheet\s*\{[\s\S]*?right:\s*0[\s\S]*?left:\s*auto[\s\S]*?height:\s*100dvh/.test(tabletCss)
    || !/body\[data-wide-panel="settings"\] \.global-settings-btn/.test(tabletCss)) {
  failures.push("PCの使い方・全体設定が、現在画面を保つ右側ドロワーになっていません");
}
if (!/#sheet:not\(\.wide-side-sheet\)\s*\{[\s\S]*?top:\s*50%[\s\S]*?left:\s*50%[\s\S]*?transform:\s*translate\(-50%,\s*-50%\)/.test(tabletCss)
    || !/#sheet:not\(\.wide-side-sheet\) > \.grabber\s*\{\s*display:\s*none/.test(tabletCss)
    || !/#sheet\.trim-sheet:not\(\.wide-side-sheet\)\s*\{[\s\S]*?width:\s*min\(880px/.test(tabletCss)
    || !/@keyframes wideModalIn/.test(tabletCss)) {
  failures.push("PCの下部シートが、動画トリムを含む中央モーダル表示へ統一されていません");
}
if (!/\.tablet-edit-save-actions \.btn:only-child\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1[\s\S]*?width:\s*100%/.test(tabletCss)) {
  failures.push("新規ルーティンの保存ボタンがPC編集領域の横幅いっぱいに広がっていません");
}
const homeHeaderRule = css.match(/\.home-simple-head\s*\{([^}]*)\}/);
if (!homeHeaderRule || !/min-height:\s*calc\(66px \+ var\(--safe-top\)\)/.test(homeHeaderRule[1])) {
  failures.push("ホーム画面のヘッダー高が他画面と揃っていません");
}
if (!/<svg class="head-settings-icon" viewBox="0 0 24 24" stroke-width="2" style="fill:none"/.test(app)) {
  failures.push("全体設定の歯車が選択時も中抜きになる指定がありません");
}
if (!/const TRICK_LIBRARY_LABEL = "シーケンスライブラリ"/.test(app)
    || (app.match(/\$\{TRICK_LIBRARY_LABEL\}/g) || []).length < 8
    || !/\["シーケンスライブラリ", "Sequence Library"\]/.test(i18n)) {
  failures.push("シーケンスライブラリの名称が画面全体と英語表示に統一されていません");
}
if (!/登録済みのシーケンス \(最大\$\{TRICK_MAX_SEC\}秒\/本/.test(app)
    || !/Saved sequences \(max/.test(i18n)) {
  failures.push("登録済み一覧の見出しがシーケンスの表記に統一されていません");
}
if (!/trickbatch:\s*renderBatchSequenceImport/.test(app)
    || !/go\('trickbatch'\)/.test(app)
    || !/view\.name === "trickbatch"[\s\S]*?batchSequenceImportCleanup/.test(app)
    || !/const transition = step\.kind === "transition"/.test(batchSequenceImport)
    || !/cueSet:\s*false/.test(batchSequenceImport)
    || !/start:\s*null,\s*end:\s*null/.test(batchSequenceImport)
    || !/既存のキュー位置は使いません/.test(batchSequenceImport)
    || !/window\.batchSetCueFromPreview\s*=/.test(batchSequenceImport)
    || !/step\.cue = batchRound\(segment\.start - draft\.offset\)/.test(batchSequenceImport)
    || !/action:\s*transition \? "cue"/.test(batchSequenceImport)
    || !/draft\.segments\.some\(\(segment\) => !segment\.cueSet\)/.test(batchSequenceImport)
    || !/runsOfVersion\(routine\.id, currentVersion\.id\)\.length > 0/.test(batchSequenceImport)
    || !/label: batchText\("長尺動画からキュー設定"/.test(batchSequenceImport)
    || !/linked \? "skip" : "new"/.test(batchSequenceImport)
    || !/\["replace", batchText\("差し替え"/.test(batchSequenceImport)
    || !/\["new", batchText\("別シーケンスとして登録"/.test(batchSequenceImport)
    || !/blobPut\(sourceBlobId, draft\.file\)/.test(batchSequenceImport)
    || !/blobId:\s*sourceBlobId/.test(batchSequenceImport)
    || !/target\.trickId = trickId/.test(batchSequenceImport)
    || !/uniqueTrickBlobBytes\(tricks\)/.test(app)
    || !/trickBlobStillReferenced\(trick\.blobId\)/.test(batchSequenceImport)
    || !/\.batch-segment/.test(batchSequenceImportCss)) {
  failures.push("長尺動画をルーティン順に切り分け、既存動画のスキップ・差し替え・別シーケンス登録を安全に選べません");
}
if (/\bskills?\b/i.test(app) || /\bskills?\b/i.test(i18n)) {
  failures.push("英語表示にskill表記が残っています");
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
if (!/function runVideoStorageActions\(videos\)/.test(runVideoReview)
    || !/window\.showDeleteAllRunVideos\s*=/.test(runVideoSync)
    || !/onclick="showDeleteAllRunVideos\(\)"/.test(runVideoReview)
    || !/window\.startRunVideoBulkDeleteSlide\s*=/.test(app)
    || !/window\.runVideoBulkDeleteKey\s*=/.test(app)
    || !/async function performRunVideoBulkDelete\(\)/.test(runVideoSync)
    || !/state\.runVideos\s*=\s*\[\]/.test(runVideoSync)
    || !/videoIds\.has\(run\.videoId\)[\s\S]*?delete run\.videoId/.test(runVideoSync)
    || !/Promise\.all\(videos\.map\(\(video\)\s*=>\s*blobDel\(video\.blobId\)\)\)/.test(runVideoSync)
    || !/映像の使用容量/.test(settingsView)
    || !/onclick="go\(.runvideos.\)">演技映像の保存を管理/.test(settingsView)
    || !/\.run-video-storage-actions/.test(css)) {
  failures.push("演技映像の容量表示と、スライド確認付き一括削除が揃っていません");
}
if (!/showRoutinePracticeChoice\('\$\{rt\.id\}'\)/.test(app)
    || !/function routineCardHtml[\s\S]*?routineId:'\$\{rt\.id\}'[\s\S]*?<span>演技映像<\/span>/.test(app)
    || /演技映像を見る/.test(app)
    || !/\["演技映像", "Performance Videos"\]/.test(i18n)) {
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
  ["app.js", 354_500], ["run-video-orientation.js", 1_600], ["run-camera-lens.js", 17_400], ["skin-blackboard.css", 6_500], ["from-run-video.js", 14_600], ["run-video-delay.js", 11_200], ["run-video-composition.js", 22_400], ["run-video-sync.js", 22_400], ["run-video-review.js", 13_000], ["music-playback.js", 4_500], ["batch-sequence-import.js", 31_300], ["styles.css", 118_900], ["batch-sequence-import.css", 8_000], ["tablet.css", 13_500], ["i18n.js", 48_300], ["i18n-zh.js", 60_000], ["help-zh.js", 8_000], ["share-practice.js", 9_500],
];
for (const [name, max] of budgets) {
  const size = (await stat(new URL(name, root))).size;
  if (size > max) failures.push(`${name} がサイズ上限 ${max} bytes を超えています (${size})`);
  notes.push(`${name}: ${(size / 1024).toFixed(1)} KiB`);
}
const gzipShell = gzipSync(app).length + gzipSync(runVideoOrientation).length + gzipSync(runCameraLens).length + gzipSync(runVideoDelay).length + gzipSync(runVideoComposition).length + gzipSync(runVideoSync).length + gzipSync(runVideoReview).length + gzipSync(musicPlayback).length + gzipSync(batchSequenceImport).length + gzipSync(css).length + gzipSync(batchSequenceImportCss).length + gzipSync(tabletCss).length + gzipSync(i18n).length + gzipSync(i18nZh).length + gzipSync(sw).length + gzipSync(html).length;
notes.push(`主要コード gzip概算: ${(gzipShell / 1024).toFixed(1)} KiB`);
// 経緯: 背面カメラまわりで186KBまで上げ、旧テーマ撤去で182KB、サンプル差し替えで
// 183KBへ。2026-07-31、繁体字翻訳(i18n-zh.js)の追加で+約8KB。これは機能でなく
// 翻訳そのものの重さなので、削減でなく枠の引き上げが正しい(204KBへ)。
// コード側で次に当たったら、まず減らすこと。
if (gzipShell > 204_000) failures.push(`主要コードのgzip概算が204KBを超えています (${gzipShell})`);

if (failures.length) {
  console.error("Release check failed:\n- " + failures.join("\n- "));
  process.exitCode = 1;
} else {
  console.log(`Release check passed (${appVersion})`);
}
console.log(notes.join("\n"));
