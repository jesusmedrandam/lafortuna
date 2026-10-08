import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
const root=fileURLToPath(new URL('../',import.meta.url));
const entry=`
import {createElement as h} from 'react';import {createRoot} from 'react-dom/client';
import {V2SessionProvider,useV2Session} from './src/sgb-v2/V2Session';
import {getPropertySettings} from './src/sgb-v2/api';
import {getSessionSnapshot,putSessionSnapshot} from '${root.replaceAll('\\','/')}src/sgb-v2/offline/database.ts';
const user={id:'cached-user',displayName:'Usuario guardado',email:'cached@example.test',isSuperadmin:false};
const context={propertyId:'property-a',roleId:'role-a'};
const overview={user,activeContext:context,supportMode:false,enabledUserModules:[],ownedAccount:null,
  properties:[{id:'property-a',name:'Propiedad guardada',enabledModules:[],roles:[{id:'role-a',code:'OWNER',permissions:['ANIMAL_VIEW']}]}]};
const payload=token=>({user,activeContext:context,accessToken:token,accessExpiresAt:new Date(Date.now()+3600000).toISOString()});
let online=true,nativeCalls=0,networkCalls=0,freshToken='renewed-token-1';const waiting=[];
const respond=(id,status,data)=>window.dispatchEvent(new CustomEvent('sgb-native-auth-response',{detail:{id,status,body:JSON.stringify(status===200?{data}:{error:{code:'UNAUTHORIZED',message:'Sesión inválida'}})}}));
window.SGBAndroid={isOnline:()=>online,isWifiConnected:()=>false,configureOfflineSync(){},clearOfflineSyncSession(){},
  setOfflineUserScope(){},setAutomaticMediaDownloads(){},setAuthenticatedSession(){},
  requestAuthentication:(id,path)=>{nativeCalls++;if(path==='/auth/logout'){setTimeout(()=>respond(id,200,{}),0);return;}waiting.push(id);}};
window.fetch=async(url,init)=>{networkCalls++;const path=new URL(url).pathname;
  if(path.startsWith('/auth/')&&path!=='/auth/me')throw new Error('Android auth must use private native cookie storage');
  if(new Headers(init.headers).get('authorization')!=='Bearer '+freshToken)
    return new Response(JSON.stringify({error:{code:'UNAUTHORIZED',message:'Expired access token'}}),{status:401});
  return new Response(JSON.stringify({data:path==='/auth/me'?overview:{account:{name:'Actualizada'},modules:[]}}),{status:200});};
const root=createRoot(document.getElementById('root'));
function Harness(){window.harness=useV2Session();return h('p',{id:'session-state'},window.harness.ready?(window.harness.session?'Datos locales disponibles':'Sin sesión'):'Cargando');}
const mount=()=>root.render(h(V2SessionProvider,null,h(Harness)));
const check=(value,message)=>{if(!value)throw new Error(message);};const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
async function until(condition){for(let n=0;n<150;n++){if(condition())return;await tick();}throw new Error('Timeout: '+condition.toString());}
try{
  await putSessionSnapshot(user.id,{...payload('expired-token'),accessExpiresAt:'2026-01-01T00:00:00Z',overview});
  mount();await until(()=>window.harness?.ready&&waiting.length===1);
  check(document.getElementById('session-state').textContent==='Datos locales disponibles','Saved session opens before network refresh finishes');
  check(nativeCalls===1&&networkCalls===0,'Startup does not block on overview request');
  respond(waiting.shift(),200,payload(freshToken));await until(()=>window.harness.session?.accessToken===freshToken);
  check((await getSessionSnapshot()).payload.accessToken===freshToken,'Renewed session persists in IndexedDB');
  const results=await Promise.all([getPropertySettings('expired-token'),getPropertySettings('expired-token')]);
  check(results.every(result=>result.account.name==='Actualizada'),'Stale access requests retry automatically with fresh credentials');
  check(nativeCalls===1,'Concurrent stale requests share renewal and do not rotate cookies twice');
  window.dispatchEvent(new Event('sgb-app-resumed'));window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));
  await until(()=>waiting.length===1);check(nativeCalls===2,'Resume/focus/network share one refresh');
  freshToken='renewed-token-2';respond(waiting.shift(),200,payload(freshToken));await until(()=>window.harness.session?.accessToken===freshToken);
  online=false;window.dispatchEvent(new Event('sgb-app-resumed'));await tick();check(nativeCalls===2,'Offline resume preserves local session without network');
  root.render(h('div'));await tick();online=false;mount();await until(()=>window.harness?.ready&&window.harness.session?.accessToken===freshToken);
  check(nativeCalls===2,'Offline cold restart uses the saved session');
  online=true;window.dispatchEvent(new Event('online'));await until(()=>waiting.length===1);
  await window.harness.signOut();respond(waiting.shift(),200,payload('late-token'));await tick();await tick();
  check(window.harness.session===null&&(await getSessionSnapshot())===null,'Late refresh cannot restore a signed-out account');
  document.getElementById('result').textContent='PASS: real API/native auth bridge, nonblocking cached startup, automatic 401 renewal, deduplication, resume/offline restart and logout race';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack;}
`;
const result=await build({root,configFile:false,logLevel:'error',define:{'process.env.NODE_ENV':'"production"','import.meta.env.VITE_API_URL':'"https://appsgb.onrender.com"'},plugins:[{
  name:'session-startup-test',enforce:'pre',resolveId(id,importer){importer=importer?.replaceAll('\\','/');
    if(id==='session-startup-test'||id===root+'session-startup-test')return '\0session-startup-test';
    if(id.endsWith('/V2Session'))return root.replaceAll('\\','/')+'src/sgb-v2/V2Session.tsx';
    if(id==='./src/sgb-v2/api'||id==='./api'&&importer?.includes('/src/sgb-v2/'))return root.replaceAll('\\','/')+'src/sgb-v2/api.ts';
    if(importer==='\0session-startup-test'&&id.startsWith('./src/'))return root+id.slice(2)+'.tsx';
  },load(id){if(id==='\0session-startup-test')return entry;},
}],build:{write:false,minify:false,lib:{entry:'session-startup-test',formats:['es'],fileName:'test'},rolldownOptions:{output:{codeSplitting:false}}}});
const code=(Array.isArray(result)?result[0]:result).output.find(item=>item.type==='chunk').code;
const css=(await Promise.all(['src/styles/global.css','src/sgb-v2/shell.css','src/sgb-v2/v2.css']
  .map(path=>readFile(join(root,path),'utf8')))).join('\n');
