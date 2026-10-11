export const mockApi=`
export class ApiRequestError extends Error{}
window.birthCalls=0;window.heatCalls=0;window.photoCalls=[];let coverFailed=false;
const pregnancy={id:'pregnancy-a',cowId:'cow-a',cowName:'Lucera',status:'CONFIRMED',confirmedOn:'2026-01-01',expectedBirthOn:'2026-10-10'};
const records={heats:[],services:[],births:[],losses:[],pregnancies:[pregnancy]};
export const getReproduction=async()=>records;
export const getReproductionCandidates=async()=>[{id:'cow-a',name:'Lucera',sex:'FEMALE',birthDate:'2018-01-01'},
 {id:'young-a',name:'Ternera pequeña',sex:'FEMALE',birthDate:'2026-01-01'}];
export const getReproductionSettings=async()=>({canManageRules:!window.restrictedRules,minimumCowMonths:18,minimumBullMonths:24,
 daysAfterBirthHeat:30,daysAfterBirthPregnancy:45,daysAfterLossHeat:21,daysAfterLossPregnancy:30,
 allowSecondHeat:true,allowFalseHeatInPregnancy:true,useLastValidHeat:true,maxMilkingDays:305});
export const recordBirth=async(_token,input)=>{window.birthCalls++;window.birthInput=input;return {id:'birth-a',occurredOn:input.occurredOn,calves:input.calves.map((calf,index)=>({...calf,id:'calf-'+index}))};};
export const uploadMedia=async(_token,input)=>{window.photoCalls.push({name:input.file.name,entityId:input.entityId,animalIds:input.animalIds,relationCode:input.relationCode});
 if(input.file.name==='cover.jpg'&&!coverFailed){coverFailed=true;throw new Error('Fotografía pendiente. Reintenta.');}return {id:'photo'};};
export const listGroups=async()=>[{id:'group-a',name:'Crías',active:true}];
export const listCatalogItems=async(_token,code)=>[{id:code+'-a',name:code==='BREEDS'?'Jersey':'Pinta',active:true}];
export const listOwners=async()=>[{id:'owner-a',name:'Ana',active:true}];
export const getMedia=async()=>[];export const deleteMediaObject=async()=>{};
export const createHeat=async()=>{window.heatCalls++;};export const createService=async()=>{};
export const createPregnancy=async()=>{};export const recordLoss=async()=>{};export const updateReproductionSettings=async()=>{};
export const cancelHeat=async()=>{};export const cancelPregnancy=async()=>{};export const cancelService=async()=>{};
`;
export const mockSession=`export const useV2Session=()=>({hasPermission:()=>true});`;
export const entry=`
import {createElement as h} from 'react';import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {ThemeProvider} from './src/theme/ThemeContext';import {ReproductionPanel} from './src/sgb-v2/ReproductionPanel';
const root=createRoot(document.getElementById('root'));let incarnation=0;
const render=()=>root.render(h(BrowserRouter,{},h(ThemeProvider,{},h(ReproductionPanel,{key:incarnation++,accessToken:'test',canManage:true}))));
const wait=async(test)=>{for(let n=0;n<400;n++){if(test())return;await new Promise(r=>setTimeout(r,25));}throw new Error('No apareció el resultado esperado.');};
const assert=(value,message)=>{if(!value)throw new Error(message);};
const click=label=>{const button=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===label||x.getAttribute('aria-label')===label);assert(button,'Botón '+label);button.click();};
const set=async(form,name,value)=>{const field=form.elements.namedItem(name);assert(field,'Campo '+name);
 if(field.tagName==='SELECT'){const label=[...field.options].find(option=>option.value===value)?.textContent;
  field.nextElementSibling.click();await wait(()=>document.querySelector('[role=option]'));
  const option=[...document.querySelectorAll('[role=option]')].find(node=>node.textContent===label);assert(option,'Opción '+value);option.click();
  await wait(()=>field.value===value);
 }else field.value=value;};
const photo=(form,name,fileName)=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array([255,216,255,217])],fileName,{type:'image/jpeg'}));form.elements.namedItem(name).files=transfer.files;form.elements.namedItem(name).dispatchEvent(new Event('change',{bubbles:true}));};
(async()=>{
 render();await wait(()=>document.querySelector('[aria-label="Reglas de reproducción"]'));
 click('Reglas de reproducción');await wait(()=>location.pathname==='/configuracion'&&new URLSearchParams(location.search).get('opcion')==='reproduccion');
 history.back();await wait(()=>location.pathname==='/');
 click('Próximos partos');await wait(()=>document.querySelector('.record-list-row'));assert(document.body.innerText.includes('Lucera'),'Se listan los próximos partos');
 click('Nuevo evento reproductivo');await wait(()=>document.querySelector('.reproduction-forms'));click('Parto');
 await wait(()=>document.querySelector('[name="calfGroup:0"] option[value="group-a"]'));const form=document.querySelector('.birth-registration-form');await set(form,'pregnancyId','pregnancy-a');await set(form,'calfName:0','Estrella');
 await set(form,'calfWeight:0','32.125');await set(form,'calfDescription:0','Mancha blanca');await set(form,'calfGroup:0','group-a');
 await set(form,'calfBreed:0','BREEDS-a');await set(form,'calfColor:0','COLORS-a');await set(form,'calfCondition:0','WEAK');
 click('Agregar cría');await wait(()=>form.elements.namedItem('calfName:1'));await set(form,'calfName:1','Ficha para quitar');
 click('Agregar cría');await wait(()=>form.elements.namedItem('calfName:2'));await set(form,'calfName:2','Brisa');
 await set(form,'calfSex:2','MALE');photo(form,'profilePhoto:2','brisa-profile.jpg');photo(form,'coverPhoto:2','brisa-cover.jpg');
 click('Quitar cría 2');await wait(()=>!form.elements.namedItem('calfName:2'));
 assert(form.elements.namedItem('calfName:1').value==='Brisa','Quitar una ficha intermedia conserva la siguiente');
 assert(form.elements.namedItem('profilePhoto:1').files[0].name==='brisa-profile.jpg','La foto sigue con su cría');
 assert(document.querySelector('.modal').getBoundingClientRect().width<=innerWidth,'El formulario cabe en móvil');
 assert(form.getBoundingClientRect().width>innerWidth*0.65,'El parto usa el ancho de la pantalla');
 photo(form,'birthPhoto','birth.jpg');photo(form,'profilePhoto:0','profile.jpg');photo(form,'coverPhoto:0','cover.jpg');
 await wait(()=>document.querySelectorAll('.birth-profile-preview img').length===5);
 window.birthPreviewReady=true;await wait(()=>!window.pauseBirthPreview);
 form.requestSubmit();form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 await wait(()=>document.body.innerText.includes('Fotografía pendiente'));
 assert(window.birthInput.calves.length===2&&window.birthInput.calves[1].name==='Brisa','Se registran las dos crías');
 assert(window.birthInput.calves[1].sex==='MALE','Cada cría conserva sus datos');
 assert(window.birthCalls===1,'Un solo parto al pulsar dos veces');assert(window.birthInput.calves[0].initialWeight===32.125,'Se envía el peso');
 assert(window.birthInput.calves[0].birthCondition==='WEAK','Se envía el estado');assert(window.birthInput.calves[0].description==='Mancha blanca','Se envía información');
 click('Completar fotografías');await wait(()=>!document.querySelector('.reproduction-forms'));
 assert(window.birthCalls===1,'Reintentar foto no duplica parto');assert(window.photoCalls.filter(x=>x.name==='birth.jpg').length===1,'No se repite la foto confirmada');
 assert(window.photoCalls.filter(x=>x.name==='profile.jpg').length===1,'No se repite el perfil');assert(window.photoCalls.filter(x=>x.name==='cover.jpg').length===2,'Se reintenta la portada pendiente');
 assert(window.photoCalls.find(x=>x.name==='profile.jpg').animalIds[0]==='calf-0','Perfil asignado a la cría');
 assert(window.photoCalls.find(x=>x.name==='brisa-profile.jpg').animalIds[0]==='calf-1','El perfil de la segunda cría corresponde a la segunda cría');
 assert(window.photoCalls.filter(x=>x.name==='brisa-cover.jpg').length===1,'La segunda portada se carga una vez');
 window.restrictedRules=true;render();await wait(()=>!document.querySelector('[aria-label="Reglas de reproducción"]'));
 assert(!document.querySelector('[aria-label="Reglas de reproducción"]'),'Un operador no administra reglas');click('Nuevo evento reproductivo');
 await wait(()=>document.querySelector('.reproduction-forms'));
 const heatForm=[...document.querySelectorAll('.reproduction-forms form')].find(x=>!x.hidden);await set(heatForm,'cowId','young-a');await set(heatForm,'startsOn','2026-10-10');heatForm.requestSubmit();
 await wait(()=>document.body.innerText.includes('debe tener al menos 18 meses'));assert(window.heatCalls===0,'La edad se valida antes de enviar');
 document.getElementById('result').textContent='PASS: multiple calf cards, stable removal/photos, mobile layout, retry without duplicates, settings shortcut and minimum-age preflight.';
})().catch(error=>document.getElementById('result').textContent='FAIL: '+error.message);
`;
