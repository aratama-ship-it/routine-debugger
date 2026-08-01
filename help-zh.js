/* ルーティンノート — 使い方(繁体字版)と、?説明の繁体字版
 *
 * 内容は help-en.js の日本語版・英語版と同じ構成。
 * 片方だけ直すと内容がずれるので、3言語そろえて書き換えること。
 */
window.renderHelpZh = function renderHelpZh() {
  return `
    <div class="topbar"><button class="back-btn" onclick="go('home')" aria-label="返回" title="返回"></button><h1>使用說明</h1></div>
    <div class="card help-tutorial-card"><h2>教學</h2>
      <p>用範例演目，從記錄體驗到決定下次要練什麼(約5分鐘)。</p>
      <button class="btn primary" onclick="tutorialStart()">開始教學</button>
    </div>
    <div class="card help-guide-card"><h2>基本流程</h2>
      <ol class="help-quick-steps">
        <li><span class="help-step-no">01</span><span><b>組出套路。</b>選好音樂，排好段落。需要的段落可以錄影並登錄參考影片。</span></li>
        <li><span class="help-step-no">02</span><span><b>練習。</b>用全套練習跑完整套，或用分段練習重複特定區間。</span></li>
        <li><span class="help-step-no">03</span><span><b>回顧並細練。</b>從全套的分析找出模式，集中整理在意的區間。</span></li>
        <li><span class="help-step-no">04</span><span><b>接到下一次練習。</b>需要時調整編排，重複這個循環來提高穩定度。</span></li>
      </ol>
    </div>
    <div class="card help-guide-card"><h2>兩種練習模式</h2>
      <div class="help-body">
        <div class="help-topic-line"><b>全套練習</b>會把結果留到分析。也可以用前鏡頭錄影，儲存時合成音樂。影片全App最多保留5段。</div>
        <div class="help-topic-line"><b>分段練習</b>會循環A〜B區間，速度與返回間隔(預設3秒)都能調整。結果不會列入分析。</div>
      </div></div>
    <div class="card help-guide-card"><h2>編輯套路</h2>
      <div class="help-body">在<b>編輯</b>設定段落順序、音樂位置與參考影片。儲存時可選擇存成<b>新版本</b>(分析分開保留)或覆寫目前版本。<b>套路設定</b>可管理風險度、A/B、預覽影片與編排的版本紀錄。</div></div>
    <div class="card help-guide-card"><h2>分析與紀錄</h2>
      <div class="help-body">分析會顯示各段落的失誤次數與比率。<b>未能執行</b>不列入失誤率的分母，另外統計。在練習紀錄裡可以編輯筆記，或把誤記錄的全套從統計排除而不刪除。</div></div>
    <div class="card help-guide-card"><h2>保護資料</h2>
      <div class="help-body">紀錄儲存在這個瀏覽器內。建立帳號後，影片與音檔以外的資料會在裝置間同步。<b>連影片與音檔都能保留的，只有完整備份(ZIP)</b>。</div>
      <button class="btn ghost" onclick="openDocPage('backup.html')">閱讀：如何保護資料</button></div>`;
};

// 「?」ボタンの説明(繁体字版)。日本語版は app.js の INFO、英語版は help-en.js の INFO_EN。
window.INFO_ZH = {
  steps: { t: "排序、釘選與FIT", b: "上下拖曳編號下方的 <span style=\"color:var(--muted)\">⠿</span>，就能調整段落順序。<br><br>釘選後，即使排序或自動設定，也會保留該段落的音樂位置。FIT會把該段落的開始時間對齊上一個段落的結尾。" },
  audioLib: { t: "音檔庫", b: "這裡的音檔可在編輯套路／時間軸的「♪ 從音檔庫選擇」使用。內附範例可直接使用。音檔只儲存在這台裝置，登入也不會同步。要保留請使用完整備份(ZIP)。" },
  editorFeatures: { t: "套路的功能", b: "有些人用不到的功能，初始狀態是隱藏的。<br><br><b>風險度</b>＝替每個段落標上危險度(1〜5)，在分析裡對照實際失誤率。<br><b>A/B分支</b>＝建立可以在正式演出時二選一的步驟。<br><br>從套路畫面右上的<b>套路</b>設定，可只針對該套路切換。關閉後已設定的資料不會消失。" },
  videoQuality: { t: "段落影片的畫質", b: "段落影片會自動壓縮以節省空間。選省流量會更省空間，但畫質稍差。此設定只影響之後的錄影與上傳(既有影片不變)。" },
  fullBackup: { t: "完整備份(ZIP)", b: "<b>登入時還原，內容也會同步到其他裝置</b>(備份裡沒有的資料，也會從其他裝置消失)。只想還原到這台裝置時，請先登出。<br><br>除了套路、紀錄與設定，<b>段落影片、全套影片、音檔與錄音也會一起匯出成1個ZIP檔</b>。換機或裝置資料遺失時的復原請用這個。<br><br>ZIP內記錄了每個檔案的校驗值(SHA-256)，還原時會自動驗證是否損壞。只要有1個檔案損壞就會中止還原，目前的資料不會被更動。<br><br><b>驗證ZIP</b>只確認內容是否完好，不會還原。請不時確認備份是否真的可用。<br><br>因為包含影片，檔案會比較大。匯出的ZIP請放到iCloud或電腦等<b>這台裝置以外</b>的地方。" },
  csv: { t: "匯出紀錄(試算表用)", b: "把練習紀錄匯出成CSV，供你在試算表軟體自行統計。<br><br><b>這不是備份。</b>CSV無法匯回App。想保留資料請用「完整備份(ZIP)」。" },
  feedback: { t: "意見與功能建議", b: "「想要這樣的功能」「這裡不好用」等意見可以直接傳給開發者，會用於之後的改善。" },
  reset: { t: "重設", b: "想從頭再試一次、或想重新載入範例時使用。套路、紀錄、段落與全套影片、錄音、音樂與設定會全部刪除(無法復原)。" },
};