const page='<meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style><div id="root"></div><pre id="result">PENDING</pre><script>'+ 
  'const report=e=>document.getElementById("result").textContent="FAIL: "+(e.message??e.reason);'+
  'window.addEventListener("error",report);window.addEventListener("unhandledrejection",report);'+
  '</script><script type="module">'+code.replaceAll('</script','<\\/script')+'</script>';
const server=createServer((_request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(page);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const temporary=await mkdtemp(join(tmpdir(),'sgb-session-startup-'));
let browser;let socket;
try{
  const chrome=process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser=spawn(chrome,['--headless','--disable-gpu','--no-first-run',
    '--no-default-browser-check','--disable-background-networking','--disable-component-update',
    '--user-data-dir='+join(temporary,'profile'),'--remote-debugging-port=0','about:blank'],{windowsHide:true,stdio:'ignore'});
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let port;
  for(let attempt=0;attempt<100;attempt++){try{port=(await readFile(join(temporary,'profile','DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await pause(50);}}
  assert.ok(port,'Chrome did not start');
  const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0;const pending=new Map();
  socket.addEventListener('message',event=>{const response=JSON.parse(event.data);if(response.id){const handler=pending.get(response.id);
    if(handler){pending.delete(response.id);response.error?handler.reject(new Error(response.error.message)):handler.resolve(response.result);}}});
  const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  await command('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:1,mobile:true});
  await command('Emulation.setTouchEmulationEnabled',{enabled:true});
  await command('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
  let outcome='PENDING';
  for(let attempt=0;attempt<300;attempt++){
    const response=await command('Runtime.evaluate',{expression:'document.getElementById("result")?.textContent',returnByValue:true});
    outcome=response.result?.value??'PENDING';if(outcome.startsWith('PASS:')||outcome.startsWith('FAIL:'))break;await pause(50);
  }
  assert.ok(outcome.startsWith('PASS:'),outcome);console.log(outcome);
  await command('Browser.close');
}finally{socket?.close();browser?.kill();server.close();await rm(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:200});}

