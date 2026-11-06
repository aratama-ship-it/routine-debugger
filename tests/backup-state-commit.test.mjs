import { harness, check } from "./backup-test-harness.mjs";
const source = process.argv[2] || new URL("../backup-archive.js", import.meta.url);
const failed = harness(source), prior = failed.c.state;
let saves = 0;
failed.c.saveState = () => { saves++; };
failed.c.db = { transaction() { throw Error("quota"); } };
failed.c.localStorage.setItem = () => { throw Error("quota"); };
await failed.c.importFullBackup(failed.input(await failed.zip()));
check("記録の両保存先が失敗したら現行stateを維持", failed.c.state === prior);
check("保存失敗で成功表示・同期通知を出さない", saves === 0 && !failed.sheets.some(s => /<h3>復元しました/.test(s)));

const delayed = harness(source), old = delayed.c.state;
let written, tx, notifyPut, updates = 0;
const put = new Promise(resolve => { notifyPut = resolve; });
delayed.c.localStorage.setItem = () => { throw Error("quota"); };
delayed.c.db = { transaction() { tx = { objectStore: () => ({ put: value => { written = value; notifyPut(); } }) }; return tx; } };
delayed.c.saveState = () => { updates++; };
const work = delayed.c.importFullBackup(delayed.input(await delayed.zip()));
// Old code never starts a state transaction; fail promptly instead of hanging the suite.
const started = await Promise.race([put.then(() => true), work.then(() => false)]);
check("記録の永続化transactionを開始", started);
if (started) {
  check("transaction完了前は現行state・画面・同期を維持", delayed.c.state === old && updates === 0 && delayed.sheets.length === 0);
  tx.oncomplete(); await work;
  check("transaction完了後だけ復元結果を公開", delayed.c.state === written && updates === 1 && delayed.sheets.some(s => /<h3>復元しました/.test(s)));
}

const migration = harness(source), before = migration.c.state;
migration.c.migrateState = () => { throw Error("migration fault"); };
await migration.c.importFullBackup(migration.input(await migration.zip()));
check("形式変換の失敗でも現行stateを維持", migration.c.state === before);
