// 端末の記録が空なのに同期メモに記録が残っている(端末側の保存が失われた)とき、
// 最初の同期で削除として広めず、サーバーの記録を取り戻すことの検証。
// 操作中に本人が全部削除した場合は、通常どおり削除が同期されること。
// 使い方: node tests/sync-empty-guard.test.mjs [対象sync.jsのパス]
import { harness, check } from "./sync-test-harness.mjs";

// ---- シナリオ1: 起動時に端末が空・メモとサーバーに記録あり → 取り戻す ----
{
  const h = harness(process.argv[2] || new URL("../sync.js", import.meta.url));
  h.rows.set("r1", { id: "r1", kind: "routine", body: { id: "r1", name: "演目" }, entity_version: 1, change_seq: 1, deleted_at: null });
  h.rows.set("s1", { id: "s1", kind: "session", body: { id: "s1", routineId: "r1", runs: [] }, entity_version: 1, change_seq: 2, deleted_at: null });
  h.kv.set("sync", { userId: "user-1", cursor: 2, entities: { r1: { kind: "routine", version: 1, hash: "old" }, s1: { kind: "session", version: 1, hash: "old" } } });
  h.load(); await h.settle(); await h.c.runSyncNow();
  check("空端末から墓石を送らない", !h.calls.some((p) => p.p_deleted));
  check("サーバーの記録を全件取り戻す(cursor 0 から pull)", h.calls.some((p) => p.cursor === 0));
  check("ルーティンとセッションが端末に戻る", h.c.state.routines.length === 1 && h.c.state.sessions.length === 1);
  check("サーバー側は削除されていない", !h.rows.get("r1").deleted_at && !h.rows.get("s1").deleted_at);
  check("取り戻した旨を知らせる", h.toasts.some((m) => String(m).includes("取り戻しました")));
  check("同期メモは取り戻した内容で保存される", !!h.kv.get("sync").entities.r1 && h.kv.get("sync").cursor === 2);
}

// ---- シナリオ2: 同期済みの端末で本人が全部削除 → 削除は通常どおり同期される ----
{
  const h = harness(process.argv[2] || new URL("../sync.js", import.meta.url));
  h.c.state.routines = [{ id: "r1", name: "演目" }];
  h.load(); await h.settle(); await h.c.runSyncNow();           // r1 を push(最初の同期＝空ではない)
  h.c.state.routines = [];                                        // 本人が削除
  h.calls.length = 0; await h.c.runSyncNow();
  check("操作中の全削除は墓石として送る", h.calls.some((p) => p.p_deleted && p.p_id === "r1"));
  check("サーバー側で削除になる", h.rows.get("r1").deleted_at === "deleted");
}
