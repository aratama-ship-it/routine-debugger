import vm from "node:vm";
import { readFileSync } from "node:fs";
export function harness(target) {
  const kv = new Map(), rows = new Map(), applied = new Map(), events = new Map(), timers = [], calls = [], toasts = [], order = [];
  let seq = 0;
  const db = { transaction() { const tx = {};
    tx.objectStore = () => ({
      get(key) { const rq = {}; queueMicrotask(() => { rq.result = structuredClone(kv.get(key)); rq.onsuccess?.(); }); return rq; },
      put(value, key) { kv.set(key, structuredClone(value)); order.push("meta"); queueMicrotask(() => tx.oncomplete?.()); }
    }); return tx;
  }};
  const c = { console, Map, Set, Date, Math, JSON, Object, String, Number, Event,
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    navigator: { onLine: true }, db, STORE: "kv", state: { routines: [], sessions: [], tricks: [], audios: [] },
    document: { hidden: false, getElementById: () => null, addEventListener(n, fn) { events.set(n, fn); } },
    addEventListener() {}, saveState() { order.push("state"); }, flushStateSave() { order.push("flush"); }, render() {},
    toast: (m) => toasts.push(m), isEnglish: () => false,
    accountUser: () => ({ id: "user-1" }), accountEmail: () => "test@example.com", accountAccessToken: async () => "token",
    uid: () => "copy-" + Math.random(), performance: { now: () => 1 },
    async fetch(url, opts = {}) {
      if (url.includes("/rpc/")) {
        const p = JSON.parse(opts.body); calls.push(p);
        if (applied.has(p.p_mutation_id)) return { ok: true, json: async () => applied.get(p.p_mutation_id) };
        const row = rows.get(p.p_id), base = row?.entity_version || 0;
        const out = base !== p.p_base_version ? { status: "conflict", server: row } : { status: "applied", version: base + 1 };
        if (out.status === "applied") rows.set(p.p_id, { id: p.p_id, kind: p.p_kind, body: structuredClone(p.p_body), entity_version: base + 1, change_seq: ++seq, deleted_at: p.p_deleted ? "deleted" : null });
        applied.set(p.p_mutation_id, out); return { ok: true, json: async () => out };
      }
      const after = Number(url.match(/change_seq=gt\.([0-9]+)/)[1]); calls.push({ cursor: after });
      return { ok: true, json: async () => [...rows.values()].filter((r) => r.change_seq > after).map((r) => structuredClone(r)) };
    }
  };
  c.window = c;
  const load = () => vm.runInContext(readFileSync(target, "utf8"), vm.createContext(c));
  return { c, db, kv, rows, calls, toasts, order, timers, events, load, settle: async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); } };
}
export function check(name, cond) { console.log(`${cond ? "ok" : "FAIL"} ${name}`); if (!cond) process.exitCode = 1; }
