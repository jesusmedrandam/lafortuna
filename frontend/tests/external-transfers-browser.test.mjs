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
window.transferWrites=[];window.refreshed=[];
const animal={id:'old-id',name:'Lucera',sex:'FEMALE',classification:{code:'VACA',name:'Vaca'},birthDate:null,
 entryDate:'2025-01-01',owners:[{id:'owner',name:'Ana',percent:50}],breeds:[],brands:[],group:{name:'Vacas'},location:{name:'Norte'}};
const request={id:'request-a',status:'PENDING',version:2,sourcePropertyId:'origin',sourcePropertyName:'Finca Norte',destinationPropertyId:'destination',destinationPropertyName:'Finca Sur',
 movementOn:'2026-10-14',reason:'Traslado',animals:[{sourceAnimalId:'old-id',destinationAnimalId:null,profile:animal,
 history:[{id:'birth-a',module:'REPRODUCTION',title:'Parto',date:'2026-09-01',sourcePropertyName:'Finca Norte',notes:'Parto normal',lines:['1 cría viva']}],media:[],processes:{pregnancy:false,conditions:0,milking:true}}]};
export const getExternalTransfers=async()=>[structuredClone(request)];
export const getExternalTransferSettings=async()=>({enabled:true,canManage:true,canRequest:true,receiveCode:'test-code'});
export const setExternalTransferSettings=async(_t,enabled)=>({enabled,canManage:true,canRequest:true,receiveCode:'test-code'});
export const getMovementOptions=async()=>({groups:[{id:'group-a',name:'Vacas Sur',propertyId:'destination',locationId:'place',locationName:'Sur'}],animals:[{id:'old-id',name:'Lucera'}]});
export const lookupExternalDestination=async()=>({id:'other',name:'Finca vecina',ownerName:'Ana'});
export const createExternalTransfer=async(_t,input)=>{window.transferWrites.push({action:'create',input});return {...request,id:'request-new',sourcePropertyId:'destination',destinationPropertyId:'other'};};
export const respondExternalTransfer=async(_t,id,action,input)=>{window.transferWrites.push({action,id,input});return {...request,status:action==='accept'?'ACCEPTED':'CANCELLED',version:3,
 animals:request.animals.map(row=>({...row,destinationAnimalId:'new-id'}))};};
`;
const entry=`
import {createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {ExternalTransfersPanel} from './src/sgb-v2/ExternalTransfersPanel';
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const tick=()=>new Promise(resolve=>setTimeout(resolve,25));
async function until(condition){for(let n=0;n<100;n++){if(condition())return;await tick();}throw new Error('Timeout '+document.body.innerText);}
const button=text=>[...document.querySelectorAll('button')].find(row=>row.textContent.trim()===text);
const root=createRoot(document.getElementById('root'));
root.render(createElement(MemoryRouter,{initialEntries:['/movimientos?externos=1&solicitud=request-a']},createElement(ExternalTransfersPanel,{accessToken:'test',propertyId:'destination'})));
try{
 await until(()=>button('Aceptar e ingresar animales'));
 check(button('Aceptar e ingresar animales').disabled,'Reception must require group');
 check(document.body.textContent.includes('Lucera')&&document.body.textContent.includes('Parto normal'),'Readable animal history');
 const select=document.querySelector('.v2-search-select-trigger');check(select,'Group selector');select.click();await tick();
 const option=[...document.querySelectorAll('button')].find(row=>row.textContent.includes('Vacas Sur'));check(option,'Only destination group');option.click();await tick();
 check(!button('Aceptar e ingresar animales').disabled,'Chosen destination group enables acceptance');
 button('Aceptar e ingresar animales').click();await until(()=>window.transferWrites.length===1&&window.refreshed.length>0);
 check(window.transferWrites[0].input.groupId==='group-a'&&window.transferWrites[0].input.expectedVersion===2,'Reviewed version and group sent');
 check(document.body.textContent.includes('Aceptado'),'Accepted status shown');
 check(window.refreshed.includes('/animals/new-id')&&window.refreshed.includes('/animals/new-id/received-history'),'Received profile/history refreshed');
 root.unmount();const second=createRoot(document.getElementById('root'));window.offline=true;
 second.render(createElement(MemoryRouter,{initialEntries:['/movimientos?externos=1&solicitud=request-a']},createElement(ExternalTransfersPanel,{accessToken:'test',propertyId:'destination'})));
 await until(()=>button('Aceptar e ingresar animales'));check(button('Aceptar e ingresar animales').closest('fieldset').disabled,'Offline decisions disabled');
 check(document.body.textContent.includes('Conéctate'),'Offline explanation');
 document.getElementById('result').textContent='PASS: transfer review, mandatory destination group, checked version, refreshed profile/history, offline decision blocked';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack;}
`;
const result=await build({root,configFile:false,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
  name:'external-transfer-test-api',enforce:'pre',
  resolveId(id,importer){
    if(id==='external-transfer-test'||id===root+'external-transfer-test')return '\0external-transfer-test';
    if(id==='./api'&&importer?.endsWith('/ExternalTransfersPanel.tsx'))return '\0external-transfer-api';
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
    '--user-data-dir='+join(temporary,'profile'),'--virtual-time-budget=10000','--dump-dom',page],
    {timeout:30000,maxBuffer:4*1024*1024,windowsHide:true});
  const outcome=stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1];
  assert.ok(outcome?.startsWith('PASS:'),outcome??'Browser did not return a result');
  console.log(outcome);
}finally{await rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
