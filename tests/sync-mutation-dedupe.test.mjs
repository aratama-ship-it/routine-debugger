import { harness, check } from "./sync-test-harness.mjs";
const h = harness(process.argv[2] || new URL("../sync.js", import.meta.url));
h.c.state.routines = [{ id: "r1", name: "A" }]; h.load(); await h.settle();
for (const name of ["A", "B", "A"]) { h.c.state.routines[0].name = name; await h.c.runSyncNow(); }
check("A→B→Aがサーバーversion 3へ届く", h.rows.get("r1").body.name === "A" && h.rows.get("r1").entity_version === 3);
await h.c.runSyncNow(); check("再同期でもAを保持", h.c.state.routines[0].name === "A");
