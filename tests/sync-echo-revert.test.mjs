// sync.js のpullが「自分のpushの反響」でローカル編集を巻き戻さないことの検証。
// 使い方: /Users/arata/.local/node/bin/node tests/sync-echo-revert.test.mjs [対象sync.jsのパス]
// 擬似Supabase(メモリ上のentities表 + apply_mutation)に対して同期を2周させ、
// 1周目push後の編集が2周目のpullで失われないことを確かめる。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || path.join(here, "..", "sync.js");

// ---------- ブラウザ環境の代役 ----------
const g = globalThis;
g.window = g;
g.document = { addEventListener() {}, getElementById: () => null, visibilityState: "visible", hidden: false };
Object.defineProperty(g.navigator, "onLine", { value: true, configurable: true });
g.addEventListener = () => {};
g.db = null; // IndexedDBなし → 同期メモはプロセス内メモリのみ(検証には十分)
g.state = { routines: [], sessions: [], tricks: [], audios: [] };
g.saveState = () => {};
g.render = () => {};
g.toast = (m) => { logs.push(`toast: ${m}`); };
g.isEnglish = () => false;
g.accountUser = () => ({ id: "user-1" });
g.accountEmail = () => "user@example.com";
g.accountAccessToken = async () => "token";
let uidN = 0;
g.uid = () => `uid-${++uidN}`;
const logs = [];

// ---------- 擬似Supabase ----------
const server = { seq: 0, rows: new Map() }; // id -> {kind, body, entity_version, change_seq, deleted_at}
g.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes("/rpc/apply_mutation")) {
    const p = JSON.parse(opts.body);
    const row = server.rows.get(p.p_id);
    const base = row ? row.entity_version : 0;
    if ((p.p_base_version || 0) !== base) {
      return { ok: true, json: async () => ({ status: "conflict", server: row ? { body: row.body, entity_version: row.entity_version } : null }) };
    }
    const next = {
      kind: p.p_kind,
      body: JSON.parse(JSON.stringify(p.p_body)),
      entity_version: base + 1,
      change_seq: ++server.seq,
      deleted_at: p.p_deleted ? new Date().toISOString() : null,
    };
    server.rows.set(p.p_id, next);
    return { ok: true, json: async () => ({ status: "applied", version: next.entity_version }) };
  }
  if (u.includes("/entities?")) {
    const m = u.match(/change_seq=gt\.([0-9]+)/);
    const after = m ? Number(m[1]) : 0;
    const rows = [...server.rows.entries()]
      .map(([id, r]) => ({ id, ...r }))
      .filter((r) => r.change_seq > after)
      .sort((a, b) => a.change_seq - b.change_seq);
    return { ok: true, json: async () => rows };
  }
  throw new Error(`unexpected fetch: ${u}`);
};

// 別端末からの書き込みを模す(サーバー側を直接進める)
function remoteWrite(id, kind, body) {
  const row = server.rows.get(id);
  server.rows.set(id, {
    kind, body: JSON.parse(JSON.stringify(body)),
    entity_version: (row ? row.entity_version : 0) + 1,
    change_seq: ++server.seq, deleted_at: null,
  });
}

// ---------- 対象コードを読み込む ----------
new Function(readFileSync(target, "utf8"))();

let failed = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log(`ok   ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};
const sync = () => g.runSyncNow();

// ---------- シナリオ1: 反響による巻き戻し(Tensei報告の再現) ----------
g.state.routines = [{ id: "r1", name: "演目", partLoop: { a: 30.1, b: 44.1 } }];
await sync();                                   // 選択① をpush
g.state.routines[0].partLoop = { a: 10, b: 20 }; // 選択②(pushの後の編集)
await sync();                                   // ここのpullが反響(選択①)を取り込むと巻き戻る
check("編集がpullの反響で巻き戻らない",
  g.state.routines[0].partLoop.a === 10 && g.state.routines[0].partLoop.b === 20,
  `partLoop=${JSON.stringify(g.state.routines[0].partLoop)}`);
check("編集がサーバーへ送られる",
  server.rows.get("r1").body.partLoop.a === 10,
  `server=${JSON.stringify(server.rows.get("r1").body.partLoop)}`);
await sync();
check("その後の同期でも安定(再pushループなし)",
  g.state.routines[0].partLoop.a === 10 && server.rows.get("r1").entity_version === 2,
  `version=${server.rows.get("r1").entity_version}`);

// ---------- シナリオ2: 通し記録の追記が消えない ----------
g.state.sessions = [{ id: "s1", routineId: "r1", runs: [{ n: 1 }] }];
await sync();                       // run1をpush
g.state.sessions[0].runs.push({ n: 2 }); // push後にrun2を記録
await sync();
check("push後に追記した通し記録が消えない",
  g.state.sessions[0].runs.length === 2,
  `runs=${JSON.stringify(g.state.sessions[0].runs)}`);

// ---------- シナリオ3: 他端末の正当な更新は取り込まれる ----------
await sync(); // 手元をきれいに
remoteWrite("r1", "routine", { id: "r1", name: "演目(他端末)", partLoop: { a: 5, b: 15 } });
await sync();
check("他端末の更新(手元は未編集)は取り込む",
  g.state.routines[0].name === "演目(他端末)" && g.state.routines[0].partLoop.a === 5,
  `local=${JSON.stringify(g.state.routines[0])}`);

// ---------- シナリオ4: 他端末更新×手元編集は両方残す(競合コピー) ----------
await sync();
remoteWrite("r1", "routine", { id: "r1", name: "演目(他端末2)", partLoop: { a: 1, b: 2 } });
g.state.routines[0].partLoop = { a: 40, b: 50 }; // 手元でも編集
await sync();
const names = g.state.routines.map((r) => r.name);
check("競合時は両方残る(上書き消失しない)",
  g.state.routines.length === 2 && names.includes("演目(他端末2)"),
  `routines=${JSON.stringify(names)}`);

console.log(failed ? `\n${failed} FAILED` : "\nすべて合格");
process.exit(failed ? 1 : 0);
