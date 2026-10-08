import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
const root=fileURLToPath(new URL('../',import.meta.url));
const mockApi=`
export class ApiRequestError extends Error{}
const user={id:'admin-user',displayName:'Administrador',email:'admin@example.test',isSuperadmin:true};
const own={id:'own-property',name:'Mi propiedad',enabledModules:[],enabledSpecies:['BOVINE'],roles:[
  {id:'owner-role',code:'OWNER',name:'Propietario',permissions:['ANIMAL_VIEW','ANIMAL_UPDATE']},
  {id:'viewer-role',code:'VIEWER',name:'Consulta',permissions:['ANIMAL_VIEW']}]};
let activeContext={propertyId:own.id,roleId:'owner-role'},supportMode=false,saved=null;
const payload=()=>({accessToken:'test',accessExpiresAt:new Date(Date.now()+86400000).toISOString(),user,activeContext});
window.contextCalls=[];window.supportCalls=[];
export const refreshSession=async()=>payload();export const login=async()=>payload();export const logout=async()=>{};
export const updateUserProfile=async(_token,input)=>Object.assign(user,input);
export const getSessionOverview=async()=>({user,activeContext,supportMode,
  supportOwner:supportMode?{id:'foreign-owner',name:'Otro usuario',email:'other@example.test'}:null,
  supportAccountId:supportMode?'foreign-account':null,memberProperties:[own],properties:supportMode?
  [own,{id:activeContext.propertyId,name:'Propiedad en soporte',enabledModules:[],enabledSpecies:[],
    roles:[{id:activeContext.roleId,code:'SUPERADMIN',name:'Sistema · soporte',permissions:['ANIMAL_VIEW','ANIMAL_UPDATE']}]}]:[own],
  enabledUserModules:[],ownedAccount:null});
export const changeContext=async(_token,propertyId,roleId)=>{window.contextCalls.push({propertyId,roleId});
  if(propertyId!==own.id||!own.roles.some(role=>role.id===roleId))throw new Error('Membership required');
  activeContext={propertyId,roleId};supportMode=false;saved=null;return activeContext;};
export const beginPropertySupport=async(_token,accountId,propertyId)=>{window.supportCalls.push({accountId,propertyId});
  if(!supportMode)saved=activeContext;activeContext={propertyId,roleId:'support-role'};supportMode=true;return activeContext;};
export const endPropertySupport=async()=>{if(supportMode)activeContext=saved;supportMode=false;saved=null;};
export const getPropertyTeam=async()=>({});export const createPropertyInvitation=async()=>{};
export const revokePropertyInvitation=async()=>{};export const updateMembershipStatus=async()=>{};
`;
const entry=`
import {createElement as h} from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';
import {V2SessionProvider,useV2Session} from './src/sgb-v2/V2Session';
import {RolesPermissionsPage} from './src/sgb-v2/RolesPermissionsPage';
import {getSessionSnapshot,putSessionSnapshot} from '${root.replaceAll('\\','/')}src/sgb-v2/offline/database.ts';
window.nativeScopes=[];window.nativeClears=0;window.SGBAndroid={isOnline:()=>!window.testOffline,isWifiConnected:()=>false,
  configureOfflineSync:(...args)=>window.nativeScopes.push(args),clearOfflineSyncSession:()=>window.nativeClears++,setAutomaticMediaDownloads(){}};
function Harness(){const session=useV2Session();window.sessionHarness=session;
  return session.ready&&session.session?h(RolesPermissionsPage):h('p',null,'Cargando');}
const reactRoot=createRoot(document.getElementById('root'));
reactRoot.render(h(BrowserRouter,null,h(V2SessionProvider,null,h(Harness))));
const check=(value,message)=>{if(!value)throw new Error(message);};const tick=()=>new Promise(resolve=>setTimeout(resolve,30));
async function until(condition){for(let n=0;n<150;n++){if(condition())return;await tick();}throw new Error('Timeout: '+condition.toString());}
try{
  await until(()=>window.sessionHarness?.ready&&document.querySelector('.roles-permissions-page'));
  check(window.sessionHarness.session.overview.supportMode===false&&window.supportCalls.length===0,'Login never implicitly starts support');
  await window.sessionHarness.saveProfile({displayName:'Nombre nuevo',profilePhoto:'data:image/webp;base64,dGVzdA=='});await tick();
  check(window.sessionHarness.session.user.displayName==='Nombre nuevo'&&window.sessionHarness.session.overview.user.displayName==='Nombre nuevo','Profile updates both user representations');
  check((await getSessionSnapshot()).payload.overview.user.profilePhoto==='data:image/webp;base64,dGVzdA==','Saved profile photo persists in offline session snapshot');
  document.querySelectorAll('.sgb-select-button')[1].click();await tick();
  [...document.querySelectorAll('[role="option"]')].find(node=>node.textContent==='Consulta').click();await tick();
  [...document.querySelectorAll('button')].find(node=>node.textContent==='Usar este rol').click();
  await until(()=>window.sessionHarness.session.overview.activeContext.roleId==='viewer-role');
  check(window.supportCalls.length===0&&!window.sessionHarness.hasPermission('ANIMAL_UPDATE'),'Normal role stays read-only for superadministrator');
  await window.sessionHarness.beginSupport('foreign-account','foreign-property');await tick();
  check(window.sessionHarness.session.overview.supportMode&&window.sessionHarness.hasPermission('ANIMAL_UPDATE'),'Explicit support grants permissions');
  document.querySelectorAll('.sgb-select-button')[0].click();await tick();
  check(![...document.querySelectorAll('[role="option"]')].some(node=>node.textContent.includes('Propiedad en soporte')),'Support-only property excluded from normal roles');
  [...document.querySelectorAll('[role="option"]')].find(node=>node.textContent==='Mi propiedad').click();await tick();
  await window.sessionHarness.endSupport();await tick();
  check(window.sessionHarness.session.overview.activeContext.roleId==='viewer-role'&&!window.sessionHarness.hasPermission('ANIMAL_UPDATE'),'End support restores previous normal role');
  check(window.sessionHarness.session.activeContext.roleId==='viewer-role','Payload and overview contexts agree');
  const snapshot=await getSessionSnapshot();check(!snapshot.payload.overview.supportMode&&snapshot.payload.activeContext.roleId==='viewer-role','Restored role persists in IndexedDB');
  await window.sessionHarness.beginSupport('foreign-account','foreign-property');await tick();
  await window.sessionHarness.selectContext('own-property','owner-role');await tick();
  check(!window.sessionHarness.session.overview.supportMode&&window.sessionHarness.hasPermission('ANIMAL_UPDATE'),'Own role exits support and allows normal edits');
  check(window.nativeClears>=2,'Support disables native background sync');
  check(document.documentElement.scrollWidth<=window.innerWidth,'Mobile role picker does not overflow');
  const legacy=await getSessionSnapshot();delete legacy.payload.overview.supportMode;
  await putSessionSnapshot(legacy.userId,legacy.payload);window.testOffline=true;
  reactRoot.render(h(BrowserRouter,null,h(V2SessionProvider,{key:'legacy'},h(Harness))));await tick();
  await until(()=>window.sessionHarness.ready&&!window.sessionHarness.session);
  check(window.sessionHarness.error?.includes('Conéctate'),'Legacy administrator permissions must refresh before offline use');
  document.getElementById('result').textContent='PASS: real session provider, explicit support, member-only roles, restored permissions and IndexedDB snapshot';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack;}
`;
const result=await build({root,configFile:false,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
  name:'session-mode-test',enforce:'pre',resolveId(id,importer){importer=importer?.replaceAll('\\','/');
    if(id==='session-mode-test'||id===root+'session-mode-test')return '\0session-mode-test';
    if(id.endsWith('/V2Session'))return root.replaceAll('\\','/')+'src/sgb-v2/V2Session.tsx';
    if(id==='./api'&&importer?.includes('/src/sgb-v2/'))return '\0session-mode-api';
    if(importer==='\0session-mode-test'&&id.startsWith('./src/'))return root+id.slice(2)+'.tsx';
  },load(id){if(id==='\0session-mode-test')return entry;if(id==='\0session-mode-api')return mockApi;},
}],build:{write:false,minify:false,lib:{entry:'session-mode-test',formats:['es'],fileName:'test'},rolldownOptions:{output:{codeSplitting:false}}}});
const code=(Array.isArray(result)?result[0]:result).output.find(item=>item.type==='chunk').code;
const css=(await Promise.all(['src/styles/global.css','src/sgb-v2/shell.css','src/sgb-v2/v2.css']
  .map(path=>readFile(join(root,path),'utf8')))).join('\n');
const page='<meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style><div id="root"></div><pre id="result">PENDING</pre><script>'+ 
  'const report=e=>document.getElementById("result").textContent="FAIL: "+(e.message??e.reason);'+
  'window.addEventListener("error",report);window.addEventListener("unhandledrejection",report);'+
  '</script><script type="module">'+code.replaceAll('</script','<\\/script')+'</script>';
const server=createServer((_request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(page);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const temporary=await mkdtemp(join(tmpdir(),'sgb-session-mode-'));
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

