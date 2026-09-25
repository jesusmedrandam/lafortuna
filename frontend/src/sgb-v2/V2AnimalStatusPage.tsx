import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {ChevronRight,HeartCrack,Plus} from 'lucide-react';
import {useNavigate,useSearchParams} from 'react-router-dom';
import {Badge,Button,Card,CompactToolbar,EmptyState,ErrorState,Field,FloatingActionDock,
  IconButton,Input,LoadingState,Modal,Select,Textarea} from '../components/ui';
import {formatDateTime} from '../utils';
import {createAnimalStatusEvent,getAnimalStatusEvents,getAnimalStatusOptions,
  type AnimalStatusEvent,type AnimalStatusOption,type AnimalStatusInput} from './api';
import {useV2Session} from './V2Session';

const labels:Record<AnimalStatusEvent['action'],string>={REPORT_MISSING:'Desaparición',
  MARK_FOUND:'Recuperación',RECORD_DEATH:'Muerte',RECORD_EXIT:'Salida'};
function actionFor(status:AnimalStatusOption['status']):AnimalStatusEvent['action'][]{
  return status==='MISSING'?['MARK_FOUND','RECORD_DEATH','RECORD_EXIT']:
    status==='INACTIVE'?['RECORD_DEATH','RECORD_EXIT']:
      ['REPORT_MISSING','RECORD_DEATH','RECORD_EXIT'];
}
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil',year:'numeric',
  month:'2-digit',day:'2-digit'}).format(new Date());}

