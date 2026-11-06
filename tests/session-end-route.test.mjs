import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function section(start,end) {
  const at=source.indexOf(start); assert(at>=0,start);
  const to=source.indexOf(end,at); assert(to>at,end); return source.slice(at,to);
}
function setup({miss=false,video=false,defer=false}={}) {
  const rt={id:'r',versions:[{steps:[{},{}]}]},sess={runs:[]};
  let release;
  const gate=defer?new Promise(resolve=>{release=resolve;}):Promise.resolve();
  const c={state:{routines:[rt]},view:{name:'record',params:{id:'r'}},openRun:miss?{routineId:'r',events:[{type:'drop_continue',stepIndex:0}]}:null,
    activeFullRunRoutineId:'r',pendingRunVideo:null,sheet:'',messages:[],Date,uid:()=> 'run-1',
    activeSession:()=>sess,latestVersion:()=>rt.versions[0],currentChoices:()=>undefined,
    fullRunIsActive:id=>c.activeFullRunRoutineId===id,musicResetForNextRun(){},saveState(){},render(){},
    toast:m=>c.messages.push(m),showSheet:html=>{c.sheet=html;},hideSheet:()=>{c.sheet='';},
    stopRunVideoCapture:async()=>{await gate;if(video){c.pendingRunVideo={blob:'owned fixture'};c.sheet='<h3>通し練習の映像</h3>';}}};
  c.window=c;vm.createContext(c);
  vm.runInContext(section('window.recordClean =','let pendingCapture =')+section('window.endSessionAsk =','window.abandonActiveRun ='),c);
  c.endSessionAsk('r');assert.match(c.sheet,/完走しましたか/);
  const handler=c.sheet.match(/<button class="btn primary" onclick="([^"]+)"/)[1];
  return {c,sess,release,click:()=>vm.runInContext(handler,c)};
}
const cases=[
  ['no-miss run advances to reflection without another exit tap',async()=>{
    const h=setup();await h.click();assert.equal(h.sess.runs.length,1);assert.equal(h.sess.runs[0].outcome,'clean');assert.match(h.c.sheet,/セッション終了/);assert.doesNotMatch(h.c.sheet,/完走しましたか/);
  }],
  ['run with misses keeps events and advances to reflection',async()=>{
    const h=setup({miss:true});await h.click();assert.equal(h.sess.runs.length,1);assert.equal(h.sess.runs[0].events[0].type,'drop_continue');assert.match(h.c.sheet,/セッション終了/);
  }],
  ['video review remains available before session reflection',async()=>{
    const h=setup({video:true});await h.click();assert.equal(h.sess.runs.length,1);assert.match(h.c.sheet,/通し練習の映像/);assert.doesNotMatch(h.c.sheet,/セッション終了/);
  }],
  ['confirmation closes while capture finishes; reflection waits',async()=>{
    const h=setup({defer:true});const pending=h.click();assert.equal(h.c.sheet,'');assert.equal(h.sess.runs.length,1);h.release();await pending;assert.match(h.c.sheet,/セッション終了/);
  }],
  ['finishing asynchronously does not pull a different view back',async()=>{
    const h=setup({defer:true});const pending=h.click();h.c.view={name:'settings',params:{}};h.c.sheet='other view';h.release();await pending;assert.equal(h.c.sheet,'other view');
  }],
  ['returning to practice leaves the run unrecorded',async()=>{
    const h=setup();const no=h.c.sheet.match(/<button class="btn ghost" onclick="([^"]+)"/)[1];vm.runInContext(no,h.c);assert.equal(h.sess.runs.length,0);assert.equal(h.c.activeFullRunRoutineId,'r');assert.equal(h.c.sheet,'');
  }],
];
for(const [name,test] of cases){try{await test();console.log('PASS '+name);}catch(error){console.error('FAIL '+name+': '+error.message);process.exitCode=1;}}
