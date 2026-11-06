import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../sample-music.js',import.meta.url),'utf8');
const bytes=new Uint8Array([73,68,51,4,0,1]);
function harness(href, native=true, status=0, body=new Blob([bytes])) {
  let reads=0;
  const c=vm.createContext({URL,Blob,location:new URL(href),window:{Capacitor:{isNativePlatform:()=>native}},
    fetch:async()=>({ok:status>=200&&status<300,status,redirected:false,blob:async()=>{reads++;return body;}})});
  vm.runInContext(source,c);return {c,reads:()=>reads};
}
let count=0;
async function check(name,fn){await fn();console.log('PASS',name);count++;}
await check('native status 0 preserves media bytes and MIME',async()=>{
 const h=harness('capacitor://localhost/index.html');
 const b=await h.c.fetchSampleAsset('samples/spiral-of-light.mp3');
 assert.equal(h.c.canLoadSampleAssets(),true);assert.equal(b.type,'audio/mpeg');
 assert.deepEqual(new Uint8Array(await b.arrayBuffer()),bytes);assert.equal(h.reads(),1);
});
await check('native sample video preserves bytes with video MIME',async()=>{
 const b=await harness('capacitor://localhost/').c.fetchSampleAsset('samples/demo.mp4');assert.equal(b.type,'video/mp4');
});
for(const path of ['https://other.example/samples/demo.mp3','capacitor://other/samples/demo.mp3','samples/../private.mp3','_capacitor_file_/private/demo.mp3','samples/demo.mp3?other=1','samples/demo.mp3#x','samples/page.html']) {
 await check('reject status 0 outside bundled sample path: '+path,async()=>{
  const h=harness('capacitor://localhost/');assert.equal(await h.c.fetchSampleAsset(path),null);assert.equal(h.reads(),0);
 });
}
await check('web status 0 remains rejected',async()=>{
 const h=harness('https://routine.example/',false);assert.equal(await h.c.fetchSampleAsset('samples/demo.mp3'),null);assert.equal(h.reads(),0);
});
await check('native 404 remains rejected',async()=>{
 const h=harness('capacitor://localhost/',true,404);assert.equal(await h.c.fetchSampleAsset('samples/demo.mp3'),null);assert.equal(h.reads(),0);
});
await check('HTTP success and MIME remain unchanged',async()=>{
 const b=new Blob([bytes],{type:'audio/mpeg'}),h=harness('https://routine.example/',false,200,b);
 assert.equal(await h.c.fetchSampleAsset('samples/demo.mp3'),b);assert.equal(h.c.canLoadSampleAssets(),true);
});
await check('missing native runtime and file URLs are not enabled',async()=>{
 assert.equal(harness('capacitor://localhost/',false).c.canLoadSampleAssets(),false);
 assert.equal(harness('file:///app/index.html').c.canLoadSampleAssets(),false);
});
await check('empty and HTML fallbacks are rejected',async()=>{
 for(const b of [new Blob([]),new Blob(['<html>'],{type:'text/html'})])assert.equal(await harness('capacitor://localhost/',true,0,b).c.fetchSampleAsset('samples/demo.mp3'),null);
});
console.log(`${count} asset-boundary checks passed`);
