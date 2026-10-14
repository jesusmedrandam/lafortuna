import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {build} from 'vite';

// Run the real React form and FormData in Chrome, with only the API replaced.
// CHROME_PATH can point to another Chromium executable on other machines.
const root=fileURLToPath(new URL('../',import.meta.url));
const mockApi=`
export class ApiRequestError extends Error {}
const saved={id:'animal-a',name:'Lucera',description:'Notas guardadas',version:7,sex:'FEMALE',
  breeds:[],breed:{id:'breed-old',name:'Raza guardada'},colors:[{id:'color-old',name:'Color guardado'}],
  brands:[{id:'brand-old',name:'Marquilla guardada'}],
  owners:[{id:'owner-old',name:'Dueño guardado',percent:60,isPrimary:true},
    {id:'owner-other',name:'Otro dueño',percent:40,isPrimary:false}],
  mother:{animalId:'mother-old',name:'Madre guardada'},father:{animalId:null,name:'Padre externo'},
  availabilityStatusCode:'ACTIVE',classification:null,birthDate:null,entryDate:'2026-01-01',
  initialWeight:32.5,initialWeightUnitCode:'POUND',earTagCode:'A1',group:{id:'group-a',name:'Grupo de prueba'},location:{id:'pasture-a',name:'Norte',kind:'PASTURE'}};
window.calls=[];window.backCount=0;window.failSection=null;
export const getAnimal=async()=>structuredClone(saved);
export const getAnimals=async()=>({items:[structuredClone(saved),
 {...saved,id:'young-father',name:'Macho joven',sex:'MALE',birthDate:'2026-01-01'},
 {...saved,id:'adult-father',name:'Macho adulto',sex:'MALE',birthDate:'2020-01-01'},
 {...saved,id:'unknown-father',name:'Macho sin nacimiento',sex:'MALE',birthDate:null}],total:4,hasMore:false});
export const listCatalogItems=async(_token,code)=>[{id:code==='BREEDS'?'breed-new':'color-new',
  name:code==='BREEDS'?'Nueva raza':'Nuevo color',active:true,speciesCode:'BOVINE'}];
export const listOwners=async()=>[{id:'owner-new',name:'Nuevo dueño',active:true,kind:'EXTERNAL_PERSON'}];
export const listBrands=async()=>[{id:'brand-new',name:'Nueva marquilla',active:true}];
export const listAccountUsers=async()=>[];
export const listGroups=async()=>[{id:'group-a',name:'Grupo de prueba',active:true,location:{id:'pasture-a',name:'Norte',kind:'PASTURE'}},{id:'group-unplaced',name:'Grupo antiguo sin ubicación',active:true,location:null}];
export const listLocations=async()=>[];
export const getMedia=async()=>[];
export const getAnimalParentRules=async()=>({minimumCowMonths:18,minimumBullMonths:24});
export const getAnimalClassificationPolicy=async()=>({names:{}});
async function update(section,input){
  window.calls.push({section,...structuredClone(input)});
  if(window.failSection===section)throw new ApiRequestError('Fallo de prueba');
  if(input.expectedVersion!==saved.version)throw new ApiRequestError('Versión incorrecta');
  if(section==='details')Object.assign(saved,Object.fromEntries(Object.entries(input).filter(([key])=>!['expectedVersion','groupId'].includes(key))));
  if(section==='owners')saved.owners=input.owners.map(owner=>({id:owner.partyId,
    name:owner.partyId,percent:owner.percent,isPrimary:owner.isPrimary}));
  if(section==='catalogs')for(const key of ['breed','color'])saved[key+'s']=input[key+'Ids'].map(id=>({id,name:id}));
  if(section==='brands')saved.brands=input.brandIds.map(id=>({id,name:id}));
  if(section==='parents')for(const key of ['mother','father'])saved[key]=input[key]?
    {animalId:input[key].animalId??null,name:input[key].reportedName??input[key].animalId}:null;
  saved.version++;return structuredClone(saved);
}
export const updateAnimalDetails=(_t,_id,input)=>update('details',input);
export const updateAnimalOwners=(_t,_id,input)=>update('owners',input);
export const updateAnimalCatalogs=(_t,_id,input)=>update('catalogs',input);
export const updateAnimalBrands=(_t,_id,input)=>update('brands',input);
export const updateAnimalParents=(_t,_id,input)=>update('parents',input);
export const createAnimal=async(_token,input)=>({...saved,...input,id:'animal-created'});
export const createCatalogItem=async()=>{};
export const createOwner=async()=>{};
export const uploadMedia=async()=>{};
export const deleteMedia=async()=>{};
`;
const entry=`
import {createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {AnimalPanel} from './src/sgb-v2/AnimalPanel';
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
async function until(condition){for(let n=0;n<100;n++){if(condition())return;await tick();}
  throw new Error('Timeout waiting for form: '+condition+' '+document.body.innerText.slice(0,2200));}
const field=(name,value)=>document.querySelector('[name="'+name+'"]'+
  (value?'[value="'+value+'"]':''));
const form=()=>document.querySelector('#animal-edit-panel form');
const submit=()=>form().dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
const animalRoot=createRoot(document.getElementById('root'));
animalRoot.render(createElement(AnimalPanel,{
  accessToken:'test',canCreate:false,canUpdate:true,canViewCatalogs:true,canManageBrands:false,
  canViewMedia:false,canManageMedia:false,canViewLocations:false,modules:[],
  initialAnimalId:'animal-a',initialEdit:true,onNavigate(){},onBack(){window.backCount++;},
}));
try{
  await until(()=>field('breedIds','breed-old')&&field('brandIds','brand-new'));
  check(document.querySelectorAll('#animal-edit-panel form').length===1,'Must have one form');
  check(form().querySelectorAll('button[type="submit"]').length===1,'Must have one save button');
  check(form().querySelector('button[type="submit"]').textContent==='Guardar','Save label');
  check(field('description').value==='Notas guardadas','Saved description');
  check(field('name').value==='Lucera'&&field('earTagCode').value==='A1','Saved identification');
  check(field('sex').value==='FEMALE'&&field('groupId').value==='group-a','Saved sex and group');
  check(field('birthDate').value===''&&field('entryDate').value==='2026-01-01','Saved dates');
  check(field('initialWeight').value==='32.5'&&field('weightUnit').value==='POUND','Saved weight and unit');
  for(const [name,id] of [['breedIds','breed-old'],['colorIds','color-old'],['brandIds','brand-old'],
    ['ownerIds','owner-old'],['ownerIds','owner-other']])check(field(name,id).checked,'Saved '+name);
  check(field('percent:owner-old').value==='60'&&field('percent:owner-other').value==='40','Saved shares');
  check(field('primary','owner-old').checked,'Saved primary owner');
  check(field('motherMode').value==='animal'&&field('motherAnimalId').value==='mother-old','Saved mother');
  check(field('fatherMode').value==='reported'&&field('fatherReportedName').value==='Padre externo','Saved father');
  check(field('motherAnimalId').nextElementSibling.textContent.includes('Madre guardada'),'Parent displayed');
  submit();await until(()=>window.backCount===1);await tick();
  check(window.calls.length===0,'Unchanged form must not write');
  field('name').value='Lucera corregida';field('earTagCode').value='A2';field('description').value='Nueva descripción';
  for(const [name,oldId,newId] of [['breedIds','breed-old','breed-new'],['colorIds','color-old','color-new'],
    ['brandIds','brand-old','brand-new']]){field(name,oldId).click();await tick();field(name,newId).click();await tick();}
  field('ownerIds','owner-old').click();await tick();field('ownerIds','owner-other').click();await tick();
  field('ownerIds','owner-new').click();await tick();
  field('fatherReportedName').value='Nuevo padre externo';
  submit();await until(()=>window.backCount===2);await tick();
  check(window.calls.map(call=>call.section).join(',')==='details,owners,catalogs,brands,parents','All sections saved');
  check(window.calls.map(call=>call.expectedVersion).join(',')==='7,8,9,10,11','Versions must advance in order');
  check(window.calls[0].name==='Lucera corregida'&&window.calls[0].earTagCode==='A2','Identity fields saved');
  check(window.calls[1].owners[0].partyId==='owner-new'&&window.calls[1].owners[0].percent===100,'Owner update');
  check(window.calls[2].breedIds[0]==='breed-new'&&window.calls[2].colorIds[0]==='color-new','Catalog update');
  check(window.calls[3].brandIds[0]==='brand-new','Brand update');
  check(window.calls[4].father.reportedName==='Nuevo padre externo','Parent update');
  field('description').value='Edición parcial';field('colorIds','color-new').click();await tick();
  window.failSection='catalogs';submit();await until(()=>!form().querySelector('fieldset').disabled);await tick();
  check(window.backCount===2,'Failed save must keep form open');
  check(field('description').value==='Edición parcial'&&!field('colorIds','color-new').checked,'Keep draft after partial save');
  check(document.querySelector('[role="alert"]').textContent.includes('Se guardó parte'),'Partial save is reported');
  window.failSection=null;submit();await until(()=>window.backCount===3);await tick();
  check(window.calls.at(-1).section==='catalogs'&&window.calls.at(-1).expectedVersion===13,'Retry uses latest version');
  check(window.calls.filter(call=>call.section==='details').length===2,'Retry must not repeat saved changes');
  field('ownerIds','owner-new').click();await tick();field('description').value='No guardar';submit();await tick();
  check(window.calls.length===8&&window.backCount===3,'Invalid owners must block every write');
  flushSync(()=>animalRoot.render(createElement(AnimalPanel,{key:'create',accessToken:'test',canCreate:true,canUpdate:true,
    canViewCatalogs:true,canViewMedia:false,canManageMedia:false,canViewLocations:false,modules:[],initialCreate:true,
    onCreated(id){window.createdAnimal=id;},onNavigate(){}})));
  await until(()=>document.querySelector('.animal-create [name="ownerIds"]'));
  check(document.querySelector('.animal-create').closest('[role="dialog"]'),'Animal creation opens in a separate dialog');
  async function choose(name,value){const select=field(name);select.nextElementSibling.click();await tick();
    const label=[...select.options].find(option=>option.value===value).textContent;
    [...document.querySelectorAll('[role="option"]')].find(option=>option.textContent===label).click();await tick();}
  await choose('fatherMode','animal');await until(()=>field('fatherAnimalId')?.querySelector('option[value="adult-father"]'));
  check(!field('fatherAnimalId').querySelector('option[value="young-father"]'),'Young fathers are hidden in animal creation');
  check(field('fatherAnimalId').querySelector('option[value="unknown-father"]'),'Parents without birth date are allowed');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field('birthDate'),'2021-01-01');
  field('birthDate').dispatchEvent(new Event('input',{bubbles:true}));field('birthDate').dispatchEvent(new Event('change',{bubbles:true}));await tick();
  check(!field('fatherAnimalId').querySelector('option[value="adult-father"]'),'Parent age uses the calf birth date');
  await choose('fatherAnimalId','unknown-father');field('name').value='Animal nuevo';await choose('sex','FEMALE');await choose('groupId','group-a');
  field('ownerIds','owner-new').click();await tick();document.querySelector('.animal-create').requestSubmit();
  await until(()=>window.createdAnimal==='animal-created');
  check(!document.querySelector('.animal-detail'),'Creation calls the current profile route instead of opening the old profile');
  document.getElementById('result').textContent='PASS: saved selections, single save, sequential versions, partial retry, validation';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack;}
`;