export function V2AnimalStatusPage(){
  const {session,hasPermission}=useV2Session();const token=session!.accessToken;
  const navigate=useNavigate();const [params]=useSearchParams();const animalId=params.get('animal')??undefined;
  const [events,setEvents]=useState<AnimalStatusEvent[]|null>(null);
  const [options,setOptions]=useState<AnimalStatusOption[]>([]);
  const [query,setQuery]=useState('');const [filter,setFilter]=useState('');
  const [detail,setDetail]=useState<AnimalStatusEvent|null>(null);
  const [open,setOpen]=useState(false);const [chosen,setChosen]=useState('');
  const [action,setAction]=useState<AnimalStatusEvent['action']>('REPORT_MISSING');
  const [error,setError]=useState('');const [saving,setSaving]=useState(false);
  const [revision,setRevision]=useState(0);const canManage=hasPermission('ANIMAL_UPDATE');
  useEffect(()=>{let active=true;setError('');setEvents(null);
    void getAnimalStatusEvents(token,animalId).then(rows=>{if(active)setEvents(rows);})
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'No se pudo cargar el historial.');});
    if(canManage)void getAnimalStatusOptions(token).then(rows=>{if(active)setOptions(rows);})
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'No se pudieron cargar los animales.');});
    return()=>{active=false;};},[token,animalId,canManage,revision]);
  const selected=options.find(row=>row.id===chosen);
  const visible=useMemo(()=>events?.filter(row=>(!filter||row.action===filter)&&
    `${row.animalName} ${row.earTagCode??''} ${row.reason??''}`.toLowerCase()
      .includes(query.trim().toLowerCase()))??[],[events,filter,query]);
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!selected)return;
    const data=new FormData(event.currentTarget);const date=String(data.get('date'));
    const input:AnimalStatusInput={animalId:selected.id,action,reason:String(data.get('reason')??'').trim()||null,
      // Preserve the actual time when recording today's event.
      occurredAt:date===today()?new Date().toISOString():`${date}T12:00:00-05:00`,
      expectedVersion:selected.version,...(action==='RECORD_EXIT'?{
        exitReasonCode:String(data.get('exitReasonCode'))}: {})};
    setSaving(true);setError('');try{await createAnimalStatusEvent(token,input);
      setOpen(false);setRevision(value=>value+1);
    }catch(reason){setError(reason instanceof Error?reason.message:'No se pudo registrar el evento.');}
    finally{setSaving(false);}
  }
  return <div className="module-no-header">
    <CompactToolbar search={query} onSearch={setQuery} placeholder="Buscar novedad…" count={visible.length}
      below={<Select aria-label="Filtrar novedad" value={filter} onChange={event=>setFilter(event.target.value)}>
        <option value="">Todas las novedades</option>
        {Object.entries(labels).map(([code,label])=><option key={code} value={code}>{label}</option>)}
      </Select>}/>
    {error&&<div className="form-error admin-error" role="alert">{error}</div>}
    {events===null&&!error?<LoadingState/>:events===null?<ErrorState message={error}
      onRetry={()=>setRevision(value=>value+1)}/>:visible.length?<Card className="record-list">
      <div className="record-list-head"><span>Animal</span><span>Novedad</span><span>Fecha</span><span>Motivo</span><span/></div>
      {visible.map(row=><button type="button" className="record-list-row" key={row.id}
        onClick={()=>setDetail(row)}><span><strong>{row.animalName}</strong>
          <small>{row.earTagCode??'Sin arete'}</small></span>
          <span><Badge tone={row.action==='RECORD_DEATH'?'danger':row.action==='MARK_FOUND'?'success':'info'}>
            {labels[row.action]}</Badge></span><span>{formatDateTime(row.occurredAt)}</span>
          <span>{row.reason??'Sin observaciones'}</span><span className="record-row-actions"><ChevronRight size={18}/></span>
      </button>)}</Card>:<EmptyState icon={HeartCrack} title="Sin novedades"
        description={events.length?'No hay resultados para ese filtro.':'Aquí aparecerán desapariciones, recuperaciones, muertes y salidas.'}/>}
    {detail&&<Modal title={labels[detail.action]} onClose={()=>setDetail(null)}
      footer={<Button variant="ghost" onClick={()=>setDetail(null)}>Cerrar</Button>}>
      <div className="detail-grid"><div><small>Animal</small><strong>{detail.animalName}</strong></div>
        <div><small>Fecha</small><strong>{formatDateTime(detail.occurredAt)}</strong></div>
        <div><small>Motivo o causa</small><strong>{detail.reason??'No indicado'}</strong></div>
        <div><small>Registrado por</small><strong>{detail.registeredBy}</strong></div></div>
      <Button variant="secondary" onClick={()=>navigate(`/animales/${detail.animalId}`)}>Ver perfil del animal</Button>
    </Modal>}
    {open&&<Modal title="Nueva novedad" onClose={()=>setOpen(false)} footer={<>
      <Button variant="ghost" onClick={()=>setOpen(false)}>Cancelar</Button>
      <Button type="submit" form="v2-status-form" loading={saving}>Guardar novedad</Button></>}>
      <form id="v2-status-form" className="form-stack" onSubmit={event=>void save(event)}>
        {error&&<div className="form-error admin-error" role="alert">{error}</div>}
        <Field label="Animal" required><Select required value={chosen} onChange={event=>{
          setChosen(event.target.value);const option=options.find(row=>row.id===event.target.value);
          if(option)setAction(actionFor(option.status)[0]!);}}>
          <option value="">Selecciona un animal</option>
          {options.filter(row=>!animalId||row.id===animalId).map(row=><option key={row.id} value={row.id}>
            {row.name}{row.earTagCode?` · ${row.earTagCode}`:''}</option>)}
        </Select></Field>
        <Field label="Tipo de novedad" required><Select value={action}
          onChange={event=>setAction(event.target.value as AnimalStatusEvent['action'])}
          disabled={!selected}>{selected? actionFor(selected.status).map(code=><option key={code} value={code}>
            {labels[code]}</option>):<option>Selecciona un animal</option>}</Select></Field>
        {action==='RECORD_EXIT'&&<Field label="Motivo de salida" required><Select name="exitReasonCode" required>
          <option value="">Selecciona un motivo</option>
          <option value="DONATION">Donación</option>
          <option value="SLAUGHTER">Sacrificio</option>
          <option value="EXTERNAL_TRANSFER">Traslado externo</option>
          <option value="OTHER">Otro</option></Select></Field>}
        <Field label="Fecha" required><Input name="date" type="date" required max={today()} defaultValue={today()}/></Field>
        <Field label={action==='RECORD_DEATH'?'Causa de muerte':'Motivo u observaciones'}
          required={action!=='MARK_FOUND'}><Textarea name="reason" maxLength={3000} rows={3}
          required={action!=='MARK_FOUND'}/></Field>
      </form></Modal>}
    {canManage&&<FloatingActionDock><IconButton label="Registrar novedad" onClick={()=>{
      const preselected=options.find(row=>row.id===animalId);setChosen(preselected?.id??'');
      const requested=params.get('accion');const choices=preselected?actionFor(preselected.status):[];
      setAction(choices.includes(requested as AnimalStatusEvent['action'])?
        requested as AnimalStatusEvent['action']:choices[0]??'REPORT_MISSING');
      setError('');setOpen(true);
    }}><Plus size={23}/></IconButton></FloatingActionDock>}
  </div>;
}
