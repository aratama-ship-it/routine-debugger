/* ルーティンノート — iPhone アプリ版への移り方の案内(Web版のみ)
 *
 * なぜ出すか:
 *  - iPhone アプリ版を作っていて、公開後に Web 版は終える予定(本人決定 2026-11-09)。
 *  - 移す道具はすでにある(完全バックアップ ZIP。アプリ版も同じ形式 v1 を読む)。
 *    知らないまま Web 版が終わるのが一番まずいので、先に手順を見せ、今のうちのバックアップを促す。
 *  - 閉じた人には二度と出さない(設定の「完全バックアップ」からいつでも開ける)。
 *
 * i18n は描画後の一括置換で、繁体字の辞書は容量の上限が近い。後から差し込むこの要素は
 * 3 言語の文言をここで出し分ける(日本語を残さないので置換の対象にもならない)。
 */
(() => {
  "use strict";

  const DISMISS_KEY = "rd_iphone_move_hint";
  const lang = () => (typeof uiLanguage === "function" ? uiLanguage() : "ja");
  const t = (ja, en, zh) => (lang() === "en" ? en : lang() === "zh" ? zh : ja);

  function renderMoveHint() {
    const el = document.getElementById("home-move");
    if (!el) return;
    if (window.RNLab || localStorage.getItem(DISMISS_KEY) === "off") {
      if (el.innerHTML !== "") el.innerHTML = "";
      return;
    }
    const html = `<div class="home-install">
      <div class="hi-body">
        <small>${t("お知らせ", "Notice", "公告")}</small>
        <b>${t("iPhone アプリ版を準備しています", "An iPhone app is on the way", "iPhone App 版準備中")}</b>
        <span>${t(
          "公開されたら、この Web 版の記録をそのまま移せます。今のうちに完全バックアップを。",
          "Once it is out, you can move your records from this web version. Make a full backup now.",
          "公開後，可以把這個網頁版的紀錄直接移過去。請趁現在做好完整備份。")}</span>
      </div>
      <div class="hi-actions">
        <button class="btn primary small" onclick="showMoveGuide()">${t("移り方を見る", "How to move", "查看移轉方式")}</button>
        <button class="btn small ghost" onclick="dismissMoveHint()">${t("あとで", "Later", "稍後")}</button>
      </div>
    </div>`;
    if (el.innerHTML !== html) el.innerHTML = html; // 同じ内容なら書き換えない(監視の再発火を避ける)
  }
  window.renderMoveHint = renderMoveHint;

  window.dismissMoveHint = () => {
    localStorage.setItem(DISMISS_KEY, "off");
    renderMoveHint();
  };

  window.showMoveGuide = () => {
    const li = (ja, en, zh) => `<li>${t(ja, en, zh)}</li>`;
    showSheet(`
      <h3>${t("iPhone アプリへの移り方", "Moving to the iPhone app", "移轉到 iPhone App 的方式")}</h3>
      <p class="sheet-note">${t(
        "ルーティンノートは iPhone アプリとして作り直しています。アプリが公開されたら、次の手順でこの Web 版の記録を移せます。Web 版は、iPhone アプリの公開後に終了する予定です。",
        "Routine Note is being rebuilt as an iPhone app. Once it is released, you can move your records from this web version with the steps below. The web version is planned to close after the iPhone app is released.",
        "Routine Note 正在重新製作成 iPhone App。App 公開後，可以依照下列步驟把這個網頁版的紀錄移過去。網頁版預計在 iPhone App 公開後結束。")}</p>
      <ol class="help-body">
        ${li("この Web 版で、右上の歯車 →「完全バックアップ(動画・音源を含む)」→「ZIPで書き出す」。iPhone では「ファイル」アプリに保存されます。",
          "In this web version, tap the gear (top right) → Full backup (includes video and audio) → Export as ZIP. On iPhone the file is saved to the Files app.",
          "在這個網頁版點右上的齒輪 →「完整備份(含影片與音檔)」→「匯出ZIP」。在 iPhone 上會存到「檔案」App。")}
        ${li("iPhone アプリで、歯車 →「完全バックアップ」→「ZIPから復元する」で、その ZIP を選びます。",
          "In the iPhone app, tap the gear → Full backup → Restore from ZIP, and choose that ZIP.",
          "在 iPhone App 點齒輪 →「完整備份」→「從ZIP還原」，選擇該 ZIP。")}
      </ol>
      <ul class="help-body">
        ${li("iPhone アプリが読み込める ZIP は 512MB までです。",
          "The iPhone app can read ZIP files up to 512 MB.",
          "iPhone App 可讀取的 ZIP 最大為 512MB。")}
        ${li("ログインして複数の端末で使っている場合は、いちばん新しい記録がある端末から書き出してください。",
          "If you sign in on several devices, export from the one with the newest records.",
          "若登入後在多台裝置使用，請從紀錄最新的裝置匯出。")}
        ${li("iPhone アプリにはアカウントがありません。記録は iPhone の中に保存されます。",
          "The iPhone app has no accounts. Your records are stored on the iPhone.",
          "iPhone App 沒有帳號功能。紀錄會保存在 iPhone 裡。")}
      </ul>
      <button class="btn primary" onclick="hideSheet();exportFullBackup()">${t("今すぐバックアップする", "Back up now", "立即備份")}</button>
      <button class="btn ghost" onclick="hideSheet()">${t("閉じる", "Close", "關閉")}</button>`);
  };

  const appEl = document.getElementById("app");
  if (appEl) {
    new MutationObserver(() => {
      if (document.getElementById("home-move")) renderMoveHint();
    }).observe(appEl, { childList: true });
  }
  renderMoveHint();
})();
