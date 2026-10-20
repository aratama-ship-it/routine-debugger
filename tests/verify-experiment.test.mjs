import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { harness } from './sync-test-harness.mjs';
const source = readFileSync(new URL('../verify-experiment.js', import.meta.url), 'utf8');
const env = harness(new URL('../sync.js', import.meta.url));
const c = env.c;
c.latestVersion = rt => rt.versions.at(-1);
const context = vm.createContext(c);
vm.runInContext(source, context);
const xp = c.RoutineExperiment;
const plain = o => JSON.parse(JSON.stringify(o));
function test(name, fn) { try { fn(); console.log('ok ' + name); } catch (e) { console.error('FAIL ' + name, e); process.exitCode = 1; } }
const pairs = [{ order: 'HC' }, { order: 'CH' }, { order: 'HC' }];
const plan = { id: 'xp', stepId: 'b', stepIndex: 1, versionId: 'v1', intervention: 'gap', createdAt: 1 };
const clean = () => ({ reachedIndex: 1, events: [] });
const failed = () => ({ reachedIndex: 1, events: [{ stepIndex: 1, type: 'drop' }] });
const session = runs => ({ experiment: { ...plan, pairs: plain(pairs) }, runs });
const support = () => session([clean(), failed(), failed(), clean(), clean(), failed()]);
const against = () => session([failed(), clean(), clean(), failed(), failed(), clean()]);
test('makePairs: independent draws, deterministic, three valid orders', () => {
 let n = 0; const draws = [.1, .9, .49];
 assert.deepEqual(plain(xp.makePairs(() => draws[n++])), pairs); assert.equal(n, 3);
 assert.deepEqual(plain(xp.makePairs(() => .5)), Array(3).fill({ order: 'CH' }));
 assert.deepEqual(plain(xp.makePairs(() => .1)), plain(xp.makePairs(() => .1)));
 assert.equal(xp.makePairs().length, 3);
});
test('schedule: HC / CH expand into six conditions', () => assert.deepEqual(plain(xp.schedule(pairs)), ['H','C','C','H','H','C']));
test('assignConditions: first six, idempotence, no experiment untouched', () => {
 const s = session(Array.from({ length: 7 }, clean));
 assert.equal(xp.assignConditions(s), true); const after = JSON.stringify(s);
 assert.equal(xp.assignConditions(s), false); assert.equal(JSON.stringify(s), after);
 assert.equal(Object.hasOwn(s.runs[6], 'condition'), false);
 assert.deepEqual(s.runs.slice(0,6).map(r => r.condition), ['H','C','C','H','H','C']);
 const old = { runs: [clean()] }, before = JSON.stringify(old);
 assert.equal(xp.assignConditions(old), false); assert.equal(JSON.stringify(old), before);
});
test('evaluate: support / against / tie and no mutation', () => {
 const s = support(), before = JSON.stringify(s);
 assert.equal(xp.evaluate(s).support, 3); assert.equal(JSON.stringify(s), before);
 assert.equal(xp.evaluate(against()).against, 3);
 assert.equal(xp.evaluate(session(Array.from({length: 6},clean))).tie, 3);
 assert.deepEqual(plain(xp.evaluate(s).pairs[1]), { order:'CH', h:'clean', c:'failed', verdict:'support' });
});
test('evaluate: unreached, not_attempted only, missing run are incomplete', () => {
 for (const run of [{ reachedIndex: 0, events: [] }, { reachedIndex: 1, events: [{stepIndex:1,type:'not_attempted'}] }, undefined]) {
  const r = xp.evaluate(session(run ? [clean(), run] : [clean()]));
  assert.equal(r.completed, 0); assert.equal(r.pairs[0].verdict, 'incomplete');
 }
 const run = failed(); run.events.push({stepIndex:1,type:'not_attempted'});
 assert.equal(xp.evaluate(session([clean(),run])).support,1);
 const other = clean(); other.events.push({stepIndex:0,type:'drop'});
 assert.equal(xp.evaluate(session([other,clean()])).tie,1);
});
test('evidenceLevel: all thresholds and replicated sign checks', () => {
 assert.equal(xp.evidenceLevel([]), 'insufficient');
 assert.equal(xp.evidenceLevel([session([])]), 'insufficient');
 assert.equal(xp.evidenceLevel([session(support().runs.slice(0,2))]), 'pattern');
 assert.equal(xp.evidenceLevel([session(support().runs.slice(0,4))]), 'pattern');
 assert.equal(xp.evidenceLevel([support()]), 'compared');
 assert.equal(xp.evidenceLevel([support(),support()]), 'replicated');
 assert.equal(xp.evidenceLevel([against(),against()]), 'replicated');
 assert.equal(xp.evidenceLevel([support(),against()]), 'compared');
 assert.equal(xp.evidenceLevel([support(),session(Array.from({length:6},clean))]), 'compared');
 assert.equal(xp.evidenceLevel([support(),support(),against()]), 'compared');
});
test('save wrapper: copy plan before save, no recursion, skip existing/ended/nonempty', () => {
 c.state.routines = [{ id:'r', experiment:plain(plan), versions:[{id:'v1',steps:[{id:'a'},{id:'b'}]}] }];
 c.state.sessions = [
  { id:'new', routineId:'r', versionId:'v1', endedAt:null, runs:[] },
  { id:'old', routineId:'r', versionId:'v1', endedAt:null, runs:[clean()] },
  { id:'ended', routineId:'r', versionId:'v1', endedAt:2, runs:[] },
  { id:'other', routineId:'other', versionId:'v1', runs:[] }
 ];
 // Original save in harness records calls.
 const count = env.order.length; c.saveState(); assert.equal(env.order.length,count+1);
 const s = c.state.sessions[0]; assert.equal(s.experiment.id,'xp'); assert.equal(s.experiment.pairs.length,3);
 assert.equal(Object.hasOwn(s.experiment,'createdAt'),false);
 for (const old of c.state.sessions.slice(1)) assert.equal(old.experiment,undefined);
 const fixed = s.experiment; c.saveState(); assert.equal(s.experiment,fixed);
 s.runs.push(clean()); c.saveState(); assert.equal(s.runs[0].condition,xp.schedule(fixed.pairs)[0]);
 assert.equal(c.state.routines[0].versions[0].steps.length,2);
});
test('save wrapper: changed version or moved target is not copied', () => {
 const rt = c.state.routines[0];
 for (const steps of [[{id:'b'},{id:'a'}], [{id:'a'}]]) {
  rt.versions[0].steps = steps;
  const s = {routineId:'r',versionId:'v1',runs:[]}; c.state.sessions.push(s); c.saveState(); assert.equal(s.experiment,undefined);
 }
 rt.versions[0].steps = [{id:'a'},{id:'b'}];
 rt.versions.push({id:'v2',steps:[{id:'a'},{id:'b'}]});
 const s = {routineId:'r',versionId:'v2',runs:[]}; c.state.sessions.push(s); c.saveState(); assert.equal(s.experiment,undefined);
 rt.versions.pop();
});
test('save wrappers: sync loaded afterwards also schedules, sends added fields intact', () => {
 vm.runInContext(readFileSync(new URL('../sync.js',import.meta.url),'utf8'), context);
 const s = {id:'with-sync',routineId:'r',versionId:'v1',runs:[]}; c.state.sessions.push(s);
 const count = env.order.length; const timers = env.timers.length;
 c.saveState(); assert.equal(env.order.length,count+1); assert.ok(s.experiment);
 assert.equal(env.timers.length,timers+1); assert.equal(env.timers.at(-1).ms,4000);
 s.runs.push(clean()); c.saveState(); assert.ok(['H','C'].includes(s.runs[0].condition));
});
await env.settle();
await c.runSyncNow();
test('sync body roundtrip retains experiment and run.condition', () => {
 const body = env.rows.get('with-sync').body;
 assert.equal(body.experiment.id,'xp'); assert.ok(['H','C'].includes(body.runs[0].condition));
});
