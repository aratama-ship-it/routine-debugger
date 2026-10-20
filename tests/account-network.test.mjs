import vm from "node:vm";
import { readFileSync } from "node:fs";
const source = readFileSync(process.argv[2] || new URL("../account.js", import.meta.url), "utf8");
function setup(expired = false) {
  const btn = { disabled: false }, messages = [], stored = new Map();
  stored.set("rd_session", JSON.stringify({ access_token: "test", refresh_token: "refresh", expires_at: expired ? 0 : Date.now() + 3600000, user: { id: "test" } }));
  const c = { console, Date, URLSearchParams, setTimeout() {}, location: { hash: "" },
    document: { getElementById: (id) => id.startsWith("ac-") ? { value: "test@example.com" } : null, querySelector: () => btn },
    localStorage: { getItem: (k) => stored.get(k), setItem: (k,v) => stored.set(k,v), removeItem: (k) => stored.delete(k) },
    fetch: async () => { throw new Error("offline"); }, isEnglish: () => false, toast: (m) => messages.push(m),
  }; c.window = c; vm.runInNewContext(source, c); return { c, btn, messages, stored };
}
function check(name, cond) { console.log(`${cond ? "ok" : "FAIL"} ${name}`); if (!cond) process.exitCode = 1; }
for (const fn of ["accountSignIn", "accountSignUp", "accountSendReset", "accountSaveName", "accountSetPassword"]) {
  const h = setup(); let rejected = false; try { await h.c[fn](); } catch (_) { rejected = true; }
  check(`${fn}: 通信失敗で操作を戻し案内`, !rejected && !h.btn.disabled && h.messages.some((m) => /通信できませんでした/.test(m)));
}
const h = setup(true); let token; try { token = await h.c.accountAccessToken(); } catch (_) {}
check("通信失敗時はセッションを保持しnullを返す", token === null && !!h.stored.get("rd_session"));
h.c.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
await h.c.accountAccessToken(); check("認証失効時はセッションを解除", !h.stored.has("rd_session"));
