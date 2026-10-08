import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';

const root=fileURLToPath(new URL('../',import.meta.url));
const deadline=setTimeout(()=>{console.error('Browser test timed out');process.exit(1);},45000);
const mockApi=`
const animal={id:'animal-a',name:'Lucera',description:'Vaca de la finca',version:1,speciesCode:'BOVINE',sex:'FEMALE',
  availabilityStatusCode:'ACTIVE',classification:{code:'VACA',name:'Vaca'},earTagCode:'A1',
  birthDate:'2024-01-01',entryDate:'2024-03-01',initialWeight:0,initialWeightUnitCode:'KILOGRAM',
  group:{id:'group-a',name:'Vacas'},location:{id:'pasture-a',name:'Potrero Norte'},
  owners:[{id:'owner-a',name:'Ana',percent:100,isPrimary:true}],breeds:[{id:'breed-a',name:'Jersey'}],
  colors:[{id:'color-a',name:'Café'}],brands:[{id:'brand-a',name:'Finca A'}],
  mother:{name:'Margarita',animalId:'mother-a'},father:{name:'Toro A',animalId:null}};
export const getAnimal=async(_token,id)=>id==='animal-a'?structuredClone(animal):{
  ...animal,id,name:'Bruno',description:' ',earTagCode:' ',birthDate:null,entryDate:'',initialWeight:undefined,
  classification:null,group:{name:' '},location:null,owners:[],breeds:[],colors:[],brands:[],mother:{name:' '},father:null};
export const getMedia=async(_token,_type,id)=>{if(id!=='animal-a')throw new Error('No local photos for this animal');
  return [{id:'photo-a',entity_id:'animal-a',kind:'IMAGE',relation_code:'GENERAL',description:'Foto de Lucera',
    url:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/%3E',created_at:'2026-10-01T12:00:00Z'}];};
export const uploadMedia=async()=>{};
export const getAnimalStatusEvents=async()=>[];
export const getAnimalStatusOptions=async()=>[{id:'animal-a',name:'Lucera',earTagCode:'A1',status:'ACTIVE',version:1}];
export const createAnimalStatusEvent=async(_token,input)=>{window.savedStatus=input;return {id:'status-new',...input};};
export const getMovements=async()=>[{id:'move-a',movementOn:'2026-10-01',reason:'Rotación',
  destinationGroupName:'Vacas',destinationLocationName:'Potrero Norte',animals:[{id:'animal-a'}]}];
export const getMovementOptions=async()=>({groups:[{id:'group-a',locationId:'pasture-a'}],properties:[],locations:[]});
export const getWeighings=async(_token,id)=>id==='animal-a'?Array.from({length:5},(_,n)=>({
  id:'weight-'+n,weight:300+n,unitCode:'KILOGRAM',weighedOn:'2026-10-0'+(n+1),voidedAt:null})):[];
export const getHealthMedicines=async()=>[];export const getHealthConditions=async()=>[];
export const getHealthCampaigns=async()=>[];export const getCommerce=async()=>[];
export const getProduction=async()=>({milk:[],cows:[],lactations:[]});
export const getReproductionSettings=async()=>({minimumCowMonths:12});
export const getReproduction=async()=>({services:[],pregnancies:[],losses:[],
  heats:[{id:'heat-a',cowId:'animal-a',startsOn:'2026-08-01',isFalse:false}],
  births:[{id:'birth-a',motherId:'animal-a',occurredOn:'2026-06-01',calves:[{id:'calf-a',name:'Luna'}]}]});
`;
const mockSession=`
export function useV2Session(){return {session:{accessToken:window.token??'test',overview:{activeContext:{propertyId:'property-a',roleId:'role-a'},
  properties:[{id:'property-a',enabledModules:['MULTIMEDIA','MOVEMENTS','WEIGHING','HEALTH','REPRODUCTION','PRODUCTION','SALES_PURCHASES']}]}},
  hasPermission:permission=>!window.readOnly||permission.endsWith('_VIEW')};}
`;
const entry=`
import {createElement as h} from 'react';import {createRoot} from 'react-dom/client';
import {BrowserRouter,Route,Routes} from 'react-router-dom';
import {V2AnimalDetail} from './src/sgb-v2/V2AnimalDetail';
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
async function until(condition){for(let n=0;n<120;n++){if(condition())return;await tick();}throw new Error('Timeout: '+condition);}
const root=createRoot(document.getElementById('root'));
const render=id=>{if(location.pathname!=='/animales/'+id)history.replaceState(null,'','/animales/'+id);root.render(h(BrowserRouter,{key:id+Boolean(window.readOnly)},
  h(Routes,null,h(Route,{path:'/animales/:id',element:h(V2AnimalDetail)}))));};
const info=()=>document.querySelector('.animal-data-only-card');
const cards=()=>[...document.querySelectorAll('.animal-history-preview')];
const historyCard=title=>cards().find(node=>node.querySelector('h2').textContent===title);
try{
  render('animal-a');await until(()=>historyCard('Pesajes')&&historyCard('Crías'));
  check(document.querySelector('.animal-social-avatar [data-animal-icon]'),'Animals without a profile photo use the shared bovine drawing');
  check(!document.getElementById('root').textContent.includes('Sin registros'),'Empty histories hidden');
  check(!historyCard('Ventas')&&!historyCard('Novedades')&&!historyCard('Preñeces'),'No empty sections');
  check(historyCard('Celos')&&historyCard('Partos'),'Reproduction sections match reference');
  check(historyCard('Pesajes').querySelector('.history-count').textContent==='5','Corner count');
  check(historyCard('Pesajes').querySelector('h2 .lucide-weight'),'Same weighing icon');
  check(document.querySelector('[aria-label="Sanidad"] .lucide-syringe'),'Same health action icon');
  check(document.querySelector('[aria-label="Movimientos"] .lucide-arrow-right-left'),'Same movement action icon');
  check(document.querySelector('[aria-label="Registrar fallecimiento"] .lucide-heart-off'),'Same death action icon');
  check(document.querySelector('[aria-label="Reportar desaparición"] .lucide-search'),'Same missing action icon');
  check(info().querySelector('.lucide-calendar-days'),'Date icon');
  check(info().querySelector('.lucide-user-round'),'Owner/parent icon');
  check(info().textContent.includes('0 kg'),'Zero is valid data');
  check(info().textContent.includes('304 kg'),'Latest weight first');
  check(info().textContent.includes('Margarita')&&info().textContent.includes('Ana (100%)'),'Existing information preserved');
  check(document.querySelector('.animal-compact-tags').textContent.includes('Jersey'),'Reference breed tags');
  check(document.querySelector('.v2-animal-gallery button'),'Available animal photos preserved');
  const weighing=historyCard('Pesajes');check(weighing.querySelectorAll('.history-entry').length===3,'Three-record preview');
  weighing.querySelector('.history-toggle').click();await until(()=>weighing.querySelectorAll('.history-entry').length===5);
  check(weighing.querySelector('.history-toggle').getAttribute('aria-expanded')==='true','Expanded accessibility');
  weighing.querySelector('.history-toggle').click();await until(()=>weighing.querySelectorAll('.history-entry').length===3);
  check(!document.querySelector('[aria-label="Compras"]')&&document.querySelector('[aria-label="Ventas"]'),'Only sale action in profile');
  const actionButton=document.querySelector('[aria-label="Sanidad"]');
  check(getComputedStyle(actionButton).borderRadius==='15px','Reference button shape');
  check(getComputedStyle(actionButton).width==='48px','Reference button size');
  document.querySelector('[aria-label="Registrar fallecimiento"]').click();await until(()=>document.querySelector('#v2-status-form'));
  check(document.querySelector('#v2-status-form').textContent.includes('Causa de muerte'),'Death opens the real death form');
  const field=document.querySelector('#v2-status-form textarea[name="reason"]');field.value='Pending form';window.token='renewed';render('animal-a');await tick();await tick();
  check(document.querySelector('#v2-status-form textarea[name="reason"]')===field&&field.value==='Pending form','Token renewal preserves open form');
  check(!document.querySelector('.v2-animal-action-exit')&&!document.querySelector('.animal-back'),'Duplicate back buttons removed');
  history.back();await until(()=>!document.querySelector('#v2-status-form'));
  check(location.pathname==='/animales/animal-a','Back from an action returns to the same animal');
  document.querySelector('[aria-label="Registrar fallecimiento"]').click();await until(()=>document.querySelector('#v2-status-form'));
  [...document.querySelectorAll('button')].find(node=>node.textContent==='Cancelar').click();await until(()=>!document.querySelector('.v2-animal-action-host'));
  check(location.pathname==='/animales/animal-a','Cancel returns to the same profile');
  document.querySelector('[aria-label="Registrar fallecimiento"]').click();await until(()=>document.querySelector('#v2-status-form'));
  document.querySelector('#v2-status-form textarea[name="reason"]').value='Causa registrada';
  document.querySelector('#v2-status-form').requestSubmit();await until(()=>window.savedStatus&&!document.querySelector('#v2-status-form'));
  check(window.savedStatus.action==='RECORD_DEATH','Real action saved with the selected kind');
  check(location.pathname==='/animales/animal-a','Successful action closes using browser history');
  historyCard('Crías').querySelector('.history-entry').click();await until(()=>location.pathname==='/animales/calf-a');
  render('animal-b');await until(()=>document.querySelector('h1')?.textContent==='Bruno');await tick();
  const hidden=['Grupo','Ubicación actual','Clasificación','Nacimiento','Edad','Ingreso','Propietarios','Marquillas','Peso inicial','Padres','Último peso','Último tratamiento','Último traslado'];
  for(const label of hidden)check(![...info().querySelectorAll('small')].some(node=>node.textContent===label),'Hide absent '+label);
  check(!document.querySelector('.animal-profile-history-grid'),'Empty history container hidden');
  check(!document.querySelector('.v2-animal-gallery'),'Failed photo read does not show previous animal photos');
  check(!info().textContent.includes('Sin grupo')&&!info().textContent.includes('undefined'),'No placeholders');
  window.readOnly=true;render('animal-a');await until(()=>historyCard('Pesajes'));
  check(!document.querySelector('[aria-label="Editar animal"]')&&!document.querySelector('[aria-label="Registrar fallecimiento"]'),
    'Profile permissions preserved');
  window.readOnly=false;render('animal-a');await until(()=>historyCard('Pesajes'));
  document.getElementById('result').textContent='PASS: reference profile icons/style, absent fields, split histories, expansion, child links and role permissions';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack;}
`;
const panels=['AnimalPanel','MovementPanel','HealthPanel','ReproductionPanel','ProductionPanel','V2WeighingsPage','V2CommercePage'];
const result=await build({root,configFile:false,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
  name:'animal-profile-test',enforce:'pre',resolveId(id,importer){
    importer=importer?.replaceAll('\\','/');
    if(id==='animal-profile-test'||id===root+'animal-profile-test')return '\0profile-test';
    if(importer?.endsWith('/V2AnimalStatusPage.tsx')){
      if(id==='./api')return '\0profile-api';if(id==='./V2Session')return '\0profile-session';
    }
    if(importer?.endsWith('/V2AnimalDetail.tsx')){
      if(id==='./api')return '\0profile-api';if(id==='./V2Session')return '\0profile-session';
      if(panels.includes(id.slice(2)))return '\0panel:'+id.slice(2);
    }
    if(importer==='\0profile-test'&&id.startsWith('./src/'))return root+id.slice(2)+'.tsx';
  },load(id){if(id==='\0profile-test')return entry;if(id==='\0profile-api')return mockApi;if(id==='\0profile-session')return mockSession;
    if(id.startsWith('\0panel:'))return 'import {createElement as h} from "react";export function '+id.slice(7)+'(props){return h("div",null,h("p",{id:"profile-action-check"},props.profileAction??props.initialAction??"edit"),h("input",{id:"profile-form-check"}),h("button",{id:"profile-action-save",onClick:props.onCompleted},"Guardar"));}';},
}],build:{write:false,minify:false,lib:{entry:'animal-profile-test',formats:['es'],fileName:'test'},rolldownOptions:{output:{codeSplitting:false}}}});
const code=(Array.isArray(result)?result[0]:result).output.find(item=>item.type==='chunk').code;
console.log('Animal profile test compiled');
const css=(await Promise.all(['src/sgb-v2/styles.css','src/sgb-v2/shell.css','src/styles/global.css','src/styles/device.css',
  'src/styles/radical-ui.css','src/styles/restored-ui.css','src/styles/settings-hub.css','src/styles/patch-1.2.8.35.css','src/sgb-v2/v2.css']
  .map(path=>readFile(join(root,path),'utf8')))).join('\n');
const page='<meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style><div id="root"></div><pre id="result">PENDING</pre><script>'+ 
  'const report=e=>document.getElementById("result").textContent="FAIL: "+(e.message??e.reason);'+
  'window.addEventListener("error",report);window.addEventListener("unhandledrejection",report);'+
  '</script><script type="module">'+code.replaceAll('</script','<\\/script')+'</script>';
const server=createServer((_request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(page);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const temporary=await mkdtemp(join(tmpdir(),'sgb-animal-profile-'));
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
  if(process.env.PROFILE_SCREENSHOT){
    const metrics=await command('Page.getLayoutMetrics');
    const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,
      clip:{x:0,y:0,width:412,height:metrics.cssContentSize.height,scale:1}});
    await writeFile(process.env.PROFILE_SCREENSHOT,Buffer.from(shot.data,'base64'));
  }
  await Promise.race([command('Browser.close'),pause(1000)]);
}finally{clearTimeout(deadline);socket?.close();browser?.kill();server.close();await rm(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
