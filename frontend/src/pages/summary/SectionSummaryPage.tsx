import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowRight, ArrowRightLeft, Baby, Beef, CalendarDays, CircleDollarSign,
  HeartOff, Milk, PackagePlus, Sprout, Stethoscope, Weight, type LucideIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiRequest, apiRequestAllPages } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button, Card, ErrorState, LoadingState } from '../../components/ui';
import type { Animal } from '../../types/api';
import { currentDateInput, formatDate, formatNumber, humanizeCode } from '../../utils';

export type SummarySection = 'animales' | 'movimientos' | 'sanidad' | 'limpiezas' | 'reproduccion' | 'produccion' | 'pesajes' | 'muertes' | 'ventas' | 'compras';

interface SectionDefinition { label:string; description:string; route:string; icon:LucideIcon }
interface SummaryMetric { label:string; value:string; detail?:string; tone?:'green'|'blue'|'red'|'orange'|'cyan'|'pink'|'lime' }
interface SummaryHighlight { label:string; id:string; name:string; photo?:string|null; subtitle:string; value:string }
interface SummaryLine { label:string; value:string; detail?:string }
interface SummaryModel { metrics:SummaryMetric[]; highlights:SummaryHighlight[]; lines:SummaryLine[]; note?:string }
interface SummaryData { animals:Animal[]; collections:Record<string,Record<string,unknown>[]> }
interface AnimalSummaryPreference { oldestMode:'HIDDEN'|'AUTOMATIC'|'MANUAL'; manualOldestId:string }
export const ANIMAL_SUMMARY_PREFERENCE_KEY='sgb.animal-summary.preference.v1';
function animalSummaryPreference():AnimalSummaryPreference{try{const value=JSON.parse(localStorage.getItem(ANIMAL_SUMMARY_PREFERENCE_KEY)??'null') as Partial<AnimalSummaryPreference>|null;return{oldestMode:value?.oldestMode==='AUTOMATIC'||value?.oldestMode==='MANUAL'?value.oldestMode:'HIDDEN',manualOldestId:String(value?.manualOldestId??'')};}catch{return{oldestMode:'HIDDEN',manualOldestId:''};}}

const sections:Record<SummarySection,SectionDefinition>={
  animales:{label:'Animales',description:'Inventario y animales destacados',route:'/animales',icon:Beef},
  movimientos:{label:'Movimientos',description:'Traslados, rutas y animales movilizados',route:'/movimientos',icon:ArrowRightLeft},
  sanidad:{label:'Sanidad',description:'Condiciones, tratamientos y jornadas',route:'/sanidad',icon:Stethoscope},
  limpiezas:{label:'Limpieza de potreros',description:'Trabajos, potreros, productos y cumplimiento',route:'/limpiezas',icon:Sprout},
  reproduccion:{label:'Reproducción',description:'Celos, preñeces, partos y desempeño reproductivo',route:'/partos',icon:Baby},
  produccion:{label:'Producción',description:'Leche, lactancias y rendimiento por vaca',route:'/produccion',icon:Milk},
  pesajes:{label:'Pesajes',description:'Evolución de peso y animales controlados',route:'/pesajes',icon:Weight},
  muertes:{label:'Novedades y bajas',description:'Desapariciones, recuperaciones y muertes',route:'/muertes',icon:HeartOff},
  ventas:{label:'Ventas',description:'Ingresos, compradores, animales y productos',route:'/ventas',icon:CircleDollarSign},
  compras:{label:'Compras y egresos',description:'Gastos, proveedores y productos adquiridos',route:'/compras',icon:PackagePlus},
};

const endpoints:Record<SummarySection,string[]>={
  animales:['/animales?limit=100','/registros/producciones','/reproduccion/celos','/partos','/registros/pesajes'],
  movimientos:['/movimientos','/animales?limit=100'],
  sanidad:['/registros/tratamientos','/condiciones-salud','/jornadas-sanitarias','/animales?limit=100'],
  limpiezas:['/limpiezas-potrero'],
  reproduccion:['/reproduccion/celos','/reproduccion/preneces','/reproduccion/proximos-partos','/partos','/registros/abortos','/animales?limit=100'],
  produccion:['/registros/producciones','/registros/produccion-tanque','/registros/lactancias','/animales?limit=100'],
  pesajes:['/registros/pesajes','/animales?limit=100'],
  muertes:['/animales/novedades','/registros/muertes','/animales?limit=100'],
  ventas:['/ventas','/ventas/productos','/animales?limit=100'],
  compras:['/compras','/animales?limit=100'],
};

function records(value:unknown):Record<string,unknown>[] {
  if(Array.isArray(value))return value.filter((item):item is Record<string,unknown>=>Boolean(item&&typeof item==='object'));
  if(value&&typeof value==='object'&&Array.isArray((value as {data?:unknown}).data))return records((value as {data:unknown}).data);
  return [];
}

