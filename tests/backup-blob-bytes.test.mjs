import { harness, check } from "./backup-test-harness.mjs";
const h = harness(new URL("../backup-archive.js", import.meta.url));
const payload = new Uint8Array([1, 9, 2, 8, 3]);
const manifest = { blobs: [{ blobId: "media", path: "blobs/media", size: payload.length, type: "audio/wav" }] };
let reads = 0;
const zip = {
  has: () => true,
  blob: async () => ({ size: payload.length, type: "", arrayBuffer: async () => { reads++; return payload.slice().buffer; } }),
};
// A ZIP reader exposes a byte-range object. Storage must use its bytes, not its wrapper.
const saved = await h.c.processBackupBlobs(zip, manifest, true);
const blob = h.blobs.get("media");
check("hashのない旧ZIPも独立したバイト列で保存", saved.ok === 1 && blob?.size === payload.length && String(new Uint8Array(await blob.arrayBuffer())) === String(payload));
check("manifestのMIMEを保持", blob?.type === "audio/wav");
manifest.blobs[0].sha256 = await h.c.RoutineBackupArchive.sha256Hex(payload.buffer);
reads = 0;
await h.c.processBackupBlobs(zip, manifest, true);
check("ハッシュ照合と保存で同じ読み出しバッファを使用", reads === 1);
const writes = h.writes.length;
zip.blob = async () => ({ size: payload.length, arrayBuffer: async () => new ArrayBuffer(99) });
const rejected = await h.c.processBackupBlobs(zip, manifest, true);
check("表示サイズと実バイト数が違うメディアは保存しない", rejected.failed.length === 1 && h.writes.length === writes);
