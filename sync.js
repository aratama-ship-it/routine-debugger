// 端末間の同期(β1-b)。app.js の後に読み込む。
//
// 設計(2026-07-25 確定):
//  - ローカルファースト。端末側が主体で、オフラインでも今までどおり動く
//  - サーバーrevision付きの楽観的並行制御。「自分が見ていた版」と一致したときだけ適用
//  - **食い違ったら上書きしない。両方残す(競合コピー)。LWW(最終更新勝ち)は禁止**
//  - 削除は墓石化。同じ変更を再送しても二重に適用されない(mutation_idで冪等)
//
// 実装方針: 既存コードは state を自由に書き換えて saveState() を呼ぶ作りなので、
// 変更箇所すべてに記録を仕込むのは現実的でない。そこで「前回同期した内容のハッシュ」を
// 端末に持ち、保存のたびに差分を割り出して送る(スナップショット差分方式)。
// これなら app.js 側にほとんど手を入れずに済む。
//
// β1で同期するのは記録などの軽いデータだけ。動画・音源の実体は端末内のまま(β1.5で対応)。
(function () {
  "use strict";

  const REST = `${window.SUPABASE_URL_FOR_SYNC || "https://ipuoofukdctvmczpxjnc.supabase.co"}/rest/v1`;
  const KEY = "sb_publishable_Cnw6TSVgAijP5uflVaxnhw_w-nZk_cp";
  const META_KEY = "sync";
  const PULL_LIMIT = 200;

  // 同期する種類。動画そのものを持つ runVideos と、端末ごとの設定は対象外。
  const KINDS = [
    { kind: "routine", get: () => (state.routines = state.routines || []) },
    { kind: "session", get: () => (state.sessions = state.sessions || []) },
    { kind: "trick", get: () => (state.tricks = state.tricks || []) },
    { kind: "audio", get: () => (state.audios = state.audios || []) },
  ];

  let meta = null;          // { userId, cursor, entities: {id:{kind,version,hash}} }
  let running = false;      // 二重起動の防止
  let applying = false;     // 取り込み中の保存で同期を再帰させない
  let timer = null;
  let lastResult = null;    // 画面表示用

  const en = () => (typeof isEnglish === "function" ? isEnglish() : false);
  const t = (ja, eng) => (en() ? eng : (typeof uiLanguage === "function" && uiLanguage() === "zh" && window.RoutineI18nZh ? window.RoutineI18nZh.text(ja) : ja));

  // ---------- 端末に持つ同期メモ ----------
  function kvGet(key) {
    return new Promise((resolve) => {
      if (!db) return resolve(null);
      try {
        const rq = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        rq.onsuccess = () => resolve(rq.result || null);
        rq.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }
  function kvSet(key, value) {
    return new Promise((resolve) => {
      if (!db) return resolve(false);
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  }
  const blankMeta = () => ({ userId: null, cursor: 0, entities: {} });
  async function loadMeta() { meta = (await kvGet(META_KEY)) || blankMeta(); return meta; }
  const saveMeta = () => kvSet(META_KEY, meta);

  // ---------- 変更の検出 ----------
  // キー順に依存しない安定した文字列にしてから、短いハッシュを取る
  function stableString(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableString).join(",")}]`;
    return `{${Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + stableString(value[k])).join(",")}}`;
  }
  function hashOf(value) {
    const s = stableString(value);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36) + ":" + s.length;
  }

  function localEntities() {
    const out = new Map();
    for (const k of KINDS) {
      for (const item of k.get()) {
        if (item && item.id) out.set(String(item.id), { kind: k.kind, body: item });
      }
    }
    return out;
  }

  function replaceLocal(kind, body) {
    const k = KINDS.find((x) => x.kind === kind);
    if (!k) return;
    const list = k.get();
    const i = list.findIndex((x) => String(x.id) === String(body.id));
    if (i >= 0) list[i] = body; else list.push(body);
  }
  function removeLocal(kind, id) {
    const k = KINDS.find((x) => x.kind === kind);
    if (!k) return;
    const list = k.get();
    const i = list.findIndex((x) => String(x.id) === String(id));
    if (i >= 0) list.splice(i, 1);
  }

  // ---------- 通信 ----------
  // 通信の失敗は、そのまま出すとHTTPコードが利用者に見えてしまう。何をすればよいかを示す文言にする。
  function httpError(status) {
    if (status === 401 || status === 403) {
      return new Error(t("ログインの有効期限が切れました。ログインし直してください。",
        "Your session has expired. Please sign in again."));
    }
    if (status === 429) {
      return new Error(t("混み合っています。少し待ってからお試しください。", "Too many requests. Please try again shortly."));
    }
    return new Error(t("同期できませんでした。通信環境をご確認ください。",
      "Could not sync. Please check your connection."));
  }

  async function authHeaders() {
    const token = await window.accountAccessToken();
    if (!token) return null;
    return { apikey: KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }

  async function pull(headers) {
    const applied = { added: 0, updated: 0, removed: 0 };
    for (let page = 0; page < 50; page++) {   // 念のため上限を設ける
      const url = `${REST}/entities?select=id,kind,body,entity_version,change_seq,deleted_at`
        + `&change_seq=gt.${encodeURIComponent(meta.cursor || 0)}&order=change_seq.asc&limit=${PULL_LIMIT}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw httpError(res.status);
      const rows = await res.json();
      if (!rows.length) break;
      for (const row of rows) {
        const id = String(row.id);
        const known = meta.entities[id];
        if (row.deleted_at) {
          // 墓石。こちらで編集していない場合だけ消す(編集していたら残して競合として扱う)
          const current = localEntities().get(id);
          if (current && known && hashOf(current.body) !== known.hash) {
            // 端末側で編集済み → 消さずに残す。次のpushで新規として上がる
            delete meta.entities[id];
          } else {
            if (current) applied.removed++;
            removeLocal(row.kind, id);
            delete meta.entities[id];
          }
        } else if (known && known.version === row.entity_version) {
          // この端末が送った変更がそのまま返ってきただけ(pushはcursorを進めないため必ず起きる)。
          // 取り込むと、push後にした編集をひとつ前の状態へ巻き戻してしまうので、何もしない
        } else {
          const current = localEntities().get(id);
          if (current && known && hashOf(current.body) !== known.hash) {
            // 端末側で編集済み → 上書きせず残す。次のpushが競合として両方を保存する
          } else {
            replaceLocal(row.kind, row.body);
            meta.entities[id] = { kind: row.kind, version: row.entity_version, hash: hashOf(row.body) };
            current ? applied.updated++ : applied.added++;
          }
        }
        meta.cursor = Math.max(meta.cursor || 0, row.change_seq);
      }
      if (rows.length < PULL_LIMIT) break;
    }
    return applied;
  }

  async function callApply(headers, payload) {
    const res = await fetch(`${REST}/rpc/apply_mutation`, {
      method: "POST", headers, body: JSON.stringify(payload),
    });
    if (!res.ok) throw httpError(res.status);
    return res.json();
  }

  // 競合したときに、こちらの内容を別の記録として残す
  function makeConflictCopy(kind, body) {
    const copy = JSON.parse(JSON.stringify(body));
    copy.id = (typeof uid === "function" ? uid() : `c${Date.now()}${Math.floor(performance.now())}`);
    if (kind === "routine") {
      copy.name = `${copy.name || ""}${t("（この端末の変更）", " (this device)")}`;
      // 版を引き継ぐと分析が混ざるので、複製として独立させる
      if (Array.isArray(copy.versions)) copy.versions = copy.versions.map((v) => ({ ...v, id: uid() }));
    }
    replaceLocal(kind, copy);
    return copy;
  }

  async function push(headers) {
    const result = { sent: 0, conflicts: 0, deleted: 0 };
    const current = localEntities();

    // 追加・更新
    for (const [id, { kind, body }] of current) {
      const known = meta.entities[id];
      const hash = hashOf(body);
      if (known && known.hash === hash) continue;         // 変わっていない
      const payload = {
        p_mutation_id: `${id}:${hash}`,                    // 同じ変更を再送しても一度しか適用されない
        p_id: id, p_kind: kind, p_body: body,
        p_base_version: known ? known.version : 0,
        p_deleted: false,
      };
      const out = await callApply(headers, payload);
      if (out && out.status === "applied") {
        meta.entities[id] = { kind, version: out.version, hash };
        result.sent++;
      } else {
        // 別の端末が先に変えていた。サーバー側を採用しつつ、こちらの内容も別記録として残す
        result.conflicts++;
        const server = out && out.server;
        if (server && server.body) {
          makeConflictCopy(kind, body);
          replaceLocal(kind, server.body);
          meta.entities[id] = { kind, version: server.entity_version, hash: hashOf(server.body) };
        } else {
          delete meta.entities[id];   // 次回、新規として送り直す
        }
      }
    }

    // こちらで消えたもの → 墓石を立てる
    for (const id of Object.keys(meta.entities)) {
      if (current.has(id)) continue;
      const known = meta.entities[id];
      const out = await callApply(headers, {
        p_mutation_id: `${id}:del:${known.version}`,
        p_id: id, p_kind: known.kind, p_body: {},
        p_base_version: known.version, p_deleted: true,
      });
      if (out && out.status === "applied") { delete meta.entities[id]; result.deleted++; }
      else delete meta.entities[id];   // 競合していたら pull 側で拾い直す
    }
    return result;
  }

  // ---------- 同期の本体 ----------
  async function runSync(reason) {
    if (running) return null;
    if (!window.accountUser || !window.accountUser()) return null;
    if (!navigator.onLine) { lastResult = { error: t("オフラインです", "Offline") }; return null; }

    running = true;
    updateSyncUi();
    try {
      const headers = await authHeaders();
      if (!headers) throw new Error(t("ログインし直してください", "Please sign in again"));
      if (!meta) await loadMeta();

      const userId = window.accountUser().id || window.accountEmail();
      if (meta.userId && meta.userId !== userId) {
        // 別のアカウントのデータが端末に残っている。取り違えると取り返しがつかないので同期しない
        lastResult = { error: t(
          "この端末には別のアカウントのデータがあります。安全のため同期しません。設定から完全バックアップを取り、初期化してからお使いください。",
          "This device holds data from another account. Syncing is blocked for safety. Export a full backup and reset before using this account here.") };
        return lastResult;
      }
      const firstTime = !meta.userId;
      meta.userId = userId;

      applying = true;
      const pulled = await pull(headers);
      applying = false;
      const pushed = await push(headers);

      await saveMeta();
      if (pulled.added || pulled.updated || pulled.removed || pushed.conflicts) {
        applying = true; saveState(); applying = false;
        if (typeof render === "function") render();
      }
      lastResult = { at: Date.now(), pulled, pushed, firstTime, error: null };
      if (pushed.conflicts) {
        toast(t(`${pushed.conflicts}件が別の端末と食い違ったため、両方を残しました`,
          `${pushed.conflicts} item(s) differed from another device. Both versions were kept.`));
      }
      return lastResult;
    } catch (e) {
      applying = false;
      lastResult = { at: Date.now(), error: (e && e.message) || String(e) };
      return lastResult;
    } finally {
      running = false;
      updateSyncUi();
      if (typeof renderAccountCard === "function") renderAccountCard();
    }
  }

  // ---------- 起動と自動実行 ----------
  function scheduleSync(delay) {
    if (applying) return;                       // 取り込み中の保存では動かさない
    clearTimeout(timer);
    timer = setTimeout(() => runSync("auto"), delay == null ? 4000 : delay);
  }

  // 保存のたびに差分を送る。既存コードには手を入れず、saveState を包む。
  if (typeof window.saveState === "function") {
    const original = window.saveState;
    window.saveState = function wrappedSaveState() {
      const out = original.apply(this, arguments);
      scheduleSync();
      return out;
    };
  }

  window.addEventListener("online", () => scheduleSync(1500));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduleSync(2000); });

  loadMeta().then(() => { setTimeout(() => runSync("start"), 2500); });

  // ---------- 画面 ----------
  function syncStatusText() {
    if (running) return t("同期中…", "Syncing…");
    if (!lastResult) return t("まだ同期していません", "Not synced yet");
    if (lastResult.error) return lastResult.error;
    const d = new Date(lastResult.at);
    const hhmm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
    return t(`最終同期 ${hhmm}`, `Last synced ${hhmm}`);
  }
  function updateSyncUi() {
    const el = document.getElementById("sync-status");
    if (el) el.textContent = syncStatusText();
  }
  window.syncStatusText = syncStatusText;
  window.runSyncNow = async () => {
    if (!window.accountUser()) return toast(t("ログインしてください", "Please sign in"));
    const r = await runSync("manual");
    if (r && r.error) toast(r.error);
    else if (r) toast(t("同期しました", "Synced"));
  };
  // まだサーバーへ送っていない変更の件数。表示にも、不具合の切り分けにも使う。
  window.syncPendingCount = () => {
    if (!meta) return null;
    const current = localEntities();
    let n = 0;
    for (const [id, { body }] of current) {
      const known = meta.entities[id];
      if (!known || known.hash !== hashOf(body)) n++;
    }
    for (const id of Object.keys(meta.entities)) if (!current.has(id)) n++;
    return n;
  };
  // 状態の確認用(問い合わせ対応・検証)
  window.syncDiagnostics = () => ({
    signedIn: !!(window.accountUser && window.accountUser()),
    userId: meta && meta.userId,
    cursor: meta && meta.cursor,
    tracked: meta ? Object.keys(meta.entities).length : null,
    pending: window.syncPendingCount(),
    running, applying,
    last: lastResult,
  });

  // ログイン直後・ログアウト時に呼ばれる
  window.onAccountChanged = async (signedIn) => {
    if (signedIn) { await loadMeta(); scheduleSync(500); return; }
    lastResult = null;
    clearTimeout(timer);
  };
})();
