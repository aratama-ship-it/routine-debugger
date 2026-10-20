import vm from "node:vm";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
export function harness(target) {
  const blobs = new Map(), sheets = [], toasts = [], writes = [];
  let n = 0;
  const c = { console, Blob, TextEncoder, TextDecoder, Uint8Array, DataView, ArrayBuffer, Map, Set, Date, URL, crypto: webcrypto,
    navigator: {}, location: { protocol: "http:" }, document: { getElementById: () => null, addEventListener() {} },
    setTimeout() {}, addEventListener() {}, localStorage: { getItem: () => null, setItem() {} },
    state: { routines: [{ id: "existing" }], sessions: [], tricks: [], audios: [], runVideos: [] },
    validateBackupShape: (s) => Array.isArray(s.routines) && Array.isArray(s.sessions),
    blobGet: async (id) => blobs.get(id), blobPut: async (id, blob) => { writes.push(id); blobs.set(id, blob); return true; },
    uid: () => `restored-${++n}`, showLoading() {}, hideLoading() {}, loadingMarkup: (s) => s,
    showSheet: (s) => sheets.push(s), toast: (s) => toasts.push(s), esc: (s) => String(s), fmtBytes: (n) => String(n),
    appConfirm: () => true, migrateState() {}, saveState() {}, render() {},
  };
  c.window = c; vm.createContext(c); vm.runInContext(readFileSync(target, "utf8"), c);
  return { c, blobs, sheets, toasts, writes, async zip({ corruptState = false, absent = false, corruptMedia = false, countMismatch = false } = {}) {
    const a = c.RoutineBackupArchive, z = a.createZipBuilder();
    const data = { routines: [{ id: "r1", name: "A", music: { blobId: absent ? "absent" : "one" } }], sessions: [], tricks: [], audios: [], runVideos: [] };
    const text = JSON.stringify(data), manifest = { format: "routine-note-backup", formatVersion: 1, stateSha256: await a.sha256Hex(new TextEncoder().encode(text).buffer), counts: { routines: countMismatch ? 2 : 1, sessions: 0, blobs: 2 }, blobs: [] };
    for (const id of ["one", "two"]) {
      const blob = new Blob([`backup-${id}`], { type: "video/mp4" }), info = await z.addBlob(`blobs/${id}`, blob);
      manifest.blobs.push({ blobId: id, path: `blobs/${id}`, size: info.size, sha256: corruptMedia && id === "two" ? "bad" : info.sha256 });
    }
    z.addText("state.json", corruptState ? text.replace('"A"', '"B"') : text); z.addText("manifest.json", JSON.stringify(manifest)); return z.finish();
  }, load: (file) => c.loadBackupZip(file), input: (file) => ({ files: [file], value: "x" }) };
}
export function check(name, cond) { console.log(`${cond ? "ok" : "FAIL"} ${name}`); if (!cond) process.exitCode = 1; }
