import vm from "node:vm";
import { readFileSync } from "node:fs";
const source = readFileSync(process.argv[2] || new URL("../editor-time.js", import.meta.url), "utf8");
let observed = false, error;
const c = { window: { addEventListener() {} }, document: { addEventListener() {}, getElementById: () => ({}) },
  MutationObserver: class { observe() { observed = true; } }, setTimeout() {} };
try { vm.runInNewContext(source, c); } catch (e) { error = e; }
console.log(`${error ? "FAIL" : "ok"} view定義前でも起動する${error ? ': '+error.message : ''}`);
console.log(`${observed ? "ok" : "FAIL"} MutationObserverを登録する`);
if (error || !observed) process.exitCode = 1;
