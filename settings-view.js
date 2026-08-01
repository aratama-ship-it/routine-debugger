/* ルーティンノート — 設定画面
 *
 * 画面の組み立てが長く、app.js の容量を圧迫していたためこちらへ移した。
 * 呼び出し元は app.js の render()。
 *
 * 並び順には意味がある。上から「自分は誰か(アカウント)」→「どう見えるか」→
 * 「どう残すか」→「困ったとき」→「最後に初期化」。
 * 初期化は取り返しがつかないので、いちばん下から動かさない。
 */
window.renderSettings = function renderSettings() {
  const runTotal = state.sessions.reduce((a, s) => a + s.runs.length, 0);
  const runVideoBytes = runVideoStorageBytes();
  setTimeout(refreshStorageInfo, 0); // 容量・永続化の取得は非同期なので描画後に埋める
  setTimeout(renderAccountCard, 0);  // アカウント欄は account.js が埋める
  return `
    <div class="topbar"><button class="back-btn" onclick="returnFromGlobalSettings()" aria-label="戻る" title="戻る"></button><h1>グローバル設定</h1></div>
    <div class="card" id="account-card"></div>
    <div class="card">
      <h2>${isEnglish() ? "Language" : "表示言語"}</h2>
      <div class="segmented" id="language-seg" role="group" aria-label="${isEnglish() ? "Language" : "表示言語"}">
        <button class="choice ${uiLanguage() === "ja" ? "selected" : ""}" onclick="setLanguage('ja')">日本語</button>
        <button class="choice ${uiLanguage() === "en" ? "selected" : ""}" onclick="setLanguage('en')">English</button>
        <button class="choice ${uiLanguage() === "zh" ? "selected" : ""}" onclick="setLanguage('zh')">繁體中文</button>
      </div>
    </div>
    <div class="card">
      <h2>${isEnglish() ? "Appearance" : "見た目"}</h2>
      <div class="segmented" id="skin-seg" role="group" aria-label="${isEnglish() ? "Appearance" : "見た目"}">
        <button class="choice ${currentRoutineSkin() !== "blackboard" ? "selected" : ""}" onclick="chooseRoutineSkin('')">${
          isEnglish() ? "Loose-leaf" : "ルーズリーフ"}</button>
        <button class="choice ${currentRoutineSkin() === "blackboard" ? "selected" : ""}" onclick="chooseRoutineSkin('blackboard')">${
          isEnglish() ? "Blackboard" : "黒板"}</button>
      </div>
      <small>${isEnglish()
        ? "Colours only. The layout and wording stay the same. Saved on this device."
        : "変わるのは色と枠だけで、配置や文言はそのままです。この端末にだけ保存します。"}</small>
    </div>
    <div class="card">
      <h2>データ</h2>
      <div class="bd-row"><span class="k">ルーティン</span><span class="v">${state.routines.length}</span></div>
      <div class="bd-row"><span class="k">セッション</span><span class="v">${state.sessions.length}</span></div>
      <div class="bd-row"><span class="k">通し合計</span><span class="v">${runTotal}本</span></div>
      <div class="bd-row"><span class="k">通し映像</span><span class="v">${storedRunVideos().length}/${RUN_VIDEO_LIMIT}本</span></div>
      <div class="bd-row"><span class="k">映像の使用容量</span><span class="v">${fmtBytes(runVideoBytes)}</span></div>
      <div class="bd-row"><span class="k">端末全体の使用容量</span><span class="v" id="storage-est">…</span></div>
      <div class="bd-row"><span class="k">データの保護</span><span class="v" id="storage-persist">…</span></div>
      <div class="bd-row"><span class="k">未使用データ</span><span class="v" id="storage-orphan">…</span></div>
      <button class="btn storage-manage-btn" onclick="go('runvideos')">演技映像の保存を管理</button>
    </div>
    <div class="card">
      <h2>シーケンスの動画の画質(撮影・アップロード)${infoBtn("videoQuality")}</h2>
      <div class="segmented" id="vq-seg">
        ${Object.entries(VIDEO_PROFILES).map(([k, p]) => `<button class="choice ${(state.settings.videoQuality || "standard") === k ? "selected" : ""}"
          onclick="setVideoQuality('${k}')">${p.label}</button>`).join("")}
      </div>
    </div>
    <div class="card">
      <h2>完全バックアップ(動画・音源を含む)${infoBtn("fullBackup")}</h2>
      <button class="btn primary" onclick="exportFullBackup()">ZIPで書き出す</button>
      <button class="btn" onclick="document.getElementById('zip-import-file').click()">ZIPから復元する</button>
      <input type="file" id="zip-import-file" accept=".zip,application/zip" class="hidden" onchange="importFullBackup(this)">
      <button class="btn ghost" onclick="document.getElementById('zip-verify-file').click()">ZIPを検証する(復元しない)</button>
      <input type="file" id="zip-verify-file" accept=".zip,application/zip" class="hidden" onchange="verifyFullBackup(this)">
      <button class="btn ghost" onclick="openDocPage('backup.html')">データの守り方を読む</button>
    </div>
    <div class="card">
      <h2>記録の書き出し(表計算用)${infoBtn("csv")}</h2>
      <button class="btn ghost" onclick="exportCsv()">CSVエクスポート</button>
    </div>
    <div class="card">
      <h2>ご意見・機能の要望${infoBtn("feedback")}</h2>
      <button class="btn" onclick="openFeedback()">機能の要望・バグ報告を送る</button>
    </div>
    <div class="card">
      <h2>ベータ版について</h2>
      <button class="btn" onclick="openDocPage('beta.html')">テスターの方へ(使い方と注意)</button>
      <button class="btn ghost" onclick="openDocPage('privacy.html')">プライバシーポリシー</button>
      <button class="btn ghost" onclick="openDocPage('updates.html')">アップデート履歴</button>
      <button class="btn ghost" onclick="openDocPage('terms.html')">利用規約</button>
    </div>
    <button class="btn" onclick="openHelp()">使い方を見る</button>
    <button class="btn" onclick="openDocPage('about.html')">このアプリについて</button>
    <div class="card">
      <h2>初期化${infoBtn("reset")}</h2>
      <button class="btn danger-ghost" style="width:100%" onclick="resetAllData()">この端末のデータを全て削除</button>
    </div>
    <div class="app-copyright">© 2026 PYGMIX</div>`;
};
