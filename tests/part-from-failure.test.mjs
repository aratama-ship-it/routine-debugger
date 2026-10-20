import vm from "node:vm";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const context = {
  window: {}, stepDur: (s) => Number(s.dur) || 0,
  document: { getElementById: () => null },
};
vm.runInNewContext(readFileSync(new URL("../part-from-failure.js", import.meta.url), "utf8"), context);
const range = (steps, i, dur = null) => JSON.parse(JSON.stringify(context.window.partRangeAroundStep({ steps }, i, dur)));
const cases = [
  ["中間: 前のcueから次の終端まで", () => assert.deepEqual(range([{ cue: 10 }, { cue: 20, dur: 3 }, { cue: 30, dur: 4 }], 1), { a: 10, b: 34 })],
  ["先頭: cue-2、0より前にしない", () => {
    assert.deepEqual(range([{ cue: 5, dur: 2 }], 0), { a: 3, b: 9 });
    assert.deepEqual(range([{ cue: 1, dur: 2 }], 0), { a: 0, b: 5 });
  }],
  ["末尾: 有効曲長の0.05秒手前以降は曲末", () => {
    assert.deepEqual(range([{ cue: 8 }, { cue: 12, dur: 6 }], 1, 20), { a: 8, b: null });
    assert.equal(range([{ cue: 12, dur: 5.96 }], 0, 20).b, null);
    assert.equal(range([{ cue: 12, dur: 5.9 }], 0, 20).b, 19.9);
  }],
  ["cue無し・対象無しはnull", () => {
    assert.equal(range([{ dur: 2 }], 0), null);
    assert.equal(range([{ cue: null }], 0), null);
    assert.equal(range([], 0), null);
  }],
  ["b<=aは曲末", () => assert.deepEqual(range([{ cue: 30 }, { cue: 10 }, { cue: 20, dur: 2 }], 1), { a: 30, b: null })],
  ["0.1秒に丸め、丸め後のb<=aも確認", () => {
    assert.deepEqual(range([{ cue: 1.26 }, { cue: 2.55 }, { cue: 3.34, dur: 0.02 }], 1), { a: 1.3, b: 3.4 });
    assert.equal(range([{ cue: 3.31 }, { cue: 2 }, { cue: 3.32 }], 1).b, null);
  }],
];
for (const [label, test] of cases) {
  try { test(); console.log(`ok ${label}`); }
  catch (error) { console.error(`FAIL ${label}: ${error.message}`); process.exitCode = 1; }
}
