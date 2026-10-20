import { harness, check } from "./sync-test-harness.mjs";
const h = harness(process.argv[2] || new URL("../sync.js", import.meta.url));
const { c } = h;
c.state.routines = [{ id: "r1", name: "A" }]; h.load(); await h.settle(); await c.runSyncNow(); await c.runSyncNow();
const cursor = h.kv.get("sync").cursor;
c.db = null; c.state.routines[0].name = "offline"; h.events.clear(); h.timers.length = 0; h.load(); await h.settle();
c.db = h.db; h.events.get("rd:state-loaded")?.();
const start = h.timers.find((x) => x.ms === 1500);
if (start) await start.fn(); else await c.runSyncNow();
check("実機起動順でオフライン編集を保持", c.state.routines[0].name === "offline");
check("保存済みcursorからpull", h.calls.filter((x) => "cursor" in x).at(-1).cursor === cursor && cursor > 0);
check("state-loaded後1500msで起動", !!start);
const before = h.timers.filter((x) => x.ms === 1500).length;
h.timers.find((x) => x.ms === 15000)?.fn(); h.events.get("rd:state-loaded")?.();
check("保険タイマーとイベントで二重起動しない", h.timers.filter((x) => x.ms === 1500).length === before);
// リモート変更でstateの保存順を確認
h.rows.get("r1").entity_version++; h.rows.get("r1").change_seq += 20; h.rows.get("r1").body.name = "remote";
h.order.length = 0; await c.runSyncNow();
check("state/flushをmetaより先に保存", h.order.indexOf("state") >= 0 && h.order.indexOf("flush") > h.order.indexOf("state") && h.order.indexOf("meta") > h.order.indexOf("flush"));
