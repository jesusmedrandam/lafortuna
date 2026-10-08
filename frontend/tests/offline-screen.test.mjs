import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
const root=fileURLToPath(new URL('../',import.meta.url));
const mockSession=`
const property={id:'property-a',name:'Finca de prueba',enabledModules:['MULTIMEDIA','MOVEMENTS','TASKS','PRODUCTION','REPRODUCTION'],
  roles:[{id:'role-a',permissions:['ANIMAL_VIEW','MEDIA_VIEW','MOVEMENT_VIEW','ACTIVITY_VIEW','PRODUCTION_VIEW','REPRODUCTION_VIEW','AGENDA_TASK_VIEW']}]};
const session={accessToken:'test',overview:{user:{id:'user-a'},activeContext:{propertyId:'property-a',roleId:'role-a'},properties:[property],enabledUserModules:[]}};
export const useV2Session=()=>({session});`;
const mockRuntime=`
import {defaultDownloadPreferences} from '${root.replaceAll('\\','/') }src/sgb-v2/offline/preferences.ts';
let state={online:true,wifi:false,preferences:defaultDownloadPreferences(),automaticDownloads:false,pending:1,failed:1,syncing:false,
  cachedEntries:2,cachedBytes:2000,mediaFiles:2,mediaBytes:4000,mediaPending:0,mediaFailed:0,lastDownload:null};
window.offlineDownloads=[];window.offlineRemovals=[];
const announce=()=>window.dispatchEvent(new CustomEvent('sgb-v2-offline-state',{detail:{...state}}));
window.setOfflineNetwork=(online,wifi)=>{state={...state,online,wifi};announce();};
window.setOfflineCounts=(pending,failed,mediaPending,mediaFailed)=>{state={...state,pending,failed,mediaPending,mediaFailed};announce();};
window.setOfflineProgress=syncProgress=>{state={...state,syncing:Boolean(syncProgress),syncProgress};announce();};
export const runtimeState=async()=>({...state});export const isRuntimeOnline=()=>state.online;
export const setAutomaticDownloads=async automaticDownloads=>{state={...state,automaticDownloads};announce();};
export const setDownloadPreferences=async preferences=>{state={...state,preferences};window.savedOfflinePreferences=preferences;announce();};
export const downloadPaths=async(paths,options={})=>{window.offlineDownloads.push({paths,options});return {downloaded:paths.length,failed:0};};
export const syncOfflineMutations=async()=>{};export const retryFailedMutations=async()=>{};
export const discardPendingMutation=async id=>{window.offlineRemovals.push('change:'+id);details.changes=details.changes.filter(item=>item.id!==id);};
export const editPendingMutation=async(id,fields)=>{window.pendingCorrection={id,fields};};
export const pendingMutationFields=item=>item.jsonBody??{};
let details={data:[{category:'animals',label:'Animales y clasificación',entries:1,bytes:1000,protected:true},
  {category:'activities',label:'Registros de actividades',entries:1,bytes:1000,protected:false}],
  media:[{id:'native-photo',name:'Foto guardada',bytes:3000,categories:['activity-photos'],local:false,protected:false},
    {id:'local:pending',name:'Foto pendiente',bytes:1000,categories:['local'],local:true,protected:true}],
  changes:[{id:'change',path:'/animals/a',createdAt:Date.now(),state:'FAILED',lastError:'Dato inválido',bodyType:'json',jsonBody:{description:'Descripción pendiente'},
    summary:'Actualizar animal · Lucera',formParts:[],scope:{propertyId:'property-a'}}]};
export const getOfflineDetails=async()=>structuredClone(details);
export const removeDownloadedData=async category=>{window.offlineRemovals.push(category);details.data=details.data.filter(row=>row.category!==category);};
export const removeDownloadedMedia=async ids=>{window.offlineRemovals.push(ids);details.media=details.media.filter(row=>!ids.includes(row.id));};
`;
const entry=`
import {createElement as h} from 'react';import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {V2OfflinePage,V2OfflineProvider,OfflineStatusButton,SyncProgressBar} from './src/sgb-v2/offline/V2Offline';
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const tick=()=>new Promise(resolve=>setTimeout(resolve,30));
async function until(condition){for(let n=0;n<120;n++){if(condition())return;await tick();}throw new Error('Timeout: '+condition.toString());}
const button=text=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===text);
const close=()=>document.querySelector('[aria-label="Cerrar"]').click();
createRoot(document.getElementById('root')).render(h(BrowserRouter,null,h(V2OfflineProvider,null,h(OfflineStatusButton),h(SyncProgressBar),h(V2OfflinePage))));
try{
  await until(()=>document.querySelector('.offline-page'));
  await until(()=>document.querySelector('.offline-status').textContent==='2');
  check(document.querySelector('.offline-status').getAttribute('href')==='/sin-conexion','Connection link opens downloads');
  check(getComputedStyle(document.querySelector('.offline-pending-count')).display!=='none','Mobile pending number remains visible');
  document.querySelector('.offline-status').click();await tick();
  check(location.pathname==='/sin-conexion','Tapping connection and count navigates to downloads');
  window.setOfflineCounts(2,1,3,1);await until(()=>document.querySelector('.offline-status').textContent==='7');
  check(document.querySelector('.offline-status').getAttribute('aria-label').includes('7 contenidos pendientes'),'Accessible total includes media and errors');
  window.setOfflineCounts(0,0,0,0);await until(()=>!document.querySelector('.offline-pending-count'));
  window.setOfflineCounts(1,1,0,0);await until(()=>document.querySelector('.offline-pending-count'));
  check(document.querySelectorAll('.offline-summary-button').length===4,'Four accessible detail cards');
  check([...document.querySelectorAll('.offline-choices details')].every(item=>!item.open),'Categories initially collapsed');
  const animalGroup=document.querySelector('.offline-choices details');animalGroup.querySelector('summary').click();await tick();
  const cover=document.querySelector('select[aria-label="Fotos de portada"]');cover.value='all';cover.dispatchEvent(new Event('change',{bubbles:true}));
  await until(()=>window.savedOfflinePreferences?.photos.cover==='all');
  check(document.querySelector('select[aria-label="Fotos de perfil"]').value==='latest','Latest profile selection');
  document.querySelector('[aria-label="Descargas automáticas con Wi-Fi"]').click();await tick();
  check(window.offlineDownloads.length===0,'Cellular does not auto-download');
  button('Descargar ahora').click();await until(()=>window.offlineDownloads.length===1);
  await until(()=>!document.querySelector('.offline-buttons .spin'));await tick();
  check(window.offlineDownloads[0].paths.includes('/media?entityType=ANIMAL'),'Manual request uses selected photos');
  window.setOfflineNetwork(true,true);await until(()=>window.offlineDownloads.length===2);await tick();
  check(window.offlineDownloads[1].options.automatic===true,'Wi-Fi auto-download');
  check(window.offlineDownloads.length===2,'State refresh does not start repeated downloads');
  document.querySelector('[aria-label="Descargas automáticas con Wi-Fi"]').click();await tick();
  check(document.querySelector('.offline-status').classList.contains('online')&&!document.querySelector('.offline-status').classList.contains('failed'),'Queue errors leave connection green');
  check(getComputedStyle(document.querySelector('.offline-status')).color==='rgb(37, 134, 91)','Online color is green');
  document.querySelectorAll('.offline-summary-button')[0].click();await until(()=>document.querySelector('[aria-label="Eliminar datos de Registros de actividades"]'));
  check(document.querySelector('[aria-label="Eliminar datos de Animales y clasificación"]').disabled,'Pending data protected');
  document.querySelector('[aria-label="Eliminar datos de Registros de actividades"]').click();await tick();button('Eliminar del dispositivo').click();
  await until(()=>window.offlineRemovals.includes('activities'));close();await tick();
  document.querySelectorAll('.offline-summary-button')[1].click();await until(()=>document.querySelector('[aria-label="Eliminar Foto pendiente"]'));
  check(document.querySelector('[aria-label="Eliminar Foto pendiente"]').disabled,'Pending photo protected');
  const group=document.querySelector('[role="dialog"] details');group.querySelector('summary').click();await tick();
  document.querySelector('[aria-label="Eliminar Foto guardada"]').click();await tick();button('Eliminar del dispositivo').click();
  await until(()=>window.offlineRemovals.some(item=>Array.isArray(item)&&item[0]==='native-photo'));close();await tick();
  document.querySelectorAll('.offline-summary-button')[2].click();await until(()=>document.querySelector('[role="dialog"]')?.textContent.includes('Red Wi-Fi confirmada'));close();await tick();
  window.setOfflineProgress({completed:1,total:2,current:'Actualización de foto de perfil · Lucera',loaded:50,bytes:100});
  await until(()=>document.querySelector('progress'));
  check(document.querySelector('progress').value===75,'Progress includes completed records and current upload bytes');
  check(document.querySelector('.sync-progress').textContent.includes('Lucera'),'Progress identifies the animal and photo');
  window.setOfflineProgress(null);await until(()=>!document.querySelector('progress'));
  document.querySelectorAll('.offline-summary-button')[3].click();await until(()=>document.querySelector('[role="dialog"]')?.textContent.includes('Dato inválido'));
  check(document.querySelector('[role="dialog"]').textContent.includes('Actualizar animal · Lucera'),'Queue has a meaningful animal description');
  document.querySelector('[aria-label="Corregir Actualizar animal · Lucera"]').click();await until(()=>document.querySelector('.pending-edit textarea'));
  const textarea=document.querySelector('.pending-edit textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'Descripción corregida');
  textarea.dispatchEvent(new Event('input',{bubbles:true}));button('Guardar corrección').click();await until(()=>window.pendingCorrection);
  check(window.pendingCorrection.fields.description==='Descripción corregida','Failed record can be edited');
  await until(()=>!document.querySelector('.pending-edit'));
  document.querySelector('[aria-label="Descartar Actualizar animal · Lucera"]').click();await tick();button('Descartar cambio').click();
  await until(()=>window.offlineRemovals.includes('change:change'));close();await tick();
  check(!document.getElementById('root').textContent.toLowerCase().includes('transferir'),'No transfer backup UI');
  check(document.documentElement.scrollWidth<=window.innerWidth,'No horizontal overflow at mobile width');
  document.getElementById('result').textContent='PASS: collapsed download choices, Wi-Fi/manual flows, green connection, four dialogs and protected cleanup at 412px';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack;}
`;
const result=await build({root,configFile:false,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
  name:'offline-screen-test',enforce:'pre',resolveId(id,importer){
    importer=importer?.replaceAll('\\','/');
    if(id==='offline-screen-test'||id===root+'offline-screen-test')return '\0offline-screen-test';
    if(id==='./runtime'&&importer?.endsWith('/offline/V2Offline.tsx'))return '\0offline-screen-runtime';
    if(id==='../V2Session'&&importer?.endsWith('/offline/V2Offline.tsx'))return '\0offline-screen-session';
    if(importer==='\0offline-screen-test'&&id.startsWith('./src/'))return root+id.slice(2)+'.tsx';
  },load(id){if(id==='\0offline-screen-test')return entry;if(id==='\0offline-screen-runtime')return mockRuntime;if(id==='\0offline-screen-session')return mockSession;},
}],build:{write:false,minify:false,lib:{entry:'offline-screen-test',formats:['es'],fileName:'test'},rolldownOptions:{output:{codeSplitting:false}}}});
const code=(Array.isArray(result)?result[0]:result).output.find(item=>item.type==='chunk').code;
const css=(await Promise.all(['src/styles/global.css','src/sgb-v2/shell.css','src/sgb-v2/v2.css']
  .map(path=>readFile(join(root,path),'utf8')))).join('\n');
const page='<meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style><div id="root"></div><pre id="result">PENDING</pre><script>'+ 
  'const report=e=>document.getElementById("result").textContent="FAIL: "+(e.message??e.reason);'+
  'window.addEventListener("error",report);window.addEventListener("unhandledrejection",report);'+
  '</script><script type="module">'+code.replaceAll('</script','<\\/script')+'</script>';
const server=createServer((_request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(page);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const temporary=await mkdtemp(join(tmpdir(),'sgb-offline-screen-'));
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

