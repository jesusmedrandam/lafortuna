import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';

const root=fileURLToPath(new URL('../',import.meta.url));

const mockApi=`
const locations=[{id:'north',name:'Potrero Norte',kind:'PASTURE',description:'Junto al río',active:true,
  version:1,area:3,areaUnitCode:'HECTARE',capacityEstimate:20,waterAvailable:true,group:{id:'cows',name:'Vacas'},
  pastureUse:'PASTOREO',lastRestDate:'2026-08-01',grasses:[{name:'Estrella',percent:100}],currentAnimalCount:8,
  occupationHistory:[{startedOn:'2026-10-01',endedOn:null,animalCount:10,restStartedOn:'2026-09-20'},
    {startedOn:'2026-09-10',endedOn:'2026-09-20',animalCount:12,restStartedOn:'2026-08-25'},
    {startedOn:'2026-08-20',endedOn:'2026-08-25',animalCount:9,restStartedOn:null}]},
  {id:'south',name:'Potrero Sur',kind:'PASTURE',description:null,active:false,version:1,area:null,
    group:null,grasses:[],lastRestDate:null,currentAnimalCount:0,
    occupationHistory:[{startedOn:'2026-09-20',endedOn:'2026-09-20',animalCount:1,restStartedOn:'2026-09-20'}]},
  {id:'corral',name:'Corral Central',kind:'CORRAL',active:true,version:1,group:null,grasses:[]}];
export const listLocations=async()=>{window.reads=(window.reads??0)+1;if(window.fail)throw new Error('No se pudo cargar');
  return structuredClone(locations).map(place=>window.missing?{...place,currentAnimalCount:undefined,occupationHistory:undefined}:place);};
export const listCatalogItems=async()=>[];export const listGroups=async()=>[];
export const createLocation=async(_token,input)=>{window.saved=input;};
export const updateLocation=async(_token,id,input)=>{window.saved={id,...input};};
export const createGroup=async()=>{};export const updateGroup=async()=>{};export const setGroupState=async()=>{};
`;
const mockSession=`const hasPermission=permission=>!window.readOnly||permission.endsWith('_VIEW');
export function useV2Session(){return {session:{accessToken:window.token??'test'},hasPermission};}`;
const mockFields=`import {createElement as h} from 'react';
export const locationInput=(data,kind)=>({kind,name:String(data.get('name'))});
export const LocationFields=()=>h('span',null,'Campos de ubicación');`;
const entry=`
import {createElement as h} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {BrowserRouter} from 'react-router-dom';import {V2LocationsPage} from './src/sgb-v2/V2GroupsLocations';
import {currentDateInput} from './src/utils';
const root=createRoot(document.getElementById('root'));let key=0;
const render=(kind='PASTURE',reset=true)=>{if(reset)key++;flushSync(()=>root.render(h(BrowserRouter,{key},h(V2LocationsPage,{kind}))));};
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
const check=(condition,message)=>{if(!condition)throw new Error(message);};
async function until(condition){for(let n=0;n<120;n++){if(condition())return;await tick();}throw new Error('Timeout '+condition);}
const rows=()=>[...document.querySelectorAll('.pasture-list-row')];
const click=label=>document.querySelector('[aria-label="'+label+'"]').click();
const close=()=>document.querySelector('.modal header [aria-label="Cerrar"]').click();
try{
  render();await until(()=>rows().length===2);
  check(!document.querySelector('.record-grid'),'Pastures use the former list layout');
  check(rows()[0].tagName==='BUTTON','Native keyboard-accessible rows');
  check(rows()[0].textContent.includes('Ocupado')&&rows()[0].textContent.includes('8 animales'),'Current occupancy count');
  check(rows()[1].textContent.includes('En descanso')&&rows()[1].textContent.includes('Última: 1 animal · 0 días'),'Resting pasture and same-day occupancy');
  check(document.documentElement.scrollWidth<=innerWidth,'No mobile horizontal overflow');
  rows()[0].click();await until(()=>document.querySelector('.pasture-latest-occupation'));
  const latest=document.querySelector('.pasture-latest-occupation');
  check(latest.textContent.includes('10 animales')&&latest.textContent.includes('8 animales actualmente'),'Historical unique animals differ from current count');
  check(latest.textContent.includes('11 días')&&latest.textContent.includes('20 sept 2026'),'Previous rest belongs to this occupation');
  const elapsed=(Date.parse(currentDateInput()+'T00:00:00Z')-Date.parse('2026-10-01T00:00:00Z'))/86400000;
  check(latest.textContent.includes(elapsed+' '+(elapsed===1?'día':'días')),'Live duration uses calendar days in the app timezone');
  const history=[...document.querySelectorAll('.pasture-history-row')];
  check(history.length===3,'All occupations available');
  check(history[1].textContent.includes('12 animales')&&history[1].textContent.includes('10 días')&&history[1].textContent.includes('16 días'),'Historical duration and respective rest');
  check(history[2].textContent.includes('Sin datos'),'Unknown initial rest is not invented');
  check(document.querySelector('.modal header [aria-label="Cerrar"]'),'Accessible modal close control');
  const selected=latest;window.token='renewed';render('PASTURE',false);await tick();await tick();
  check(document.querySelector('.pasture-latest-occupation')===selected,'Token renewal preserves open detail');
  close();await until(()=>!document.querySelector('.pasture-latest-occupation'));
  rows()[1].click();await until(()=>document.querySelector('.pasture-latest-occupation'));
  check(document.querySelector('.pasture-latest-occupation').textContent.includes('0 días'),'Zero days preserved');
  check(document.querySelector('.pasture-detail').textContent.includes('Descanso actual'),'Current rest separate from prior rest');
  close();
  click('Nuevo potrero');await until(()=>document.querySelector('#v2-location-form'));
  const name=document.querySelector('input[name="name"]');name.value='Potrero Nuevo';
  document.querySelector('#v2-location-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>window.saved?.name==='Potrero Nuevo');check(window.saved.kind==='PASTURE','Existing creation action preserved');
  window.readOnly=true;render();await until(()=>rows().length===2);
  check(!document.querySelector('[aria-label="Nuevo potrero"]'),'No management action for read-only role');
  rows()[0].click();await until(()=>document.querySelector('.pasture-latest-occupation'));
  check(![...document.querySelectorAll('.modal footer button')].some(button=>button.textContent.includes('Editar')),'Read-only history without edit');
  window.missing=true;render();await until(()=>rows().length===2);rows()[0].click();
  await until(()=>document.querySelector('.pasture-latest-occupation'));
  check(document.querySelector('.pasture-latest-occupation').textContent.includes('No hay información'),'Old offline downloads do not invent history');
  window.missing=false;render('CORRAL');await until(()=>document.querySelector('.record-card'));
  check(document.querySelector('.record-card').textContent.includes('Corral Central')&&!document.querySelector('.pasture-list'),'Corral screen preserved');
  window.fail=true;render();await until(()=>document.querySelector('.error-state'));
  check(!document.querySelector('.pasture-list'),'Read failure does not expose previous records');
  window.fail=false;render();await until(()=>rows().length===2);rows()[0].click();
  await until(()=>document.querySelector('.pasture-latest-occupation'));
  check(document.documentElement.scrollWidth<=innerWidth,'Detail fits mobile width');
  document.getElementById('result').textContent='PASS: pasture list, latest and complete history, calendar duration, previous rest, zero/unknown values, permissions, cache compatibility and corral screen';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack;}
`;
const result=await build({root,configFile:false,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
  name:'pastures-test',enforce:'pre',resolveId(id,importer){
    importer=importer?.replaceAll('\\','/');
    if(id==='pastures-test'||id===root+'pastures-test')return '\0pastures-test';
    if(importer?.endsWith('/V2GroupsLocations.tsx')){
      if(id==='./api')return '\0pastures-api';if(id==='./V2Session')return '\0pastures-session';
      if(id==='./GroupPanel')return '\0pastures-fields';
    }
    if(importer==='\0pastures-test'&&id.startsWith('./src/'))return root+id.slice(2)+(id.endsWith('utils')?'.ts':'.tsx');
  },load(id){if(id==='\0pastures-test')return entry;if(id==='\0pastures-api')return mockApi;
    if(id==='\0pastures-session')return mockSession;if(id==='\0pastures-fields')return mockFields;},
}],build:{write:false,minify:false,lib:{entry:'pastures-test',formats:['es'],fileName:'test'},rolldownOptions:{output:{codeSplitting:false}}}});
const code=(Array.isArray(result)?result[0]:result).output.find(item=>item.type==='chunk').code;
const css=(await Promise.all(['src/sgb-v2/styles.css','src/sgb-v2/shell.css','src/styles/global.css','src/styles/device.css',
  'src/styles/radical-ui.css','src/styles/restored-ui.css','src/styles/settings-hub.css','src/styles/patch-1.2.8.35.css','src/sgb-v2/v2.css']
  .map(path=>readFile(join(root,path),'utf8')))).join('\n');
const page='<meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style><div id="root"></div><pre id="result">PENDING</pre><script>'+ 
  'const report=e=>document.getElementById("result").textContent="FAIL: "+(e.message??e.reason);'+
  'window.addEventListener("error",report);window.addEventListener("unhandledrejection",report);'+
  '</script><script type="module">'+code.replaceAll('</script','<\\/script')+'</script>';
const server=createServer((_request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(page);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const temporary=await mkdtemp(join(tmpdir(),'sgb-pastures-'));
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
  if(process.env.PASTURE_SCREENSHOT){
    const metrics=await command('Page.getLayoutMetrics');
    const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,
      clip:{x:0,y:0,width:412,height:metrics.cssContentSize.height,scale:1}});
    await writeFile(process.env.PASTURE_SCREENSHOT,Buffer.from(shot.data,'base64'));
  }
  await Promise.race([command('Browser.close'),pause(1000)]);
}finally{socket?.close();browser?.kill();server.close();await rm(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
