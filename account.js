// アカウント(確認済みメール + パスワード)。β1の第一段階。
//
// 方針:
// - アカウントは完全に任意。未ログインでも全機能が使え、外部への通信も発生しない。
//   ログインで増えるのは「端末間の同期」だけ(同期本体は次段階)。
// - SDKは使わず fetch で Supabase の認証APIを直接叩く。このアプリはバンドラも依存も無い構成で、
//   必要なのは登録・ログイン・更新・ログアウト・再設定だけのため。
// - 認証情報はこの端末のlocalStorageに保存する。練習データ(IndexedDB)とは別。
(function () {
  "use strict";

  const SUPABASE_URL = "https://ipuoofukdctvmczpxjnc.supabase.co";
  // 公開前提のキー(Supabaseが「RLSがあればブラウザで安全」と明記しているもの)。
  // 秘密鍵(sb_secret_)は絶対にここへ書かない。
  const SUPABASE_KEY = "sb_publishable_Cnw6TSVgAijP5uflVaxnhw_w-nZk_cp";
  const SESSION_KEY = "rd_session";
  const AUTH = `${SUPABASE_URL}/auth/v1`;

  let session = null;   // { access_token, refresh_token, expires_at, user }

  const en = () => (typeof isEnglish === "function" ? isEnglish() : false);
  const t = (ja, eng) => (en() ? eng : ja);

  // ---------- セッションの保存と読み出し ----------
  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      session = raw ? JSON.parse(raw) : null;
    } catch (_) { session = null; }
    return session;
  }
  function saveSession(next) {
    session = next;
    try {
      if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      else localStorage.removeItem(SESSION_KEY);
    } catch (_) {}
  }
  function sessionFromTokens(data) {
    if (!data || !data.access_token) return null;
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      // 期限は絶対時刻で持つ(expires_inは受け取った瞬間からの秒数)
      expires_at: Date.now() + (Number(data.expires_in || 3600) * 1000),
      user: data.user || (session && session.user) || null,
    };
  }
  window.accountUser = () => (session && session.user) || null;
  window.accountEmail = () => (session && session.user && session.user.email) || "";
  // 表示名。メールアドレスは長くて自分のものか判別しづらいので、名前があればそちらを主に見せる
  window.accountName = () => {
    const u = window.accountUser();
    return (u && u.user_metadata && u.user_metadata.display_name) || "";
  };

  // ---------- 通信 ----------
  async function authPost(path, body, extraHeaders) {
    const res = await fetch(`${AUTH}${path}`, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json", apikey: SUPABASE_KEY }, extraHeaders || {}),
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    return { ok: res.ok, status: res.status, data };
  }

  // 期限が近ければ更新する。同期処理から呼べるよう公開しておく。
  window.accountAccessToken = async () => {
    if (!session) return null;
    if (session.expires_at - Date.now() > 60000) return session.access_token;
    const res = await authPost("/token?grant_type=refresh_token", { refresh_token: session.refresh_token });
    if (!res.ok) { saveSession(null); return null; }   // 更新できない=ログアウト扱い
    saveSession(sessionFromTokens(res.data));
    return session ? session.access_token : null;
  };

  // 認証APIのエラーは英語で返るので、よくあるものだけ日本語にする
  function authErrorText(res) {
    const raw = String((res.data && (res.data.error_description || res.data.msg || res.data.message)) || "");
    const code = String((res.data && res.data.error_code) || "");
    if (/already registered|already been registered/i.test(raw) || code === "user_already_exists")
      return t("このメールアドレスは登録済みです。ログインしてください。", "This email is already registered. Please sign in.");
    if (/Invalid login credentials/i.test(raw))
      return t("メールアドレスかパスワードが違います。", "Incorrect email or password.");
    if (/Email not confirmed/i.test(raw))
      return t("メールの確認がまだです。届いた確認メールのリンクを開いてください。", "Email not confirmed yet. Open the link in the confirmation email.");
    if (code === "email_address_invalid" || /Email address .* is invalid/i.test(raw))
      return t("このメールアドレスは使えません。受信できるアドレスを入れてください。", "That email address cannot be used. Enter an address you can receive mail at.");
    if (/Password should be/i.test(raw) || code === "weak_password")
      return t("パスワードは6文字以上にしてください。", "Password must be at least 6 characters.");
    if (res.status === 429 || /rate limit/i.test(raw))
      return t("試行が多すぎます。しばらく待ってからお試しください。", "Too many attempts. Please wait a while and try again.");
    return raw || t("うまくいきませんでした。通信環境を確認してください。", "Something went wrong. Please check your connection.");
  }

  // ---------- 画面 ----------
  const emailField = (id, value) => `<label class="fld">${t("メールアドレス", "Email")}</label>
    <input type="email" id="${id}" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" value="${value || ""}">`;
  const passField = (id, label, autocomplete) => `<label class="fld">${label}</label>
    <input type="password" id="${id}" autocomplete="${autocomplete}">`;

  window.sheetAccountSignIn = () => {
    showSheet(`<h3>${t("ログイン", "Sign in")}</h3>
      ${emailField("ac-email")}
      ${passField("ac-pass", t("パスワード", "Password"), "current-password")}
      <div style="height:14px"></div>
      <button class="btn primary" onclick="accountSignIn()">${t("ログイン", "Sign in")}</button>
      <button class="btn ghost" onclick="sheetAccountSignUp()">${t("アカウントを作る", "Create an account")}</button>
      <button class="btn ghost" onclick="sheetAccountReset()">${t("パスワードを忘れた", "Forgot password")}</button>
      <button class="btn ghost" onclick="hideSheet()">${t("キャンセル", "Cancel")}</button>`);
  };

  window.sheetAccountSignUp = () => {
    showSheet(`<h3>${t("アカウントを作る", "Create an account")}</h3>
      <div class="help-body" style="margin-bottom:10px">${t(
        "端末間で記録を同期したい場合に作ります。作らなくても、これまでどおり全ての機能が使えます。",
        "Create an account if you want to sync your records across devices. Everything works without one.")}</div>
      <label class="fld">${t("お名前(表示用・任意)", "Name (shown in the app, optional)")}</label>
      <input type="text" id="ac-name" autocomplete="nickname" placeholder="${t("例: あらた", "e.g. Alex")}">
      ${emailField("ac-email")}
      ${passField("ac-pass", t("パスワード(6文字以上)", "Password (6+ characters)"), "new-password")}
      <div style="height:14px"></div>
      <button class="btn primary" onclick="accountSignUp()">${t("登録する", "Sign up")}</button>
      <button class="btn ghost" onclick="sheetAccountSignIn()">${t("すでにアカウントがある", "I already have an account")}</button>
      <button class="btn ghost" onclick="hideSheet()">${t("キャンセル", "Cancel")}</button>`);
  };

  window.sheetAccountReset = () => {
    showSheet(`<h3>${t("パスワードの再設定", "Reset password")}</h3>
      <div class="help-body" style="margin-bottom:10px">${t(
        "登録したメールアドレスに、再設定用のリンクを送ります。",
        "We will email you a link to set a new password.")}</div>
      ${emailField("ac-email")}
      <div style="height:14px"></div>
      <button class="btn primary" onclick="accountSendReset()">${t("再設定メールを送る", "Send reset email")}</button>
      <button class="btn ghost" onclick="sheetAccountSignIn()">${t("戻る", "Back")}</button>`);
  };

  const readField = (id) => (document.getElementById(id) || {}).value || "";

  // 処理中の表示。終了時にラベルを戻し忘れると「登録中…」のまま固まるので、常に文言を設定する
  function busy(on, label) {
    const btn = document.querySelector("#sheet .btn.primary");
    if (!btn) return;
    btn.disabled = on;
    btn.textContent = label;
  }

  window.accountSignUp = async () => {
    const email = readField("ac-email").trim();
    const password = readField("ac-pass");
    if (!email || !password) return toast(t("メールアドレスとパスワードを入れてください", "Enter your email and password"));
    const name = readField("ac-name").trim();
    busy(true, t("登録中…", "Signing up…"));
    // data は user_metadata として保存される
    const res = await authPost("/signup", name
      ? { email, password, data: { display_name: name } }
      : { email, password });
    busy(false, t("登録する", "Sign up"));
    if (!res.ok) return toast(authErrorText(res));
    // メール確認が有効なので、この時点ではまだログインできない
    hideSheet();
    showSheet(`<h3>${t("確認メールを送りました", "Check your email")}</h3>
      <div class="help-body" style="margin-top:8px">${t(
        `<b>${esc(email)}</b> にメールを送りました。中のリンクを開くと登録が完了します。<br><br>届かないときは迷惑メールも確認してください。`,
        `We sent a message to <b>${esc(email)}</b>. Open the link in it to finish signing up.<br><br>If it does not arrive, check your spam folder.`)}</div>
      <div style="height:16px"></div>
      <button class="btn ghost" onclick="hideSheet()">${t("閉じる", "Close")}</button>`);
  };

  window.accountSignIn = async () => {
    const email = readField("ac-email").trim();
    const password = readField("ac-pass");
    if (!email || !password) return toast(t("メールアドレスとパスワードを入れてください", "Enter your email and password"));
    busy(true, t("ログイン中…", "Signing in…"));
    const res = await authPost("/token?grant_type=password", { email, password });
    busy(false, t("ログイン", "Sign in"));
    if (!res.ok) return toast(authErrorText(res));
    saveSession(sessionFromTokens(res.data));
    hideSheet();
    renderAccountCard();
    toast(t("ログインしました", "Signed in"));
  };

  window.accountSendReset = async () => {
    const email = readField("ac-email").trim();
    if (!email) return toast(t("メールアドレスを入れてください", "Enter your email"));
    busy(true, t("送信中…", "Sending…"));
    // 戻り先を指定しないと、リンクから元のアプリへ帰ってこられない
    const res = await authPost("/recover", { email }, null);
    busy(false, t("再設定メールを送る", "Send reset email"));
    // 存在しないアドレスでも成否を伏せる(総当たり対策)ため、成功として案内する
    if (!res.ok && res.status !== 422) return toast(authErrorText(res));
    hideSheet();
    toast(t("再設定メールを送りました", "Reset email sent"));
  };

  window.accountSignOut = async () => {
    if (!appConfirm(t(
      "ログアウトします。この端末に保存された練習データは消えません。よいですか?",
      "Sign out? The practice data stored on this device will not be deleted."))) return;
    const token = session && session.access_token;
    saveSession(null);
    renderAccountCard();
    toast(t("ログアウトしました", "Signed out"));
    if (token) authPost("/logout", {}, { Authorization: `Bearer ${token}` }).catch(() => {});
  };

  // 再設定リンクから戻ってきたときに、新しいパスワードを決めてもらう
  window.sheetAccountNewPassword = () => {
    showSheet(`<h3>${t("新しいパスワード", "New password")}</h3>
      ${passField("ac-newpass", t("新しいパスワード(6文字以上)", "New password (6+ characters)"), "new-password")}
      <div style="height:14px"></div>
      <button class="btn primary" onclick="accountSetPassword()">${t("変更する", "Update")}</button>
      <button class="btn ghost" onclick="hideSheet()">${t("あとで", "Later")}</button>`);
  };
  window.accountSetPassword = async () => {
    const password = readField("ac-newpass");
    if (!password) return toast(t("新しいパスワードを入れてください", "Enter a new password"));
    const token = await window.accountAccessToken();
    if (!token) return toast(t("リンクの有効期限が切れています。もう一度お試しください。", "The link has expired. Please try again."));
    busy(true, t("変更中…", "Updating…"));
    const res = await fetch(`${AUTH}/user`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ password }),
    });
    busy(false, t("変更する", "Update"));
    if (!res.ok) { let d=null; try { d = await res.json(); } catch(_){} return toast(authErrorText({ status: res.status, data: d })); }
    hideSheet();
    renderAccountCard();
    toast(t("パスワードを変更しました", "Password updated"));
  };

  // 名前の変更(登録後でもいつでも)
  window.sheetAccountName = () => {
    showSheet(`<h3>${t("お名前", "Your name")}</h3>
      <div class="help-body" style="margin-bottom:10px">${t(
        "アプリの中での表示に使います。いつでも変えられます。",
        "Used for display inside the app. You can change it any time.")}</div>
      <label class="fld">${t("お名前", "Name")}</label>
      <input type="text" id="ac-name" autocomplete="nickname" value="${esc(window.accountName())}">
      <div style="height:14px"></div>
      <button class="btn primary" onclick="accountSaveName()">${t("保存", "Save")}</button>
      <button class="btn ghost" onclick="hideSheet()">${t("キャンセル", "Cancel")}</button>`);
  };
  window.accountSaveName = async () => {
    const name = readField("ac-name").trim();
    const token = await window.accountAccessToken();
    if (!token) return toast(t("ログインし直してください", "Please sign in again"));
    busy(true, t("保存中…", "Saving…"));
    const res = await fetch(`${AUTH}/user`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: { display_name: name } }),
    });
    busy(false, t("保存", "Save"));
    if (!res.ok) { let d = null; try { d = await res.json(); } catch (_) {} return toast(authErrorText({ status: res.status, data: d })); }
    try { saveSession(Object.assign({}, session, { user: await res.json() })); } catch (_) {}
    hideSheet();
    renderAccountCard();
    toast(t("お名前を保存しました", "Name saved"));
  };

  // 設定画面のアカウント欄。app.js からは空の <div id="account-card"> だけ置いてもらう。
  function renderAccountCard() {
    const el = document.getElementById("account-card");
    if (!el) return;
    const user = window.accountUser();
    if (!user) {
      el.innerHTML = `<h2>${t("アカウント(任意)", "Account (optional)")}</h2>
         <div class="account-state out">${t("ログインしていません", "Not signed in")}</div>
         <div class="help-body" style="margin-bottom:10px">${t(
           "複数の端末で同じ記録を見たい場合に使います。<b>作らなくても全ての機能が無料で使えます。</b>",
           "Use an account to see the same records on more than one device. <b>Everything is free to use without one.</b>")}</div>
         <button class="btn" onclick="sheetAccountSignIn()">${t("ログイン / アカウントを作る", "Sign in / Create account")}</button>`;
      return;
    }
    const name = window.accountName();
    el.innerHTML = `<h2>${t("アカウント", "Account")}</h2>
       <div class="account-state in">${t("ログイン中", "Signed in")}</div>
       <div class="account-who">
         <div class="account-name" data-user-text>${esc(name || t("(名前は未設定)", "(no name set)"))}</div>
         <div class="account-mail" data-user-text>${esc(user.email || "")}</div>
       </div>
       <div class="help-body" style="margin:10px 0">${t(
         "端末間の同期は次の更新で有効になります。いまはログイン状態の確認のみです。",
         "Syncing across devices will be enabled in a future update. For now this only confirms sign-in.")}</div>
       <button class="btn" onclick="sheetAccountName()">${name ? t("お名前を変える", "Change name") : t("お名前を登録する", "Set your name")}</button>
       <button class="btn ghost" onclick="accountSignOut()">${t("ログアウト", "Sign out")}</button>`;
  }
  window.renderAccountCard = renderAccountCard;

  // ---------- 起動時 ----------
  loadSession();

  // 確認メール・再設定リンクから戻ると、URLの # にトークンが付いてくる
  (function handleAuthRedirect() {
    const hash = location.hash || "";
    if (!hash.includes("access_token=") && !hash.includes("error=")) return;
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const clean = () => history.replaceState(null, "", location.pathname + location.search);
    if (params.get("error")) {
      clean();
      setTimeout(() => toast(params.get("error_description") || t("リンクが無効です", "Invalid link")), 800);
      return;
    }
    const next = sessionFromTokens({
      access_token: params.get("access_token"),
      refresh_token: params.get("refresh_token"),
      expires_in: params.get("expires_in"),
    });
    if (!next) return;
    saveSession(next);
    const type = params.get("type");
    clean();
    setTimeout(async () => {
      // ユーザー情報を取りに行く(メールアドレスの表示に使う)
      try {
        const res = await fetch(`${AUTH}/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${next.access_token}` } });
        if (res.ok) saveSession(Object.assign({}, next, { user: await res.json() }));
      } catch (_) {}
      renderAccountCard();
      if (type === "recovery") window.sheetAccountNewPassword();
      else toast(t("メールを確認しました。ログイン済みです。", "Email confirmed. You are signed in."));
    }, 600);
  })();
})();