async function loadSummaryData(section:SummarySection):Promise<SummaryData>{
  const collections:Record<string,Record<string,unknown>[]>= {};
  const primary=endpoints[section][0];let primaryError:unknown;
  for(const path of endpoints[section]){
    try{collections[path]=path==='/animales?limit=100'
      ? records((await apiRequestAllPages<Animal>('/animales')).data)
      : records(await apiRequest<unknown>(path));}
    catch(error){if(path===primary)primaryError=error;collections[path]=[];}
  }
  if(primaryError)throw primaryError;
  return {animals:(collections['/animales?limit=100']??[]) as unknown as Animal[],collections};
}

function localDate(value:unknown){return String(value??'').slice(0,10);}
function dateShift(days:number){const date=new Date(`${currentDateInput()}T12:00:00`);date.setDate(date.getDate()+days);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function periodStart(period:'week'|'month'|'year'){
  const today=currentDateInput();const date=new Date(`${today}T12:00:00`);
  if(period==='week')date.setDate(date.getDate()-((date.getDay()+6)%7));
  else if(period==='month')date.setDate(1);
  else {date.setMonth(0);date.setDate(1);}
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function inPeriod(value:unknown,start:string,end=currentDateInput()){const date=localDate(value);return Boolean(date&&date>=start&&date<=end);}
function number(value:unknown){const parsed=Number(value??0);return Number.isFinite(parsed)?parsed:0;}
function money(value:unknown){return new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(number(value));}
function daysBetween(left:string,right:string){return Math.round((Date.parse(`${right}T12:00:00`)-Date.parse(`${left}T12:00:00`))/86_400_000);}
function valid(row:Record<string,unknown>){return row.deleted_at==null;}
function completed(row:Record<string,unknown>){return valid(row)&&row.estado!=='ANULADA'&&row.estado!=='CANCELADO';}

function topEntry(map:Map<string,{name:string;value:number}>,lowest=false){
  return [...map.entries()].filter(([,item])=>Number.isFinite(item.value)).sort((a,b)=>lowest?a[1].value-b[1].value:b[1].value-a[1].value)[0]??null;
}
function add(map:Map<string,{name:string;value:number}>,id:unknown,name:unknown,value=1){const key=String(id??'');if(!key)return;const old=map.get(key);map.set(key,{name:String(name??old?.name??'Animal'),value:(old?.value??0)+value});}
function countValues(rows:Record<string,unknown>[],value:(row:Record<string,unknown>)=>string){const map=new Map<string,number>();for(const row of rows){const key=value(row).trim();if(key)map.set(key,(map.get(key)??0)+1);}return [...map.entries()].sort((a,b)=>b[1]-a[1])[0]??null;}

function animalHighlight(label:string,entry:[string,{name:string;value:number}]|null,animals:Map<string,Animal>,subtitle:string,value:(amount:number)=>string):SummaryHighlight|null{
  if(!entry)return null;const [id,item]=entry;const animal=animals.get(id);
  return {label,id,name:animal?.nombre||item.name,photo:animal?.foto_perfil,subtitle:animal?.codigo_arete?`Arete ${animal.codigo_arete} · ${subtitle}`:subtitle,value:value(item.value)};
}

function buildAnimalModel(data:SummaryData,preference=animalSummaryPreference()):SummaryModel{
  const animals=data.animals.filter((item)=>item&&item.estado!=='ELIMINADO');const directory=new Map(animals.map((item)=>[item.id_animal,item]));
  const active=animals.filter((item)=>item.estado==='ACTIVO');const born=active.filter((item)=>Boolean(item.fecha_nacimiento)).sort((a,b)=>localDate(a.fecha_nacimiento).localeCompare(localDate(b.fecha_nacimiento)));
  const productions=data.collections['/registros/producciones']??[];const productionDays=new Map<string,{id:string;name:string;date:string;value:number}>();
  productions.filter(valid).forEach((row)=>{const id=String(row.id_vaca??'');const date=localDate(row.fecha_produccion);const liters=number(row.litros);if(!id||!date||liters<=0)return;const key=`${id}:${date}`;const old=productionDays.get(key);productionDays.set(key,{id,name:String(row.animal??row.vaca??old?.name??'Animal'),date,value:(old?.value??0)+liters});});
  const productionTotals=new Map<string,{name:string;value:number;days:number}>();productionDays.forEach(item=>{const old=productionTotals.get(item.id);productionTotals.set(item.id,{name:item.name,value:(old?.value??0)+item.value,days:(old?.days??0)+1});});
  const production=new Map<string,{name:string;value:number}>();productionTotals.forEach((item,id)=>production.set(id,{name:item.name,value:item.value/item.days}));
  const heats=new Map<string,{name:string;value:number}>();(data.collections['/reproduccion/celos']??[]).filter(valid).forEach((row)=>add(heats,row.id_vaca,row.vaca));
  const offspring=new Map<string,Set<string>>();animals.forEach(animal=>{if(!animal.id_madre)return;const children=offspring.get(animal.id_madre)??new Set<string>();children.add(animal.id_animal);offspring.set(animal.id_madre,children);});
  const birthDates=new Map<string,{name:string;dates:string[]}>();const births=(data.collections['/partos']??[]).filter(valid);
  births.forEach(row=>{const id=String(row.id_madre??'');if(id&&Array.isArray(row.crias)){const children=offspring.get(id)??new Set<string>();row.crias.forEach((child,index)=>{if(child&&typeof child==='object'){const item=child as Record<string,unknown>;children.add(String(item.id_cria??item.id_animal??item.id_parto_cria??`${row.id_parto}:${index}`));}});offspring.set(id,children);}const date=localDate(row.fecha_parto);if(id&&date){const old=birthDates.get(id)??{name:String(row.madre??'Animal'),dates:[]};old.dates.push(date);birthDates.set(id,old);}});
  const calves=new Map<string,{name:string;value:number}>();offspring.forEach((children,id)=>calves.set(id,{name:directory.get(id)?.nombre??birthDates.get(id)?.name??'Animal',value:children.size}));
  const intervals=new Map<string,{name:string;value:number}>();const longIntervals=new Map<string,{name:string;value:number}>();
  birthDates.forEach((item,id)=>{const dates=[...new Set(item.dates)].sort();for(let index=1;index<dates.length;index+=1){const days=daysBetween(dates[index-1],dates[index]);const shortest=intervals.get(id);const longest=longIntervals.get(id);if(!shortest||days<shortest.value)intervals.set(id,{name:item.name,value:days});if(!longest||days>longest.value)longIntervals.set(id,{name:item.name,value:days});}});
  const automaticOldest=born[0];const manualOldest=directory.get(preference.manualOldestId);const oldest=preference.oldestMode==='AUTOMATIC'?automaticOldest:preference.oldestMode==='MANUAL'?manualOldest:undefined;
  const highlights=[
    oldest?{label:'Animal más viejo',id:oldest.id_animal,name:oldest.nombre,photo:oldest.foto_perfil,subtitle:oldest.fecha_nacimiento?`Nació ${formatDate(oldest.fecha_nacimiento)}`:'Seleccionado manualmente',value:preference.oldestMode==='MANUAL'?'Selección manual':'Cálculo automático'}:null,
    animalHighlight('Mayor producción promedio',topEntry(production),directory,'promedio por día ordeñado',value=>`${formatNumber(value,2)} L/día`),
    animalHighlight('Menor producción promedio',topEntry(production,true),directory,'promedio por día ordeñado',value=>`${formatNumber(value,2)} L/día`),
    animalHighlight('Más celos registrados',topEntry(heats),directory,'historial reproductivo',value=>`${formatNumber(value)} celos`),
    animalHighlight('Más crías registradas',topEntry(calves),directory,'partos registrados',value=>`${formatNumber(value)} crías`),
    animalHighlight('Intervalo más corto entre partos',topEntry(intervals,true),directory,'entre dos partos',value=>`${formatNumber(value)} días`),
    animalHighlight('Intervalo más largo entre partos',topEntry(longIntervals),directory,'entre dos partos',value=>`${formatNumber(value)} días`),
  ].filter((item):item is SummaryHighlight=>Boolean(item));
  const principal=active.filter((item)=>item.categoria_codigo==='EN_PROPIEDAD');
  return {metrics:[
    {label:'Activos',value:formatNumber(active.length),detail:'Animales habilitados',tone:'green'},
    {label:'En propiedad',value:formatNumber(animals.filter((item)=>item.categoria_codigo==='EN_PROPIEDAD').length),detail:'Inventario propio',tone:'lime'},
    {label:'Fuera de propiedad',value:formatNumber(animals.filter((item)=>item.categoria_codigo==='FUERA_PROPIEDAD').length),detail:'Trasladados o vendidos',tone:'orange'},
    {label:'No activos',value:formatNumber(animals.length-active.length),detail:'Bajas y otros estados',tone:'red'},
    {label:'Partos este año',value:formatNumber(births.filter(item=>inPeriod(item.fecha_parto,periodStart('year'))).length),detail:'Registrados',tone:'blue'},
  ],highlights,lines:[
    {label:'Vacas',value:formatNumber(principal.filter((item)=>item.clasificacion_codigo==='VACA').length)},
    {label:'Vaconas',value:formatNumber(principal.filter((item)=>item.clasificacion_codigo==='VACONA').length)},
    {label:'Terneras',value:formatNumber(principal.filter((item)=>item.clasificacion_codigo==='TERNERA').length)},
    {label:'Toros y toretes',value:formatNumber(principal.filter((item)=>item.clasificacion_codigo==='TORO'||item.clasificacion_codigo==='TORETE').length)},
    {label:'Terneros',value:formatNumber(principal.filter((item)=>item.clasificacion_codigo==='TERNERO').length)},
    {label:'Hembras / machos',value:`${formatNumber(principal.filter((item)=>item.sexo==='HEMBRA').length)} / ${formatNumber(principal.filter((item)=>item.sexo==='MACHO').length)}`},
  ],note:'La producción suma los turnos del mismo día y calcula el promedio diario independiente de cada vaca. La descendencia se cuenta por hijos e hijas relacionados. Los destacados usan el historial disponible en este dispositivo.'};
}

function buildMovementModel(data:SummaryData):SummaryModel{
  const rows=(data.collections['/movimientos']??[]).filter(valid);const month=periodStart('month');const applied=rows.filter((item)=>item.estado==='COMPLETADO');const monthly=applied.filter((item)=>inPeriod(item.fecha_movimiento,month));
  const types=countValues(monthly,(item)=>humanizeCode(String(item.tipo_movimiento??'')));const routes=countValues(monthly,(item)=>`${String(item.origen_descripcion??item.ubicacion_origen??item.grupo_origen??item.propiedad_origen??'Origen')} → ${String(item.destino_descripcion??item.ubicacion_destino??item.grupo_destino??item.propiedad_destino??'Destino')}`);
  const moved=new Map<string,{name:string;value:number}>();monthly.forEach((row)=>(Array.isArray(row.detalles)?row.detalles:[]).forEach((detail)=>{if(detail&&typeof detail==='object'&&(detail as Record<string,unknown>).seleccionado!==false)add(moved,(detail as Record<string,unknown>).id_animal,(detail as Record<string,unknown>).animal??(detail as Record<string,unknown>).nombre);}));
  const directory=new Map(data.animals.map((item)=>[item.id_animal,item]));const top=animalHighlight('Animal con más movimientos',topEntry(moved),directory,'movimientos este mes',value=>`${formatNumber(value)} movimientos`);
  return {metrics:[{label:'Total',value:formatNumber(rows.length),detail:'Historial disponible',tone:'blue'},{label:'Este mes',value:formatNumber(monthly.length),detail:'Movimientos aplicados',tone:'green'},{label:'Borradores',value:formatNumber(rows.filter((item)=>item.estado==='BORRADOR').length),detail:'Pendientes de aplicar',tone:'orange'},{label:'Animales movilizados',value:formatNumber(moved.size),detail:'Distintos este mes',tone:'cyan'}],highlights:top?[top]:[],lines:[{label:'Tipo más frecuente',value:types?.[0]??'Sin datos',detail:types?`${types[1]} movimientos`:undefined},{label:'Ruta más utilizada',value:routes?.[0]??'Sin datos',detail:routes?`${routes[1]} movimientos`:undefined},{label:'Último movimiento',value:formatDate(String([...applied].sort((a,b)=>localDate(b.fecha_movimiento).localeCompare(localDate(a.fecha_movimiento)))[0]?.fecha_movimiento??''))}]};
}

function buildHealthModel(data:SummaryData):SummaryModel{
  const treatments=(data.collections['/registros/tratamientos']??[]).filter(valid);const conditions=(data.collections['/condiciones-salud']??[]).filter(valid);const campaigns=(data.collections['/jornadas-sanitarias']??[]).filter(valid);const month=periodStart('month');const monthly=treatments.filter((item)=>inPeriod(item.fecha_aplicacion,month));
  const treated=new Map<string,{name:string;value:number}>();monthly.forEach((row)=>add(treated,row.id_animal,row.animal));const medicine=countValues(monthly,(row)=>String(row.medicamento??row.tipo_tratamiento??row.id_medicamento??''));const directory=new Map(data.animals.map((item)=>[item.id_animal,item]));const top=animalHighlight('Animal con más tratamientos',topEntry(treated),directory,'aplicaciones este mes',value=>`${formatNumber(value)} tratamientos`);
  const pending=conditions.filter((item)=>item.estado!=='RESUELTA');const upcoming=treatments.filter((item)=>{const date=localDate(item.proxima_aplicacion);return date>=currentDateInput()&&date<=dateShift(30);});
  return {metrics:[{label:'Condiciones abiertas',value:formatNumber(pending.length),detail:'Por resolver o en tratamiento',tone:'red'},{label:'Tratamientos del mes',value:formatNumber(monthly.length),detail:'Aplicaciones individuales',tone:'green'},{label:'Jornadas',value:formatNumber(campaigns.length),detail:'Colectivas registradas',tone:'blue'},{label:'Próximas aplicaciones',value:formatNumber(upcoming.length),detail:'Siguientes 30 días',tone:'orange'}],highlights:top?[top]:[],lines:[{label:'Medicamento más utilizado',value:medicine?.[0]??'Sin datos',detail:medicine?`${medicine[1]} aplicaciones`:undefined},{label:'Animales tratados este mes',value:formatNumber(treated.size)},{label:'Condiciones resueltas',value:formatNumber(conditions.filter((item)=>item.estado==='RESUELTA').length)}]};
}

function buildCleaningModel(data:SummaryData):SummaryModel{
  const rows=(data.collections['/limpiezas-potrero']??[]).filter(valid);const monthly=rows.filter((item)=>inPeriod(item.fecha_inicio,periodStart('month')));const pasture=countValues(rows,(row)=>String(row.potrero??''));const products=new Map<string,number>();rows.forEach((row)=>(Array.isArray(row.productos)?row.productos:[]).forEach((item)=>{if(item&&typeof item==='object'){const name=String((item as Record<string,unknown>).producto??'');if(name)products.set(name,(products.get(name)??0)+1);}}));const product=[...products.entries()].sort((a,b)=>b[1]-a[1])[0];
  const latest=[...rows].sort((a,b)=>localDate(b.fecha_inicio).localeCompare(localDate(a.fecha_inicio)))[0];
  return {metrics:[{label:'Total',value:formatNumber(rows.length),detail:'Limpiezas registradas',tone:'green'},{label:'Este mes',value:formatNumber(monthly.length),detail:'Trabajos iniciados',tone:'lime'},{label:'Completadas',value:formatNumber(rows.filter((item)=>item.estado==='COMPLETADO').length),detail:'Histórico disponible',tone:'blue'},{label:'Pendientes',value:formatNumber(rows.filter((item)=>item.estado==='BORRADOR'||item.estado==='PENDIENTE').length),detail:'Por ejecutar',tone:'orange'}],highlights:[],lines:[{label:'Potrero con más limpiezas',value:pasture?.[0]??'Sin datos',detail:pasture?`${pasture[1]} registros`:undefined},{label:'Producto más utilizado',value:product?.[0]??'Sin datos',detail:product?`${product[1]} limpiezas`:undefined},{label:'Último trabajo',value:latest?String(latest.potrero??'Potrero'): 'Sin datos',detail:latest?formatDate(String(latest.fecha_inicio??'')):undefined}]};
}

function reproductionParts(data:SummaryData){
  const heats=(data.collections['/reproduccion/celos']??[]).filter(valid);const pregnancies=(data.collections['/reproduccion/preneces']??[]).filter(valid);const upcoming=(data.collections['/reproduccion/proximos-partos']??[]).filter(valid);const births=(data.collections['/partos']??[]).filter(valid);const abortions=(data.collections['/registros/abortos']??[]).filter(valid);return{heats,pregnancies,upcoming,births,abortions};
}
function buildReproductionModel(data:SummaryData):SummaryModel{
  const {heats,pregnancies,upcoming,births,abortions}=reproductionParts(data);const year=periodStart('year');const directory=new Map(data.animals.map((item)=>[item.id_animal,item]));const heatMap=new Map<string,{name:string;value:number}>();heats.forEach((row)=>add(heatMap,row.id_vaca,row.vaca));const calfMap=new Map<string,{name:string;value:number}>();births.forEach((row)=>add(calfMap,row.id_madre,row.madre,Array.isArray(row.crias)?row.crias.length:1));
  const highlights=[animalHighlight('Más celos registrados',topEntry(heatMap),directory,'historial disponible',value=>`${formatNumber(value)} celos`),animalHighlight('Más crías registradas',topEntry(calfMap),directory,'partos disponibles',value=>`${formatNumber(value)} crías`)].filter((item):item is SummaryHighlight=>Boolean(item));
  const next=[...upcoming].filter((item)=>item.estado==='PENDIENTE').sort((a,b)=>localDate(a.fecha_tentativa).localeCompare(localDate(b.fecha_tentativa)))[0];
  return {metrics:[{label:'Celos abiertos',value:formatNumber(heats.filter((item)=>!item.fecha_fin||localDate(item.fecha_fin)>=currentDateInput()).length),detail:'Seguimiento activo',tone:'pink'},{label:'Preñeces confirmadas',value:formatNumber(pregnancies.filter((item)=>item.estado==='CONFIRMADA').length),detail:'Actualmente activas',tone:'green'},{label:'Próximos partos',value:formatNumber(upcoming.filter((item)=>item.estado==='PENDIENTE').length),detail:'Pendientes',tone:'orange'},{label:'Partos este año',value:formatNumber(births.filter((item)=>inPeriod(item.fecha_parto,year)).length),detail:'Registrados',tone:'blue'}],highlights,lines:[{label:'Próximo parto estimado',value:next?String(next.vaca??'Animal'):'Sin datos',detail:next?formatDate(String(next.fecha_tentativa??'')):undefined},{label:'Abortos este año',value:formatNumber(abortions.filter((item)=>inPeriod(item.fecha??item.fecha_aborto,year)).length)},{label:'Crías nacidas este año',value:formatNumber(births.filter((item)=>inPeriod(item.fecha_parto,year)).reduce((sum,row)=>sum+(Array.isArray(row.crias)?row.crias.length:1),0))}]};
}

function buildProductionModel(data:SummaryData):SummaryModel{
  const rows=(data.collections['/registros/producciones']??[]).filter(valid);const tanks=(data.collections['/registros/produccion-tanque']??[]).filter(valid);const lactations=(data.collections['/registros/lactancias']??[]).filter(valid);const today=currentDateInput(),week=periodStart('week'),month=periodStart('month'),year=periodStart('year');const liters=(start:string)=>rows.filter((item)=>inPeriod(item.fecha_produccion,start)).reduce((sum,item)=>sum+number(item.litros),0);const monthRows=rows.filter((item)=>inPeriod(item.fecha_produccion,month));const days=new Map<string,{id:string;name:string;value:number}>();monthRows.forEach(row=>{const id=String(row.id_vaca??''),date=localDate(row.fecha_produccion);if(!id||!date)return;const key=`${id}:${date}`,old=days.get(key);days.set(key,{id,name:String(row.animal??row.vaca??old?.name??'Animal'),value:(old?.value??0)+number(row.litros)});});const totals=new Map<string,{name:string;sum:number;days:number}>();days.forEach(item=>{const old=totals.get(item.id);totals.set(item.id,{name:item.name,sum:(old?.sum??0)+item.value,days:(old?.days??0)+1});});const byCow=new Map<string,{name:string;value:number}>();totals.forEach((item,id)=>byCow.set(id,{name:item.name,value:item.sum/item.days}));const directory=new Map(data.animals.map((item)=>[item.id_animal,item]));
  const highlights=[animalHighlight('Mayor promedio diario',topEntry(byCow),directory,'promedio del mes por día ordeñado',value=>`${formatNumber(value,2)} L/día`),animalHighlight('Menor promedio diario',topEntry(byCow,true),directory,'promedio del mes por día ordeñado',value=>`${formatNumber(value,2)} L/día`)].filter((item):item is SummaryHighlight=>Boolean(item));
  const tankToday=tanks.filter((item)=>inPeriod(item.fecha_produccion,today)).reduce((sum,item)=>sum+number(item.litros),0);
  return {metrics:[{label:'Hoy',value:`${formatNumber(liters(today),2)} L`,detail:'Producción por vaca',tone:'cyan'},{label:'Esta semana',value:`${formatNumber(liters(week),2)} L`,detail:'Acumulado',tone:'blue'},{label:'Este mes',value:`${formatNumber(liters(month),2)} L`,detail:'Acumulado',tone:'green'},{label:'Este año',value:`${formatNumber(liters(year),2)} L`,detail:'Acumulado',tone:'lime'}],highlights,lines:[{label:'Vacas registradas este mes',value:formatNumber(byCow.size)},{label:'Promedio de los promedios diarios',value:byCow.size?`${formatNumber([...byCow.values()].reduce((sum,item)=>sum+item.value,0)/byCow.size,2)} L/día`:'Sin datos'},{label:'Tanque hoy',value:`${formatNumber(tankToday,2)} L`},{label:'Lactancias activas',value:formatNumber(lactations.filter((item)=>item.activa===true).length)}],note:'Cada vaca se compara por su promedio diario del mes; primero se suman todos sus turnos del mismo día.'};
}

function buildWeightModel(data:SummaryData):SummaryModel{
  const rows=(data.collections['/registros/pesajes']??[]).filter(valid);const month=periodStart('month'),year=periodStart('year');const latest=new Map<string,Record<string,unknown>>();const count=new Map<string,{name:string;value:number}>();rows.forEach((row)=>{const id=String(row.id_animal??'');if(!id)return;add(count,id,row.animal);const old=latest.get(id);if(!old||localDate(row.fecha_pesaje)>localDate(old.fecha_pesaje))latest.set(id,row);});const latestWeights=new Map<string,{name:string;value:number}>();latest.forEach((row,id)=>latestWeights.set(id,{name:String(row.animal??'Animal'),value:number(row.peso_kg)}));const directory=new Map(data.animals.map((item)=>[item.id_animal,item]));const highlights=[animalHighlight('Mayor peso actual',topEntry(latestWeights),directory,'último pesaje',value=>`${formatNumber(value,2)} kg`),animalHighlight('Menor peso actual',topEntry(latestWeights,true),directory,'último pesaje',value=>`${formatNumber(value,2)} kg`),animalHighlight('Animal más controlado',topEntry(count),directory,'historial de pesajes',value=>`${formatNumber(value)} pesajes`)].filter((item):item is SummaryHighlight=>Boolean(item));const average=latestWeights.size?[...latestWeights.values()].reduce((sum,item)=>sum+item.value,0)/latestWeights.size:0;
  return {metrics:[{label:'Pesajes este mes',value:formatNumber(rows.filter((item)=>inPeriod(item.fecha_pesaje,month)).length),detail:'Registros',tone:'blue'},{label:'Pesajes este año',value:formatNumber(rows.filter((item)=>inPeriod(item.fecha_pesaje,year)).length),detail:'Registros',tone:'green'},{label:'Animales controlados',value:formatNumber(latest.size),detail:'Con al menos un pesaje',tone:'cyan'},{label:'Peso promedio actual',value:latestWeights.size?`${formatNumber(average,2)} kg`:'—',detail:'Último pesaje de cada animal',tone:'lime'}],highlights,lines:[{label:'Total histórico disponible',value:formatNumber(rows.length)},{label:'Último pesaje',value:formatDate(String([...rows].sort((a,b)=>localDate(b.fecha_pesaje).localeCompare(localDate(a.fecha_pesaje)))[0]?.fecha_pesaje??''))}]};
}

function buildNewsModel(data:SummaryData):SummaryModel{
  const rows=(data.collections['/animales/novedades']??[]).filter(valid);const month=periodStart('month'),year=periodStart('year');const count=new Map<string,{name:string;value:number}>();rows.forEach((row)=>add(count,row.id_animal,row.animal));const directory=new Map(data.animals.map((item)=>[item.id_animal,item]));const top=animalHighlight('Animal con más novedades',topEntry(count),directory,'historial disponible',value=>`${formatNumber(value)} novedades`);const latest=[...rows].sort((a,b)=>localDate(b.fecha).localeCompare(localDate(a.fecha)))[0];
  return {metrics:[{label:'Desaparecidos',value:formatNumber(rows.filter((item)=>item.tipo==='DESAPARECIDO').length),detail:'Eventos registrados',tone:'orange'},{label:'Recuperados',value:formatNumber(rows.filter((item)=>item.tipo==='RECUPERADO').length),detail:'Eventos registrados',tone:'green'},{label:'Muertes',value:formatNumber(rows.filter((item)=>item.tipo==='MUERTO').length),detail:'Bajas registradas',tone:'red'},{label:'Este mes',value:formatNumber(rows.filter((item)=>inPeriod(item.fecha,month)).length),detail:'Todas las novedades',tone:'blue'}],highlights:top?[top]:[],lines:[{label:'Novedades este año',value:formatNumber(rows.filter((item)=>inPeriod(item.fecha,year)).length)},{label:'Última novedad',value:latest?`${humanizeCode(String(latest.tipo))} · ${String(latest.animal??'Animal')}`:'Sin datos',detail:latest?formatDate(String(latest.fecha??'')):undefined}]};
}

function buildSalesModel(data:SummaryData):SummaryModel{
  const animalSales=(data.collections['/ventas']??[]).filter(completed);const productSales=(data.collections['/ventas/productos']??[]).filter(completed);const all=[...animalSales,...productSales];const week=periodStart('week'),month=periodStart('month'),year=periodStart('year');const total=(start:string)=>all.filter((item)=>inPeriod(item.fecha_venta,start)).reduce((sum,item)=>sum+number(item.precio_total),0);const buyer=new Map<string,number>();all.forEach((row)=>{const key=String(row.comprador_nombre??'').trim();if(key)buyer.set(key,(buyer.get(key)??0)+number(row.precio_total));});const topBuyer=[...buyer.entries()].sort((a,b)=>b[1]-a[1])[0];const products=new Map<string,number>();productSales.forEach((sale)=>(Array.isArray(sale.productos)?sale.productos:[]).forEach((item)=>{if(item&&typeof item==='object'){const row=item as Record<string,unknown>;const key=String(row.producto??'');if(key)products.set(key,(products.get(key)??0)+number(row.cantidad));}}));const topProduct=[...products.entries()].sort((a,b)=>b[1]-a[1])[0];const highest=[...all].sort((a,b)=>number(b.precio_total)-number(a.precio_total))[0];const sold=animalSales.reduce((sum,item)=>sum+(Array.isArray(item.animales)?item.animales.length:0),0);
  return {metrics:[{label:'Esta semana',value:money(total(week)),detail:'Ingresos',tone:'lime'},{label:'Este mes',value:money(total(month)),detail:'Ingresos',tone:'green'},{label:'Este año',value:money(total(year)),detail:'Ingresos',tone:'blue'},{label:'Animales vendidos',value:formatNumber(sold),detail:'Histórico disponible',tone:'orange'}],highlights:[],lines:[{label:'Ventas de animales',value:formatNumber(animalSales.length)},{label:'Ventas de productos',value:formatNumber(productSales.length)},{label:'Comprador principal',value:topBuyer?.[0]??'Sin datos',detail:topBuyer?money(topBuyer[1]):undefined},{label:'Producto más vendido',value:topProduct?.[0]??'Sin datos',detail:topProduct?`${formatNumber(topProduct[1])} unidades`:undefined},{label:'Venta de mayor valor',value:highest?money(highest.precio_total):'Sin datos',detail:highest?`${String(highest.comprador_nombre??'Comprador')} · ${formatDate(String(highest.fecha_venta??''))}`:undefined}]};
}

function buildPurchaseModel(data:SummaryData):SummaryModel{
  const rows=(data.collections['/compras']??[]).filter(valid);const week=periodStart('week'),month=periodStart('month'),year=periodStart('year');const total=(start:string)=>rows.filter((item)=>inPeriod(item.fecha_compra,start)).reduce((sum,item)=>sum+number(item.valor_total),0);const supplier=new Map<string,number>();const products=new Map<string,number>();rows.forEach((row)=>{const provider=String(row.proveedor??'').trim();if(provider)supplier.set(provider,(supplier.get(provider)??0)+number(row.valor_total));const product=String(row.animal??row.producto??row.tipo_producto??'').trim();if(product)products.set(product,(products.get(product)??0)+number(row.cantidad||1));});const topSupplier=[...supplier.entries()].sort((a,b)=>b[1]-a[1])[0];const topProduct=[...products.entries()].sort((a,b)=>b[1]-a[1])[0];const highest=[...rows].sort((a,b)=>number(b.valor_total)-number(a.valor_total))[0];
  return {metrics:[{label:'Esta semana',value:money(total(week)),detail:'Egresos',tone:'red'},{label:'Este mes',value:money(total(month)),detail:'Egresos',tone:'orange'},{label:'Este año',value:money(total(year)),detail:'Egresos',tone:'blue'},{label:'Compras',value:formatNumber(rows.length),detail:'Histórico disponible',tone:'green'}],highlights:[],lines:[{label:'Proveedor principal',value:topSupplier?.[0]??'Sin datos',detail:topSupplier?money(topSupplier[1]):undefined},{label:'Producto o animal más comprado',value:topProduct?.[0]??'Sin datos',detail:topProduct?`${formatNumber(topProduct[1])} de cantidad`:undefined},{label:'Compra de mayor valor',value:highest?money(highest.valor_total):'Sin datos',detail:highest?`${String(highest.animal??highest.producto??highest.tipo_producto??'Compra')} · ${formatDate(String(highest.fecha_compra??''))}`:undefined},{label:'Animales adquiridos',value:formatNumber(rows.filter((item)=>item.es_animal===true).length)}]};
}

function buildModel(section:SummarySection,data:SummaryData):SummaryModel{
  switch(section){
    case'animales':return buildAnimalModel(data);case'movimientos':return buildMovementModel(data);case'sanidad':return buildHealthModel(data);case'limpiezas':return buildCleaningModel(data);case'reproduccion':return buildReproductionModel(data);case'produccion':return buildProductionModel(data);case'pesajes':return buildWeightModel(data);case'muertes':return buildNewsModel(data);case'ventas':return buildSalesModel(data);case'compras':return buildPurchaseModel(data);
  }
}

export function SectionSummaryPage({section}:{section:SummarySection}){
  const navigate=useNavigate();const {hasPermission}=useAuth();const definition=sections[section];
  const query=useQuery({queryKey:['section-summary',section],queryFn:()=>loadSummaryData(section),staleTime:60_000});
  const model=useMemo(()=>query.data?buildModel(section,query.data):null,[query.data,section]);const Icon=definition.icon;
  if(query.isLoading)return <LoadingState text={`Preparando el resumen de ${definition.label.toLocaleLowerCase('es')}…`}/>;
  if(query.isError)return <ErrorState message={(query.error as Error).message} onRetry={()=>void query.refetch()}/>;
  if(!model)return null;
  return <div className="section-summary-page">
    <header className="section-summary-heading"><Button variant="ghost" onClick={()=>navigate(definition.route)}><ArrowLeft size={18}/>Volver</Button><span className="section-summary-icon"><Icon size={25}/></span><div><span className="eyebrow">Resumen</span><h1>{definition.label}</h1><p>{definition.description}</p></div><Badge tone="success">Disponible sin conexión</Badge></header>
    <div className="section-summary-metrics">{model.metrics.map((metric)=><Card className={`section-summary-metric stat-${metric.tone??'green'}`} key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span>{metric.detail?<small>{metric.detail}</small>:null}</Card>)}</div>
    {model.highlights.length?<section className="section-summary-block"><div className="section-summary-title"><div><h2>Animales destacados</h2><p>Selecciona un animal para abrir su perfil.</p></div></div><div className="summary-animal-list">{model.highlights.map((item)=><button type="button" key={`${item.label}-${item.id}`} onClick={()=>navigate(`/animales/${item.id}`)}><span className="summary-animal-photo">{item.photo?<img src={item.photo} alt=""/>:<Beef size={23}/>}</span><span><small>{item.label}</small><strong>{item.name}</strong><em>{item.subtitle}</em></span><b>{item.value}</b><ArrowRight size={18}/></button>)}</div></section>:null}
    <section className="section-summary-block"><div className="section-summary-title"><div><h2>Lectura detallada</h2><p>Indicadores calculados con la información disponible.</p></div><CalendarDays size={21}/></div><div className="section-summary-lines">{model.lines.map((line)=><div key={line.label}><span><small>{line.label}</small><strong>{line.value}</strong></span>{line.detail?<em>{line.detail}</em>:null}</div>)}</div></section>
    {model.note?<p className="section-summary-note">{model.note}</p>:null}
    <div className="section-summary-footer"><Button onClick={()=>navigate(definition.route)}>Ver todos los registros <ArrowRight size={18}/></Button>{hasPermission('DASHBOARD_CONSULTAR')?<Button variant="secondary" onClick={()=>navigate('/')}>Volver al panel</Button>:null}</div>
  </div>;
}
