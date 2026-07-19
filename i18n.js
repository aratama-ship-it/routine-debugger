/* Routine Note UI translations.
 * User-authored routine names, skill names, music names and notes are intentionally left untouched.
 */
(() => {
  "use strict";

  const exact = new Map([
    ["ルーティンノート", "Routine Note"],
    ["使い方", "Guide"], ["使い方を見る", "View guide"], ["設定", "Settings"],
    ["戻る", "Back"], ["閉じる", "Close"], ["やめる", "Cancel"], ["キャンセル", "Cancel"],
    ["削除", "Delete"], ["編集", "Edit"], ["保存", "Save"], ["追加", "Add"],
    ["完了", "Done"], ["解除", "Unlink"], ["取り消し", "Undo"], ["説明", "Help"],
    ["未登録", "Not added"], ["未設定", "Not set"], ["動画なし", "No video"],
    ["動画プレビュー", "Video preview"], ["動画を準備中…", "Preparing video…"],
    ["動画を読み込めません", "Could not load video"], ["読み込み中…", "Loading…"],
    ["動画を読み込めませんでした", "Could not load video"], ["動画データが見つかりません", "Video data not found"],
    ["動画が見つかりません(技ライブラリから削除されています)", "Video not found. It may have been removed from the Skill Library."],
    ["動画を保存できませんでした", "Could not save video"], ["音源データが見つかりません", "Audio data not found"],
    ["音源が見つかりません", "Audio not found"], ["音源を保存できませんでした", "Could not save audio"],
    ["音源を保存できませんでした(既存の音源を維持します)", "Could not save audio. The existing audio was kept."],
    ["音源の長さを取得できませんでした", "Could not read the audio duration"],
    ["録音データが見つかりません", "Recording data not found"], ["録音を保存できませんでした", "Could not save recording"],
    ["録音が空でした", "The recording was empty"], ["保存できませんでした", "Could not save"],

    ["ルーティン練習をする", "Practice a routine"], ["前回のルーティン", "Previous routine"],
    ["練習中・続きを開く", "In progress · Continue"], ["もう一度練習する", "Practice again"],
    ["まだ練習したルーティンはありません", "No practiced routines yet"],
    ["ライブラリ", "Libraries"], ["技ライブラリ", "Skill Library"], ["音源ライブラリ", "Audio Library"],

    ["ルーティン練習", "Routine Practice"], ["ルーティン", "Routines"],
    ["通し練習", "Full Run"], ["パート練習", "Section Practice"], ["分析", "Analysis"],
    ["＋ 新規ルーティン", "+ New routine"], ["サンプルルーティンを読み込む", "Load sample routine"],
    ["まだルーティンがありません。", "No routines yet."],
    ["技と移行を順番に登録するところから始めます。", "Start by arranging skills and transitions in order."],

    ["ルーティンを編集", "Edit Routine"], ["新しいルーティン", "New Routine"],
    ["ルーティン編集", "Edit Routine"],
    ["ルーティン名", "Routine name"], ["構成", "Sequence"], ["ステップ", "Steps"],
    ["技", "Skill"], ["移行", "Transition"], ["技を追加", "Add skill"],
    ["＋ 技を追加", "+ Add skill"], ["＋ 移行を追加", "+ Add transition"],
    ["＋ 技リストから", "+ From Skill Library"], ["A/B化", "Make A/B"],
    ["A/Bを解除", "Remove A/B"], ["選択肢A", "Option A"], ["選択肢B", "Option B"],
    ["♪ キュー", "♪ Cue"], ["タイムライン", "Timeline"],
    ["♪ 技の長さから曲位置を自動セット", "♪ Set cues from skill durations"],
    ["この内容で保存", "Save changes"], ["ルーティンを作成", "Create routine"],
    ["保存しました", "Saved"], ["ルーティン名を入れてください", "Enter a routine name"],
    ["ステップを2つ以上登録してください", "Add at least two steps"], ["ステップを2つ以上配置してください", "Place at least two steps"],
    ["秒指定は「1:23」か「83」の形式で", "Enter time as “1:23” or “83”"],
    ["技名", "Skill name"], ["新しい技", "New skill"], ["名称未設定", "Untitled"],
    ["移行(例: 持ち替え)", "Transition (for example, prop change)"], ["分岐の名前(例: ラスト技)", "Branch name (for example, final skill)"],
    ["リスク度(任意)", "Risk rating (optional)"], ["ドラッグで並べ替え", "Drag to reorder"],
    ["この技を上部でプレビュー", "Preview this skill above"], ["この技を上部でプレビュー中", "Previewing this skill above"],
    ["複製", "Duplicate"], ["ルーティンを複製", "Duplicate routine"],
    ["このルーティンを複製", "Duplicate this routine"],
    ["ステップ(技と移行) — 上から実施順", "Steps (skills and transitions) — performance order"],
    ["＋ 技", "+ Skill"], ["＋ 移行", "+ Transition"],
    ["楽曲", "Music"], ["音源を添付", "Attach audio"], ["＋ 音源を添付", "+ Attach audio"],
    ["♪ ライブラリから", "♪ From Audio Library"], ["♪ サンプル曲から", "♪ From sample music"],
    ["▶ 再生", "▶ Play"], ["❚❚ 一時停止", "❚❚ Pause"], ["■ 停止", "■ Stop"],
    ["■ 停止(頭に戻す)", "■ Stop (restart)"], ["動画を再生", "Play video"],
    ["技を追加するとここに表示されます", "Add a skill to show it here"],
    ["プレビュー位置は固定されます", "The preview area stays fixed"],
    ["選択した技", "Selected skill"], ["選択した移行", "Selected transition"],
    ["再生位置の技", "Skill at playhead"], ["再生位置の移行", "Transition at playhead"],
    ["いま実施する技", "Current skill"], ["いまの移行", "Current transition"], ["フィニッシュ", "Finish"],

    ["通し練習モード", "FULL RUN MODE"], ["通し練習をスタート", "Start full run"],
    ["通し練習中", "Full run in progress"], ["終わったら結果を記録してください", "Log the result when you finish"],
    ["スタート後、失敗した場所をタップ", "After starting, tap where the issue happened"],
    ["通し練習のスタート後に記録できます", "Available after starting the run"],
    ["クリーン", "Clean"], ["完走", "Finished"], ["セッション終了", "End session"],
    ["セッション開始", "Start Session"], ["セッションを準備する", "Prepare session"],
    ["今日の体調(開始時の主観)", "Condition today (before practice)"],
    ["良い", "Good"], ["普通", "Okay"], ["悪い", "Poor"],
    ["条件メモ(任意: 会場・道具・風など)", "Conditions (optional: venue, props, wind, etc.)"],
    ["通し練習を始めますか？", "Start the full run?"], ["最初の技", "First skill"],
    ["楽曲なし", "No music"], ["COUNTDOWN", "COUNTDOWN"], ["始める", "Start"],
    ["0になったら通し練習スタートです", "The run starts when the count reaches 0"],
    ["ここでの変更はこのルーティンに保存されます", "This value is saved for this routine"],
    ["この通しを記録せず中断", "Stop this run without saving"],
    ["この通しは開始済みです", "This run has already started"], ["先に通し練習をスタートしてください", "Start the full run first"],
    ["楽曲は再生ボタンから開始してください", "Start the music with the Play button"],
    ["続行中の通しがあります。「完走」か失敗記録で確定してください", "A run is still in progress. Finish it or log an issue first."],
    ["この通しを記録せず中断しました", "Run stopped without saving"],
    ["ノーミスで完走 = 1タップ", "One tap for a clean run"], ["失敗ありで最後まで", "Reached the end with issues"],
    ["完走(失敗あり)を記録", "Log finished run with issues"],
    ["記録して続行中 — 最後までいったら「完走」", "Issue logged — tap Finished if you reach the end"],
    ["記録せず終了(破棄)", "End and discard session"], ["まだ続ける", "Keep practicing"],
    ["終了して記録する", "End and save"], ["今日の通し", "Runs today"],
    ["失敗した技", "Skill with issue"], ["失敗の種類", "Issue type"],
    ["原因の仮説(任意・複数可)", "Possible causes (optional, multiple)"],
    ["メモ(任意)", "Note (optional)"], ["この内容で記録", "Save this issue"],
    ["ドロップ(中止)", "Drop (stopped)"], ["ドロップ(復帰)", "Drop (recovered)"],
    ["乱れ(回収)", "Wobble (recovered)"], ["回避", "Skipped"],
    ["集中切れ", "Lost focus"], ["疲労", "Fatigue"], ["技術ミス", "Technical error"],
    ["環境(風/床/光)", "Environment (wind/floor/light)"], ["道具", "Props"], ["緊張", "Nerves"],
    ["今日の体調", "Condition"], ["振り返りメモ(任意 — 気づいた仮説など)", "Review (optional — observations or hypotheses)"],
    ["次回試すこと(任意 — 次のセッション開始時に表示されます)", "Try next time (shown at the next session)"],

    ["パート練習モード", "SECTION PRACTICE MODE"], ["練習区間", "Practice range"],
    ["ループ区間", "Loop range"], ["バーをタップ＆スライド", "Tap or drag the bar"],
    ["A 始点", "A Start"], ["B 終点", "B End"], ["今の位置", "Current position"],
    ["区間をリセット", "Reset range"],
    ["未設定(曲末)", "Not set (end of track)"], ["先に位置を設定してください", "Set the position first"],
    ["始点 A", "Start A"], ["終点 B", "End B"], ["今の位置をAに", "Set current position as A"],
    ["今の位置をBに", "Set current position as B"], ["Aから再生", "Play from A"],
    ["ループON", "Loop On"], ["ループOFF", "Loop Off"], ["区間をクリア", "Clear range"],
    ["パート練習は分析に入りません", "Section practice is not included in analysis"],

    ["構成の変化を比較できます", "Compare sequence versions"],
    ["v1 基本構成 → v2 移行を追加 → v3 A/B分岐を追加", "v1 Basic → v2 Added transition → v3 Added A/B branch"],
    ["基本構成", "Basic"], ["移行を追加", "Added transition"], ["A/B分岐を追加", "Added A/B branch"],
    ["通し数", "Runs"], ["乱れ/ドロップ", "Wobbles / drops"], ["からの回復", "Recovered"],
    ["ステップ別の失敗", "Issues by step"], ["何本目で崩れるか", "When issues occur"],
    ["体調別", "By condition"], ["原因の仮説タグ(推測の集計)", "Possible-cause tags"],
    ["セッション履歴・メモを見る", "View session history and notes"],
    ["この構成で通し練習する", "Practice this version"],
    ["データなし", "No data"], ["観測不足", "Not enough observations"],
    ["記録済", "Logged"], ["集計から除外", "Exclude from analysis"], ["集計に戻す", "Include in analysis"],
    ["集計から除外しました", "Excluded from analysis"], ["集計に戻しました", "Included in analysis"],
    ["直前の失敗記録を取り消しました", "Last issue removed"],
    ["セッション履歴", "Session History"], ["履歴", "History"], ["原因タグ", "Cause tags"],

    ["ルーティンの機能設定", "Routine Features"],
    ["このルーティンで表示する機能を設定します", "Choose the features shown for this routine"],
    ["使う機能", "Features"], ["リスク度", "Risk rating"], ["A/B分岐", "A/B branch"],
    ["事前予想と実際の失敗率を比べる", "Compare expected risk with actual issues"],
    ["本番で使う技を選択肢から切り替える", "Choose between alternate skills for a performance"],
    ["OFFにしても登録済みの値は消えません", "Turning this off keeps saved values"],

    ["設定 / バックアップ", "Settings / Backup"], ["表示言語", "Language"],
    ["日本語", "Japanese"], ["データ", "Data"], ["セッション", "Sessions"], ["通し合計", "Total runs"],
    ["ルーティンで使う機能", "Routine Features"],
    ["各技に危険度(1〜5)を設定・表示します", "Set and show a 1–5 risk rating for each skill"],
    ["本番でどちらの技をやるか選べるステップ(A/B)を作れます", "Create a step with two performance options (A/B)"],
    ["技の動画の画質(撮影・アップロード)", "Skill video quality (recording and upload)"],
    ["標準", "Standard"], ["軽量", "Data saver"], ["バックアップ", "Backup"],
    ["JSONバックアップを書き出す", "Export JSON backup"], ["JSONから復元する", "Restore from JSON"],
    ["CSVエクスポート(表計算用)", "Export CSV (spreadsheet)"],
    ["ご意見・機能の要望", "Feedback and Requests"], ["機能の要望・バグ報告を送る", "Send feedback or report a bug"],
    ["初期化", "Reset"], ["この端末のデータを全て削除", "Delete all data on this device"],
    ["表示設定", "Display settings"], ["機能の要望", "Feature request"], ["バグ報告", "Bug report"],
    ["その他", "Other"], ["種類", "Type"], ["内容 *", "Message *"], ["お名前(任意)", "Name (optional)"],
    ["送信する", "Send"], ["送信中…", "Sending…"],
    ["ルーティンの機能設定を開く", "Open routine features"], ["機能設定", "Features"],
    ["楽曲の音量", "Music volume"], ["開始までの時間を1秒短くする", "Decrease countdown by 1 second"],
    ["開始までの時間を1秒長くする", "Increase countdown by 1 second"],
    ["例: 2026ステージ用 4分", "Example: 4-minute stage routine"], ["♪秒", "♪ sec"],
    ["例: 屋外、やや風あり", "Example: outdoors, light wind"],
    ["例: 左手の握りが浅かった気がする", "Example: My left-hand grip may have been shallow"],
    ["例: 3本目以降、腕が重くなってからリング系が怪しい", "Example: Ring skills became unstable after my arms felt heavy"],
    ["例: 持ち替え→ソロクラブの移行だけ10回反復してから通す", "Example: Repeat the prop-change transition 10 times before a full run"],
    ["例: 技ごとに成功率のグラフが見たい / ○○の画面でボタンが押しにくい など", "Example: I would like a success-rate chart for each skill"],
    ["誰からの要望か分かると助かります(空欄OK)", "Optional — helps us identify your feedback"],

    ["技ライブラリ", "Skill Library"], ["技を撮影", "Record a skill"], ["動画を追加", "Add video"],
    ["● カメラで撮影", "● Record with camera"], ["＋ 動画を登録", "+ Add video"],
    ["サンプル技を追加", "Add sample skills"], ["サンプルを削除", "Remove samples"],
    ["サンプル技をまとめて削除", "Remove all sample skills"],
    ["名前を変更", "Rename"], ["長さ", "Duration"], ["長さを調整", "Adjust clip"],
    ["始点", "Start"], ["終点", "End"], ["この長さで保存", "Save clip range"],
    ["カメラを開始", "Start camera"], ["録画開始", "Start recording"], ["録画停止", "Stop recording"],
    ["● 録画開始", "● Start recording"], ["この環境ではマイク録音を使えません(https配信が必要です)", "Microphone recording is unavailable here. HTTPS is required."],
    ["マイクへのアクセスが許可されませんでした", "Microphone access was denied"],
    ["音源ライブラリ", "Audio Library"], ["ファイルを追加", "Add file"], ["マイクで録音", "Record with microphone"],
    ["● マイクで録音", "● Record with microphone"], ["＋ 音源を登録(MP3等)", "+ Add audio (MP3, etc.)"],
    ["付属のサンプル音源(自由に使えます)", "Included sample audio (free to use)"],
    ["付属", "Included"], ["あなたが追加した音源", "Your audio"],
    ["まだありません。", "Nothing added yet."], ["マイクで録音するか、MP3等を登録してください。", "Record with the microphone or add an audio file."],
    ["録音開始", "Start recording"], ["録音停止", "Stop recording"], ["試聴", "Preview"],
    ["サンプル曲から選ぶ", "Choose sample music"], ["練習用に自由に使える楽曲です(今後追加予定)", "Music you can freely use for practice (more coming later)"],

    ["タイムラインで組む", "Build on Timeline"], ["＋ 技を配置", "+ Place skill"], ["＋ 間(2秒)", "+ Gap (2 sec)"],
    ["ルーティンとして書き出す", "Export as routine"], ["タイムラインを空にする", "Clear timeline"],
    ["曲より長い", "Longer than music"],

    ["このアプリ", "About this app"], ["通し練習の流れ", "Full-run workflow"],
    ["楽曲と録音", "Music and recordings"], ["ステップの登録(編集画面)", "Adding steps (Edit screen)"],
    ["分析の数字の読み方", "Reading the analysis"], ["記録の編集と削除", "Editing and deleting records"],
    ["タイムラインで曲に合わせる", "Matching the routine to music"], ["データの保存", "Saving your data"],

    ["録音を書き出しました", "Recording exported"], ["録音を削除しました", "Recording deleted"],
    ["削除しました", "Deleted"], ["曲位置を自動セットしました", "Music cues updated"],
    ["紐づけを解除しました", "Video unlinked"], ["復元しました", "Restored"],
    ["JSONを書き出しました", "JSON exported"], ["CSVを書き出しました", "CSV exported"],
    ["読み込めませんでした(形式が違います)", "Could not import this file. The format is invalid."],
    ["40MB以下の音源にしてください", "Choose an audio file under 40 MB"], ["0.3秒以上にしてください", "Choose a range of at least 0.3 seconds"],
    ["サンプルを削除しました", "Samples removed"], ["サンプルを読み込めませんでした", "Could not load samples"],
    ["サンプル曲を取得できませんでした", "Could not load sample music"],
    ["サンプル曲を取得できませんでした(通信環境をご確認ください)", "Could not load sample music. Check your connection."],
    ["サンプルルーティンは既にあります(技のみ確認しました)", "The sample routine already exists. Sample skills were checked."],
    ["サンプルv1〜v3と通し40本の分析例を追加しました", "Added sample versions v1–v3 and 40 example runs"],
    ["サンプル一式を読み込み中…", "Loading the sample set…"], ["サンプルの技を読み込み中…", "Loading sample skills…"],
    ["内容を入力してください", "Enter a message"], ["ご意見を送信しました。ありがとうございます", "Feedback sent. Thank you!"],
    ["送信しました。ありがとうございます!", "Sent. Thank you!"], ["メールアプリで送信を完了してください", "Complete sending in your mail app"],
    ["送信できませんでした。メール送信画面を開きます", "Could not send directly. Opening your mail app."],
    ["通し練習の開始をキャンセルしました", "Full-run start cancelled"],
    ["記録せず終了しました", "Session discarded"], ["取り消すものがありません", "Nothing to undo"],
    ["この録音を削除しますか?(元に戻せません)", "Delete this recording? This cannot be undone."],
    ["各技の長さから曲位置(♪)を自動計算して、全ステップのキューを上書きします。よいですか?", "Calculate music cues from skill durations and replace every existing cue?"],
    ["この通しを集計から除外しますか?(データは残り、いつでも戻せます)", "Exclude this run from analysis? The record remains and can be included again."],
    ["サンプルの技9個(アニメーション)を技ライブラリに追加しますか?", "Add 9 animated sample skills to the Skill Library?"],
    ["サンプル一式(技9個+楽曲付きサンプルルーティン)を追加しますか?", "Add the complete sample set (9 skills and a routine with music)?"],
    ["タイムラインを空にしますか?(音源は残ります)", "Clear the timeline? The audio will remain."],
    ["この端末のデータを全て削除して初期状態に戻します。\nルーティン・記録・技の動画・録音・楽曲・設定が消えます。よいですか?", "Delete all data on this device and reset the app? Routines, records, videos, recordings, music, and settings will be removed."],
    ["本当に初期化しますか? 元に戻せません。\n(残したいデータがあれば先にJSONバックアップを)", "Reset now? This cannot be undone. Export a JSON backup first if needed."],
    ["現在のデータをバックアップの内容で置き換えます。よいですか?", "Replace the current data with this backup?"],
    ["ファイルから直接開いているため、サンプルを取得できません。\n\n公開版URLで開いてください:\nhttps://aratama-ship-it.github.io/routine-debugger/", "Samples cannot be loaded when the app is opened directly as a file. Open the published app instead:\nhttps://aratama-ship-it.github.io/routine-debugger/"],
  ]);

  const rules = [
    [/^(\d+)ステップ \/ v(\d+) \/ 通し(\d+)本$/, "$1 steps / v$2 / $3 runs"],
    [/^(\d+)本$/, "$1 runs"], [/^(\d+)件$/, "$1 items"],
    [/^通し(\d+)本$/, "$1 runs"], [/^通し (\d+) 本$/, "$1 runs"],
    [/^今日 (\d+) 本$/, "Today: $1 runs"], [/^クリーン (\d+)$/, "Clean: $1"],
    [/^これまでの合計 (\d+)本$/, "$1 total runs"], [/^本日 (\d+)本目$/, "Run $1 today"],
    [/^(\d+)秒カウントダウン$/, "$1-sec countdown"], [/^(\d+)秒$/, "$1 sec"],
    [/^リスク([1-5])$/, "Risk $1"], [/^クリーン率 (\d+)%$/, "Clean rate $1%"],
    [/^95%区間 (.+)$/, "95% interval $1"], [/^再生中 (.+)$/, "Playing $1"],
    [/^体調: (.+)$/, (_, v) => `Condition: ${translateCore(v)}`],
    [/^クリーン (\d+)\/(\d+) \((\d+)%\)$/, "Clean $1/$2 ($3%)"],
    [/^v(\d+) の通し記録はまだありません。$/, "No full-run records for v$1 yet."],
    [/^次: (.+)$/, "Next: $1"], [/^♪ (.+)　次: (.+)$/, "♪ $1  Next: $2"],
    [/^♪ (.+)　フィニッシュ$/, "♪ $1  Finish"],
    [/^動画の画質: (.+)$/, (_, v) => `Video quality: ${translateCore(v)}`],
    [/^(リスク度|A\/B分岐)を(ON|OFF)にしました$/, (_, label, state) => `${translateCore(label)} turned ${state}`],
    [/^録音を保存しました \((.+)\)$/, "Recording saved ($1)"],
    [/^今日 (\d+) 本 \/ クリーン (\d+) 本$/, "Today: $1 runs / $2 clean"],
    [/^前回 (.+) — (\d+)本 \/ クリーン(\d+)$/, "Previous $1 — $2 runs / $3 clean"],
    [/^構成 \(合計 (.+)\)$/, "Sequence (total $1)"],
    [/^合計 (.+)$/, "Total $1"],
    [/^(.+) パート練習$/, "$1 Section Practice"], [/^(.+) 分析$/, "$1 Analysis"],
    [/^(.+) 履歴$/, "$1 History"],
    [/^v(\d+) (基本構成|移行を追加|A\/B分岐を追加) \((.+)〜\)$/, (_, version, label, date) => {
      const shortLabel = label === "基本構成" ? "Basic" : label === "移行を追加" ? "Transition" : "A/B branch";
      return `v${version} ${shortLabel} · ${date}`;
    }],
    [/^(\d+)〜(\d+)本目$/, "Runs $1–$2"], [/^(\d+)本目〜$/, "Run $1+"],
    [/^(\d+)回$/, "$1 time"],
    [/^ループ (ON|OFF)$/, "Loop $1"],
    [/^(標準|軽量) \((.+)\)$/, (_, label, detail) => `${translateCore(label)} (${detail})`],
    [/^登録済みの技 \(最大(\d+)秒\/本(?: — 合計(.+))?\)$/, (_, seconds, total) => `Saved skills (max ${seconds} sec each${total ? ` — ${total} total` : ""})`],
    [/^(.+) \(サンプル\)$/, "$1 (Sample)"],
    [/^(.+)の動画を再生$/, "Play video: $1"],
    [/^選択肢([A-Z])の技名$/, "Option $1 skill name"],
    [/^サンプルの技(\d+)個をまとめて削除しますか\?$/, "Remove all $1 sample skills?"],
    [/^「(.+)」を削除しますか\?\(元に戻せません\)$/, "Delete “$1”? This cannot be undone."],
    [/^「(.+)」を削除しますか\?\(元に戻せません。既にルーティンに設定した分は残ります\)$/, "Delete “$1”? Existing routine attachments will remain."],
    [/^このセッションを記録せず破棄します。\n今日の通し (\d+) 本は保存されません。よいですか\?$/, "Discard this session without saving its $1 runs?"],
  ];

  function translateCore(core) {
    if (!core) return core;
    const direct = exact.get(core);
    if (direct) return direct;
    for (const [pattern, replacement] of rules) {
      if (pattern.test(core)) return core.replace(pattern, replacement);
    }
    return core.replace(/(\d)〜(?=\d)/g, "$1–");
  }

  function text(value) {
    const raw = String(value ?? "");
    const match = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!match || !match[2]) return raw;
    return match[1] + translateCore(match[2]) + match[3];
  }

  function shouldSkip(node) {
    const parent = node.parentElement;
    if (!parent) return false;
    return parent.matches("script,style,textarea") || parent.hasAttribute("data-user-text");
  }

  function apply(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) if (!shouldSkip(node)) node.nodeValue = text(node.nodeValue);
    const base = root.querySelectorAll ? root : document;
    base.querySelectorAll("[placeholder],[aria-label],[title]").forEach((el) => {
      for (const attr of ["placeholder", "aria-label", "title"]) {
        if (el.hasAttribute(attr)) el.setAttribute(attr, text(el.getAttribute(attr)));
      }
    });
  }

  window.RoutineI18n = { apply, text };
})();
