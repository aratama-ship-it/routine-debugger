/* ルーティンノート — 使い方(英語版)
 *
 * 日本語版と同じ内容の英訳。文章がまとまって長く、app.js の容量を圧迫していたため
 * こちらへ移した。表示の入口は app.js の renderHelp() で、英語のときだけ呼ばれる。
 * 日本語版を書き換えたら、必ずこちらも直す(片方だけ古くなるのが一番困る)。
 */
window.renderHelpEnglish = function renderHelpEnglish() {
  return `
    <div class="topbar"><button class="back-btn" onclick="go('home')">Back</button><h1>Guide</h1></div>
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
