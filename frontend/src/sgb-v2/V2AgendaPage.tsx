import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {CalendarDays,CheckCircle2,ChevronRight,ClipboardCheck,Plus,UserCheck,UserX} from 'lucide-react';
import {Badge,Button,Card,EmptyState,ErrorState,Field,FloatingActionDock,IconButton,
  Input,LoadingState,Modal,Select,Textarea} from '../components/ui';
import {useSearchParams} from 'react-router-dom';
import {formatDateTime} from '../utils';
import {actOnAgenda,createAgenda,getAgenda,getAgendaOptions,
  type AgendaInput,type AgendaItem,type AgendaOptions} from './api';
import {useV2Session} from './V2Session';
const activities=[['PERSONALIZADA','Personalizada'],['TRATAMIENTO','Tratamiento'],
  ['MOVIMIENTO','Movimiento'],['LIMPIEZA_POTRERO','Limpieza de potrero'],
  ['HERRAJE','Herraje'],['PESAJE','Pesaje'],['INSEMINACION_ARTIFICIAL','Inseminación artificial'],
  ['TRANSFERENCIA_EMBRIONES','Transferencia de embriones'],['DESCORNE','Descorne']];
function localDateTime(){const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Guayaquil',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
  .format(new Date());return parts.replace(' ','T');}
function asIso(value:string){return value?new Date(`${value}:00-05:00`).toISOString():null;}

