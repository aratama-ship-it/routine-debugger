# ルーティン・デバッガ — Codex 引き継ぎメモ

最終更新: 2026-07-19 / ローカル現行バージョン: **v73**（編集行の並び替え操作改善・本番未反映）

パフォーマー（ジャグラー等）向けの「通し練習の失敗を記録・分析する」PWA。
iPhone Safari が主ターゲット。バニラJS単一ファイル + IndexedDB。

- 本番: https://aratama-ship-it.github.io/routine-debugger/
- GitHubリポ: `aratama-ship-it/routine-debugger`（GitHub Pages、`main`ブランチ）
- ソースの正: `app-dev/routine-debugger/`（この場所。iCloud配下）
  ※ Pagesリポにはローカルの `PROJECT_NOTES.md` は含めない（`.gitignore`相当でrsync除外している）

---

## 1. 最優先の申し送り（未決・要判断）

### ★ホーム画面「稽古場に戻る」第一案（v58・ローカルのみ）

- 従来の3つの同格カードをやめ、直近のルーティンへ1タップで戻るホームへ変更。
- 骨格は「静かな舞台袖」。前回の `nextPlan` を一文だけ表示し、オレンジの目印線で「床のバミリ」の身体性を加えた。
- 練習中の未終了セッションがあれば「通し練習に戻る」を最優先。記録が無い場合やルーティン未作成時も専用表示を持つ。
- 技・音源ライブラリは練習より一段控えた「道具棚」にまとめた。
- 派生案と戻す場合の判断軸は `docs/2026-07-19-home-concept-a-directions.md` に保存。
- **本番未反映**。ローカル確認と本人レビュー後に調整・公開する。

### ★ホーム画面シンプル化（v59・ローカルのみ）

- v58の本人レビューを反映し、ホーム中央を「ルーティン練習をする」「前回のルーティン」の2操作だけに整理。
- 次回試すこと、メタ情報、パート練習/分析/編集はホームから除外。
- 技/音源ライブラリは最下部に横並びで固定。
- 全操作を塗り・枠・影・押下反応のある明確なボタン表現へ変更。
- v58の舞台袖/稽古ノート/バミリ案は `docs/2026-07-19-home-concept-a-directions.md` に保留案として保存。
- **本番未反映**。公開版は引き続きv57。

### ✅ A/B機能OFF時の「通し練習(record)画面」の挙動 → v57で対応完了
v54で編集画面のリスク/A/B表示、v56で編集画面の既存データ表示を「OFFなら隠す（データは保持）」に統一。
v57で **通し練習の実行画面まで含めて完全に統一**した。

- `currentChoice(sess, st)`（1226付近）が唯一の判定ポイント: `!state.settings.showSlots` なら
  保存済み `slotDefaults` を無視して常に `options[0].id`（＝A）を返す。
- `renderRecord` のステップ一覧（1275付近）: OFF時はA/Bステップも通常ステップとして表示
  （ラベル＝Aの技名、`.slot`クラス/チップなし）。
- `tapStep` の記録シート（1421付近）: OFF時は「どちらをやった?」チップを出さない。
  `commitEvent`（1446付近）は `#opt-grid` が存在しないため `currentChoice` 経由でAへ自動フォールバック。
- `renderHistory` のスロット選択修正チップ（1897付近）もOFF時は非表示（データ保持、ONで復帰）。
- **v71で追加対応**: 分析一覧と技詳細の「選択肢別」内訳も `showSlots` に追従して非表示化。
  OFF中はステップ全体の実測値だけを表示し、保存済み内訳はONへ戻すと復元する。リスク度も通し・分析で
  `showRisk` に追従する。右上の共通メニューから編集・通し・パート・分析のいずれでも切り替え可能。

### ★サンプル楽曲の追加（ファイル待ち）
ユーザーは「サンプル音源を3つほど」希望。現状 `samples/challie-lav.mp3` の1曲のみ。
- 追加するには `samples/` にmp3を置き、`app.js` の `SAMPLE_MUSIC`（2007付近）に `{ f, n }` を追記するだけ。
- 残り2曲のファイル提供待ち。

