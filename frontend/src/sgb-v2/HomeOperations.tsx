import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {ArrowLeftRight,Baby,CalendarClock,ChevronRight,ClipboardCheck,HeartCrack,
  HeartPulse,Milk,SlidersHorizontal,Weight} from 'lucide-react';
import {
  getAgenda,getAnimalStatusEvents,getHealthCampaigns,getHealthConditions,getHealthMedicines,
  getMovements,getProduction,getReproduction,getWeighings,listBrands,listCatalogItems,listOwners,
  type AgendaItem,type AnimalStatusEvent,type HealthCampaign,type HealthCondition,type HealthMedicine,
  type MovementRecord,type ProductionRecords,type ReproductionRecords,type WeighingRecord,
} from './api';
import type {DashboardItem} from './DashboardPreferences';

interface HomeOperationsProps{
  accessToken:string;userId:string;userName:string;propertyName:string;
  modules:string[];permissions:string[];onNavigate:(path:string)=>void;
  items?:DashboardItem[];
}
const catalogCodes=['BREEDS','COLORS','GRASS_TYPES','HEALTH_CONDITION_TYPES','TREATMENT_TYPES',
  'AGROCHEMICAL_CATEGORIES','MEDIA_TAGS','MOVEMENT_REASONS'] as const;
const taskActivities:Record<string,string>={TRATAMIENTO:'Tratamiento',MOVIMIENTO:'Movimiento',
  LIMPIEZA_POTRERO:'Limpieza de potrero',HERRAJE:'Herraje',PESAJE:'Pesaje',
  INSEMINACION_ARTIFICIAL:'Inseminación',TRANSFERENCIA_EMBRIONES:'Transferencia de embriones',
  DESCORNE:'Descorne',PERSONALIZADA:'Tarea'};

function ecuadorDate(date=new Date()){
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Guayaquil',year:'numeric',month:'2-digit',day:'2-digit'})
    .format(date);
}
function scheduledLabel(value:string){
  const date=new Date(value);const today=ecuadorDate();const day=ecuadorDate(date);
  const time=new Intl.DateTimeFormat('es-EC',{timeZone:'America/Guayaquil',hour:'2-digit',minute:'2-digit'})
    .format(date);
  if(day===today)return `Hoy, ${time}`;
  const tomorrow=new Date(`${today}T12:00:00-05:00`);tomorrow.setDate(tomorrow.getDate()+1);
  if(day===ecuadorDate(tomorrow))return `Mañana, ${time}`;
  return new Intl.DateTimeFormat('es-EC',{timeZone:'America/Guayaquil',day:'numeric',month:'short',
    hour:'2-digit',minute:'2-digit'}).format(date);
}
function taskTone(item:AgendaItem){
  return new Date(item.scheduledAt).getTime()<Date.now()?'overdue':item.myResponse==='ACCEPTED'?'accepted':'pending';
}

