import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {ArrowUpDown,ChevronRight,Edit3,Plus,Weight} from 'lucide-react';
import {useNavigate,useSearchParams} from 'react-router-dom';
import {Badge,Button,Card,CompactToolbar,ConfirmDialog,EmptyState,ErrorState,Field,
  FloatingActionDock,IconButton,Input,LoadingState,Modal,Select,Textarea} from '../components/ui';
import {formatDate} from '../utils';
import {createWeighing,getWeighingOptions,getWeighings,updateWeighing,voidWeighing,
  type WeighingInput,type WeighingRecord} from './api';
import {useV2Session} from './V2Session';

function ecuadorToday(){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Guayaquil',year:'numeric',
    month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const find=(type:string)=>parts.find(part=>part.type===type)?.value??'';
  return `${find('year')}-${find('month')}-${find('day')}`;
}
function amount(item:WeighingRecord){return `${item.weight} ${item.unitCode==='POUND'?'lb':'kg'}`;}
function message(reason:unknown){return reason instanceof Error?reason.message:'No se pudo guardar el pesaje.';}

export function V2WeighingsPage({profileAnimalId,profileAction,onCompleted}:{
  profileAnimalId?:string;profileAction?:string;onCompleted?:()=>void}={}){
  const {session,hasPermission}=useV2Session();const token=session!.accessToken;const navigate=useNavigate();
  const [params]=useSearchParams();const animalId=profileAnimalId??params.get('animal')??undefined;
  const [records,setRecords]=useState<WeighingRecord[]|null>(null);
  const [animals,setAnimals]=useState<Array<{id:string;name:string;earTagCode:string|null}>>([]);
  const [query,setQuery]=useState('');const [newest,setNewest]=useState(true);
  const [selected,setSelected]=useState<string|null>(null);const [editing,setEditing]=useState<WeighingRecord|null|undefined>(undefined);
  const [voiding,setVoiding]=useState<string|null>(null);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [revision,setRevision]=useState(0);
  const canManage=hasPermission('WEIGHING_MANAGE');
  const openedFromProfile=useRef<string|null>(null);
  useEffect(()=>{if(!canManage||!animalId||(profileAction??params.get('accion'))!=='NUEVO'||
    openedFromProfile.current===animalId||!animals.some(item=>item.id===animalId))return;
    openedFromProfile.current=animalId;setEditing(null);
  },[animalId,animals,canManage,params,profileAction]);
  useEffect(()=>{let active=true;setError('');
    void getWeighings(token,animalId).then(items=>{if(active)setRecords(items);})
      .catch(reason=>{if(active)setError(message(reason));});
    if(canManage)void getWeighingOptions(token).then(items=>{if(active)setAnimals(items);})
      .catch(reason=>{if(active)setError(message(reason));});
    return()=>{active=false;};},[token,animalId,canManage,revision]);
  const visible=useMemo(()=>records?.filter(item=>
    `${item.animalName} ${item.earTagCode??''} ${item.method??''} ${item.notes??''}`
      .toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()))
    .sort((a,b)=>(newest?-1:1)*(a.weighedOn.localeCompare(b.weighedOn)||
      a.createdAt.localeCompare(b.createdAt)))??[],[records,query,newest]);
  const item=records?.find(row=>row.id===selected);
  const pendingVoid=records?.find(row=>row.id===voiding);
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');
    const data=new FormData(event.currentTarget);
    const input:WeighingInput={animalId:String(data.get('animalId')),
      weighedOn:String(data.get('weighedOn')),weight:Number(data.get('weight')),
      unitCode:String(data.get('unitCode')) as WeighingInput['unitCode'],
      method:String(data.get('method')??'').trim()||null,
      notes:String(data.get('notes')??'').trim()||null,
      ...(editing?{expectedVersion:editing.version}:{})};
    try{if(editing)await updateWeighing(token,editing.id,input);
      else await createWeighing(token,input);
      setEditing(undefined);setRevision(value=>value+1);if(profileAction)onCompleted?.();
    }catch(reason){setError(message(reason));}finally{setBusy(false);}
  }
  async function confirmVoid(){if(!pendingVoid)return;setBusy(true);setError('');
    try{await voidWeighing(token,pendingVoid.id,pendingVoid.version);
      setVoiding(null);setSelected(null);setRevision(value=>value+1);
    }catch(reason){setVoiding(null);setError(message(reason));}finally{setBusy(false);}
  }
  return <div className="module-no-header">
    <CompactToolbar search={query} onSearch={setQuery} placeholder="Buscar pesaje…"
      count={visible.length} actions={<IconButton label={newest?'Más recientes':'Más antiguos'}
      onClick={()=>setNewest(value=>!value)}><ArrowUpDown size={19}/></IconButton>}/>
    {error&&<div className="form-error admin-error" role="alert">{error}</div>}
    {records===null&&!error?<LoadingState/>:records===null?<ErrorState message={error}
      onRetry={()=>setRevision(value=>value+1)}/>:visible.length?<Card className="record-list v2-weighings-list">
      <div className="record-list-head"><span>Animal</span><span>Fecha</span>
        <span>Peso</span><span>Estado</span><span/></div>
      {visible.map(row=><button type="button" className="record-list-row" key={row.id}
        onClick={()=>setSelected(row.id)}>
        <span><strong>{row.animalName}</strong><small>{row.earTagCode?`Arete ${row.earTagCode}`:'Sin arete'}</small></span>
        <span><strong>{formatDate(row.weighedOn)}</strong></span>
        <span><strong>{amount(row)}</strong><small>{row.method??'Sin método'}</small></span>
        <span><Badge tone={row.voidedAt?'neutral':'success'}>{row.voidedAt?'Anulado':'Registrado'}</Badge></span>
        <span className="record-row-actions"><ChevronRight size={18}/></span>
      </button>)}</Card>:<EmptyState icon={Weight} title="Sin pesajes"
      description={records.length?'No hay pesajes con esa búsqueda.':'Registra el peso de un animal.'}/>}
    {item&&<Modal title="Detalle del pesaje" onClose={()=>setSelected(null)}
      footer={<><Button variant="ghost" onClick={()=>setSelected(null)}>Cerrar</Button>
        {!item.voidedAt&&canManage&&<><Button variant="secondary" onClick={()=>{
          setEditing(item);setSelected(null);}}><Edit3 size={17}/>Editar</Button>
          <Button variant="ghost" onClick={()=>{setVoiding(item.id);setSelected(null);}}>Anular</Button></>}</>}>
      <div className="detail-grid"><div><small>Animal</small><strong>{item.animalName}</strong></div>
        <div><small>Fecha</small><strong>{formatDate(item.weighedOn)}</strong></div>
        <div><small>Peso</small><strong>{amount(item)}</strong></div>
        <div><small>Equivalente</small><strong>{item.weightKg} kg</strong></div>
        <div><small>Método</small><strong>{item.method??'Sin registrar'}</strong></div>
        <div><small>Estado</small><strong>{item.voidedAt?'Anulado':'Registrado'}</strong></div>
        {item.notes&&<div><small>Observaciones</small><strong>{item.notes}</strong></div>}</div>
      <Button variant="secondary" onClick={()=>navigate(`/animales/${item.animalId}`)}>
        Ver perfil del animal <ChevronRight size={17}/></Button>
    </Modal>}
    {editing!==undefined&&<Modal title={editing?'Editar pesaje':'Nuevo pesaje'}
      onClose={()=>setEditing(undefined)} footer={<><Button variant="ghost"
        onClick={()=>setEditing(undefined)}>Cancelar</Button>
        <Button type="submit" form="v2-weighing-form" loading={busy}>Guardar</Button></>}>
      <form id="v2-weighing-form" className="form-stack" onSubmit={event=>void save(event)}>
        {error&&<div className="form-error admin-error" role="alert">{error}</div>}
        <Field label="Animal" required><Select name="animalId" required
          defaultValue={editing?.animalId??animalId??''} disabled={Boolean(editing)}>
          <option value="">Selecciona un animal</option>
          {editing&&!animals.some(animal=>animal.id===editing.animalId)&&<option value={editing.animalId}>
            {editing.animalName}</option>}
          {animals.map(animal=><option key={animal.id} value={animal.id}>
            {animal.name}{animal.earTagCode?` · ${animal.earTagCode}`:''}</option>)}
        </Select>{editing&&<input type="hidden" name="animalId" value={editing.animalId}/>}</Field>
        <Field label="Fecha" required><Input name="weighedOn" type="date" required max={ecuadorToday()}
          defaultValue={editing?.weighedOn??ecuadorToday()}/></Field>
        <Field label="Peso" required><Input name="weight" type="number" required min="0.001" step="0.001"
          defaultValue={editing?.weight??''}/></Field>
        <Field label="Unidad"><Select name="unitCode" defaultValue={editing?.unitCode??'KILOGRAM'}>
          <option value="KILOGRAM">Kilogramos (kg)</option><option value="POUND">Libras (lb)</option>
        </Select></Field>
        <Field label="Método"><Input name="method" maxLength={160} defaultValue={editing?.method??''}/></Field>
        <Field label="Observaciones"><Textarea name="notes" maxLength={3000} rows={3}
          defaultValue={editing?.notes??''}/></Field>
      </form></Modal>}
    {pendingVoid&&<ConfirmDialog title="Anular pesaje"
      message={`¿Anular el pesaje de ${pendingVoid.animalName} del ${formatDate(pendingVoid.weighedOn)}? Permanecerá en el historial y en la auditoría.`}
      onClose={()=>setVoiding(null)} onConfirm={()=>void confirmVoid()} loading={busy}/>}
    {canManage&&<FloatingActionDock><IconButton label="Nuevo pesaje" onClick={()=>setEditing(null)}>
      <Plus size={23}/></IconButton></FloatingActionDock>}
  </div>;
}
