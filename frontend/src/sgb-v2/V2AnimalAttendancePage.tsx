import {useEffect,useMemo,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import {Beef,Check,ClipboardCheck,RotateCcw} from 'lucide-react';
import {useNavigate} from 'react-router-dom';
import {Badge,EmptyState,ErrorState,IconButton,LoadingState,SearchBox,Select} from '../components/ui';
import {getAnimals,type Animal} from './api';
import {useV2Session} from './V2Session';

type AttendanceMap=Record<string,number>;
interface AttendanceFilters {search:string;groupId:string}

function stored<T>(key:string,fallback:T):T{
  try{return JSON.parse(localStorage.getItem(key)??'') as T;}catch{return fallback;}
}

async function loadActiveAnimals(token:string){
  const animals:Animal[]=[];
  for(let page=1;page<=200;page+=1){
    const result=await getAnimals(token,page,'','',{status:'ACTIVE'});
    animals.push(...result.items);
    if(!result.hasMore)break;
  }
  return animals;
}

export function V2AnimalAttendancePage(){
  const {session}=useV2Session();const navigate=useNavigate();
  const token=session!.accessToken;const userId=session!.overview.user.id;
  const propertyId=session!.overview.activeContext?.propertyId??'none';
  const storageKey=`sgb.v2.attendance.${userId}.${propertyId}`;
  const filtersKey=`${storageKey}.filters`;
  const initialFilters=useMemo(()=>stored<AttendanceFilters>(filtersKey,{search:'',groupId:''}),[filtersKey]);
  const [search,setSearch]=useState(initialFilters.search);const [groupId,setGroupId]=useState(initialFilters.groupId);
  const [animals,setAnimals]=useState<Animal[]|null>(null);const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  const [marked,setMarked]=useState<AttendanceMap>(()=>stored<AttendanceMap>(storageKey,{}));
  const holdTimer=useRef<number|null>(null);const holdStart=useRef({x:0,y:0});
  const openedByHold=useRef(false);

  useEffect(()=>{let active=true;setAnimals(null);setError('');
    void loadActiveAnimals(token).then(items=>{if(active)setAnimals(items);})
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'No se pudo cargar la lista.');});
    return()=>{active=false;};},[token,revision]);
  useEffect(()=>{localStorage.setItem(filtersKey,JSON.stringify({search,groupId} satisfies AttendanceFilters));},
    [filtersKey,search,groupId]);
  useEffect(()=>{localStorage.setItem(storageKey,JSON.stringify(marked));},[storageKey,marked]);

  const groups=useMemo(()=>{
    const unique=new Map<string,string>();
    for(const animal of animals??[])if(animal.group)unique.set(animal.group.id,animal.group.name);
    return [...unique].map(([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name,'es'));
  },[animals]);
  const filtered=useMemo(()=>{
    const term=search.trim().toLocaleLowerCase();
    return (animals??[]).filter(animal=>(!groupId||animal.group?.id===groupId)&&(!term||
      `${animal.name} ${animal.earTagCode??''} ${animal.description??''} ${animal.group?.name??''}`
        .toLocaleLowerCase().includes(term)));
  },[animals,search,groupId]);
  const pending=useMemo(()=>filtered.filter(animal=>!marked[animal.id])
    .sort((a,b)=>a.name.localeCompare(b.name,'es')),[filtered,marked]);
  const present=useMemo(()=>filtered.filter(animal=>Boolean(marked[animal.id]))
    .sort((a,b)=>(marked[b.id]??0)-(marked[a.id]??0)),[filtered,marked]);

  function cancelHold(){if(holdTimer.current!==null)window.clearTimeout(holdTimer.current);holdTimer.current=null;}
  function beginHold(event:ReactPointerEvent<HTMLButtonElement>,id:string){
    cancelHold();openedByHold.current=false;holdStart.current={x:event.clientX,y:event.clientY};
    holdTimer.current=window.setTimeout(()=>{openedByHold.current=true;holdTimer.current=null;
      navigate(`/animales/${id}`);},600);
  }
  function moveHold(event:ReactPointerEvent<HTMLButtonElement>){
    if(Math.hypot(event.clientX-holdStart.current.x,event.clientY-holdStart.current.y)>10)cancelHold();
  }
  function select(id:string){
    cancelHold();if(openedByHold.current){openedByHold.current=false;return;}
    setMarked(current=>{const next={...current};if(next[id])delete next[id];else next[id]=Date.now();return next;});
  }
  const row=(animal:Animal,isPresent:boolean)=><button key={animal.id} type="button"
    className={`attendance-row ${isPresent?'present':''}`}
    title="Toca para marcar. Mantén pulsado para abrir la ficha."
    onPointerDown={event=>beginHold(event,animal.id)} onPointerMove={moveHold}
    onPointerUp={cancelHold} onPointerLeave={cancelHold} onPointerCancel={cancelHold}
    onContextMenu={event=>event.preventDefault()} onClick={()=>select(animal.id)}>
    <span className="attendance-check">{isPresent?<Check size={20}/>:null}</span>
    <span className="attendance-photo">{animal.profilePhotoUrl?<img src={animal.profilePhotoUrl} alt=""/>:<Beef size={22}/>}</span>
    <span><strong>{animal.name}</strong><small>{animal.earTagCode?`Arete ${animal.earTagCode}`:'Sin arete'} · {animal.group?.name??'Sin grupo'}</small></span>
  </button>;

  return <div className="attendance-page v2-attendance-page module-no-header">
    <div className="attendance-sticky-controls"><div className="attendance-toolbar">
      <SearchBox value={search} onChange={setSearch} placeholder="Buscar animal…"/>
      <Select aria-label="Filtrar lista por grupo" value={groupId} onChange={event=>setGroupId(event.target.value)}>
        <option value="">Todos los grupos</option>{groups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}
      </Select>
      <IconButton label="Reiniciar lista" disabled={!Object.keys(marked).length} onClick={()=>setMarked({})}>
        <RotateCcw size={18}/></IconButton>
    </div><div className="attendance-summary"><Badge tone="warning">Sin marcar {pending.length}</Badge>
      <Badge tone="success">Marcados {present.length}</Badge><Badge tone="info">Total {filtered.length}</Badge></div></div>
    {animals===null&&!error?<LoadingState text="Preparando la lista de animales…"/>:
      error?<ErrorState message={error} onRetry={()=>setRevision(value=>value+1)}/>:
      !filtered.length?<EmptyState icon={ClipboardCheck} title="No hay animales"
        description="No se encontraron animales activos con estos filtros."/>:<div className="attendance-groups">
        <section><header><div><h2>Sin marcar</h2><p>Toca un animal para registrarlo como presente.</p></div>
          <Badge tone="warning">{pending.length}</Badge></header>
          {pending.length?<div className="attendance-list">{pending.map(animal=>row(animal,false))}</div>:
            <p className="attendance-complete">Todos los animales visibles ya fueron marcados.</p>}</section>
        <section><header><div><h2>Marcados</h2><p>El último marcado aparece primero. Tócalo nuevamente para devolverlo arriba.</p></div>
          <Badge tone="success">{present.length}</Badge></header>
          {present.length?<div className="attendance-list">{present.map(animal=>row(animal,true))}</div>:
            <p className="attendance-complete">Todavía no has marcado animales.</p>}</section>
      </div>}
  </div>;
}
