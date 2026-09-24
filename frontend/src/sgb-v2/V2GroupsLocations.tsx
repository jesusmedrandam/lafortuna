import {useEffect,useState,type FormEvent} from 'react';
import {ChevronRight,Edit3,Plus,SlidersHorizontal,Sprout,Users,Warehouse} from 'lucide-react';
import {useNavigate} from 'react-router-dom';
import {Badge,Button,Card,CompactToolbar,EmptyState,ErrorState,Field,FloatingActionDock,
  IconButton,Input,LoadingState,Modal,Textarea} from '../components/ui';
import {LocationFields,locationInput} from './GroupPanel';
import {createGroup,createLocation,listCatalogItems,listGroups,listLocations,setGroupState,
  updateGroup,updateLocation,type CatalogItem,type LivestockGroup,type PhysicalLocation} from './api';
import {useV2Session} from './V2Session';

type Filter='ALL'|'ACTIVE'|'INACTIVE';
function matches(active:boolean,filter:Filter){return filter==='ALL'||active===(filter==='ACTIVE');}
function cycle(filter:Filter):Filter{return filter==='ALL'?'ACTIVE':filter==='ACTIVE'?'INACTIVE':'ALL';}
function message(reason:unknown){return reason instanceof Error?reason.message:'No se pudo guardar el registro.';}
function areaLabel(place:PhysicalLocation){
  return place.area==null?'Sin registrar':`${place.area} ${place.areaUnitCode==='HECTARE'?'ha':'m²'}`;
}

export function V2GroupsPage(){
  const {session,hasPermission}=useV2Session();const navigate=useNavigate();const token=session!.accessToken;
  const [groups,setGroups]=useState<LivestockGroup[]|null>(null);
  const [query,setQuery]=useState('');const [filter,setFilter]=useState<Filter>('ALL');
  const [selected,setSelected]=useState<string|null>(null);
  const [editing,setEditing]=useState<LivestockGroup|null|undefined>(undefined);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [revision,setRevision]=useState(0);
  const canManage=hasPermission('GROUP_MANAGE');
  useEffect(()=>{let active=true;setError('');
    void listGroups(token).then(items=>{if(active)setGroups(items);})
      .catch(reason=>{if(active)setError(message(reason));});
    return()=>{active=false;};},[token,revision]);
  const item=groups?.find(group=>group.id===selected);
  const visible=groups?.filter(group=>matches(group.active,filter)&&
    `${group.name} ${group.description??''} ${group.location?.name??''}`.toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()))??[];
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();
    const data=new FormData(event.currentTarget);setBusy(true);setError('');
    try{const input={name:String(data.get('name')??'').trim(),description:String(data.get('description')??'').trim()||null};
      if(editing)await updateGroup(token,editing.id,{...input,expectedVersion:editing.version});
      else await createGroup(token,input);
      setEditing(undefined);setRevision(value=>value+1);
    }catch(reason){setError(message(reason));}finally{setBusy(false);}
  }
  async function toggle(group:LivestockGroup){setBusy(true);setError('');
    try{await setGroupState(token,group.id,{active:!group.active,expectedVersion:group.version});
      setRevision(value=>value+1);
    }catch(reason){setError(message(reason));}finally{setBusy(false);}
  }
  return <div className="module-no-header">
    <CompactToolbar search={query} onSearch={setQuery} placeholder="Buscar grupo…" count={visible.length}
      actions={<IconButton label={filter==='ALL'?'Todos los grupos':filter==='ACTIVE'?'Solo activos':'Solo inactivos'}
        className={filter==='ALL'?'':'active'} onClick={()=>setFilter(cycle)}>
        <SlidersHorizontal size={19}/></IconButton>}/>
    {error&&<div role="alert" className="form-error admin-error">{error}</div>}
    {groups===null&&!error?<LoadingState/>:groups===null?<ErrorState message={error}
      onRetry={()=>setRevision(value=>value+1)}/>:visible.length===0?<EmptyState icon={Users}
      title="Sin grupos" description="Crea un grupo o modifica los filtros."/>:<div className="record-grid">
      {visible.map(group=><Card key={group.id} className="record-card" onClick={()=>setSelected(group.id)}>
        <div className="record-card-header"><div className="record-icon"><Users size={22}/></div>
          <div><h3>{group.name}</h3><span>Grupo de esta propiedad</span></div>
          <Badge tone={group.active?'success':'neutral'}>{group.active?'Activo':'Inactivo'}</Badge></div>
        <div className="record-details">
          <span><small>Animales</small><strong>{group.animalCount}</strong></span>
          <span><small>Ubicación</small><strong>{group.location?.name??'Sin ubicación'}</strong></span>
        </div><p>{group.description||'Sin descripción.'}</p>
        <div className="record-actions"><span>Ver detalles</span><ChevronRight size={18}/></div>
      </Card>)}</div>}
    {item&&<Modal title="Detalle del grupo" onClose={()=>setSelected(null)} wide
      footer={<><Button variant="ghost" onClick={()=>setSelected(null)}>Cerrar</Button>
        {canManage&&<Button onClick={()=>{setEditing(item);setSelected(null);}}><Edit3 size={17}/>Editar grupo</Button>}</>}>
      <div className="record-detail"><div className="record-detail-heading"><div className="record-icon"><Users size={22}/></div>
        <div><h2>{item.name}</h2><p>{item.animalCount} {item.animalCount===1?'animal':'animales'}</p></div>
        <Badge tone={item.active?'success':'neutral'}>{item.active?'Activo':'Inactivo'}</Badge></div>
        <section><h3>Ubicación actual</h3><p>{item.location?.name??'Sin ubicación asignada'}</p>
          <small>Los cambios de grupo y ubicación se registran desde Movimientos.</small></section>
        {item.description&&<section><h3>Descripción</h3><p>{item.description}</p></section>}
        <section><Button variant="secondary" onClick={()=>navigate(`/animales?groupId=${encodeURIComponent(item.id)}`)}>
          Ver animales del grupo <ChevronRight size={17}/></Button></section>
        {canManage&&<Button variant="ghost" disabled={busy} onClick={()=>void toggle(item)}>
          {item.active?'Archivar grupo':'Reactivar grupo'}</Button>}
      </div></Modal>}
    {editing!==undefined&&<Modal title={editing?'Editar grupo':'Nuevo grupo'} onClose={()=>setEditing(undefined)}
      footer={<><Button variant="ghost" onClick={()=>setEditing(undefined)}>Cancelar</Button>
        <Button type="submit" form="v2-group-form" loading={busy}>Guardar</Button></>}>
      <form id="v2-group-form" onSubmit={event=>void save(event)} className="form-stack">
        {error&&<div role="alert" className="form-error admin-error">{error}</div>}
        <Field label="Nombre" required><Input name="name" required maxLength={160} defaultValue={editing?.name??''}/></Field>
        <Field label="Descripción"><Textarea name="description" rows={3} maxLength={5000}
          defaultValue={editing?.description??''}/></Field>
      </form></Modal>}
    {canManage&&<FloatingActionDock><IconButton label="Nuevo grupo" onClick={()=>setEditing(null)}>
      <Plus size={23}/></IconButton></FloatingActionDock>}
  </div>;
}

