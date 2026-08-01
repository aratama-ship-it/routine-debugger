/* ルーティンノート — 使い方(日本語版・英語版)と、?説明の英語版
 *
 * 使い方の本文はどちらも長く、app.js の容量を圧迫していたためこちらへ移した。
 * 呼び出し元は app.js の render()。日本語版が英語版を呼び分ける。
 * 片方だけ直すと内容がずれるので、必ず両方そろえて書き換える。
 */
window.renderHelpEnglish = function renderHelpEnglish() {
  return `
    <div class="topbar"><button class="back-btn" onclick="go('home')" aria-label="Back" title="Back"></button><h1>Guide</h1></div>
    <div class="card help-tutorial-card"><h2>Tutorial</h2>
      <p>Use the sample act to go from recording a run to deciding what to practise next (about 5 minutes).</p>
      <button class="btn primary" onclick="tutorialStart()">Start the tutorial</button>
    </div>
    <div class="card help-guide-card"><h2>Start here</h2>
      <ol class="help-quick-steps">
        <li><span class="help-step-no">01</span><span><b>Build the routine.</b> Choose music and arrange the sequences. Record and register reference videos for sequences when useful.</span></li>
        <li><span class="help-step-no">02</span><span><b>Practice.</b> Try the complete routine in Full Run, or repeat a selected range in Section Practice.</span></li>
        <li><span class="help-step-no">03</span><span><b>Review and refine.</b> Use full-run analysis to find patterns, then work closely on the sections that need attention.</span></li>
        <li><span class="help-step-no">04</span><span><b>Continue to the next practice.</b> Adjust the routine if needed, then repeat the cycle to improve consistency and precision.</span></li>
      </ol>
    </div>
    <div class="card help-guide-card"><h2>Two practice modes</h2>
      <div class="help-body">
        <div class="help-topic-line"><b>Full Run</b> logs results for analysis. You can also record with the front camera; music is added when the video is saved. Up to five videos are kept across the app.</div>
        <div class="help-topic-line"><b>Section Practice</b> loops an A–B range with adjustable speed and pause (default: 3 seconds). Its results are not included in analysis.</div>
      </div></div>
    <div class="card help-guide-card"><h2>Edit a routine</h2>
      <div class="help-body">Set sequence order, music cues, and linked reference videos in <b>Edit</b>. When saving, choose a <b>new version</b> to keep earlier analysis separate, or overwrite the current version. <b>Routine Settings</b> controls Risk, A/B choices, preview video, and sequence history.</div></div>
    <div class="card help-guide-card"><h2>Analysis and records</h2>
      <div class="help-body">Analysis shows issue counts and rates by sequence. <b>Not attempted</b> is kept separate from the issue-rate denominator. In Session History, you can edit notes or exclude a mistaken run without deleting it.</div></div>
    <div class="card help-guide-card"><h2>Keep your data safe</h2>
      <div class="help-body">Records are stored in this browser. With an account, everything except videos and audio syncs across devices. <b>Only a full backup (ZIP) keeps your videos and audio.</b></div>
      <button class="btn ghost" onclick="openDocPage('backup.html')">Read: keeping your data safe</button></div>`;
};

