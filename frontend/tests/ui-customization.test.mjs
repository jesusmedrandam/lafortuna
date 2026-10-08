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
const url='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="green"/></svg>');
const base={entity_type:'ANIMAL',relation_code:'GENERAL',kind:'IMAGE',byteSize:10,url,thumbnailUrl:url,
  created_at:'2026-10-01T15:00:00Z'};
let photos=[{...base,id:'photo-a',storage_object_id:'object-a',entity_id:'animal-a',entity_name:'Lucera',
  captured_on:null,description:'Foto original',tags:[{id:'tag-a',name:'Parto'}]},
  {...base,id:'photo-b',storage_object_id:'object-b',entity_id:'animal-b',entity_name:'Moka',
  captured_on:'2026-09-30',description:null,tags:[]}];
window.savedMedia=[];window.contextCalls=[];
export const getMedia=async()=>structuredClone(photos);
export const getMediaUsage=async()=>{throw new Error('Quota unavailable offline');};
export const listCatalogItems=async()=>[{id:'tag-a',name:'Parto',active:true}];
export const getAnimals=async()=>({items:[{id:'animal-a',name:'Lucera'},{id:'animal-b',name:'Moka'}]});
export const deleteMediaObject=async()=>({deletedFromProvider:true});
export const uploadMedia=async()=>({});
export const updateMediaDetails=async(_t,id,input)=>{window.savedMedia.push({id,...input});
  photos=photos.map(photo=>photo.storage_object_id===id?{...photo,captured_on:input.capturedOn,
    description:input.description,tags:input.tagIds.map(id=>({id,name:'Parto'}))}:photo)
    .sort((a,b)=>(b.captured_on??b.created_at).localeCompare(a.captured_on??a.created_at));return {attachmentIds:[]};};
export const getAnimalSummary=async()=>({total:2,classifications:[],sex:[{sex:'FEMALE',count:2}],groups:[{name:'Vacas',count:2}]});
export const getWeighings=async()=>[];export const getHealthCampaigns=async()=>[];
export const getHealthConditions=async()=>[];export const getHealthMedicines=async()=>[];
export const getMovements=async()=>[];export const getAnimalStatusEvents=async()=>[];
export const listBrands=async()=>[];export const listOwners=async()=>[];
export const getProduction=async()=>({milk:[],tanks:[],cows:[],lactations:[]});
export const getReproduction=async()=>({pregnancies:[],births:[],losses:[]});
export const getPropertyTeam=async()=>({});
export const createPropertyInvitation=async()=>{};export const revokePropertyInvitation=async()=>{};
export const updateMembershipStatus=async()=>{};
const accounts=[{id:'account-a',name:'Cuenta primera',status:'ACTIVE',maxProperties:1,
  owner:{id:'owner-a',name:'Ana',email:'ana@example.test'},propertyCount:1},
  {id:'account-b',name:'Cuenta segunda',status:'SUSPENDED',maxProperties:4,
  owner:{id:'owner-b',name:'Luis',email:'luis@example.test'},propertyCount:1}];
window.ownerSearches=[];window.supportCalls=[];
export const getPlatformOverview=async(_token,search='',page=1)=>{window.ownerSearches.push({search,page});
  return {totals:{users:2,accounts:2,properties:2,managedAnimals:0},page,hasMore:false,
    accounts:accounts.filter(account=>JSON.stringify(account).toLowerCase().includes(search.toLowerCase()))};};
export const getAdministrativeAccount=async(_token,id)=>({account:accounts.find(account=>account.id===id),
  properties:[{id:id==='account-a'?'property-a':'property-b',name:id==='account-a'?'Finca Ana':'Finca Luis',
    timezone:'America/Guayaquil',animalCount:0,memberCount:1}],quotas:[],modules:[]});
export const updateAdministrativeAccount=async()=>{};
export const updateAdministrativeModule=async()=>{};export const updateAdministrativeQuota=async()=>{};
export const createSystemCatalogItem=async()=>{};export const getSystemCatalog=async()=>[];
export const updateSystemCatalogItem=async()=>{};
export const getAgendaOptions=async()=>({users:[],animals:[],tasks:true,events:true});
export const createAgenda=async()=>{};export const actOnAgenda=async(_token,id,action)=>{window.agendaAction={id,action};};
export const getAgenda=async()=>window.testSupportAgenda||window.testNormalAdmin?[{id:'task-a',kind:'TASK',title:'Tarea ajena',
  scheduledAt:'2026-10-05T12:00:00Z',activityType:'PERSONALIZADA',visibility:'SELECTED',status:'PENDING',
  createdBy:'owner-a',createdByName:'Ana',myResponse:null,users:[],animals:[],instructions:null,reminderAt:null}]:[];
