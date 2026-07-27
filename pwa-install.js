/* ルーティンノート — ホーム画面への追加(PWA)を最初に案内する
 *
 * なぜ最初に案内するか:
 *  - 練習中は片手・短時間で開く。ブラウザのタブを探す動作は、その場面に耐えない。
 *  - iOSは長期間サイトに触れないと保存データを消すことがあるが、ホーム画面に追加した
 *    ものは別扱いになる。つまり「追加してもらうこと」自体がデータ保護になる。
 *  - 追加済みの人には出さない。用が済んだ案内を出し続けると、本題が押し出される。
 *
 * i18n は描画後の一括置換なので、後から差し込むこの要素は通らない。文言はここで出し分ける。
 */
(() => {
  "use strict";

  const DISMISS_KEY = "rd_install_hint";
  let deferredPrompt = null; // Chrome/Edge が渡してくる「その場で追加できる」券

  const en = () => (typeof isEnglish === "function" ? isEnglish() : false);
  const t = (ja, eng) => (en() ? eng : ja);

  // すでにホーム画面/アプリとして開かれているか
  function isInstalled() {
    try {
      if (navigator.standalone) return true; // iOS Safari
      return window.matchMedia("(display-mode: standalone)").matches
        || window.matchMedia("(display-mode: fullscreen)").matches;
    } catch (_) { return false; }
  }

  function platform() {
    const ua = navigator.userAgent || "";
    // iPadOSはUAがMacを名乗るので、タッチの有無で見分ける
    if (/iPhone|iPod/.test(ua)) return "ios";
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
    if (/Android/.test(ua)) return "android";
    return "desktop";
  }

  // ---------- ホームの案内カード ----------
  function renderInstallHint() {
    const el = document.getElementById("home-install");
    if (!el) return;
    if (isInstalled() || localStorage.getItem(DISMISS_KEY) === "off") {
      if (el.innerHTML !== "") el.innerHTML = "";
      return;
    }
    const html = `<div class="home-install">
      <div class="hi-body">
        <small>${t("まず最初に", "First things first")}</small>
        <b>${t("ホーム画面に追加してください", "Add this to your Home Screen")}</b>
        <span>${t(
          "アプリのように一度で開けて、練習の記録も消えにくくなります。",
          "It opens in one tap like an app, and your records are less likely to be cleared.")}</span>
      </div>
      <div class="hi-actions">
        <button class="btn primary small" onclick="showInstallGuide()">${
          deferredPrompt ? t("追加する", "Add") : t("やり方を見る", "Show me how")}</button>
        <button class="btn small ghost" onclick="dismissInstallHint()">${t("あとで", "Later")}</button>
      </div>
    </div>`;
    if (el.innerHTML !== html) el.innerHTML = html; // 同じ内容なら書き換えない(監視の再発火を避ける)
  }
  window.renderInstallHint = renderInstallHint;

  window.dismissInstallHint = () => {
    localStorage.setItem(DISMISS_KEY, "off");
    renderInstallHint();
  };

  // ---------- やり方 ----------
  function steps() {
    const p = platform();
    if (p === "ios") {
      return {
        head: t("iPhone / iPad の場合", "On iPhone / iPad"),
        note: t("Safariで開いてください（ChromeなどではSafariより手順が異なります）。",
                "Please use Safari (other browsers differ)."),
        list: [
          // 共有アイコンは環境によって豆腐になるので、文字では出さず言葉で説明する
          t("画面下（iPadは上）の<b>共有ボタン</b>（四角から上向きの矢印が出ている印）を押す",
            "Tap the <b>Share</b> button at the bottom (top on iPad) — the square with an arrow"),
          t("メニューを下にたどって<b>「ホーム画面に追加」</b>を選ぶ",
            "Scroll down and choose <b>Add to Home Screen</b>"),
          t("右上の<b>「追加」</b>を押す", "Tap <b>Add</b> at the top right"),
        ],
      };
    }
    if (p === "android") {
      return {
        head: t("Android の場合", "On Android"),
        note: "",
        list: [
          t("右上の<b>「⋮」</b>を押す", "Tap the <b>⋮</b> menu at the top right"),
          t("<b>「アプリをインストール」</b>または<b>「ホーム画面に追加」</b>を選ぶ",
            "Choose <b>Install app</b> or <b>Add to Home screen</b>"),
          t("<b>「インストール」</b>を押す", "Tap <b>Install</b>"),
        ],
      };
    }
    return {
      head: t("パソコンの場合", "On a computer"),
      note: t("Chrome / Edge で使えます。Safariは「共有 → Dockに追加」です。",
              "Works in Chrome / Edge. In Safari, use Share → Add to Dock."),
      list: [
        t("アドレスバーの右端にある<b>インストールのアイコン</b>を押す",
          "Click the <b>install icon</b> at the right end of the address bar"),
        t("<b>「インストール」</b>を押す", "Click <b>Install</b>"),
      ],
    };
  }

  window.showInstallGuide = async () => {
    // Chrome/Edge は「その場で追加」できる。手順を読ませずに済むなら、そちらが速い
    if (deferredPrompt) {
      const dp = deferredPrompt;
      deferredPrompt = null;
      try {
        dp.prompt();
        const res = await dp.userChoice;
        if (res && res.outcome === "accepted") {
          localStorage.setItem(DISMISS_KEY, "off");
          renderInstallHint();
          return;
        }
      } catch (_) { /* 使えなければ手順表示に落とす */ }
    }
    const s = steps();
    showSheet(`<h3>${t("ホーム画面に追加する", "Add to Home Screen")}</h3>
      <p class="muted" style="margin:-4px 0 14px;font-size:13px;line-height:1.65">${t(
        "追加すると、次からはアイコンひとつで開けます。ブラウザでも使えますが、練習中はこちらが速いです。",
        "Once added, you can open it with a single icon. It still works in a browser, but this is faster during practice.")}</p>
      <div class="install-steps">
        <b>${s.head}</b>
        ${s.note ? `<p class="muted">${s.note}</p>` : ""}
        <ol>${s.list.map((x) => `<li>${x}</li>`).join("")}</ol>
      </div>
      <p class="muted" style="font-size:12px">${t(
        "追加してもデータは引き継がれます（同じ保存先を使います）。",
        "Your data carries over — it uses the same storage.")}</p>
      <div class="sheet-actions">
        <button class="btn primary" onclick="hideSheet()">${t("閉じる", "Close")}</button>
      </div>`);
  };

  // ---------- 起動時 ----------
  // Chrome/Edge の自動バナーは抑止して、こちらの案内に一本化する(2か所から出ると鬱陶しい)
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    renderInstallHint();
  });
  // 追加が完了したら、案内はもう不要
  window.addEventListener("appinstalled", () => {
    localStorage.setItem(DISMISS_KEY, "off");
    renderInstallHint();
  });

  // render() から呼んでもらう口が無いので、画面が差し替わったら埋める。
  // #app の直下だけを見る(subtreeまで見ると自分の書き換えで再発火し、無限ループになる)。
  const appEl = document.getElementById("app");
  if (appEl) {
    new MutationObserver(() => {
      if (document.getElementById("home-install")) renderInstallHint();
    }).observe(appEl, { childList: true });
  }
})();