### ★実機での最終確認（未検証項目）
- 動画圧縮（画質設定 標準/軽量）と要望フォーム送信の実機確認が未完（以前からの宿題）。
- 実機でのマイク録音（練習録音・音源ライブラリ録音）の最終確認。
- 「実装の最終チェックは後でやる」とユーザーが明言した項目が残っている。

### 要望フォームの送信先が未設定
- `app.js` 33行: `const FEEDBACK_ENDPOINT = "";`（空 → 現状はメーラー起動フォールバック）。
- GASのデプロイURLを入れると直接送信になる。手順は `FEEDBACK_GAS_SETUP.md` 参照。

---

## 2. デプロイ／バージョン運用（超重要・毎回必須）

iOS Safari のキャッシュ対策で、**コードを変えたら必ず4か所のバージョンを上げる**こと。上げ忘れると更新が反映されない。

1. `app.js` 30行: `const APP_VERSION = "vNN";`
2. `sw.js` 2行: `const CACHE = "routine-debugger-vNN";`
3. `sw.js` の `"./styles.css?v=NN"` と `"./app.js?v=NN"`
4. `index.html` の `styles.css?v=NN` と `app.js?v=NN`

一括置換の例（vNN→v(NN+1)）:
```bash
sed -i '' 's/APP_VERSION = "v56"/APP_VERSION = "v57"/' app.js
sed -i '' 's/v=56/v=57/g; s/routine-debugger-v56/routine-debugger-v57/g' index.html sw.js
node --check app.js   # 構文チェック
```

### デプロイ手順（Pagesリポは別クローン経由）
ソース(`app-dev/routine-debugger/`)を `/tmp` のクローンにrsyncして push する。
```bash
git clone https://github.com/aratama-ship-it/routine-debugger.git /tmp/rd-deploy   # 無ければ
SRC="…/app-dev/routine-debugger"
cd /tmp/rd-deploy && rsync -a --exclude='.git' --exclude='PROJECT_NOTES.md' --exclude='HANDOFF_CODEX.md' --exclude='.DS_Store' "$SRC"/ ./
git add -A && git commit -m "…" && git push origin main
```
- コミット trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Pages反映は push後 約1〜2分。`curl` で `index.html` の `app.js?v=NN` を見て確認。
- **`PROJECT_NOTES.md` / `HANDOFF_CODEX.md` はローカル専用**（rsync除外）。Pagesに載せたくなければ除外を維持。

### ローカルプレビュー
```bash
cd /tmp/rd-deploy && python3 -m http.server 8643
```
ブラウザで検証する際は、SW解除＋caches全削除してからリロードすること（でないと旧版が出る）。

---

## 3. アーキテクチャ要点

- **単一SPA**、ハッシュ無しルーティング。`view = {name, params}` → `render()` が下表の関数へ振り分け（`app.js` 618付近）。
  - view名: `home, routines, edit, record, stats, settings, history, stepdetail, part, help, tricks, trickrec, audios, builder`
  - `builder`(3029) は**旧「タイムラインで組む」。編集画面に統合済みで到達不可（休眠）**。消さずに残置。
- **状態** `state`: `{ routines, sessions, tricks, audios, settings, feedback, builder }`。IndexedDB永続化 + localStorageフォールバック。
- **Blob保存**: IndexedDB `blobs` ストア（技動画・練習録音・楽曲）。`blobPut/blobGet`。
- **テーマ**: `body[data-theme="wa|cyber|matte"]` でCSS変数を上書き。`routine.theme` に保存、`applyTheme()` は `render()` 内でDOM生成後に実行（editはdraft生成後に判定が必要なため）。
- **楽曲プレイヤー**: グローバルな `musicPlayer = new Audio()`（再描画で途切れない）。UI更新は `updateMusicUI`（イベント）＋ **再生中は `requestAnimationFrame`(`musicRafTick`) で毎フレーム更新**（v55で0.1秒表示を滑らかに）。
- **説明の「?」ボタン**: `INFO` マップ（572付近）＋ `infoBtn('key')` ＋ `window.showInfo('key')`。説明を足すときは `INFO` に1行追加。
- **設定トグル**: `switchRow(label, sub, key)` ＋ `window.toggleSetting(key, val)`。iOS風スイッチ（CSS `.switch`）。
- ファイル: `app.js`(~3360行), `styles.css`(~690行), `index.html`, `sw.js`, `manifest.webmanifest`, `assets/`, `icons/`, `samples/`, `scripts/`, `docs/`。