export function V2AgendaPage(){
  const {session}=useV2Session();const token=session!.accessToken;const userId=session!.overview.user.id;
  const [params]=useSearchParams();const selectedId=params.get('item');
  const [items,setItems]=useState<AgendaItem[]|null>(null);const [options,setOptions]=useState<AgendaOptions|null>(null);
  const [filter,setFilter]=useState<'ALL'|'TASK'|'EVENT'>('ALL');
  const [selected,setSelected]=useState<AgendaItem|null>(null);const [open,setOpen]=useState(false);
  const [kind,setKind]=useState<'TASK'|'EVENT'>('TASK');const [visibility,setVisibility]=useState<AgendaInput['visibility']>('SELECTED');
  const [userIds,setUserIds]=useState<string[]>([]);const [animalIds,setAnimalIds]=useState<string[]>([]);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [revision,setRevision]=useState(0);
  useEffect(()=>{let active=true;setItems(null);setError('');
    void Promise.all([getAgenda(token),getAgendaOptions(token)]).then(([data,opts])=>{
      if(active){setItems(data);setOptions(opts);}}).catch(reason=>{
      if(active)setError(reason instanceof Error?reason.message:'No se pudo cargar la agenda.');});
    return()=>{active=false;};},[token,revision]);
  const visible=useMemo(()=>items?.filter(item=>filter==='ALL'||item.kind===filter)??[],[items,filter]);
  useEffect(()=>{if(selectedId&&items){const item=items.find(row=>row.id===selectedId);
    if(item)setSelected(item);}},[items,selectedId]);
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);
    const input:AgendaInput={kind,activityType:String(data.get('activityType')),
      title:String(data.get('title')).trim(),instructions:String(data.get('instructions')??'').trim()||null,
      scheduledAt:asIso(String(data.get('scheduledAt')))!,reminderAt:asIso(String(data.get('reminderAt')??'')),
      visibility:kind==='TASK'?'SELECTED':visibility,
      userIds:kind==='EVENT'&&visibility==='PRIVATE'?[]:userIds,animalIds};
    if(kind==='TASK'&&!input.userIds.length||kind==='EVENT'&&visibility==='SELECTED'&&!input.userIds.length){
      setError('Selecciona al menos un usuario.');return;}
    setBusy(true);setError('');try{await createAgenda(token,input);setOpen(false);
      setRevision(value=>value+1);}catch(reason){setError(reason instanceof Error?reason.message:'No se pudo guardar.');}
    finally{setBusy(false);}
  }
  async function act(action:'ACCEPT'|'DECLINE'|'COMPLETE'|'CANCEL'){
    if(!selected)return;setBusy(true);setError('');try{await actOnAgenda(token,selected.id,action);
      setSelected(null);setRevision(value=>value+1);
    }catch(reason){setError(reason instanceof Error?reason.message:'No se pudo actualizar la agenda.');}
    finally{setBusy(false);}
  }
  const label=(item:AgendaItem)=>item.kind==='TASK'?'Tarea':'Evento';
  return <div className="agenda-page module-no-header">
    <div className="agenda-filter-strip"><button className={filter==='ALL'?'selected':''}
      onClick={()=>setFilter('ALL')}><span><CalendarDays size={20}/></span><small>Todo</small></button>
      {options?.tasks&&<button className={filter==='TASK'?'selected':''}
        onClick={()=>setFilter('TASK')}><span><ClipboardCheck size={20}/></span><small>Tareas</small></button>}
      {options?.events&&<button className={filter==='EVENT'?'selected':''}
        onClick={()=>setFilter('EVENT')}><span><CalendarDays size={20}/></span><small>Eventos</small></button>}</div>
    <div className="agenda-summary-cards"><Card><strong>{visible.filter(item=>item.status==='PENDING').length}</strong>
      <span>Pendientes</span></Card><Card><strong>{visible.filter(item=>item.myResponse==='ACCEPTED').length}</strong>
      <span>Aceptadas</span></Card><Card><strong>{visible.filter(item=>item.status==='COMPLETED').length}</strong>
      <span>Realizadas</span></Card></div>
    {error&&!open&&!selected&&<div className="form-error admin-error" role="alert">{error}</div>}
    {items===null&&!error?<LoadingState/>:items===null?<ErrorState message={error}
      onRetry={()=>setRevision(value=>value+1)}/>:visible.length?<div className="agenda-list">
      {visible.map(item=><Card key={item.id} className="agenda-card" onClick={()=>setSelected(item)}>
        <span className={`agenda-card-icon ${item.kind==='TASK'?'tarea':'evento'}`}>
          {item.kind==='TASK'?<ClipboardCheck size={21}/>:<CalendarDays size={21}/>}</span>
        <span><small>{label(item)} · {formatDateTime(item.scheduledAt)}</small>
          <strong>{item.title}</strong><em>{item.users.map(user=>user.name).slice(0,2).join(', ')||
            (item.visibility==='PRIVATE'?'Solo para mí':'Todos los usuarios')}</em></span>
        <Badge tone={item.status==='COMPLETED'?'success':item.status==='CANCELLED'?'danger':'warning'}>
          {item.status==='PENDING'?'Pendiente':item.status==='COMPLETED'?'Realizada':'Cancelada'}</Badge>
        <ChevronRight size={18}/></Card>)}</div>:<EmptyState icon={CalendarDays} title="Sin tareas ni eventos"
          description="Programa actividades, recordatorios y fechas importantes."/>}
    {selected&&<Modal title={selected.kind==='TASK'?'Detalle de la tarea':'Detalle del evento'}
      wide onClose={()=>setSelected(null)} footer={<><Button variant="ghost" onClick={()=>setSelected(null)}>Cerrar</Button>
        {selected.status==='PENDING'&&selected.createdBy===userId&&
          <Button variant="ghost" loading={busy} onClick={()=>void act('CANCEL')}>Cancelar evento</Button>}
        {selected.status==='PENDING'&&selected.kind==='TASK'&&selected.myResponse==='PENDING'&&<>
          <Button variant="secondary" loading={busy} onClick={()=>void act('DECLINE')}><UserX size={16}/>Rechazar</Button>
          <Button loading={busy} onClick={()=>void act('ACCEPT')}><UserCheck size={16}/>Aceptar</Button></>}
        {selected.status==='PENDING'&&selected.kind==='TASK'&&
          (selected.createdBy===userId||selected.myResponse==='ACCEPTED')&&
          <Button loading={busy} onClick={()=>void act('COMPLETE')}><CheckCircle2 size={16}/>Completar</Button>}</>}>
      {error&&<div className="form-error admin-error" role="alert">{error}</div>}
      <div className="record-detail"><div className="record-detail-heading"><span className="record-icon">
        {selected.kind==='TASK'?<ClipboardCheck size={22}/>:<CalendarDays size={22}/>}</span>
        <div><h2>{selected.title}</h2><p>{formatDateTime(selected.scheduledAt)}</p></div></div>
        <div className="detail-grid"><div><small>Actividad</small><strong>{activities.find(([code])=>
          code===selected.activityType)?.[1]??selected.activityType}</strong></div>
          <div><small>Creado por</small><strong>{selected.createdByName}</strong></div>
          <div><small>Recordatorio</small><strong>{selected.reminderAt?
            formatDateTime(selected.reminderAt):'Sin recordatorio'}</strong></div></div>
        {selected.instructions&&<section><h3>Instrucciones</h3><p>{selected.instructions}</p></section>}
        {selected.users.length>0&&<section><h3>Usuarios</h3><div className="detail-lines compact">
          {selected.users.map(user=><div key={user.id}><span><strong>{user.name}</strong>
            <small>{user.response}</small></span></div>)}</div></section>}
        {selected.animals.length>0&&<section><h3>Animales</h3><div className="detail-lines compact">
          {selected.animals.map(animal=><div key={animal.id}><span><strong>{animal.name}</strong>
            <small>{animal.earTagCode??'Sin arete'}</small></span></div>)}</div></section>}
      </div></Modal>}
    {open&&<Modal title="Nueva tarea o evento" wide onClose={()=>setOpen(false)} footer={<>
      <Button variant="ghost" onClick={()=>setOpen(false)}>Cancelar</Button>
      <Button type="submit" form="agenda-form" loading={busy}>Guardar</Button></>}>
      <form id="agenda-form" className="form-stack" onSubmit={event=>void save(event)}>
        {error&&<div className="form-error admin-error" role="alert">{error}</div>}
        <div className="agenda-class-options">{options?.tasks&&<button type="button"
          className={kind==='TASK'?'selected':''} onClick={()=>setKind('TASK')}>
          <ClipboardCheck size={18}/>Tarea</button>}{options?.events&&<button type="button"
          className={kind==='EVENT'?'selected':''} onClick={()=>setKind('EVENT')}>
          <CalendarDays size={18}/>Evento</button>}</div>
        <div className="form-grid"><Field label="Actividad"><Select name="activityType">
          {activities.map(([code,name])=><option key={code} value={code}>{name}</option>)}
          </Select></Field><Field label="Título" required><Input name="title" required maxLength={180}/></Field>
          <Field label="Fecha y hora" required><Input type="datetime-local" name="scheduledAt" required
            defaultValue={localDateTime()}/></Field>
          <Field label="Recordatorio"><Input type="datetime-local" name="reminderAt"/></Field></div>
        <Field label="Instrucciones"><Textarea name="instructions" maxLength={3000} rows={3}/></Field>
        {kind==='EVENT'&&<Field label="Quién puede verlo"><Select value={visibility}
          onChange={event=>setVisibility(event.target.value as AgendaInput['visibility'])}>
          <option value="PRIVATE">Solo yo</option><option value="SELECTED">Usuarios seleccionados</option>
          <option value="ALL">Todos los usuarios</option></Select></Field>}
        {(kind==='TASK'||visibility==='SELECTED')&&<Field label={kind==='TASK'?'Asignar a':'Compartir con'}>
          <div className="agenda-user-picker">{options?.users.map(user=><label key={user.id}>
            <input type="checkbox" checked={userIds.includes(user.id)} onChange={event=>
              setUserIds(ids=>event.target.checked?[...ids,user.id]:ids.filter(id=>id!==user.id))}/>
            <span><UserCheck size={17}/><strong>{user.name}</strong></span></label>)}</div></Field>}
        <Field label="Animales relacionados"><div className="agenda-user-picker">
          {options?.animals.map(animal=><label key={animal.id}><input type="checkbox"
            checked={animalIds.includes(animal.id)} onChange={event=>setAnimalIds(ids=>
              event.target.checked?[...ids,animal.id]:ids.filter(id=>id!==animal.id))}/>
            <span><strong>{animal.name}</strong></span></label>)}</div></Field>
      </form></Modal>}
    {(options?.tasks||options?.events)&&<FloatingActionDock><IconButton label="Nueva tarea o evento"
      onClick={()=>{setKind(options.tasks?'TASK':'EVENT');setVisibility('SELECTED');setUserIds([]);
        setAnimalIds([]);setError('');setOpen(true);}}><Plus size={22}/></IconButton></FloatingActionDock>}
  </div>;
}
