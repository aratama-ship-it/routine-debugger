import vm from "node:vm";
import { readFileSync } from "node:fs";
const src = readFileSync(process.argv[2] || new URL("../app.js", import.meta.url), "utf8");
const start = src.indexOf('async function persistPendingRunVideo(');
const end = src.indexOf('\nwindow.cancelRunVideoPostComposition', start);
if (start < 0 || end < start) throw new Error('対象関数が見つかりません');
const pending = { blob: new Blob(['new video']), sessionId: 'session', runId: 'run' };
const run = { videoId: 'old' }, order = []; let saved, snapshotAtDelete;
const c = { pendingRunVideo: pending, state: { runVideos: [{ id: 'old', blobId: 'old' }] },
  uid: () => 'new', blobPut: async () => true, runVideoSavedDelayFields: () => ({}), findRunRecord: () => ({ run }),
  saveState: () => { order.push('save'); },
  flushStateSave: () => { order.push('flush'); saved = { videos: structuredClone(c.state.runVideos), videoId: run.videoId }; },
  removeRunVideo: async () => { order.push('remove'); snapshotAtDelete = saved; },
  clearPendingRunVideo() {}, hideSheet() {}, render() {}, toast() {}, JSON,
};
vm.createContext(c); vm.runInContext(src.slice(start, end), c);
await c.persistPendingRunVideo(pending, 'old');
const ok = snapshotAtDelete?.videos.some((v) => v.id === 'new') && snapshotAtDelete.videoId === 'new' && order.indexOf('flush') < order.indexOf('remove');
console.log(`${ok ? 'ok' : 'FAIL'} 旧映像削除前に新映像と通し記録の参照を保存する`);
if (!ok) process.exitCode = 1;