export function HomePendingTasks({accessToken,userId,userName,propertyName,enabled,onNavigate}:{
  accessToken:string;userId:string;userName:string;propertyName:string;enabled:boolean;
  onNavigate:(path:string)=>void}){
  const [items,setItems]=useState<AgendaItem[]|null>(enabled?null:[]);
  const [error,setError]=useState(false);
  useEffect(()=>{if(!enabled){setItems([]);return;}let active=true;setItems(null);setError(false);
    void getAgenda(accessToken).then(value=>{if(active)setItems(value);}).catch(()=>{
      if(active){setItems([]);setError(true);}});return()=>{active=false;};},[accessToken,enabled]);
  const tasks=useMemo(()=>(items??[]).filter(item=>item.kind==='TASK'&&item.status==='PENDING'&&
    item.users.some(user=>user.id===userId)&&item.myResponse!=='DECLINED')
    .sort((left,right)=>new Date(left.scheduledAt).getTime()-new Date(right.scheduledAt).getTime()),[items,userId]);
  return <section className="home-pending" aria-labelledby="home-pending-title">
    <header><div className="home-pending-title"><span><ClipboardCheck size={22}/></span><div>
      <small>{propertyName}</small><h1 id="home-pending-title">Pendientes para {userName.split(' ')[0]}</h1>
    </div></div>{tasks.length>0&&<button type="button" onClick={()=>onNavigate('/agenda')}>
      Ver agenda <ChevronRight size={17}/></button>}</header>
    {items===null?<div className="home-pending-state"><span className="spinner large"/>
      <p>Consultando tus actividades…</p></div>:error?<div className="home-pending-state">
        <p>No se pudieron cargar tus actividades. Puedes revisarlas desde Agenda.</p>
        <button type="button" onClick={()=>onNavigate('/agenda')}>Abrir agenda</button></div>:
      tasks.length?<div className="home-pending-list">{tasks.slice(0,4).map(item=><button type="button"
        key={item.id} onClick={()=>onNavigate(`/agenda?item=${encodeURIComponent(item.id)}`)}>
        <span className={`home-task-status ${taskTone(item)}`}><CalendarClock size={18}/></span>
        <span><strong>{item.title}</strong><small>{taskActivities[item.activityType]??item.activityType} · {scheduledLabel(item.scheduledAt)}
          {item.animals.length?` · ${item.animals.map(animal=>animal.name).slice(0,2).join(', ')}`:''}</small></span>
        <em>{item.myResponse==='ACCEPTED'?'Aceptada':taskTone(item)==='overdue'?'Vencida':'Pendiente'}</em>
        <ChevronRight size={17}/></button>)}{tasks.length>4&&<button type="button" className="home-pending-more"
          onClick={()=>onNavigate('/agenda')}>Ver {tasks.length-4} actividades más</button>}</div>:
      <div className="home-pending-state complete"><span>✓</span><div><strong>Todo al día</strong>
        <p>No tienes actividades pendientes asignadas en esta propiedad.</p></div></div>}
  </section>;
}

interface Metric{label:string;value:string|number}
interface OperationCard{key:string;title:string;description:string;path:string;icon:ReactNode;metrics:Metric[]}