const result=await build({root,configFile:false,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
  name:'animal-edit-test-api',enforce:'pre',
  resolveId(id,importer){
    if(id==='animal-edit-test'||id===root+'animal-edit-test')return '\0animal-edit-test';
    if(id==='./api'&&importer?.endsWith('/AnimalPanel.tsx'))return '\0animal-edit-api';
    if(importer==='\0animal-edit-test'&&id.startsWith('./src/'))return root+id.slice(2)+'.tsx';
  },
  load(id){if(id==='\0animal-edit-test')return entry;if(id==='\0animal-edit-api')return mockApi;},
}],build:{write:false,minify:false,lib:{entry:'animal-edit-test',formats:['es'],fileName:'test'},
  rolldownOptions:{output:{codeSplitting:false}}}});
const code=(Array.isArray(result)?result[0]:result).output.find(item=>item.type==='chunk').code;
const temporary=await mkdtemp(join(tmpdir(),'sgb-animal-edit-'));
try{
  const page=join(temporary,'test.html');
  await writeFile(page,'<div id="root"></div><pre id="result">PENDING</pre><script>'+ 
    'const report=e=>document.getElementById("result").textContent="FAIL: "+(e.message??e.reason);'+
    'window.addEventListener("error",report);window.addEventListener("unhandledrejection",report);'+
    '</script><script type="module">'+
    code.replaceAll('</script','<\\/script')+'</script>');
  const chrome=process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const {stdout}=await promisify(execFile)(chrome,['--headless','--disable-gpu','--no-first-run',
    '--no-default-browser-check','--disable-background-networking','--disable-component-update',
    '--user-data-dir='+join(temporary,'profile'),'--virtual-time-budget=10000','--dump-dom',page],
    {timeout:30000,maxBuffer:4*1024*1024,windowsHide:true});
  const outcome=stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1];
  assert.ok(outcome?.startsWith('PASS:'),outcome??'Browser did not return a result');
  console.log(outcome);
}finally{await rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
