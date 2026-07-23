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

const [app, runVideoOrientation, runVideoComposition, runVideoSync, runVideoReview, musicPlayback, css, i18n, html, sw, manifestText] = await Promise.all([
  read("app.js"), read("run-video-orientation.js"), read("run-video-composition.js"), read("run-video-sync.js"), read("run-video-review.js"), read("music-playback.js"), read("styles.css"), read("i18n.js"), read("index.html"), read("sw.js"), read("manifest.webmanifest"),
]);

// 構文エラーはブラウザ起動前に止める。
for (const [name, source] of [["app.js", app], ["run-video-orientation.js", runVideoOrientation], ["run-video-composition.js", runVideoComposition], ["run-video-sync.js", runVideoSync], ["run-video-review.js", runVideoReview], ["music-playback.js", musicPlayback], ["i18n.js", i18n], ["sw.js", sw]]) {
  try { new Function(source); } catch (error) { failures.push(`${name}: ${error.message}`); }
}

const appVersion = requireMatch(app, /APP_VERSION\s*=\s*"(v\d+)"/, "APP_VERSION");
const cacheVersion = requireMatch(sw, /CACHE\s*=\s*"routine-debugger-(v\d+)"/, "Service Worker版");
const swRunVideoOrientationVersion = requireMatch(sw, /run-video-orientation\.js\?v=(\d+)/, "Service Worker映像向き判定JS版");
const swRunVideoCompositionVersion = requireMatch(sw, /run-video-composition\.js\?v=(\d+)/, "Service Worker映像音源合成JS版");
const swRunVideoSyncVersion = requireMatch(sw, /run-video-sync\.js\?v=(\d+)/, "Service Worker映像音源同期JS版");
const swRunVideoReviewVersion = requireMatch(sw, /run-video-review\.js\?v=(\d+)/, "Service Worker通し映像レビューJS版");
const swMusicPlaybackVersion = requireMatch(sw, /music-playback\.js\?v=(\d+)/, "Service Worker楽曲再生JS版");
const cssVersion = requireMatch(html, /styles\.css\?v=(\d+)/, "CSS版");
const i18nVersion = requireMatch(html, /i18n\.js\?v=(\d+)/, "i18n版");
const runVideoOrientationVersion = requireMatch(html, /run-video-orientation\.js\?v=(\d+)/, "映像向き判定JS版");
const runVideoCompositionVersion = requireMatch(html, /run-video-composition\.js\?v=(\d+)/, "映像音源合成JS版");
const runVideoSyncVersion = requireMatch(html, /run-video-sync\.js\?v=(\d+)/, "映像音源同期JS版");
const runVideoReviewVersion = requireMatch(html, /run-video-review\.js\?v=(\d+)/, "通し映像レビューJS版");
const musicPlaybackVersion = requireMatch(html, /music-playback\.js\?v=(\d+)/, "楽曲再生JS版");
const jsVersion = requireMatch(html, /app\.js\?v=(\d+)/, "JS版");
const expected = appVersion && appVersion.slice(1);
for (const [label, value] of [["Service Worker", cacheVersion && cacheVersion.slice(1)], ["Service Worker映像向き判定JS", swRunVideoOrientationVersion], ["Service Worker映像音源合成JS", swRunVideoCompositionVersion], ["Service Worker映像音源同期JS", swRunVideoSyncVersion], ["Service Worker通し映像レビューJS", swRunVideoReviewVersion], ["Service Worker楽曲再生JS", swMusicPlaybackVersion], ["CSS", cssVersion], ["i18n", i18nVersion], ["映像向き判定JS", runVideoOrientationVersion], ["映像音源合成JS", runVideoCompositionVersion], ["映像音源同期JS", runVideoSyncVersion], ["通し映像レビューJS", runVideoReviewVersion], ["楽曲再生JS", musicPlaybackVersion], ["JS", jsVersion]]) {
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
if (!/showPracticeVideo:\s*true/.test(app)
    || !/rt\.featureSettings\.showPracticeVideo\s*=\s*true/.test(app)
    || !/delete state\.settings\.practicePreviewMode/.test(app)
    || !/routineSwitchRow\("プレビュー動画",[\s\S]*?"showPracticeVideo"/.test(app)
    || !/function practicePreviewNameOnly\(\)[\s\S]*?!routineFeatureEnabled\(rt, "showPracticeVideo"\)/.test(app)
    || /function practicePreviewModeHtml\(\)|window\.setPracticePreviewMode/.test(app)
    || !/if \(practicePreviewNameOnly\(\)\) return;/.test(app)
    || !/\.practice-now\.name-only/.test(css)
    || !/\["プレビュー動画", "Preview video"\]/.test(i18n)) {
  failures.push("通し・パート練習のプレビュー動画が初期ONで、個別設定から切り替えられる仕様ではありません");
}
const renderSettingsSource = app.match(/function renderSettings\(\) \{([\s\S]*?)\n\}\n\nwindow\.setLanguage/);
if (!renderSettingsSource
    || /すべてのルーティンに適用|switchRow\("リスク度"|switchRow\("A\/B分岐"/.test(renderSettingsSource[1])
    || !/function defaultRoutineFeatures\(\)[\s\S]*?showRisk:\s*false[\s\S]*?showSlots:\s*false/.test(app)
    || !/routineSwitchRow\("リスク度"/.test(app)
    || !/routineSwitchRow\("A\/B分岐"/.test(app)) {
  failures.push("リスク度・A/B分岐が全体設定では非表示で、個別設定だけから変更できる仕様ではありません");
}
if (/技名|Sequence name/.test(app) || /技名|Skill name|skill name/.test(i18n)
    || !/placeholder="選択肢\$\{String\.fromCharCode\(65 \+ oi\)\}のシーケンス名"/.test(app)
    || !/\["シーケンス名", "Sequence"\]/.test(i18n)
    || !/\[\/\^選択肢\(\[A-Z\]\)のシーケンス名\$\/, "Option \$1 sequence"\]/.test(i18n)) {
  failures.push("名称を示す用語が、日本語はシーケンス名、英語はSequenceに統一されていません");
}
if (!/\["練習", "Run"\]/.test(i18n)
    || !/\["＋ 技", "\+ Sequence"\]/.test(i18n)
    || !/Add a sequence in this gap[\s\S]*?\? "Sequence" : "技"/.test(app)
    || !/routine-quick-note-label">簡易メモ <span aria-hidden="true">✎<\/span>/.test(app)) {
  failures.push("英語のRun・Sequence表記、またはQuick memoの編集マークが揃っていません");
}
if (!/<div class="es-name-field">[\s\S]*?<span class="es-duration">\$\{editorDurationLabel\(s, showSlots\)\}<\/span>/.test(app)
    || !/oninput="\$\{nameOninput\};updateEditorSequenceDuration\(this\)"/.test(app)
    || !/function updateEditorSequenceDuration\(input\)/.test(app)
    || !/context\.measureText\(label\)\.width/.test(app)
    || !/nameWidth \+ durationWidth \+ 18 <= available/.test(app)
    || !/\.es-name-field\.duration-visible input\[type=text\]/.test(css)
    || !/\.es-name-field\.duration-visible \.es-duration/.test(css)) {
  failures.push("編集行の長さがシーケンス名右側に表示され、重なる場合だけ隠れる仕様ではありません");
}
if (/function draftTotal\(|durationSummary|class="tl-caption"/.test(app)
    || !/function cueIntervalAt\(index\)[\s\S]*?nextCue - currentCue - duration/.test(app)
    || !/terminal \? editorMusicEndForDraft\(\)/.test(app)
    || !/function cueIntervalWarningHtml\(index\)/.test(app)
    || !/楽曲終了まで \$\{seconds\}秒の空間あり/.test(app)
    || !/class="cue-gap-actions"/.test(app)
    || !/addStep\('trick',\$\{insertAt\}\)/.test(app)
    || !/sheetPickTrick\(\$\{insertAt\}\)/.test(app)
    || !/addStep\('transition',\$\{insertAt\}\)/.test(app)
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
    || !/const emptyStepActions = `[\s\S]*?addStep\('trick',0\)[\s\S]*?sheetPickTrick\(0\)[\s\S]*?addStep\('transition',0\)/.test(app)
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
    || !/分析を分けて残す<b>新しいバージョン<\/b>か、現在版の上書き/.test(app)) {
  failures.push("既存ルーティンの保存時に、新バージョン保存と現在版の上書きを影響説明付きで選べません");
}
if (!/function renderHelpEnglish\(\)[\s\S]*?Start here[\s\S]*?Keep your data safe/.test(app)
    || !/function renderHelp\(\)[\s\S]*?まずはこの流れ[\s\S]*?データを守る/.test(app)
    || !/Build the routine\.[\s\S]*?Review and refine\.[\s\S]*?repeat the cycle/.test(app)
    || !/ルーティンを組み立てる。[\s\S]*?振り返り、細かく練習する。[\s\S]*?またこの流れを繰り返して精度を高める/.test(app)
    || (app.match(/class="card help-guide-card"/g) || []).length !== 10
    || !/class="help-quick-steps"/.test(app)
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
    || !/4ボールは半数で乱れ/.test(app)) {
  failures.push("失敗率10%・30%・50%の背景色分けと、それを確認できるサンプル履歴がありません");
}
if (!/SAMPLE_SEQUENCE_SCHEMA\s*=\s*2/.test(app)
    || !/function ensureSampleSequenceDemo\(rt\)/.test(app)
    || !/function remapExpandedSampleSessions\(rt, version, previousSteps\)/.test(app)
    || !/sampleSequenceSchema:\s*SAMPLE_SEQUENCE_SCHEMA/.test(app)
    || !/["']コラムス["']/.test(app)
    || !/["']ミルズメス風["']/.test(app)
    || !/["']サークルトス["']/.test(app)
    || !/v3 A\/B分岐と技を追加/.test(app)
    || !/A\/B分岐と技を追加/.test(i18n)) {
  failures.push("サンプルv3が10シーケンス構成へ移行できません");
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
    || !/vertical:\s*\{[\s\S]*?ratio:\s*9\s*\/\s*16/.test(app)
    || !/selectRunCameraProfile/.test(app)
    || !/function runVideoAspect\(video\)[\s\S]*?RUN_CAMERA_PROFILES\[video\?\.cameraProfile\]/.test(app)
    || !/\.run-camera-preview\s*\{[\s\S]*?aspect-ratio:\s*var\(--run-camera-aspect,\s*4\/3\)/.test(css)
    || !/\.run-camera-live-preview\s*\{[\s\S]*?aspect-ratio:\s*var\(--run-camera-aspect,\s*4\/3\)/.test(css)
    || !/\.run-video-review\s*\{[\s\S]*?aspect-ratio:\s*var\(--run-camera-aspect,\s*4\/3\)/.test(css)) {
  failures.push("通し映像の4:3横長／9:16縦長選択と各プレビューへの反映がありません");
}
if (!/function runCameraOrientationState\(profileId, viewportWidth, viewportHeight, frameWidth = 0, frameHeight = 0\)/.test(runVideoOrientation)
    || !/blocked:\s*requiresLandscape\s*&&\s*\(!viewportLandscape\s*\|\|\s*!frameLandscape\)/.test(runVideoOrientation)
    || !/wide:\s*\{[\s\S]*?orientation:\s*"landscape"/.test(app)
    || !/id="run-camera-orientation"/.test(app)
    || !/id="run-confirm-start"/.test(app)
    || !/async function prepareRunCamera\([\s\S]*?currentRunCameraOrientationState\(profile\.id, null\)[\s\S]*?orientation\.blocked/.test(app)
    || !/window\.startRunCountdown\s*=\s*\([\s\S]*?currentRunCameraOrientationState\(runCamera\.profileId, runCamera\)\.blocked/.test(app)
    || !/function startRunVideoCapture\([\s\S]*?currentRunCameraOrientationState\(cap\.profileId, cap\)\.blocked/.test(app)
    || !/addEventListener\("resize", scheduleRunCameraOrientationUi\)/.test(app)
    || !/addEventListener\("orientationchange", scheduleRunCameraOrientationUi\)/.test(app)
    || !/captureAspectRatio:\s*pending\.captureAspectRatio/.test(app)
    || !/4:3横長はiPhoneを横向きに、9:16縦長は縦向きにして撮影します/.test(app)
    || !/\.run-camera-orientation/.test(css)) {
  failures.push("4:3横長撮影を画面・実カメラ双方の横向き確認後だけ開始する保護がありません");
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
    || !/推定時間/.test(runVideoReview)
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
if (!/RUN_VIDEO_AUDIO_DELAY_MAX_SECONDS\s*=\s*1/.test(runVideoComposition)
    || !/function normalizeRunVideoAudioDelay\(value\)/.test(runVideoComposition)
    || !/cap\.requestedAudioDelaySeconds\s*=\s*preferredRunVideoAudioDelay\(\)/.test(app)
    || !/audioDelaySeconds:\s*normalizeRunVideoAudioDelay\(capture\.syncAudioDelaySeconds/.test(runVideoComposition)
    || !/requestedAudioDelaySeconds:\s*cap\.requestedAudioDelaySeconds/.test(app)
    || !/composition\.engine === "web-post-save-pending"/.test(runVideoSync)
    || !/function runVideoSyncDelayMarkup\(video, target/.test(runVideoSync)
    || !/max="\$\{RUN_VIDEO_AUDIO_DELAY_MAX_SECONDS\}"\s+step="0\.05"/.test(runVideoSync)
    || !/function bindRunVideoEmbeddedAudioDelay\(video\)[\s\S]*?createMediaElementSource\(player\)[\s\S]*?createDelay/.test(runVideoSync)
    || !/runVideoSyncDelayMarkup\(capture, "stopped"\)/.test(runVideoSync)
    || !/runVideoSyncDelayMarkup\(pending, "pending"\)/.test(app)
    || !/runVideoSyncDelayMarkup\(video, "saved", video\.id\)/.test(runVideoReview)
    || !/syncAudioDelaySeconds:\s*runVideoDesiredAudioDelay\(pending\)/.test(app)
    || !/\.run-video-sync-adjust/.test(css)) {
  failures.push("演技直後の0〜1秒同期補正を試聴・保存し、次回録画へ反映できません");
}
if (!/window\.previewStoppedRunVideo\s*=\s*async/.test(runVideoSync)
    || !/stoppedRunVideoCapture\s*!==\s*capture/.test(runVideoSync)
    || !/onclick="previewStoppedRunVideo\('\$\{rt\.id\}'\)"/.test(app)
    || !/今撮った通し映像/.test(runVideoSync)
    || !/\.run-video-stopped \.run-video-instant-preview/.test(css)) {
  failures.push("音源停止直後の一時映像を、結果入力前に何度でもプレビューできません");
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
    || !/実施中の技/.test(currentStepMarkup[1])
    || !/\$\{runVideoCurrentStepMarkup\(stepContext\)\}[\s\S]*?runVideoDownload/.test(runVideoReview)
    || !/\["loadedmetadata", "timeupdate", "seeking", "seeked"\]/.test(runVideoReview)
    || !/bindRunVideoCurrentStep\(stepContext\)/.test(runVideoReview)
    || !/\.run-video-current-step/.test(css)) {
  failures.push("保存済み通し映像で、撮影時の構成とA/B選択に基づく実施中の技を文字だけで追従表示できません");
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
const homeHeaderRule = css.match(/\.home-simple-head\s*\{([^}]*)\}/);
if (!homeHeaderRule || !/min-height:\s*calc\(66px \+ var\(--safe-top\)\)/.test(homeHeaderRule[1])) {
  failures.push("ホーム画面のヘッダー高が他画面と揃っていません");
}
if (!/<svg class="head-settings-icon" viewBox="0 0 24 24" stroke-width="2" style="fill:none"/.test(app)) {
  failures.push("全体設定の歯車が選択時も中抜きになる指定がありません");
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
  ["app.js", 342_000], ["run-video-orientation.js", 3_000], ["run-video-composition.js", 24_000], ["run-video-sync.js", 27_000], ["run-video-review.js", 12_000], ["music-playback.js", 4_500], ["styles.css", 128_000], ["i18n.js", 50_000], ["assets/wa-bg.svg", 100_000],
];
for (const [name, max] of budgets) {
  const size = (await stat(new URL(name, root))).size;
  if (size > max) failures.push(`${name} がサイズ上限 ${max} bytes を超えています (${size})`);
  notes.push(`${name}: ${(size / 1024).toFixed(1)} KiB`);
}
const gzipShell = gzipSync(app).length + gzipSync(runVideoOrientation).length + gzipSync(runVideoComposition).length + gzipSync(runVideoSync).length + gzipSync(runVideoReview).length + gzipSync(musicPlayback).length + gzipSync(css).length + gzipSync(i18n).length + gzipSync(sw).length + gzipSync(html).length;
notes.push(`主要コード gzip概算: ${(gzipShell / 1024).toFixed(1)} KiB`);
if (gzipShell > 161_000) failures.push(`主要コードのgzip概算が161KBを超えています (${gzipShell})`);

if (failures.length) {
  console.error("Release check failed:\n- " + failures.join("\n- "));
  process.exitCode = 1;
} else {
  console.log(`Release check passed (${appVersion})`);
}
console.log(notes.join("\n"));