export function HomeOperations({accessToken,modules,permissions,onNavigate,items}:HomeOperationsProps){
  const allowed=(permission:string,module?:string)=>permissions.includes(permission)&&(!module||modules.includes(module));
  const enabled=(key:string)=>!items||items.some(item=>item.id===key&&item.visible);
  const [weighings,setWeighings]=useState<WeighingRecord[]>();
  const [conditions,setConditions]=useState<HealthCondition[]>();
  const [campaigns,setCampaigns]=useState<HealthCampaign[]>();
  const [medicines,setMedicines]=useState<HealthMedicine[]>();
  const [production,setProduction]=useState<ProductionRecords>();
  const [reproduction,setReproduction]=useState<ReproductionRecords>();
  const [movements,setMovements]=useState<MovementRecord[]>();
  const [statusEvents,setStatusEvents]=useState<AnimalStatusEvent[]>();
  const [catalogTotals,setCatalogTotals]=useState<{items:number;owners:number;brands:number}>();
  const [partialError,setPartialError]=useState(false);

  useEffect(()=>{let active=true;const jobs:Promise<void>[]=[];setPartialError(false);
    setWeighings(undefined);setConditions(undefined);setCampaigns(undefined);setMedicines(undefined);
    setProduction(undefined);setReproduction(undefined);setMovements(undefined);setStatusEvents(undefined);
    setCatalogTotals(undefined);
    const load=<T,>(promise:Promise<T>,save:(value:T)=>void)=>{jobs.push(promise.then(value=>{if(active)save(value);}));};
    if(enabled('weighings')&&allowed('WEIGHING_VIEW','WEIGHING'))load(getWeighings(accessToken),setWeighings);
    if(enabled('health')&&allowed('HEALTH_VIEW','HEALTH')){
      load(getHealthConditions(accessToken),setConditions);load(getHealthCampaigns(accessToken),setCampaigns);
      load(getHealthMedicines(accessToken),setMedicines);
    }
    if(enabled('production')&&allowed('PRODUCTION_VIEW','PRODUCTION'))load(getProduction(accessToken),setProduction);
    if(enabled('reproduction')&&allowed('REPRODUCTION_VIEW','REPRODUCTION'))load(getReproduction(accessToken),setReproduction);
    if(enabled('movements')&&allowed('MOVEMENT_VIEW','MOVEMENTS'))load(getMovements(accessToken),setMovements);
    if(enabled('status')&&permissions.includes('ANIMAL_VIEW'))load(getAnimalStatusEvents(accessToken),setStatusEvents);
    if(enabled('catalogs')&&permissions.includes('CATALOG_VIEW'))load(Promise.all([listOwners(accessToken),listBrands(accessToken),
      ...catalogCodes.map(code=>listCatalogItems(accessToken,code))]).then(([owners,brands,...lists])=>({
        owners:owners.filter(owner=>owner.active).length,brands:brands.filter(brand=>brand.active).length,
        items:lists.reduce((total,list)=>total+list.filter(item=>item.active).length,0),
      })),setCatalogTotals);
    void Promise.allSettled(jobs).then(results=>{if(active&&results.some(result=>result.status==='rejected'))setPartialError(true);});
    return()=>{active=false;};
  },[accessToken,modules.join('|'),permissions.join('|'),JSON.stringify(items)]);

  const today=ecuadorDate();const month=today.slice(0,7);const year=today.slice(0,4);
  const activeWeighings=weighings?.filter(row=>!row.voidedAt)??[];
  const monthWeighings=activeWeighings.filter(row=>row.weighedOn.startsWith(month));
  const completedCampaigns=campaigns?.filter(row=>row.status==='COMPLETADO'&&row.appliedOn.startsWith(month))??[];
  const milkToday=production?.milk.filter(row=>row.producedOn===today).reduce((sum,row)=>sum+row.liters,0)??0;
  const tankToday=production?.tanks.filter(row=>row.producedOn===today).reduce((sum,row)=>sum+row.liters,0)??0;
  const monthMovements=movements?.filter(row=>row.status==='COMPLETADO'&&row.movementOn.startsWith(month))??[];

  const cards:OperationCard[]=[];
  if(allowed('WEIGHING_VIEW','WEIGHING'))cards.push({key:'weighings',title:'Pesajes',
    description:'Seguimiento del peso del hato',path:'/pesajes',icon:<Weight size={21}/>,metrics:[
      {label:'Este mes',value:weighings?monthWeighings.length:'—'},
      {label:'Animales pesados',value:weighings?new Set(monthWeighings.map(row=>row.animalId)).size:'—'},
      {label:'Total vigente',value:weighings?activeWeighings.length:'—'},
    ]});
  if(allowed('HEALTH_VIEW','HEALTH'))cards.push({key:'health',title:'Sanidad',
    description:'Condiciones y tratamientos',path:'/sanidad',icon:<HeartPulse size={21}/>,metrics:[
      {label:'Por resolver',value:conditions?conditions.filter(row=>row.status==='POR_RESOLVER').length:'—'},
      {label:'En tratamiento',value:conditions?conditions.filter(row=>row.status==='EN_TRATAMIENTO').length:'—'},
      {label:'Aplicados este mes',value:campaigns?completedCampaigns.length:'—'},
      {label:'Medicamentos activos',value:medicines?medicines.filter(row=>row.active).length:'—'},
    ]});
  if(allowed('PRODUCTION_VIEW','PRODUCTION'))cards.push({key:'production',title:'Producción lechera',
    description:'Producción y lactancias activas',path:'/produccion',icon:<Milk size={21}/>,metrics:[
      {label:'Litros hoy',value:production?(milkToday||tankToday).toLocaleString('es-EC',{maximumFractionDigits:2}):'—'},
      {label:'En ordeño',value:production?production.cows.filter(row=>row.inMilking).length:'—'},
      {label:'Lactancias activas',value:production?production.lactations.filter(row=>!row.endedOn).length:'—'},
    ]});
  if(allowed('REPRODUCTION_VIEW','REPRODUCTION'))cards.push({key:'reproduction',title:'Reproducción',
    description:'Preñeces, partos y abortos',path:'/reproduccion',icon:<Baby size={21}/>,metrics:[
      {label:'Preñeces confirmadas',value:reproduction?reproduction.pregnancies.filter(row=>row.status==='CONFIRMED').length:'—'},
      {label:'Partos este año',value:reproduction?reproduction.births.filter(row=>row.occurredOn.startsWith(year)).length:'—'},
      {label:'Abortos este año',value:reproduction?reproduction.losses.filter(row=>row.occurredOn.startsWith(year)).length:'—'},
    ]});
  if(allowed('MOVEMENT_VIEW','MOVEMENTS'))cards.push({key:'movements',title:'Movimientos',
    description:'Traslados y cambios de grupo',path:'/movimientos',icon:<ArrowLeftRight size={21}/>,metrics:[
      {label:'Este mes',value:movements?monthMovements.length:'—'},
      {label:'Animales movidos',value:movements?monthMovements.reduce((sum,row)=>sum+row.animals.length,0):'—'},
      {label:'Borradores',value:movements?movements.filter(row=>row.status==='BORRADOR').length:'—'},
    ]});
  if(permissions.includes('ANIMAL_VIEW'))cards.push({key:'status',title:'Bajas y novedades',
    description:'Muertes, salidas y desapariciones',path:'/bajas',icon:<HeartCrack size={21}/>,metrics:[
      {label:'Muertes este año',value:statusEvents?statusEvents.filter(row=>row.action==='RECORD_DEATH'&&row.occurredAt.startsWith(year)).length:'—'},
      {label:'Salidas este año',value:statusEvents?statusEvents.filter(row=>row.action==='RECORD_EXIT'&&row.occurredAt.startsWith(year)).length:'—'},
      {label:'Reportes de ausencia',value:statusEvents?statusEvents.filter(row=>row.action==='REPORT_MISSING'&&row.occurredAt.startsWith(year)).length:'—'},
    ]});
  if(permissions.includes('CATALOG_VIEW'))cards.push({key:'catalogs',title:'Catálogos',
    description:'Opciones compartidas de la cuenta',path:'/catalogos',icon:<SlidersHorizontal size={21}/>,metrics:[
      {label:'Opciones activas',value:catalogTotals?.items??'—'},
      {label:'Propietarios',value:catalogTotals?.owners??'—'},
      {label:'Marquillas',value:catalogTotals?.brands??'—'},
    ]});

  const visibleCards=items?items.filter(item=>item.visible).flatMap(item=>cards.filter(card=>card.key===item.id)):cards;
  if(!visibleCards.length)return null;
  return <section className="home-operations" aria-labelledby="home-operations-title"><header>
    <div><span className="eyebrow">Resumen operativo</span><h2 id="home-operations-title">Estado de la propiedad</h2>
      <p>Datos actuales según los módulos a los que tienes acceso.</p></div>
    {partialError&&<small>Algunos datos no pudieron actualizarse.</small>}</header>
    <div className="home-operation-grid">{visibleCards.map(card=><button type="button" key={card.key}
      className={`home-operation-card ${card.key}`} onClick={()=>onNavigate(card.path)}>
      <span className="home-operation-icon">{card.icon}</span><span className="home-operation-copy">
        <strong>{card.title}</strong><small>{card.description}</small></span><ChevronRight size={18}/>
      <span className={`home-operation-metrics metrics-${card.metrics.length}`}>{card.metrics.map(metric=><span key={metric.label}>
        <strong>{metric.value}</strong><small>{metric.label}</small></span>)}</span>
    </button>)}</div>
  </section>;
}
