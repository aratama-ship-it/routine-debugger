import { harness, check } from "./backup-test-harness.mjs";
const h = harness(process.argv[2] || new URL("../backup-archive.js", import.meta.url));
const existing = new Blob(["existing-one"]); h.blobs.set("one", existing);
const before = h.c.state;
await h.c.importFullBackup(h.input(await h.zip({ corruptMedia: true })));
check("2件目が壊れていても1件目の既存Blobを保持", h.blobs.get("one") === existing);
check("照合失敗時は書き込み0件・state不変", h.writes.length === 0 && h.c.state === before);
// パス2の容量不足も現行のBlobを壊さない。
const zip = await h.zip(); const put = h.c.blobPut;
h.c.blobPut = async (id, blob) => id === "two" ? false : put(id, blob);
await h.c.importFullBackup(h.input(zip));
check("書き戻し失敗でも既存Blob/state不変", h.blobs.get("one") === existing && h.c.state === before);
check("書き戻し失敗を通知", h.toasts.some((s) => /容量不足など/.test(s)));

h.c.blobPut = put;
await h.c.importFullBackup(h.input(zip));
const restoredId = h.c.state.routines[0].music.blobId;
check("成功時は復元参照を別IDへ結び、既存Blobを保持", restoredId !== "one" && h.blobs.get("one") === existing);
check("復元参照の実体がバックアップの内容", await h.blobs.get(restoredId)?.text() === "backup-one");
