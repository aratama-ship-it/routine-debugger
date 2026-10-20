import vm from "node:vm";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ctx = { window: {}, document: { getElementById: () => null } };
vm.runInNewContext(readFileSync(new URL("../verify-card.js", import.meta.url), "utf8"), ctx);
const { jeffreysInterval, pickWeakestStep, tagCounts } = ctx.window.RoutineVerifyCard;
const plain = (v) => JSON.parse(JSON.stringify(v));
const test = (label, fn) => {
  try { fn(); console.log(`ok ${label}`); }
  catch (e) { console.error(`FAIL ${label}: ${e.stack}`); process.exitCode = 1; }
};
// Independent Beta-density integration. x=sin²(theta) removes the singular
// endpoints at k=0 or k=n; normalization cancels, leaving 2 sin^(2k) cos^(2(n-k)).
function integratedQuantile(k, n, p) {
  const integral = (end) => {
    const m = 20000, h = end / m;
    const f = (theta) => 2 * Math.sin(theta) ** (2 * k) * Math.cos(theta) ** (2 * (n - k));
    let sum = f(0) + f(end);
    for (let j = 1; j < m; j++) sum += (j % 2 ? 4 : 2) * f(j * h);
    return sum * h / 3;
  };
  const total = integral(Math.PI / 2);
  let lo = 0, hi = 1;
  for (let j = 0; j < 40; j++) {
    const mid = (lo + hi) / 2;
    if (integral(Math.asin(Math.sqrt(mid))) / total < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
for (const [k, n] of [[0, 5], [4, 8], [10, 10], [3, 20], [1, 6]]) {
  test(`Jeffreys ${k}/${n} vs Simpson 20000`, () => {
    const result = jeffreysInterval(k, n);
    assert.ok(Math.abs(result.lo - integratedQuantile(k, n, 0.1)) < 0.005);
    assert.ok(Math.abs(result.hi - integratedQuantile(k, n, 0.9)) < 0.005);
    console.log(`  interval ${k}/${n}: ${result.lo.toFixed(6)}–${result.hi.toFixed(6)}`);
  });
}
test("interval monotonicity and custom level", () => {
  for (let k = 1; k <= 10; k++) {
    const a = jeffreysInterval(k - 1, 10), b = jeffreysInterval(k, 10);
    assert.ok(b.lo > a.lo && b.hi > a.hi);
  }
  const a = jeffreysInterval(4, 8), b = jeffreysInterval(4, 8, 0.95);
  assert.ok(b.lo < a.lo && b.hi > a.hi);
});
const ver = { steps: [{ name: "A" }, { name: "B" }] };
const event = (stepIndex, type = "drop", tags = []) => ({ stepIndex, type, tags });
const run = (events = [], reachedIndex = 1) => ({ events, reachedIndex });
test("attempted below 5 / zero failures / empty runs", () => {
  assert.equal(pickWeakestStep(ver, Array.from({ length: 4 }, () => run([event(0)]))), null);
  assert.equal(pickWeakestStep(ver, Array.from({ length: 6 }, () => run())), null);
  assert.equal(pickWeakestStep(ver, []), null);
});
test("equal rate prefers more failures; equal counts prefer smaller index", () => {
  const runs = Array.from({ length: 10 }, (_, i) => run([
    ...(i < 2 ? [event(0)] : []), ...(i >= 5 ? [event(0, "not_attempted")] : []),
    ...(i < 4 ? [event(1)] : []),
  ]));
  assert.equal(pickWeakestStep(ver, runs).index, 1);
  assert.equal(pickWeakestStep(ver, Array.from({ length: 5 }, () => run([event(0), event(1)]))).index, 0);
});
test("excluded / not_attempted / reached / repeated events", () => {
  const runs = [run([event(0), event(0), event(0, "not_attempted")]),
    ...Array.from({ length: 4 }, () => run()), run([event(0, "not_attempted")]),
    run([event(0)], -1), { ...run([event(0)]), excluded: true }];
  assert.deepEqual(plain(pickWeakestStep(ver, runs)),
    { index: 0, step: ver.steps[0], k: 1, n: 5, reached: 6, runsUsed: 7 });
  const snapshot = JSON.stringify(runs);
  pickWeakestStep(ver, runs); tagCounts(runs, 0);
  assert.equal(JSON.stringify(runs), snapshot);
});
test("last 10 non-excluded runs, custom window and minimum", () => {
  const runs = [run([event(0)]), ...Array.from({ length: 10 }, () => run())];
  assert.equal(pickWeakestStep(ver, runs), null);
  assert.equal(pickWeakestStep(ver, runs, 5, 11).runsUsed, 11);
  const recent = [...runs, run([event(1)]), { ...run(), excluded: true }];
  assert.equal(pickWeakestStep(ver, recent).runsUsed, 10);
  assert.equal(pickWeakestStep(ver, recent, 1, 1).index, 1);
});
test("tag counts descending, maximum 3, failure/reach/exclusion filters", () => {
  const runs = [run([event(0, "drop", ["A", "B", "C", "D"])]),
    run([event(0, "drop", ["B", "C"])]), run([event(0, "drop", ["B"])]),
    run([event(0, "not_attempted", ["ignored"]), event(1, "drop", ["ignored"])]),
    { ...run([event(0, "drop", ["ignored"])]), excluded: true },
    run([event(0, "drop", ["ignored"])], -1)];
  assert.deepEqual(plain(tagCounts(runs, 0)), [{ tag: "B", n: 3 }, { tag: "C", n: 2 }, { tag: "A", n: 1 }]);
  assert.deepEqual(plain(tagCounts([], 0)), []);
});
