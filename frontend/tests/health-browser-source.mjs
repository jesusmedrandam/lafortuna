export const mockApi=`
export class ApiRequestError extends Error{}
const routes=['ORAL','INTRAMUSCULAR'].map(code=>({id:code,itemCode:code,name:code==='ORAL'?'Oral':'Intramuscular',active:true,systemDefined:true}));
const types=[{id:'antibiotic',name:'Antibiótico',active:true}];
const animals=[{id:'animal-a',name:'Lucera',classificationCode:'VACA',weightKg:450,weightOn:'2026-10-01',weightSource:'WEIGHING'},
 {id:'animal-b',name:'Luna',classificationCode:'TERNERO',weightKg:null}];
const units=[{code:'MILLILITER',name:'Mililitros',symbol:'ml'}];
let medicines=[{id:'medicine-a',version:1,name:'Medicamento prueba',kind:'OTRO',defaultUnitCode:'MILLILITER',active:true,
 administrationRoutes:['ORAL'],doseAmount:1,doseWeight:50,doseWeightUnitCode:'KILOGRAM'}];
export const getHealthMedicines=async()=>structuredClone(medicines);
export const getCatalogMedicines=getHealthMedicines;
export const getHealthOptions=async()=>({animals,units:window.emptyUnits?[]:units,groups:[],administrationRoutes:routes});
const oldTreatment={id:'campaign-old',medicineName:'Medicamento histórico',kind:'OTRO',status:'COMPLETADO',medicineId:'medicine-old',
  appliedOn:'2025-01-01',administrationRoute:'ORAL',responsible:'Ana',notes:'Tratamiento anterior',withdrawalMilkDays:2,withdrawalMeatDays:5,
  animals:[{animalId:'animal-a',name:'Lucera',selected:true,dose:3,unitCode:'MILLILITER',conditionId:'condition-old'}]};
export const getHealthCampaigns=async()=>[];export const getHealthConditions=async()=>window.showConditionHistory?
  [{id:'condition-old',animalId:'animal-a',animalName:'Lucera',kind:'Herida',detectedOn:'2025-01-01',description:'Condición anterior',treatmentCount:1,status:'RESUELTA'}]:[];
export const getHealthConditionTreatments=async()=>[oldTreatment];
export const listCatalogItems=async(_token,code)=>code==='ADMINISTRATION_ROUTES'?routes:code==='TREATMENT_TYPES'?types:
 code==='HEALTH_CONDITION_TYPES'?[{id:'condition-a',name:'Herida',active:true}]:[];
export const createHealthCampaign=async(_token,input)=>{window.savedTreatment=input;return {id:'campaign-a'};};
export const applyHealthCampaign=async()=>{};export const cancelHealthCampaign=async()=>{};export const updateHealthCampaign=async()=>{};
export const createHealthCondition=async(_token,input)=>{window.savedCondition=input;return {id:'condition-a'};};
export const updateHealthCondition=createHealthCondition;export const resolveHealthCondition=async()=>{};
const save=async(_token,input)=>{const saved={...input,id:'medicine-'+medicines.length,active:true};medicines.push(saved);window.savedMedicine=input;return saved;};
export const createHealthMedicine=save;
export const createCatalogMedicine=async(...args)=>{window.catalogWrite=true;return save(...args);};
export const updateCatalogMedicine=async(_token,id,medicine,active,expectedVersion)=>{
  window.editedMedicine={id,...medicine,active,version:expectedVersion+1};medicines=medicines.map(item=>item.id===id?window.editedMedicine:item);return window.editedMedicine;};
export const getCatalogReference=async()=>({species:[],units:window.emptyUnits?[]:units.map(unit=>({...unit,contextCode:'MEDICINE_DOSE'}))});
export const getAnimalClassificationPolicy=async()=>({femaleAdultMonths:24,maleAdultMonths:24,
 names:{VACA:'Vaca',VACONA:'Vacona',TERNERA:'Ternera',TORO:'Toro',TORETE:'Torete',TERNERO:'Ternero'}});
export const listOwners=async()=>[];export const listBrands=async()=>[];
export const listAccountUsers=async()=>[];export const createBrand=async()=>{};export const createCatalogItem=async()=>{};
export const createOwner=async()=>{};export const setBrandActive=async()=>{};export const setCatalogItemActive=async()=>{};
export const updateAnimalClassificationPolicy=async()=>{};export const updateBrandOwners=async()=>{};
`;
export const entry=`
import {createElement as h} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {BrowserRouter,Route,Routes} from 'react-router-dom';
import {HealthPanel} from './src/sgb-v2/HealthPanel';import {CatalogPanel} from './src/sgb-v2/CatalogPanel';
import {suggestedMedicineDose,medicineDoseReference} from './src/sgb-v2/MedicineForm';
const root=createRoot(document.getElementById('root'));const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
const check=(ok,message)=>{if(!ok)throw new Error(message);};
async function until(test){for(let n=0;n<150;n++){if(test())return;await tick();}throw new Error('Timeout: '+test);}
const button=(text,scope=document)=>[...scope.querySelectorAll('button')].find(node=>node.textContent.trim()===text);
const input=(name)=>document.querySelector('[name="'+name+'"]');
function type(node,value){const prototype=node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
 Object.getOwnPropertyDescriptor(prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));}
async function select(title,label){const trigger=[...document.querySelectorAll('.v2-search-select-trigger')].find(node=>node.parentElement.textContent.includes(title));
 check(trigger,'Missing trigger '+title);trigger.click();await until(()=>document.querySelector('.v2-search-select-sheet'));await tick();
 check(document.activeElement.tagName!=='INPUT','Selector should not focus keyboard input');
 const choice=[...document.querySelectorAll('.v2-search-select-options button')].find(node=>node.querySelector('strong')?.textContent===label);
 check(choice,'Missing option '+label);choice.click();await until(()=>!document.querySelector('.v2-search-select-sheet'));}
const renderHealth=props=>flushSync(()=>root.render(h(BrowserRouter,null,h(HealthPanel,props))));
const renderCatalog=(canEdit=false)=>root.render(h(BrowserRouter,null,h(CatalogPanel,{accessToken:'test',canManage:true,canEditMedicines:canEdit})));
const render=(action,token='test')=>renderHealth({key:action,accessToken:token,canManage:true,initialAnimalId:'animal-a',initialAction:action,
 onCompleted:()=>{window.completedActions=(window.completedActions??0)+1;}});
try{
 const base={doseAmount:1,doseWeight:50,doseWeightUnitCode:'KILOGRAM'};
 check(suggestedMedicineDose(base,{weightKg:450})===9,'Kg reference');
 check(suggestedMedicineDose({...base,doseWeight:100,doseWeightUnitCode:'POUND'},{weightKg:453.59237})===10,'Pound reference');
 check(suggestedMedicineDose(base,{})===null,'Missing weight never invents dose');
 check(suggestedMedicineDose({...base,doseWeight:null},{})===1,'Fixed reference');
 render('CONDICION');await until(()=>input('description'));
 type(input('description'),'Herida registrada');await select('Tipo de problema','Herida');
 const conditionForm=input('description');check(conditionForm,'Selection retains condition form');
 window.dispatchEvent(new CustomEvent('sgb-v2-cache-updated',{detail:{path:'/health-records/options'}}));
 await new Promise(resolve=>setTimeout(resolve,200));
 check(input('description')===conditionForm&&conditionForm.value==='Herida registrada','Cache refresh retains form');
 render('CONDICION','renewed');await tick();await tick();
 check(input('description')===conditionForm&&conditionForm.value==='Herida registrada','Renewal retains form');
 const trigger=[...document.querySelectorAll('.v2-search-select-trigger')].find(node=>node.parentElement.textContent.includes('Tipo de problema'));
 trigger.click();await until(()=>document.querySelector('.v2-search-select-sheet'));
 document.querySelector('.v2-search-select-sheet button').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await tick();
 check(!document.querySelector('.v2-search-select-sheet')&&input('description'),'Escape closes selector alone');
 input('description').closest('form').requestSubmit();await until(()=>window.savedCondition);
 check(window.savedCondition.kind==='Herida'&&window.savedCondition.description==='Herida registrada','Condition value saved');
 render('TRATAMIENTO_PREVENTIVO');await until(()=>input('defaultDose'));
 await select('Medicamento','Medicamento prueba');await tick();
 check(input('defaultDose').placeholder==='9','Dose reference displayed');
 check(input('defaultDose').parentElement.textContent.includes('450 kg'),'Weight source shown');
 const routeTrigger=[...document.querySelectorAll('.v2-search-select-trigger')].find(node=>node.parentElement.textContent.startsWith('Vía'));
 routeTrigger.click();await until(()=>document.querySelector('.v2-search-select-sheet'));
 check(!button('Intramuscular',document.querySelector('.v2-search-select-options')),'Medicine routes constrain selector');
 button('Oral',document.querySelector('.v2-search-select-options')).click();await tick();
 await select('Unidad de dosis','Mililitros');
 check(input('date').parentElement.querySelector('.readable-date-value').textContent.match(/\\d+ [a-z]+ 2026/),'Native date input presents month names');
 input('defaultDose').closest('form').requestSubmit();await until(()=>window.savedTreatment);
 check(window.savedTreatment.animals[0].dose===9,'Computed dose submitted');
 window.emptyUnits=true;
 renderCatalog();await until(()=>button('Medicamentos'));button('Medicamentos').click();await until(()=>button('Nuevo medicamento'));
 button('Nuevo medicamento').click();await until(()=>input('name'));
 check(![...document.querySelectorAll('label span')].some(node=>node.textContent==='Tipo *'),'Distinct medicine labels');
 check(button('Guardar medicamento').disabled,'Unit is mandatory');
 const completedBeforeMedicine=window.completedActions;
 await select('Unidad de dosis','Mililitro');
 type(input('name'),'Medicina nueva');await select('Referencia de dosis','Según el peso');
 type(input('amount'),'2');type(input('weight'),'100');await tick();
 const oral=[...document.querySelectorAll('.medicine-routes label')].find(node=>node.textContent==='Oral').querySelector('input');oral.click();await tick();
 input('name').closest('form').requestSubmit();await until(()=>window.savedMedicine);
 check(window.savedMedicine.doseAmount===2&&window.savedMedicine.doseWeight===100,'Structured medicine dose saved');
 check(window.savedMedicine.administrationRoutes.join()==='ORAL','Selected routes saved');
 check(window.completedActions===completedBeforeMedicine,'Medicine registration does not finish animal treatment action');
 render('TRATAMIENTO');await until(()=>input('defaultDose'));await select('Medicamento','Medicina nueva');
 type(input('defaultDose'),'12');await tick();window.savedTreatment=null;
 input('defaultDose').closest('form').requestSubmit();await until(()=>window.savedTreatment);
 check(window.savedTreatment.animals[0].dose===12,'Manual dose overrides reference');
 renderHealth({key:'group',accessToken:'test',canManage:true});
 await until(()=>button('Jornadas colectivas'));
 button('Jornadas colectivas').click();await tick();button('+ Jornada').click();await until(()=>input('defaultDose'));
 await select('Medicamento','Medicamento prueba');await select('Selección','Toda la propiedad');await tick();
 check(document.querySelector('[aria-label="Dosis de Lucera"]').value==='9','Calculated dose for each group animal');
 window.savedTreatment=null;input('defaultDose').closest('form').requestSubmit();await tick();
 check(!window.savedTreatment&&document.querySelector('[role="alert"]')?.textContent.includes('dosis válida'),'Missing weight requires manual dose');
 type(document.querySelector('[aria-label="Dosis de Luna"]'),'12');await tick();
 input('defaultDose').closest('form').requestSubmit();await until(()=>window.savedTreatment);
 check(window.savedTreatment.animals.find(item=>item.animalId==='animal-a').dose===9&&
 window.savedTreatment.animals.find(item=>item.animalId==='animal-b').dose===12,'Group reference and individual override');
 renderCatalog();await until(()=>button('Nuevo medicamento'));button('Nuevo medicamento').click();await until(()=>input('name'));
 type(input('name'),'Medicina por clasificación');await select('Unidad de dosis','Mililitro');
 [...document.querySelectorAll('.medicine-routes input')][0].click();await tick();
 await select('Referencia de dosis','Según la clasificación');
 for(const name of ['Vaca','Ternero'])[...document.querySelectorAll('fieldset label')].find(node=>node.textContent===name).querySelector('input').click();
 await tick();type(input('min-VACA'),'5');type(input('max-VACA'),'3');
 type(input('min-TERNERO'),'3');type(input('max-TERNERO'),'5');await tick();window.savedMedicine=null;
 input('name').closest('form').requestSubmit();await tick();check(!window.savedMedicine&&document.querySelector('[role="alert"]'),'Invalid range rejected');
 type(input('max-VACA'),'10');await tick();input('name').closest('form').requestSubmit();await until(()=>window.savedMedicine);
 check(window.savedMedicine.doseAmount===null&&window.savedMedicine.doseClassificationRanges.length===2,'Classification ranges saved');
 render('TRATAMIENTO_PREVENTIVO');await until(()=>input('defaultDose'));await select('Medicamento','Medicina por clasificación');
 check(input('defaultDose').parentElement.textContent.includes('Vaca: 5–10 ml'),'Matching classification range shown');
 check(input('defaultDose').value==='','Range does not invent an applied dose');
 type(input('defaultDose'),'7.5');await tick();window.savedTreatment=null;
 input('defaultDose').closest('form').requestSubmit();await until(()=>window.savedTreatment);
 check(window.savedTreatment.animals[0].dose===7.5,'Editable classification dose submitted');
 renderHealth({key:'missing-weight',accessToken:'test',canManage:true,initialAnimalId:'animal-b',initialAction:'TRATAMIENTO'});
 await until(()=>input('defaultDose'));await select('Medicamento','Medicina por clasificación');
 check(input('defaultDose').parentElement.textContent.includes('Ternero: 3–5 ml'),'Classification reference works without weight');
 await select('Medicamento','Medicamento prueba');
 check(input('defaultDose').parentElement.textContent.includes('1 ml por 50 kg')&&input('defaultDose').value==='','Configured weight reference shown without weight');
 check(!input('defaultDose').parentElement.textContent.includes('Sin peso disponible'),'Missing weight shows only configuration');
 check(medicineDoseReference({defaultUnitCode:'MILLILITER',doseClassificationRanges:[{classificationCode:'TORO',min:5,max:10}]},
  {classificationCode:'VACA'},[]).startsWith('Sin rango para Vaca'),'Unmatched classification is explicit');
 history.replaceState(null,'','/');window.dispatchEvent(new PopStateEvent('popstate'));
 renderCatalog();await until(()=>button('Medicamentos'));
 button('Unidades de dosis').click();await tick();check(document.body.textContent.includes('Miligramo')&&document.body.textContent.includes('Mililitro'),'Dose units catalog visible with old downloads');
 history.back();await until(()=>button('Medicamentos'));
 button('Medicamentos').click();await until(()=>button('Nuevo medicamento'));button('Nuevo medicamento').click();await until(()=>input('name'));
 type(input('name'),'Medicina catálogo');await select('Unidad de dosis','Mililitro');[...document.querySelectorAll('.medicine-routes input')][0].click();await tick();
 input('name').closest('form').requestSubmit();await until(()=>window.catalogWrite);
 check(window.savedMedicine.name==='Medicina catálogo','Medicine registered from catalog endpoint');
 await until(()=>!input('name'));document.querySelector('.catalog-detail-row').click();await until(()=>document.querySelector('.catalog-detail-grid'));
 check(!button('Editar medicamento'),'Catalog contributors cannot edit medicines');
 renderCatalog(true);await until(()=>button('Editar medicamento'));button('Editar medicamento').click();await until(()=>input('name'));
 check(input('name').value==='Medicamento prueba'&&input('amount').value==='1'&&input('weight').value==='50','Medicine configuration is prefilled');
 type(input('name'),'Medicamento corregido');await tick();input('name').closest('form').requestSubmit();await until(()=>window.editedMedicine);
 check(window.editedMedicine.name==='Medicamento corregido'&&window.editedMedicine.version===2,'Administrator can save versioned medicine edits');
 history.back();await tick();history.back();await tick();
 window.showConditionHistory=true;
 renderHealth({key:'condition-history',accessToken:'test',canManage:false,initialAnimalId:'animal-a'});
 await until(()=>document.querySelector('.health-record-row'));document.querySelector('.health-record-row').click();
 await until(()=>document.querySelector('.health-related'));check(document.querySelector('.health-related').textContent.includes('Medicamento histórico'),'Condition fetches treatments outside the general list');
 document.querySelector('.health-related').click();await until(()=>document.getElementById('treatment-detail-title'));
 check(document.querySelector('.health-detail').textContent.includes('3 ml')&&document.querySelector('.health-detail').textContent.includes('1 ene 2025'),'Linked treatment opens readable date and applied dose');
 check(document.querySelector('.health-detail').textContent.includes('Tratamiento anterior'),'Treatment observations preserved');window.showConditionHistory=false;
 render('CONDICION');await until(()=>input('description'));const beforeCancel=window.completedActions;
 button('Cancelar').click();await until(()=>window.completedActions===beforeCancel+1&&!input('description'));
 render('TRATAMIENTO_PREVENTIVO');await until(()=>input('defaultDose'));const beforeTreatmentCancel=window.completedActions;
 button('Cancelar').click();await until(()=>window.completedActions===beforeTreatmentCancel+1&&!input('defaultDose'));
 history.replaceState(null,'','/sanidad');window.dispatchEvent(new PopStateEvent('popstate'));
 flushSync(()=>root.render(h(BrowserRouter,null,h(Routes,null,
   h(Route,{path:'/sanidad',element:h(HealthPanel,{accessToken:'test',canManage:false,canViewMedicines:true})}),
   h(Route,{path:'/catalogos',element:h(CatalogPanel,{accessToken:'test',canManage:false})})))));
 await until(()=>document.querySelector('[aria-label="Administrar medicamentos"]'));
 const shortcut=document.querySelector('[aria-label="Administrar medicamentos"]');
 check(shortcut.querySelector('svg')&&!shortcut.textContent.includes('+'),'Medicine administration uses a syringe icon');
 shortcut.click();await until(()=>document.querySelector('.catalog-detail-row'));
 check(location.search==='?catalogo=MEDICINES'&&!button('Nuevo medicamento'),'Shortcut opens the medicine list with view-only permissions');
 document.getElementById('result').textContent='PASS: dose units, routes, catalog administration and permissions, classification references, treatment history, syringe shortcut';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack;}
`;
