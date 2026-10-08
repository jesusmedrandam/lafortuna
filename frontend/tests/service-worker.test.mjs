import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const handlers=new Map();
const cached=new Map();
let network;
let calls=0;
const cache={put:async(key,response)=>cached.set(typeof key==='string'?key:key.url,response.clone())};
vm.runInNewContext(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'),{
  URL,Response,
  self:{location:{origin:'https://sgb.test'},addEventListener:(name,handler)=>handlers.set(name,handler)},
  caches:{match:async key=>cached.get(typeof key==='string'?key:key.url)?.clone(),open:async()=>cache},
  fetch:async request=>{calls++;return network(request);},
});
async function request(path,options={}){
  let response;const tasks=[];
  handlers.get('fetch')({request:{url:new URL(path,'https://sgb.test').href,method:'GET',mode:'navigate',...options},
    respondWith:promise=>response=promise,waitUntil:promise=>tasks.push(promise)});
  const result=await response;await Promise.all(tasks);return result;
}
cached.set('/index.html',new Response('old'));
network=async()=>new Response('new');
assert.equal(await(await request('/?change-email=example')).text(),'new','Online navigation must use the published interface');
assert.equal(await cached.get('/index.html').clone().text(),'new','Refresh the offline page');
network=async()=>{throw new Error('Offline');};
assert.equal(await(await request('/potreros')).text(),'new','Keep offline navigation');
network=async()=>new Response('Unavailable',{status:503});
assert.equal(await(await request('/')).text(),'new','Use the saved page during a server outage');
cached.clear();
assert.equal((await request('/')).status,503,'Report unavailable when no offline page exists');
const before=calls;
assert.equal(await request('https://api.sgb.test/auth',{mode:'cors'}),undefined);
assert.equal(await request('/auth',{method:'POST'}),undefined);
assert.equal(calls,before,'Do not intercept API calls or mutations');
cached.set('https://sgb.test/assets/app.js',new Response('saved script'));
assert.equal(await(await request('/assets/app.js',{mode:'cors'})).text(),'saved script');
assert.equal(calls,before,'Keep fingerprinted assets available offline');
console.log('PASS: published interface on online navigation, offline fallback and API isolation');