### 任意機能フラグ（v54で追加）
- `state.settings.showRisk` / `state.settings.showSlots`（既定 undefined=OFF）。
- 編集画面(`renderEdit`)のステップ行で参照。**OFFでも既存データは保持**し、必要な操作は残す設計。
  - A/BステップがOFFのとき: `collapsedSlot = isSlot(s) && !showSlots` で **表示を畳んで「選択肢A(options[0])」を通常の技として表示**。名前編集は `options[0].name` に反映。A/B化/解除ボタン・選択肢行・分岐名は非表示。ONに戻せば両選択肢が復帰。
  - リスクOFF: リスク`select`を描画しない。リスクON×A/B OFFの畳んだステップは option[0] のリスクを表示。

---

## 4. 今セッションの変更履歴（v51〜v67）

- **v51**: 旧「タイムラインで組む」(builder)を編集画面に統合し廃止（自動キュー計算＋タイムラインバー）。
- **v52**: 各項目のインライン説明文を「?」ボタン化（タップでシート表示）。`INFO`/`showInfo`。
- **v53**: 編集画面のタイムラインを「バーのみ」にして再生ボタンと縦並びに。タイムライン内の技リスト（♪時刻・長さ・±）を廃止。自動セットボタンはステップ側へ。`#edit-tl-playhead` のCSS追加（従来未定義で非表示だった現在位置線を可視化）。
- **v54**: リスク度・A/B分岐を任意機能化（設定「編集画面で使う機能」でON/OFF、既定OFF）。
- **v55**: 「楽曲(任意)」カードと選択/添付を上部プレイヤーへ統合（添付時は曲名・削除を小フッター、未添付時は小さな選択行）。再生時間の0.1秒表示をrAFで滑らかに。
- **v56**: 機能OFF時、編集画面で登録済みのリスク/A/B表示を隠す（データ保持）。A/Bは「A」を表示。
- **v57**: A/B分岐OFF時、通し練習(record)・記録シート・履歴の修正チップも含めて完全に非表示化。`currentChoice()` が常にAへフォールバックするため、新規に記録される通しは自動的にA扱いになる。
- **v58（ローカルのみ）**: ホーム画面を「稽古場に戻る」へ刷新。直近演目・次回試すこと・通し練習開始を主役にし、技/音源を「道具棚」へ整理。設計案は別文書に保存。
- **v59（ローカルのみ）**: ホームを主ボタン「ルーティン練習をする」と前回ルーティンだけに簡素化。技/音源は最下部へ固定し、操作を明確なボタン表現へ統一。
- **v61（ローカルのみ）**: ルーティン編集・通し練習・分析・パート練習・技詳細・履歴の右上に共通ハンバーガーメニューを追加し、ルーティンごとのスキンをどこからでも変更可能に。編集画面内の旧テーマカードは削除。音源ライブラリ・ルーティン編集・旧ビルダーに楽曲トリムを追加し、`fullDuration / trimStart / trimEnd / duration` を保存。再生・キュー・失敗記録・A/Bループはトリム後を0秒とする相対時間に統一。元Blobは非破壊で保持し、旧データは全区間として移行。
- **v62（ローカルのみ）**: パート練習のA/B区間を、バーのタップまたはA/Bハンドルのドラッグで直接調整可能に（0.1秒キーボード操作も対応）。再生位置線も同じバーへ表示。通し練習・パート練習では音楽再生中だけ、現在のステップ名・次のステップを上部のstickyドックに表示し、`trickId`がある技はトリム済み動画を無音ループ再生。画面離脱時に動画Object URLを解放。
- **v64（ローカルのみ）**: 三角形だけだった技動画の再生ボタンを、アクセント色の角丸四角で囲んだ動画再生マークへ統一。ルーティン編集、通し練習、技選択シート、技ライブラリ、旧ビルダーへ適用し、各ボタンに技名を含む`aria-label`を追加。編集画面で動画を開閉したときもラベルを同期。音楽の再生ボタンは従来の文字付き表示を維持。
- **v66（ローカルのみ）**: 通し練習・パート練習の現在技ドックと動画プレビュー枠を、再生停止中・動画なしの技・移行でも常設。ドックを138px、プレビューを116pxに固定し、技の切り替えで下のUIが上下しないようにした。停止中も再生位置の技と動画の静止プレビューを保持し、動画なしは同じ枠内へプレースホルダーを表示。音源ロード後の再描画でも技名とプレビューを即時再同期。
- **v67（ローカルのみ）**: ルーティン編集の動画表示を、通し・パートと共通の最上部固定プレビューへ統一。楽曲再生中の行内動画展開と従来の一時的ミニドックを廃止し、楽曲追従・行の再生マークによる手動確認を同じ138pxドックへ表示。ステップ行の高さは動画切り替えで変化しない。
- **v68（ローカルのみ）**: ルーティン編集の楽曲カードにも共通音量バーを追加。サンプルルーティンは5セッション・通し40本のデモ履歴を初期搭載し、分析画面を最初から確認可能にした。既存サンプルは通し0本の場合だけ補完し、本人の記録には混ぜない。
- **v69（ローカルのみ）**: 編集・通し・パート共通の上部動画プレビューを116×116pxの正方形へ変更。ドック全体の固定高138pxは維持。
- **v70（ローカルのみ）**: 正方形プレビューを通常幅で174×174px（約1.5倍）へ拡大。350px以下の狭幅端末は150×150pxへ調整し、固定表示は維持。
- **v71（ローカルのみ）**: ルーティン右上の共通メニューにリスク度・A/B分岐のスイッチを追加。編集・通し・パート・分析から同じ設定を変更でき、通しのリスク表示と分析のリスク/A/B内訳も即時追従する。OFFでも保存済みデータは保持。
- **v73（ローカルのみ）**: 編集ステップ左の並び替えハンドルを上下に大きい縦長タッチ領域へ変更。時間入力をその右側へ揃え、削除ボタンを操作列の最右端へ寄せた。