`;
const mockSession=`
export function useV2Session(){return {session:{accessToken:'test',overview:{user:{id:'user-a',isSuperadmin:Boolean(window.testSupportAgenda||window.testNormalAdmin)},supportMode:Boolean(window.testSupportAgenda),
  activeContext:{propertyId:'property-a',roleId:'role-a'},properties:[
    {id:'property-a',name:'Primera',roles:[{id:'role-a',name:'Propietario',permissions:['ANIMAL_VIEW']}]},
    {id:'property-b',name:'Segunda',roles:[{id:'role-b',name:'Colaborador',permissions:['MEDIA_VIEW']}]}]}},
  hasPermission:()=>false,selectContext:async(propertyId,roleId)=>window.contextCalls.push({propertyId,roleId})};}
`;
const entry=`
import {createElement as h} from 'react';import {createRoot} from 'react-dom/client';
import {BrowserRouter,Route,Routes} from 'react-router-dom';
import {MediaPanel} from './src/sgb-v2/MediaPanel';
import {RolesPermissionsPage} from './src/sgb-v2/RolesPermissionsPage';
import {SuperadminPanel} from './src/sgb-v2/SuperadminPanel';
import {V2AgendaPage} from './src/sgb-v2/V2AgendaPage';
import {DashboardPreferencesEditor,loadDashboardPreferences,saveDashboardPreferences,normalizeDashboardPreferences} from './src/sgb-v2/DashboardPreferences';
import {HomeSummary} from './src/sgb-v2/HomeSummary';import {HomeOperations} from './src/sgb-v2/HomeOperations';
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const tick=()=>new Promise(resolve=>setTimeout(resolve,30));
async function until(condition){for(let n=0;n<120;n++){if(condition())return;await tick();}throw new Error('Timeout: '+condition.toString());}
const root=createRoot(document.getElementById('root'));
const render=node=>root.render(node);
const touch=(target,type,points,changed=points)=>{const event=new Event(type,{bubbles:true,cancelable:true});
  Object.defineProperties(event,{touches:{value:points.map(([x,y])=>({clientX:x,clientY:y}))},
    changedTouches:{value:changed.map(([x,y])=>({clientX:x,clientY:y}))}});target.dispatchEvent(event);return event;};
const change=(node,value)=>{Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(node,value);
  node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));};