window.renderHelp = function renderHelp() {
  if (isEnglish()) return renderHelpEnglish();
  if (typeof uiLanguage === "function" && uiLanguage() === "zh" && window.renderHelpZh) return renderHelpZh();
  return `
    <div class="topbar"><button class="back-btn" onclick="go('home')" aria-label="戻る" title="戻る"></button><h1>使い方</h1></div>
    <div class="card help-tutorial-card"><h2>チュートリアル</h2>
      <p>サンプルの演目で、記録から次の練習を決めるところまでを試します(5分ほど)。</p>
      <button class="btn primary" onclick="tutorialStart()">チュートリアルを始める</button>
    </div>
    <div class="card help-guide-card"><h2>まずはこの流れ</h2>
      <ol class="help-quick-steps">
        <li><span class="help-step-no">01</span><span><b>ルーティンを組み立てる。</b>楽曲を選び、シーケンスを並べる。必要なシーケンスは参考動画を撮影・登録する。</span></li>
        <li><span class="help-step-no">02</span><span><b>練習する。</b>通し練習で全体を試す、またはパート練習で区間を繰り返す。</span></li>
        <li><span class="help-step-no">03</span><span><b>振り返り、細かく練習する。</b>通しの分析で傾向を見つけ、気になる区間を集中的に整える。</span></li>
        <li><span class="help-step-no">04</span><span><b>次の練習へつなげる。</b>必要なら構成を調整し、またこの流れを繰り返して精度を高める。</span></li>
      </ol>
    </div>
    <div class="card help-guide-card"><h2>2つの練習モード</h2>
      <div class="help-body">
        <div class="help-topic-line"><b>通し練習</b>は結果を分析に残します。インカメ撮影もでき、保存時に楽曲を合成。映像はアプリ全体で5本までです。</div>
        <div class="help-topic-line"><b>パート練習</b>はA〜Bを、速度と戻る間隔（初期3秒）を変えてループします。結果は分析に入りません。</div>
      </div></div>
    <div class="card help-guide-card"><h2>ルーティンを編集する</h2>
      <div class="help-body"><b>編集</b>でシーケンスの順番、楽曲の位置、参考動画を設定します。保存時は、分析を分けて残す<b>新しいバージョン</b>か、現在版の上書きを選べます。<b>個別設定</b>ではリスク・A/B・プレビュー動画・構成履歴を管理できます。</div></div>
    <div class="card help-guide-card"><h2>分析と記録</h2>
      <div class="help-body">分析では、シーケンス別の問題回数と割合を確認します。<b>実施できなかった</b>は失敗率の分母から除き、別に集計します。履歴ではメモの編集や、誤記録した通しの集計除外ができます。</div></div>
    <div class="card help-guide-card"><h2>データを守る</h2>
      <div class="help-body">記録はこのブラウザ内に保存されます。アカウントを作ると、動画・音源以外は他の端末と同期されます。<b>動画・音源まで残せるのは完全バックアップ(ZIP)だけ</b>です。</div>
      <button class="btn ghost" onclick="openDocPage('backup.html')">データの守り方を読む</button></div>`;
};

// 「?」ボタンの説明(英語版)。日本語版は app.js の INFO にある。
// 片方だけ直すと内容がずれるので、必ず両方そろえて書き換える。
window.INFO_EN = {
  steps: { t: "Reordering, pins, and FIT", b: "Drag the ⠿ handle below the step number to change the order.<br><br>Pin a step to keep that sequence at the same music position when reordering or automatically setting cues. FIT aligns its cue with the end of the previous sequence." },
  audioLib: { t: "Audio Library", b: "Reuse audio here from Routine Edit or Timeline. Audio is stored only on this device and is never synced. Use a full backup (ZIP) to keep it." },
  editorFeatures: { t: "Routine features", b: "Risk rating compares your expectation with the observed issue rate. A/B branch lets you choose between two sequences for a run. Change these for the current routine from Routine Settings. Turning features off does not erase saved values." },
  videoQuality: { t: "Sequence video quality", b: "Videos are compressed to save storage. Data saver uses less space with lower image quality. This affects future recordings and uploads only." },
  fullBackup: { t: "Full backup (ZIP)", b: "Exports everything — routines, records, settings, <b>plus sequence videos, run videos, audio, and recordings</b> — as a single ZIP file. Use this when changing devices or recovering lost data.<br><br>The ZIP stores a SHA-256 checksum for every file, so a restore verifies the contents automatically. If even one file is damaged, the restore stops and your current data is left untouched.<br><br><b>Verify a ZIP</b> checks the contents without restoring. Check your backups this way from time to time.<br><br>Files are large because video is included. Store the exported ZIP <b>off this device</b>, for example in iCloud or on a computer." },
  csv: { t: "Export records (for spreadsheets)", b: "Exports your practice records as CSV, for your own analysis in a spreadsheet.<br><br><b>This is not a backup.</b> CSV cannot be loaded back into the app. Use Full backup (ZIP) to keep your data." },
  feedback: { t: "Feedback and requests", b: "Send feature requests or usability feedback directly to the developer." },
  reset: { t: "Reset", b: "Deletes all routines, practice records, sequence videos, recordings, audio, and settings on this device. This cannot be undone." },
};