---

## 5. 既知の注意点（ハマりどころ）

- **キャッシュ**: 上記4か所のバージョン上げ忘れで「変わらない」事故が起きる。必ず。
- **楽曲のコピー・オン・アタッチ**: 音源はライブラリからルーティンへ**コピー**して添付する設計（参照ではない）。過去に楽曲消失インシデントがあり、多数の音源ロード箇所を触らずに済ませるための方針。編集中は `draft._newMusicFile`、保存で `draft.music`(blobId)。
- **iOS音量**: `audio.volume` が無視されるため Web Audio API の GainNode 経由で音量制御（`ensureAudioGraph`）。
- **draft整合**: `renderEdit` は新規・既存で同一システム（違いは初期stepsが空かどうかだけ）。`draft._for` でルーティンID/`"new"`を判別。
- **PWA/SW**: `sw.js` はプリキャッシュ方式。バージョン上げ＝新CACHE名で更新。
- **ローカルスクリプト**: `scripts/gen-wa-bg.mjs`（和テーマ背景SVG生成）等。和テーマは最終的に「ボタン素材（和紙/木/黒漆）」方向。

---

## 6. 参考ドキュメント（同フォルダ）

- `PROJECT_NOTES.md` — 機能ごとの詳細メモ（ローカル専用）
- `FEEDBACK_GAS_SETUP.md` — 要望フォームのGAS設定手順
- `docs/2026-07-18-monetization-data-retention.md` 他 — 収益化/データ保持/アウトリーチ検討メモ
