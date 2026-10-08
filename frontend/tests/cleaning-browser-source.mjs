export const mockApi=`
export class ApiRequestError extends Error{}
const base={locationId:'north',locationName:'Potrero Norte',areaType:'PARCIAL',partialPercent:50,areaValue:2,areaUnitCode:'HECTARE',
  activities:['FUMIGACION'],applicationUnit:'TANQUES',applicationCount:3,tankCapacityLiters:100,version:1,
  products:[{productId:'old',productName:'Producto anterior',unitCode:'MILLILITER',quantityPerApplication:2,totalQuantity:6,notes:'Mezcla registrada'}],
  operators:[{name:'Ana',function:'Aplicadora',notes:'Usó protección'}],notes:'Observación general',createdAt:'2026-09-21T12:00:00Z'};
let records=[{...base,id:'complete',startedOn:'2026-09-21',finishedOn:'2026-09-22',status:'COMPLETADO'},
  {...base,id:'draft',startedOn:'2026-09-20',finishedOn:null,status:'BORRADOR'},
  {...base,id:'cancelled',locationId:'south',locationName:'Potrero Sur',startedOn:'2026-09-19',status:'CANCELADO',activities:['DESBROCE'],products:[],operators:[]}];
export const getCleanings=async()=>structuredClone(records);
export const getCleaningOptions=async()=>({locations:[{id:'north',name:'Potrero Norte',areaValue:4,areaUnitCode:'HECTARE'},
  {id:'south',name:'Potrero Sur',areaValue:2,areaUnitCode:'HECTARE'}],units:[{code:'MILLILITER',name:'Mililitros',symbol:'ml'}]});
let products=[{id:'old',version:1,name:'Producto anterior',active:false,description:'Anterior'},
 {id:'new',version:1,name:'Producto disponible',active:true,category:'Herbicida',activeIngredient:'Ingrediente',formulatedBy:'Fabricante'}];
export const getCleaningProducts=async()=>structuredClone(products);
export const updateCleaningProduct=async(_token,id,input)=>{window.productEdited=input;products=products.map(row=>row.id===id?{...row,...input,version:row.version+1}:row);return products.find(row=>row.id===id);};
export const listCatalogItems=async()=>[];export const createCleaningProduct=async()=>{};export const uploadMedia=async()=>{};
export const createCleaning=async(_token,input)=>{window.cleaningCreated=input;const saved={...base,...input,id:'new-record',status:'BORRADOR'};records.push(saved);return saved;};
export const updateCleaning=async(_token,id,input)=>{window.cleaningUpdated=input;records=records.map(row=>row.id===id?{...row,...input,version:2}:row);return records.find(row=>row.id===id);};
export const applyCleaning=async(_token,id)=>{window.cleaningApplied=id;records=records.map(row=>row.id===id?{...row,status:'COMPLETADO'}:row);};
export const getAnimals=async()=>({items:[],hasMore:false});export const getMediaUsage=async()=>({storedBytes:0,limitBytes:100});
export const deleteMediaObject=async()=>{};export const updateMediaDetails=async()=>{};
const photo=(id,type,object=id)=>({id,entity_type:type,entity_id:id,entity_name:id,storage_object_id:object,kind:'IMAGE',url:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',byteSize:10,tags:[],created_at:'2026-10-01T12:00:00Z'});
export const getMedia=async()=>[photo('animal','ANIMAL'),photo('birth-animal','ANIMAL','birth'),photo('birth','REPRODUCTION_BIRTH','birth'),photo('move','LIVESTOCK_MOVEMENT'),photo('clean','CLEANING'),photo('health','HEALTH_CAMPAIGN')];
export const cancelCleaning=async(_token,id)=>{records=records.map(row=>row.id===id?{...row,status:'CANCELADO'}:row);};
`;
export const entry=`
import {createElement as h} from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';
import {MediaPanel} from './src/sgb-v2/MediaPanel';
import {CleaningPanel} from './src/sgb-v2/CleaningPanel';import {AnimalIcon} from './src/components/AnimalIcon';
const root=createRoot(document.getElementById('root'));const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
const check=(ok,message)=>{if(!ok)throw new Error(message);};
async function until(test){for(let n=0;n<150;n++){if(test())return;await tick();}throw new Error('Timeout: '+test);}
const button=text=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===text);
const change=(node,value)=>{const proto=node.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));};
const field=title=>[...document.querySelectorAll('label')].find(node=>node.querySelector('span')?.textContent===title)?.querySelector('input,select');
const rows=()=>[...document.querySelectorAll('.cleaning-summary-row')];
function render(manage=true){root.render(h(BrowserRouter,null,h('div',{className:'sgb-v2-shell'},
  h(CleaningPanel,{key:String(manage),accessToken:'test',canManage:manage,canEditProducts:manage,canViewMedia:false,canManageMedia:false}),
  h('div',{id:'animal-drawing'},h(AnimalIcon,{size:180})))));}
try{
  document.documentElement.style.setProperty('--primary','#276749');render();await until(()=>rows().length===3);
  const svg=document.querySelector('[data-animal-icon]');check(svg.getAttribute('fill')==='none'&&!svg.querySelector('rect'),'Cow SVG has no background');
  check(getComputedStyle(svg).stroke==='rgb(39, 103, 73)','Cow strokes use the chosen primary color');
  document.documentElement.style.setProperty('--primary','#7845ac');await tick();check(getComputedStyle(svg).stroke==='rgb(120, 69, 172)','Cow changes with the user palette');
  check(rows()[0].textContent.includes('Ana')&&rows()[0].textContent.includes('Producto anterior')&&rows()[0].textContent.includes('3 tanques'),'List summarizes labor, operator, products and applications');
  check(rows()[0].textContent.includes('21 sept 2026'),'List uses readable dates');rows()[0].click();await until(()=>document.querySelector('.cleaning-detail'));
  const detail=document.querySelector('.cleaning-detail').textContent;
  check(detail.includes('2 ml por tanque')&&detail.includes('6 ml en total')&&detail.includes('100 L')&&detail.includes('300 L'),'Detail shows quantities, capacity and applied volume');
  check(detail.includes('Mezcla registrada')&&detail.includes('Usó protección')&&!detail.includes('MILLILITER'),'Notes preserved and units readable');
  check(!button('Editar')&&!button('Completar'),'Completed history cannot be edited');history.back();await until(()=>!document.querySelector('.cleaning-detail'));
  document.querySelector('[aria-label="Filtros de limpieza"]').click();await until(()=>field('Estado'));change(field('Potrero'),'south');await until(()=>rows().length===1);
  check(rows()[0].textContent.includes('Potrero Sur'),'Pasture filter works');document.querySelector('[aria-label="Limpiar filtros"]').click();await until(()=>rows().length===3);
  change(field('Desde'),'2026-09-20');change(field('Hasta'),'2026-09-20');await until(()=>rows().length===1);
  check(rows()[0].textContent.includes('Borrador'),'Date range filters calendar dates');document.querySelector('[aria-label="Limpiar filtros"]').click();
  change(field('Estado'),'BORRADOR');await until(()=>rows().length===1);rows()[0].click();await until(()=>button('Editar'));button('Editar').click();
  await until(()=>document.querySelector('form'));check(document.querySelector('[aria-label="Producto"]').value==='old','Editing keeps the selected inactive product visible');
  check(document.querySelector('[aria-label="Observaciones del producto"]').value==='Mezcla registrada'&&document.querySelector('[aria-label="Observaciones del operador"]').value==='Usó protección','Notes are prefilled');
  change(document.querySelector('[aria-label="Producto"]'),'new');change(document.querySelector('[aria-label="Cantidad por aplicación"]'),'4');
  await until(()=>document.querySelector('[aria-label="Cantidad total utilizada"]').value==='12 ml');
  check(document.querySelector('[name="finishedOn"]').min==='2026-09-20','Finish date cannot precede start');
  check(document.documentElement.scrollWidth<=innerWidth,'Mobile cleanup form has no horizontal overflow');
  document.querySelector('form').requestSubmit();await until(()=>window.cleaningUpdated&&!document.querySelector('form'));
  check(window.cleaningUpdated.products[0].quantityPerApplication===4&&window.cleaningUpdated.expectedVersion===1,'Edited quantities use version checks');
  check(window.cleaningUpdated.operators[0].notes==='Usó protección','Saving preserves operator observations');
  rows()[0].click();await until(()=>button('Completar'));button('Completar').click();await until(()=>window.cleaningApplied==='draft'&&!document.querySelector('.cleaning-detail'));
  document.querySelector('[aria-label="Administrar productos"]').click();await until(()=>document.querySelector('.cleaning-product-catalog .catalog-detail-row'));
  const productRows=[...document.querySelectorAll('.cleaning-product-catalog .catalog-detail-row')];
  check(productRows[0].textContent.includes('Producto disponible'),'Products sorted active first');productRows[0].click();await until(()=>button('Editar producto'));
  check(document.querySelector('.catalog-detail-grid').textContent.includes('Ingrediente'),'Product details are readable');button('Editar producto').click();
  await until(()=>document.querySelector('input[name="name"]'));change(document.querySelector('input[name="name"]'),'Producto corregido');
  document.querySelector('.cleaning-product-catalog form').requestSubmit();await until(()=>window.productEdited&&!document.querySelector('.cleaning-product-catalog form'));
  check(window.productEdited.expectedVersion===1,'Product edit retains the opened version');history.back();await until(()=>!button('Editar producto'));
  history.back();await until(()=>!document.querySelector('.cleaning-product-catalog'));
  root.render(h(BrowserRouter,null,h('div',{className:'sgb-v2-shell animal-list-photo',style:{width:80,height:80}},h(AnimalIcon))));await tick();
  const large=document.querySelector('[data-animal-icon]');check(large.getBoundingClientRect().width>=64,'Animal drawing fills at least 80% of its frame');
  render(false);await until(()=>!document.querySelector('[aria-label="Nueva limpieza"]'));check(!document.querySelector('[aria-label="Nuevo producto"]'),'Read-only user has no creation controls');
  history.replaceState(null,'','/?limpieza=complete');window.dispatchEvent(new PopStateEvent('popstate'));await until(()=>document.querySelector('.cleaning-detail'));
  check(!button('Editar')&&!button('Completar'),'Direct links respect permissions');button('Cerrar').click();await until(()=>!document.querySelector('.cleaning-detail'));
  document.querySelector('[aria-label="Administrar productos"]').click();await until(()=>document.querySelector('.cleaning-product-catalog .catalog-detail-row'));
  check(!button('Nuevo producto'),'Read-only product list has no creation action');document.querySelector('.cleaning-product-catalog .catalog-detail-row').click();await tick();check(!button('Editar producto'),'Read-only products cannot be edited');
  root.render(h(BrowserRouter,null,h(MediaPanel,{accessToken:'test',permissions:['MEDIA_VIEW']})));await until(()=>document.querySelector('.media-category-tabs'));button('Todas').click();await until(()=>document.querySelectorAll('[data-media-module]').length>0);await tick();
  check(document.querySelectorAll('[data-media-module]').length===5,'Gallery count: '+document.querySelectorAll('[data-media-module]').length+' '+document.body.textContent.slice(-600));
  const badges=[...document.querySelectorAll('[data-media-module]')].map(node=>node.dataset.mediaModule);
  check(['animals','reproduction','movements','cleanings','health'].every(icon=>badges.includes(icon)),'Gallery badges follow the related module, including births also attached to animals');
  check([...document.querySelectorAll('[data-media-module]')].every(node=>node.querySelector('svg')),'Gallery uses module SVG icons');
  document.getElementById('result').textContent='PASS: pasture cleaning list, details, filters, applied quantities, notes, draft editing, permissions, browser back and transparent primary-color cow SVG';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack;}
`;
