import { harness, check } from "./backup-test-harness.mjs";
const h = harness(process.argv[2] || new URL("../backup-archive.js", import.meta.url));
let threw = false; try { await h.load(await h.zip({ corruptState: true })); } catch (e) { threw = /state.json/.test(e.message); }
check("state.jsonの1バイト改変を拒否", threw);
const absent = await h.zip({ absent: true }); await h.c.verifyFullBackup(h.input(absent));
check("参照メディア欠落は注意", /復元できます（注意あり）/.test(h.sheets.at(-1)) && /メディア 1 件/.test(h.sheets.at(-1)));
await h.c.importFullBackup(h.input(absent)); check("参照メディア欠落でも記録を復元", h.c.state.routines[0].id === "r1");
await h.c.verifyFullBackup(h.input(await h.zip())); check("正常ZIPは復元可能・全件照合済み", /このバックアップは復元できます/.test(h.sheets.at(-1)) && /全ファイルの照合値が一致しました/.test(h.sheets.at(-1)));
await h.c.verifyFullBackup(h.input(await h.zip({ countMismatch: true }))); check("件数不一致は注意", /復元できます（注意あり）/.test(h.sheets.at(-1)));
const zip = await h.zip(); h.c.RoutineBackupArchive.sha256Hex = async () => null;
check("SHA利用不可をstateUnverifiedで返す", (await h.load(zip)).stateUnverified === true);
await h.c.verifyFullBackup(h.input(zip)); check("未照合を全件一致と表示しない", !/全ファイルの照合値が一致しました/.test(h.sheets.at(-1)));