try{
  render(h(BrowserRouter,null,h(Routes,null,h(Route,{path:'/',element:h(MediaPanel,{accessToken:'test',permissions:['MEDIA_VIEW','MEDIA_MANAGE','CATALOG_VIEW','ANIMAL_VIEW']})}),
    h(Route,{path:'/animales/:id',element:h('p',{id:'animal-profile'},'Perfil del animal')}))));
  await until(()=>document.querySelectorAll('.media-tile-open').length===2);
  check(!document.querySelector('input[type="range"]'),'No thumbnail size bar');
  const grid=document.querySelector('.media-gallery');
  touch(grid,'touchstart',[[0,50],[100,50]]);const pinch=touch(grid,'touchmove',[[0,50],[200,50]]);await tick();
  check(grid.style.getPropertyValue('--media-thumbnail-size')==='260px'&&pinch.defaultPrevented,'Pinch enlarges thumbnails and prevents page zoom');
  touch(grid,'touchend',[]);touch(grid,'touchstart',[[0,50],[100,50]]);touch(grid,'touchmove',[[0,50],[25,50]]);await tick();
  check(grid.style.getPropertyValue('--media-thumbnail-size')==='96px','Pinch shrinks thumbnails');touch(grid,'touchend',[]);
  document.querySelector('.media-tile-open').click();await until(()=>document.querySelector('.image-lightbox'));
  check(!document.querySelector('.lightbox-close,.lightbox-arrow'),'No visible navigation/close buttons');
  const download=document.querySelector('.lightbox-download-overlay');check(download,'Download remains in image corner');
  const downloadStyle=getComputedStyle(download);check(downloadStyle.position==='absolute'&&downloadStyle.right!=='auto'&&downloadStyle.bottom!=='auto','Download is anchored bottom right');
  check(document.querySelector('.image-lightbox-details').textContent.includes('Subida el'),'Upload date fallback');
  check(document.querySelector('.image-lightbox-details').textContent.includes('Parto'),'Photo tags');
  document.querySelector('[aria-label="Editar información de la foto"]').click();await until(()=>document.querySelector('.media-edit-overlay'));
  check(document.querySelector('.media-edit-overlay textarea').value==='Foto original','Saved description loaded');
  check(document.querySelector('.media-edit-overlay input[type="date"]').value==='','Capture date can be empty');
  history.back();await until(()=>!document.querySelector('.media-edit-overlay'));
  check(document.querySelector('.image-lightbox'),'Back closes editor first');
  const stage=document.querySelector('.lightbox-media-stage');touch(stage,'touchstart',[[220,100]]);touch(stage,'touchmove',[[30,100]]);
  touch(stage,'touchend',[],[[30,100]]);await until(()=>document.querySelector('.lightbox-animal-links').textContent==='Moka');
  document.querySelector('[aria-label="Editar información de la foto"]').click();await until(()=>document.querySelector('.media-edit-overlay'));
  change(document.querySelector('.media-edit-overlay textarea'),'Descripción nueva');
  change(document.querySelector('.media-edit-overlay input[type="date"]'),'2026-10-02');await tick();
  document.querySelector('.media-edit-overlay form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>window.savedMedia.length===1&&!document.querySelector('.media-edit-overlay'));
  check(window.savedMedia[0].id==='object-b'&&window.savedMedia[0].description==='Descripción nueva','Editing targets swiped photo');
  check(window.savedMedia[0].capturedOn==='2026-10-02','Capture date saved');
  await tick();document.querySelector('.lightbox-animal-links a').click();await until(()=>document.querySelector('#animal-profile'));
  check(location.pathname==='/animales/animal-b','Animal name opens profile');
  history.back();await until(()=>document.querySelector('.media-tile-open'));
  document.querySelector('.media-tile-open').click();await until(()=>document.querySelector('.image-lightbox'));
  history.back();await until(()=>!document.querySelector('.image-lightbox'));
  check(location.pathname==='/'&&document.querySelector('.media-gallery'),'Back closes only photo');
  const defaults=loadDashboardPreferences('user-a');check(defaults.sections.map(item=>item.id).join(',')==='pending,animals,operations','Default panel order');
  const custom={...defaults,sections:[defaults.sections[1],{...defaults.sections[0],visible:false},defaults.sections[2]]};
  saveDashboardPreferences('user-a',custom);check(loadDashboardPreferences('user-a').sections[0].id==='animals','Personal order persists');
  check(loadDashboardPreferences('user-b').sections[0].id==='pending','Other users keep their own panel');
  check(normalizeDashboardPreferences({sections:[{id:'bad'},{id:'animals'},{id:'animals'}]}).sections.length===3,'Reject unknown/duplicate widgets');
  render(h(DashboardPreferencesEditor,{userId:'user-a'}));await until(()=>document.querySelector('.dashboard-settings'));
  document.querySelector('[aria-label="Bajar Animales"]').click();await tick();
  [...document.querySelectorAll('button')].find(node=>node.textContent==='Guardar mi panel').click();await tick();
  check(loadDashboardPreferences('user-a').sections[0].id==='pending','Settings reorder panel');
  render(h(HomeSummary,{accessToken:'test',items:[{id:'groups',visible:true},{id:'sex',visible:false},{id:'classification',visible:false},{id:'total',visible:true}],onAnimals(){},onGroups(){},onClassification(){}}));
  await until(()=>document.querySelector('.home-herd'));check(!document.querySelector('.home-classification-grid'),'Hidden animal elements');
  check(document.querySelector('.home-herd').textContent.indexOf('Grupos de esta propiedad')<document.querySelector('.home-herd').textContent.indexOf('Total de animales'),'Animal element order');
  render(h(HomeOperations,{accessToken:'test',modules:['WEIGHING'],permissions:['ANIMAL_VIEW','WEIGHING_VIEW'],
    items:[{id:'status',visible:true},{id:'weighings',visible:false}],onNavigate(){}}));await until(()=>document.querySelector('.home-operation-card'));
  check(document.querySelectorAll('.home-operation-card').length===1&&document.querySelector('.home-operation-card').classList.contains('status'),'Operational elements obey preferences and permissions');
  render(h(BrowserRouter,null,h(RolesPermissionsPage)));await until(()=>document.querySelector('.roles-permissions-page'));
  const selectors=document.querySelectorAll('.sgb-select-button');selectors[0].click();await tick();
  [...document.querySelectorAll('[role="option"]')].find(node=>node.textContent==='Segunda').click();await tick();
  check(document.querySelector('.role-permission-list').textContent.includes('Consultar multimedia'),'Selected role permissions');
  [...document.querySelectorAll('button')].find(node=>node.textContent==='Usar este rol').click();await until(()=>window.contextCalls.length===1);
  check(window.contextCalls[0].propertyId==='property-b'&&window.contextCalls[0].roleId==='role-b','Property and role configured together');
  render(h(SuperadminPanel,{accessToken:'test',onSettingsChanged:async()=>{},
    onStartSupport:async(accountId,propertyId)=>{window.supportCalls.push({accountId,propertyId});
      if(window.failSupport)throw new Error('Soporte no disponible');}}));
  await until(()=>document.querySelectorAll('.account-row').length===2);
  document.querySelector('.account-row').click();await until(()=>document.querySelector('[name="maxProperties"]'));
  check(document.querySelector('[name="maxProperties"]').value==='1','First owner account settings');
  document.querySelectorAll('.account-row')[1].click();await until(()=>document.querySelector('[name="maxProperties"]').value==='4');
  check(document.querySelector('.account-settings').textContent.includes('Suspendida'),'Switch owner loads saved status');
  [...document.querySelectorAll('button')].find(node=>node.textContent==='Dar soporte').click();await until(()=>window.supportCalls.length===1);
  check(window.supportCalls[0].accountId==='account-b'&&window.supportCalls[0].propertyId==='property-b','Support uses selected owner and property');
  await tick();change(document.querySelector('input[type="search"]'),'ana@example.test');
  await until(()=>document.querySelectorAll('.account-row').length===1&&window.ownerSearches.at(-1).search==='ana@example.test');
  check(!document.querySelector('[name="maxProperties"]'),'Searching clears previous owner');
  document.querySelector('.account-row').click();await until(()=>document.querySelector('[name="maxProperties"]'));
  window.failSupport=true;[...document.querySelectorAll('button')].find(node=>node.textContent==='Dar soporte').click();
  await until(()=>document.querySelector('[role="alert"]')?.textContent==='Soporte no disponible');
  check(window.supportCalls[1].accountId==='account-a','Owner switch sends new account');
  window.testSupportAgenda=true;render(h(BrowserRouter,null,h(V2AgendaPage)));
  await until(()=>document.querySelector('.agenda-card'));document.querySelector('.agenda-card').click();
  await until(()=>[...document.querySelectorAll('button')].some(node=>node.textContent==='Completar'));
  check([...document.querySelectorAll('button')].some(node=>node.textContent==='Cancelar evento'),'Support can cancel another user task');
  [...document.querySelectorAll('button')].find(node=>node.textContent==='Completar').click();await until(()=>window.agendaAction);
  check(window.agendaAction.id==='task-a'&&window.agendaAction.action==='COMPLETE','Support can complete another user task');
  window.testSupportAgenda=false;window.testNormalAdmin=true;
  render(h(BrowserRouter,null,h(V2AgendaPage,{key:'normal-mode'})));await until(()=>document.querySelector('.agenda-card'));
  document.querySelector('.agenda-card').click();await until(()=>document.querySelector('[role="dialog"]'));
  check(![...document.querySelectorAll('button')].some(node=>node.textContent==='Completar'||node.textContent==='Cancelar evento'),
    'Superadministrator identity does not give support actions in user mode');
  document.getElementById('result').textContent='PASS: multimedia, personal panel, roles, owner search/switch, support errors and foreign task actions';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack+' DOM: '+document.getElementById('root').innerHTML;}
`;
const result=await build({root,configFile:false,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
  name:'customization-test-api',enforce:'pre',
  resolveId(id,importer){
    importer=importer?.replaceAll('\\','/');
    if(id==='customization-test'||id===root+'customization-test')return '\0customization-test';
    if(id==='./api'&&importer?.includes('/src/sgb-v2/'))return '\0customization-api';
    if(id==='./V2Session'&&(/\/(RolesPermissionsPage|V2AgendaPage)\.tsx$/).test(importer??''))return '\0customization-session';
    if(importer==='\0customization-test'&&id.startsWith('./src/'))return root+id.slice(2)+'.tsx';
  },load(id){if(id==='\0customization-test')return entry;if(id==='\0customization-api')return mockApi;if(id==='\0customization-session')return mockSession;},
}],build:{write:false,minify:false,lib:{entry:'customization-test',formats:['es'],fileName:'test'},rolldownOptions:{output:{codeSplitting:false}}}});
const code=(Array.isArray(result)?result[0]:result).output.find(item=>item.type==='chunk').code;
const css=(await Promise.all(['src/styles/global.css','src/sgb-v2/shell.css','src/sgb-v2/v2.css']
  .map(path=>readFile(join(root,path),'utf8')))).join('\n');
const page='<meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style><div id="root"></div><pre id="result">PENDING</pre><script>'+ 
  'const report=e=>document.getElementById("result").textContent="FAIL: "+(e.message??e.reason);'+
  'window.addEventListener("error",report);window.addEventListener("unhandledrejection",report);'+
  '</script><script type="module">'+code.replaceAll('</script','<\\/script')+'</script>';
const server=createServer((_request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(page);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const temporary=await mkdtemp(join(tmpdir(),'sgb-customization-'));
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
