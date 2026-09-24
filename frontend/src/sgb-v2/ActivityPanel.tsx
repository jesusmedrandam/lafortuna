import {type FormEvent,useEffect,useMemo,useState} from 'react';
import {Activity as ActivityIcon,ArrowUpDown,CheckCircle2,ChevronRight,Edit3,ImagePlus,
  Plus,Tag,XCircle} from 'lucide-react';
import {Badge,Button,Card,CompactToolbar,EmptyState,ErrorState,Field,FloatingActionDock,
  IconButton,Input,LoadingState,Modal,Select,Textarea} from '../components/ui';
import {formatDate} from '../utils';
import {ApiRequestError,applyActivity,cancelActivity,createActivity,deleteMediaObject,getActivities,
  getActivityOptions,getMedia,uploadMedia,updateActivity,type ActivityInput,type ActivityOptions,
  type ActivityRecord,type MediaItem} from './api';

const kinds={HERRAJE:'Herraje',DESCORNE:'Descorne',OTRA:'Otra actividad'};
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const message=(error:unknown)=>error instanceof ApiRequestError?error.message:
  error instanceof Error?error.message:'No fue posible guardar la actividad.';
export function ActivityPanel({accessToken,canManage,canViewMedia,canManageMedia}:{accessToken:string;
  canManage:boolean;canViewMedia:boolean;canManageMedia:boolean}){
  const [records,setRecords]=useState<ActivityRecord[]|null>(null);
  const [options,setOptions]=useState<ActivityOptions|null>(null);
  const [revision,setRevision]=useState(0);
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [formOpen,setFormOpen]=useState(false);
  const [editing,setEditing]=useState<ActivityRecord|null>(null);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [media,setMedia]=useState<MediaItem[]>([]);
  const [photos,setPhotos]=useState<File[]>([]);
  const [preview,setPreview]=useState<MediaItem|null>(null);
  const [search,setSearch]=useState('');
  const [selectedKind,setSelectedKind]=useState('');
  const [newest,setNewest]=useState(true);
  const [kind,setKind]=useState<ActivityInput['kind']>('OTRA');
  const [brandId,setBrandId]=useState('');
  const [selected,setSelected]=useState<string[]>([]);
  const visible=useMemo(()=>records?.filter(item=>(!selectedKind||item.kind===selectedKind)&&
    `${item.title} ${item.description??''} ${item.animals.map(animal=>
      `${animal.name} ${animal.earTagCode??''}`).join(' ')}`
      .toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a,b)=>(newest?-1:1)*(a.occurredOn.localeCompare(b.occurredOn)||
      a.createdAt.localeCompare(b.createdAt)))??[],[records,selectedKind,search,newest]);
  const viewing=records?.find(item=>item.id===selectedId);
  useEffect(()=>{let active=true;setMedia([]);
    const activityId=selectedId??editing?.id;
    if(activityId&&canViewMedia)void getMedia(accessToken,'LIVESTOCK_ACTIVITY',activityId)
      .then(items=>{if(active)setMedia(items.filter(item=>item.kind==='IMAGE'));})
      .catch(reason=>{if(active)setError(message(reason));});
    return()=>{active=false;};},[accessToken,selectedId,editing?.id,canViewMedia,revision]);
  useEffect(()=>{let active=true;void Promise.all([getActivities(accessToken),
    getActivityOptions(accessToken)]).then(([items,choices])=>{
    if(active){setRecords(items);setOptions(choices);}
  }).catch((failure)=>{if(active)setError(message(failure));});return ()=>{active=false;};
  },[accessToken,revision]);
  function reset(){setEditing(null);setFormOpen(false);setKind('OTRA');setBrandId('');setSelected([]);
    setPhotos([]);}
  function edit(item:ActivityRecord){setSelectedId(null);setEditing(item);setFormOpen(true);setKind(item.kind);
    setBrandId(item.brandId??'');setSelected(item.animals.map((animal)=>animal.id));
    window.scrollTo({top:0,behavior:'smooth'});}
  async function removePhoto(item:MediaItem){
    if(!window.confirm('¿Eliminar esta fotografía del almacenamiento?'))return;
    await run(()=>deleteMediaObject(accessToken,item.storage_object_id),()=>
      setMedia(current=>current.filter(photo=>photo.id!==item.id)));
  }
  async function run(action:()=>Promise<unknown>,done?:()=>void){setBusy(true);setError(null);
    try{await action();done?.();setRevision((value)=>value+1);}
    catch(failure){setError(message(failure));window.scrollTo({top:0,behavior:'smooth'});}
    finally{setBusy(false);}}
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);
    const input:ActivityInput={kind,title:String(data.get('title')).trim(),
      occurredOn:String(data.get('date')),description:String(data.get('description')).trim()||null,
      brandId:kind==='HERRAJE'?brandId:null,animalIds:selected,
      ...(editing?{expectedVersion:editing.version}:{})};
    if(!selected.length||kind==='HERRAJE'&&!brandId){setError('Selecciona animales y marquilla cuando corresponda.');return;}
    setBusy(true);setError(null);let saved:ActivityRecord|null=null;
    try{saved=editing?await updateActivity(accessToken,editing.id,input):await createActivity(accessToken,input);
      for(const file of photos)await uploadMedia(accessToken,{file,entityType:'LIVESTOCK_ACTIVITY',
        entityId:saved.id,relationCode:'GENERAL'});
      reset();setRevision(value=>value+1);
    }catch(reason){if(saved){setEditing(saved);setPhotos([]);setRevision(value=>value+1);}
      setError(message(reason));}finally{setBusy(false);}}
  return <div className="module-no-header activity-panel">
    <div className="activity-type-strip"><button type="button" className={!selectedKind?'selected':''}
      onClick={()=>setSelectedKind('')}><span><ActivityIcon size={20}/></span><small>Todas</small></button>
      {(Object.keys(kinds) as ActivityInput['kind'][]).map(code=><button key={code} type="button"
        className={selectedKind===code?'selected':''} onClick={()=>setSelectedKind(code)}>
        <span>{kinds[code].slice(0,1)}</span><small>{kinds[code]}</small></button>)}</div>
    <CompactToolbar search={search} onSearch={setSearch} placeholder="Buscar actividad, animal o arete…"
      count={visible.length} actions={<IconButton label={newest?'Más recientes':'Más antiguos'}
        onClick={()=>setNewest(value=>!value)}><ArrowUpDown size={18}/></IconButton>}/>
    {error&&<div role="alert" className="form-error admin-error">{error}</div>}
    {records===null&&!error?<LoadingState/>:records===null?<ErrorState message={error??'No se pudieron cargar las actividades.'}
      onRetry={()=>setRevision(value=>value+1)}/>:visible.length?<Card className="record-list">
      <div className="record-list-head"><span>Actividad</span><span>Fecha</span>
        <span>Animales</span><span>Estado</span><span/><span/></div>
      {visible.map(item=><button type="button" className="record-list-row" key={item.id}
        onClick={()=>setSelectedId(item.id)}><span><strong>{item.title}</strong>
          <small>{kinds[item.kind]} · {item.description||'Sin descripción'}</small></span>
        <span><strong>{formatDate(item.occurredOn)}</strong></span>
        <span><strong>{item.animals.length}</strong><small>{item.animals.slice(0,2).map(animal=>
          animal.name).join(', ')}</small></span>
        <span><Badge tone={item.status==='COMPLETADA'?'success':item.status==='CANCELADA'?'danger':'warning'}>
          {item.status==='BORRADOR'?'Borrador':item.status==='COMPLETADA'?'Completada':'Cancelada'}</Badge></span>
        <span/><span className="record-row-actions"><ChevronRight size={18}/></span>
      </button>)}</Card>:<EmptyState icon={ActivityIcon} title="Sin actividades"
      description={records.length?'Prueba otro filtro.':'Registra la primera actividad sobre los animales.'}/>}
    {viewing&&<Modal title="Detalle de la actividad" wide onClose={()=>setSelectedId(null)}
      footer={<><Button variant="ghost" onClick={()=>setSelectedId(null)}>Cerrar</Button>
        {canManage&&viewing.status==='BORRADOR'&&<><Button variant="secondary"
          onClick={()=>edit(viewing)}><Edit3 size={16}/>Editar</Button>
          <Button disabled={busy} onClick={()=>void run(()=>applyActivity(accessToken,viewing.id),
            ()=>setSelectedId(null))}><CheckCircle2 size={16}/>Aplicar</Button>
          <Button variant="ghost" disabled={busy} onClick={()=>void run(()=>cancelActivity(accessToken,viewing.id),
            ()=>setSelectedId(null))}><XCircle size={16}/>Cancelar actividad</Button></>}</>}>
      <div className="record-detail"><div className="record-detail-heading"><div className="record-icon">
        <ActivityIcon size={22}/></div><div><h2>{viewing.title}</h2>
          <p>{formatDate(viewing.occurredOn)} · {kinds[viewing.kind]}</p></div></div>
        {viewing.brandName&&<section><h3>Marquilla aplicada</h3><div className="detail-lines compact">
          <div><span><strong>{viewing.brandName}</strong></span><Tag size={18}/></div></div></section>}
        <section><h3>Animales</h3><div className="detail-lines compact">{viewing.animals.map(animal=><div
          key={animal.id}><span><strong>{animal.name}</strong><small>{animal.earTagCode
            ?`Arete ${animal.earTagCode}`:'Sin arete'}</small></span></div>)}</div></section>
        {media.length>0&&<section><h3>Fotografías</h3><div className="record-photo-grid record-photo-gallery">
          {media.map(item=><button type="button" className="record-photo-view" key={item.id}
            onClick={()=>setPreview(item)}><img src={item.thumbnailUrl??item.url} alt="Actividad"/>
          </button>)}</div></section>}
        {viewing.description&&<section><h3>Descripción</h3><p>{viewing.description}</p></section>}
      </div></Modal>}
    {canManage&&formOpen&&options&&<Modal title={editing?'Editar actividad':'Nueva actividad'} wide
      onClose={reset} footer={<><Button variant="ghost" onClick={reset}>Cancelar</Button>
        <Button form="v2-activity-form" type="submit" loading={busy}>Guardar borrador</Button></>}>
      <form className="form-stack" id="v2-activity-form" onSubmit={save} key={editing?.id??'new'}>
      {error&&<div role="alert" className="form-error admin-error">{error}</div>}
      <div className="form-grid"><Field label="Tipo de actividad" required><Select value={kind} onChange={(event)=>{
        setKind(event.target.value as ActivityInput['kind']);setBrandId('');}}>
        {Object.entries(kinds).map(([code,label])=><option key={code} value={code}>{label}</option>)}
      </Select></Field>
      <Field label="Fecha" required><Input name="date" type="date" required max={today()}
        defaultValue={editing?.occurredOn??today()}/></Field>
      {kind==='HERRAJE'&&<Field label="Marquilla aplicada" required><Select value={brandId}
        required onChange={(event)=>setBrandId(event.target.value)}><option value="">Selecciona</option>
        {options.brands.map((brand)=><option key={brand.id} value={brand.id}>{brand.name}</option>)}
      </Select></Field>}</div>
      <Field label="Título" required><Input name="title" required maxLength={180} minLength={2}
        defaultValue={editing?.title??''} placeholder="Ej. Descorne de terneros"/></Field>
      <Field label={`Animales (${selected.length})`} required><div className="movement-selection">
        <button type="button" className="secondary-button compact" onClick={()=>setSelected(
          selected.length===options.animals.length?[]:options.animals.map((animal)=>animal.id))}>
          {selected.length===options.animals.length?'Quitar selección':'Seleccionar todos'}</button>
        <div className="movement-animal-grid">{options.animals.map((animal)=><label key={animal.id}>
          <input type="checkbox" checked={selected.includes(animal.id)} onChange={(event)=>setSelected(
            event.target.checked?[...selected,animal.id]:selected.filter((id)=>id!==animal.id))}/>
          <span>{animal.name}{animal.earTagCode?` · ${animal.earTagCode}`:''}</span>
        </label>)}</div></div></Field>
      <Field label="Descripción"><Textarea name="description" maxLength={5000}
        defaultValue={editing?.description??''}/></Field>
      {canManageMedia&&<Field label="Fotografías" hint="Hasta tres imágenes.">
        <div className="record-photo-picker"><div className="record-photo-grid">
          {editing&&media.map(item=><div key={item.id}><img src={item.thumbnailUrl??item.url}
            alt="Fotografía de la actividad"/><button type="button" disabled={busy}
            onClick={()=>void removePhoto(item)} aria-label="Eliminar fotografía">×</button></div>)}
          {photos.map((file,index)=><div key={`${file.name}-${index}`}>
            <ActivityFilePreview file={file}/><button type="button"
              onClick={()=>setPhotos(current=>current.filter((_,position)=>position!==index))}
              aria-label="Quitar fotografía">×</button></div>)}</div>
          <label className={`photo-upload-button ${photos.length+media.length>=3?'disabled':''}`}>
            <ImagePlus size={18}/>Agregar fotografías
            <input hidden type="file" accept="image/jpeg,image/png,image/webp" multiple
              disabled={photos.length+media.length>=3}
              onChange={event=>{setPhotos(current=>[...current,
                ...Array.from(event.target.files??[])].slice(0,3-media.length));
                event.currentTarget.value='';}}/></label>
          <small>{photos.length+media.length} de 3</small></div></Field>}
      </form></Modal>}
    {preview&&<div className="v2-media-viewer" role="dialog" aria-modal="true"
      aria-label="Fotografía de actividad" onClick={()=>setPreview(null)}>
      <button type="button" aria-label="Cerrar fotografía" onClick={()=>setPreview(null)}>×</button>
      <img src={preview.url} alt="Actividad" onClick={event=>event.stopPropagation()}/></div>}
    {canManage&&<FloatingActionDock><IconButton label="Nueva actividad" onClick={()=>{
      reset();setFormOpen(true);}}><Plus size={22}/></IconButton></FloatingActionDock>}
  </div>;
}

function ActivityFilePreview({file}:{file:File}){
  const [url,setUrl]=useState('');
  useEffect(()=>{const next=URL.createObjectURL(file);setUrl(next);
    return()=>URL.revokeObjectURL(next);},[file]);
  return <img src={url} alt={file.name}/>;
}
