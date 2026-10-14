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

const sessionMock=`export const useV2Session=()=>({session:{overview:{activeContext:{propertyId:'destination',roleId:'admin'}}}});`;
const runtimeMock=`export const isRuntimeOnline=()=>!window.offline;export const refreshCachedPaths=async paths=>{window.refreshed=paths;};`;
const mockApi=`
window.transferWrites=[];window.refreshed=[];window.lookups=[];window.internalWrites=[];window.visibilityWrites=[];
const policy=()=>({enabled:window.policyEnabled!==false,canManage:true,canRequest:true,canManageVisibility:true,
 visibility:window.visibility??'HIDDEN',visibleUntil:window.visibleUntil??null,effectiveVisibility:window.visibility??'HIDDEN'});
const animal={id:'old-id',name:'Lucera',sex:'FEMALE',classification:{code:'VACA',name:'Vaca'},birthDate:null,
 entryDate:'2025-01-01',owners:[{id:'owner',name:'Ana',percent:50}],breeds:[],brands:[],group:{name:'Vacas'},location:{name:'Norte'}};
const request={id:'request-a',status:'PENDING',version:2,sourcePropertyId:'origin',sourcePropertyName:'Finca Norte',destinationPropertyId:'destination',destinationPropertyName:'Finca Sur',
 movementOn:'2026-10-14',reason:'Traslado',animals:[{sourceAnimalId:'old-id',destinationAnimalId:null,profile:animal,
 history:[{id:'birth-a',module:'REPRODUCTION',title:'Parto',date:'2026-09-01',sourcePropertyName:'Finca Norte',notes:'Parto normal',lines:['1 cría viva']}],media:[],processes:{pregnancy:false,conditions:0,milking:true}}]};
export const getExternalTransfers=async()=>[structuredClone(request)];
export const getExternalTransferSettings=async()=>policy();
export const setExternalTransferSettings=async(_t,enabled)=>{window.policyEnabled=enabled;return policy();};
export const setExternalTransferVisibility=async(_t,input)=>{window.visibilityWrites.push(input);window.visibility=input.visibility;
 window.visibleUntil=input.durationDays?'2030-01-02T12:00:00Z':null;return policy();};
export const getMovementOptions=async()=>({properties:[{id:'destination',name:'Finca Sur'},{id:'internal',name:'Finca del mismo dueño'}],
 groups:[{id:'group-a',name:'Vacas Sur',propertyId:'destination',locationId:'place',locationName:'Sur'},
 {id:'group-internal',name:'Grupo interno',propertyId:'internal',locationId:'place-internal',locationName:'Interno'}],locations:[],animals:[{id:'old-id',name:'Lucera',groupId:'group-a'}]});
export const getMovements=async()=>[];export const listCatalogItems=async()=>[];
export class ApiRequestError extends Error{};
export const createMovement=async(_t,input)=>{window.internalWrites.push(input);return {id:'internal-draft'};};
export const applyMovement=async()=>({status:'COMPLETADO'});export const cancelMovement=async()=>{};export const updateMovement=async()=>{};
export const lookupExternalDestination=async(_t,email)=>{window.lookups.push(email);return email==='hidden@example.test'?[]:
 [{id:'other',name:'Finca vecina',ownerName:'Ana'},{id:'other-two',name:'Finca segunda',ownerName:'Ana'}];};
export const createExternalTransfer=async(_t,input)=>{window.transferWrites.push({action:'create',input});return {...request,id:'request-new',sourcePropertyId:'destination',destinationPropertyId:input.destinationPropertyId};};
export const respondExternalTransfer=async(_t,id,action,input)=>{window.transferWrites.push({action,id,input});return {...request,status:action==='accept'?'ACCEPTED':action==='reject'?'REJECTED':'CANCELLED',version:3,
 animals:request.animals.map(row=>({...row,destinationAnimalId:'new-id'}))};};
`;
const entry=`
import {createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {ExternalTransfersPanel} from './src/sgb-v2/ExternalTransfersPanel';
import {MovementPanel} from './src/sgb-v2/MovementPanel';
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const tick=()=>new Promise(resolve=>setTimeout(resolve,25));
async function until(condition){for(let n=0;n<100;n++){if(condition())return;await tick();}throw new Error('Timeout '+document.body.innerText);}
const button=text=>[...document.querySelectorAll('button')].find(row=>row.textContent.trim()===text);
const change=(node,value)=>{Object.getOwnPropertyDescriptor(node.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(node,value);
 node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));};
async function choose(label,text){const trigger=document.querySelector('[aria-label="'+label+'"]')??
 [...document.querySelectorAll('.movement-form label')].find(node=>node.firstElementChild?.textContent.trim()===label+' *')?.querySelector('button');
 check(trigger,'Missing selector: '+label);trigger.click();await tick();const option=[...document.querySelectorAll('[role="option"]')].find(node=>node.textContent.includes(text));
 check(option,'Missing option: '+text);option.click();await tick();}
const root=createRoot(document.getElementById('root'));
root.render(createElement(MemoryRouter,{initialEntries:['/movimientos?externos=1&solicitud=request-a']},createElement(ExternalTransfersPanel,{accessToken:'test',propertyId:'destination'})));
try{
 await until(()=>button('Aceptar e ingresar animales'));
 check(button('Aceptar e ingresar animales').disabled,'Reception must require group');
 check(document.getElementById('root').textContent.includes('Lucera')&&document.getElementById('root').textContent.includes('Parto normal'),'Readable animal history');
 const select=document.querySelector('.v2-search-select-trigger');check(select,'Group selector');select.click();await tick();
 const option=[...document.querySelectorAll('button')].find(row=>row.textContent.includes('Vacas Sur'));check(option,'Only destination group');option.click();await tick();
 check(!button('Aceptar e ingresar animales').disabled,'Chosen destination group enables acceptance');
 button('Aceptar e ingresar animales').click();await until(()=>window.transferWrites.length===1&&window.refreshed.length>0);
 check(window.transferWrites[0].input.groupId==='group-a'&&window.transferWrites[0].input.expectedVersion===2,'Reviewed version and group sent');
 check(document.getElementById('root').textContent.includes('Aceptado'),'Accepted status shown');
 check(window.refreshed.includes('/animals/new-id')&&window.refreshed.includes('/animals/new-id/received-history'),'Received profile/history refreshed');
 root.unmount();const second=createRoot(document.getElementById('root'));window.offline=true;
 second.render(createElement(MemoryRouter,{initialEntries:['/movimientos?externos=1&solicitud=request-a']},createElement(ExternalTransfersPanel,{accessToken:'test',propertyId:'destination'})));
 await until(()=>button('Aceptar e ingresar animales'));check(button('Aceptar e ingresar animales').closest('fieldset').disabled,'Offline decisions disabled');
 check(document.getElementById('root').textContent.includes('Conéctate'),'Offline explanation');
 second.unmount();window.offline=false;let current=createRoot(document.getElementById('root'));
 const renderMovement=()=>current.render(createElement(MemoryRouter,{},createElement(MovementPanel,{accessToken:'test',propertyId:'destination',
  canManage:true,canCancel:true,canChangeLocation:true,initialAnimalId:'old-id',initialAction:'PROPIEDAD',onCompleted:()=>{window.completed=(window.completed??0)+1;}})));
 renderMovement();await until(()=>document.querySelector('select[aria-label="Tipo de propiedad"]'));
 check(document.querySelector('select[aria-label="Tipo de propiedad"]').value==='INTERNAL','Internal property flow is selectable');
 await choose('Grupo de destino','Grupo interno');button('Guardar y aplicar').click();await until(()=>window.internalWrites.length===1);
 check(window.internalWrites[0].destinationPropertyId==='internal'&&window.internalWrites[0].animalIds[0]==='old-id','Internal destination and original animal retained');
 current.unmount();current=createRoot(document.getElementById('root'));renderMovement();await until(()=>document.querySelector('select[aria-label="Tipo de propiedad"]'));
 change(document.querySelector('select[aria-label="Tipo de propiedad"]'),'EXTERNAL');await until(()=>document.querySelector('input[name="ownerEmail"]'));
 check(!document.getElementById('root').textContent.includes('Código de'),'External discovery does not request a code');
 change(document.querySelector('select[aria-label="Tipo de propiedad"]'),'INTERNAL');await until(()=>document.querySelector('.movement-form'));
 change(document.querySelector('select[aria-label="Tipo de propiedad"]'),'EXTERNAL');await until(()=>document.querySelector('input[name="ownerEmail"]'));
 change(document.querySelector('input[name="ownerEmail"]'),'hidden@example.test');button('Buscar propiedades').click();await until(()=>document.getElementById('root').textContent.includes('No hay propiedades visibles'));
 check(!document.querySelector('[aria-label="Propiedad externa de destino"]'),'Hidden and unknown emails expose no property options');
 change(document.querySelector('input[name="ownerEmail"]'),'ANA@example.test');button('Buscar propiedades').click();await until(()=>document.querySelector('[aria-label="Propiedad externa de destino"]'));
 check(window.lookups.at(-1)==='ana@example.test','Exact owner email normalized');await choose('Propiedad externa de destino','Finca segunda');
 change(document.querySelector('input[name="reason"]'),'Cambio de propiedad');button('Enviar solicitud').click();await until(()=>window.transferWrites.some(row=>row.action==='create'));
 const created=window.transferWrites.find(row=>row.action==='create').input;
 check(created.destinationPropertyId==='other-two'&&!('receiveCode' in created)&&created.animalIds[0]==='old-id','Chosen external property and original selection sent');
 current.unmount();current=createRoot(document.getElementById('root'));
 current.render(createElement(MemoryRouter,{initialEntries:['/movimientos?externos=1&solicitud=request-a']},createElement(ExternalTransfersPanel,{accessToken:'test',propertyId:'destination'})));
 await until(()=>button('Rechazar solicitud'));button('Rechazar solicitud').click();await until(()=>document.getElementById('root').textContent.includes('Rechazado'));
 check(document.getElementById('root').textContent.includes('Rechazado'),'Receiver can reject instead of moving the animal');
 current.unmount();current=createRoot(document.getElementById('root'));window.policyEnabled=false;
 current.render(createElement(MemoryRouter,{},createElement(ExternalTransfersPanel,{accessToken:'test',propertyId:'destination'})));
 await until(()=>button('Solicitar traslado'));check(!button('Solicitar traslado').disabled,'Administrator can request without the legacy owner-only switch');
 change(document.querySelector('select[aria-label="Visibilidad para recibir traslados"]'),'COLLABORATORS');button('Guardar visibilidad').click();await until(()=>window.visibilityWrites.length===1);
 check(window.visibilityWrites[0].visibility==='COLLABORATORS','Collaborator visibility saved');await until(()=>!button('Guardar visibilidad').disabled);
 change(document.querySelector('select[aria-label="Visibilidad para recibir traslados"]'),'PUBLIC');await tick();
 change(document.querySelector('select[aria-label="Duración de la visibilidad"]'),'TEMPORARY');await until(()=>document.querySelector('input[name="durationDays"]'));
 change(document.querySelector('input[name="durationDays"]'),'2');button('Guardar visibilidad').click();await until(()=>window.visibilityWrites.length===2);
 check(window.visibilityWrites[1].durationDays===2&&window.visibilityWrites[1].visibility==='PUBLIC','Temporary public visibility sends days');
 document.getElementById('result').textContent='PASS: internal/external choice, owner email, selected property, privacy, preserved animals, administrator actions, approval/rejection, live policy updates and offline blocking';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack;}
`;
const result=await build({root,configFile:false,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
  name:'external-transfer-test-api',enforce:'pre',
  resolveId(id,importer){
    if(id==='external-transfer-test'||id===root+'external-transfer-test')return '\0external-transfer-test';
    if(id==='./api'&&['ExternalTransfersPanel.tsx','MovementPanel.tsx'].some(file=>importer?.endsWith('/'+file)))return '\0external-transfer-api';
    if(id==='./V2Session')return '\0transfer-session';
    if(id==='./offline/runtime')return '\0transfer-runtime';
    if(importer==='\0external-transfer-test'&&id.startsWith('./src/'))return root+id.slice(2)+'.tsx';
  },
  load(id){if(id==='\0transfer-session')return sessionMock;if(id==='\0transfer-runtime')return runtimeMock;if(id==='\0external-transfer-test')return entry;if(id==='\0external-transfer-api')return mockApi;},
}],build:{write:false,minify:false,lib:{entry:'external-transfer-test',formats:['es'],fileName:'test'},
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
    '--user-data-dir='+join(temporary,'profile'),'--virtual-time-budget=20000','--dump-dom',page],
    {timeout:45000,maxBuffer:4*1024*1024,windowsHide:true});
  const outcome=stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1];
  assert.ok(outcome?.startsWith('PASS:'),outcome??'Browser did not return a result');
  console.log(outcome);
}finally{await rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