export function V2LocationsPage({kind}:{kind:PhysicalLocation['kind']}){
  const {session,hasPermission}=useV2Session();const token=session!.accessToken;const navigate=useNavigate();
  const [locations,setLocations]=useState<PhysicalLocation[]|null>(null);
  const [grassCatalog,setGrassCatalog]=useState<CatalogItem[]>([]);
  const [query,setQuery]=useState('');const [filter,setFilter]=useState<Filter>('ALL');
  const [selected,setSelected]=useState<string|null>(null);
  const [editing,setEditing]=useState<PhysicalLocation|null|undefined>(undefined);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [revision,setRevision]=useState(0);
  const canManage=hasPermission('LOCATION_MANAGE');const title=kind==='PASTURE'?'potrero':'corral';
  useEffect(()=>{let active=true;setError('');
    void listLocations(token).then(items=>{if(active)setLocations(items);})
      .catch(reason=>{if(active)setError(message(reason));});
    if(kind==='PASTURE'&&hasPermission('CATALOG_VIEW'))
      void listCatalogItems(token,'GRASS_TYPES').then(items=>{if(active)setGrassCatalog(items);})
        .catch(reason=>{if(active)setError(message(reason));});
    return()=>{active=false;};},[token,kind,revision,hasPermission]);
  const item=locations?.find(place=>place.id===selected);
  const visible=locations?.filter(place=>place.kind===kind&&matches(place.active,filter)&&
    `${place.name} ${place.description??''} ${place.group?.name??''}`.toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()))??[];
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');
    try{const input=locationInput(new FormData(event.currentTarget),kind,grassCatalog);
      if(editing)await updateLocation(token,editing.id,{...input,expectedVersion:editing.version});
      else await createLocation(token,input);
      setEditing(undefined);setRevision(value=>value+1);
    }catch(reason){setError(message(reason));}finally{setBusy(false);}
  }
  return <div className="module-no-header">
    <CompactToolbar search={query} onSearch={setQuery} placeholder={`Buscar ${title}…`} count={visible.length}
      actions={<IconButton label={filter==='ALL'?'Todos':filter==='ACTIVE'?'Solo activos':'Solo inactivos'}
        className={filter==='ALL'?'':'active'} onClick={()=>setFilter(cycle)}>
        <SlidersHorizontal size={19}/></IconButton>}/>
    {error&&<div role="alert" className="form-error admin-error">{error}</div>}
    {locations===null&&!error?<LoadingState/>:locations===null?<ErrorState message={error}
      onRetry={()=>setRevision(value=>value+1)}/>:visible.length===0?<EmptyState
      icon={kind==='PASTURE'?Sprout:Warehouse} title={`Sin ${kind==='PASTURE'?'potreros':'corrales'}`}
      description={`Crea un ${title} o modifica los filtros.`}/>:<div className="record-grid">
      {visible.map(place=><Card key={place.id} className="record-card" onClick={()=>setSelected(place.id)}>
        <div className="record-card-header"><div className="record-icon">
          {kind==='PASTURE'?<Sprout size={22}/>:<Warehouse size={22}/>}</div>
          <div><h3>{place.name}</h3><span>{kind==='PASTURE'?'Potrero':'Corral'}</span></div>
          <Badge tone={place.active?'success':'neutral'}>{place.active?'Activo':'Inactivo'}</Badge></div>
        <div className="record-details">
          <span><small>Grupo actual</small><strong>{place.group?.name??'Sin grupo'}</strong></span>
          <span><small>Área</small><strong>{areaLabel(place)}</strong></span>
          <span><small>Capacidad</small><strong>{place.capacityEstimate??'Sin límite'}</strong></span>
          <span><small>Agua</small><strong>{place.waterAvailable?'Sí':'No'}</strong></span>
        </div><p>{place.description||'Sin descripción.'}</p>
        <div className="record-actions"><span>Ver detalles</span><ChevronRight size={18}/></div>
      </Card>)}</div>}
    {item&&<Modal title={`Detalle del ${title}`} wide onClose={()=>setSelected(null)}
      footer={<><Button variant="ghost" onClick={()=>setSelected(null)}>Cerrar</Button>
        {canManage&&<Button onClick={()=>{setEditing(item);setSelected(null);}}><Edit3 size={17}/>
          Editar {title}</Button>}</>}>
      <div className="record-detail"><div className="record-detail-heading"><div className="record-icon">
        {kind==='PASTURE'?<Sprout size={22}/>:<Warehouse size={22}/>}</div>
        <div><h2>{item.name}</h2><p>{item.description||'Sin descripción.'}</p></div>
        <Badge tone={item.active?'success':'neutral'}>{item.active?'Activo':'Inactivo'}</Badge></div>
        <div className="v2-location-details">
          <span><small>Área</small><strong>{areaLabel(item)}</strong></span>
          <span><small>Capacidad estimada</small><strong>{item.capacityEstimate??'Sin registrar'}</strong></span>
          <span><small>Disponibilidad de agua</small><strong>{item.waterAvailable?'Sí':'No'}</strong></span>
          <span><small>Grupo actual</small><strong>{item.group?.name??'Sin grupo'}</strong></span>
          {kind==='PASTURE'?<>
            <span><small>Uso</small><strong>{item.pastureUse??'Sin especificar'}</strong></span>
            <span><small>Último descanso</small><strong>{item.lastRestDate??'Sin registrar'}</strong></span>
          </>:<>
            <span><small>Piso</small><strong>{item.floorMaterial??'Sin registrar'}</strong></span>
            <span><small>Cubierto</small><strong>{item.covered?'Sí':'No'}</strong></span>
          </>}</div>
        {kind==='PASTURE'&&<section><h3>Pastos</h3>{item.grasses.length?<div className="detail-lines">
          {item.grasses.map((grass,index)=><div key={`${grass.name}:${index}`}><span>
            <strong>{grass.name}</strong><small>{grass.notes||'Sin observaciones'}</small></span>
            <span>{grass.percent!=null?`${grass.percent}%`:'Sin porcentaje'}</span></div>)}</div>
          :<p>Sin pastos registrados.</p>}</section>}
        {item.group&&<section><Button variant="secondary" onClick={()=>navigate(`/animales?groupId=${encodeURIComponent(item.group!.id)}`)}>
          Ver animales del grupo <ChevronRight size={17}/></Button></section>}
        <p>La asignación del grupo a este lugar se registra desde Movimientos.</p>
      </div></Modal>}
    {editing!==undefined&&<Modal title={editing?`Editar ${title}`:`Nuevo ${title}`} wide
      onClose={()=>setEditing(undefined)} footer={<><Button variant="ghost" onClick={()=>setEditing(undefined)}>Cancelar</Button>
        <Button type="submit" form="v2-location-form" loading={busy}>Guardar</Button></>}>
      <form id="v2-location-form" className="group-new-form v2-location-form"
        key={`${editing?.id??'new'}:${editing?.version??0}:${kind}`} onSubmit={event=>void save(event)}>
        {error&&<div role="alert" className="form-error admin-error v2-form-error">{error}</div>}
        <Field label="Nombre" required><Input name="name" required maxLength={160}
          defaultValue={editing?.name??''}/></Field>
        <Field label="Descripción"><Textarea name="description" rows={2} maxLength={5000}
          defaultValue={editing?.description??''}/></Field>
        <LocationFields key={`${editing?.id??'new'}:${kind}`} place={editing??({kind} as PhysicalLocation)}
          grassCatalog={grassCatalog}/>
      </form></Modal>}
    {canManage&&<FloatingActionDock><IconButton label={`Nuevo ${title}`} onClick={()=>setEditing(null)}>
      <Plus size={23}/></IconButton></FloatingActionDock>}
  </div>;
}
