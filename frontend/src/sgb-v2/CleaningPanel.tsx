import {type FormEvent,useEffect,useMemo,useState} from 'react';
import {ArrowUpDown,ChevronRight,Edit3,ImagePlus,MapPin,Plus,Sprout} from 'lucide-react';
import {Badge,Button,Card,CompactToolbar,EmptyState,ErrorState,FloatingActionDock,
  IconButton,LoadingState,Modal} from '../components/ui';
import {formatDate} from '../utils';
import {ApiRequestError,applyCleaning,cancelCleaning,createCleaning,createCleaningProduct,
  getCleaningOptions,getCleaningProducts,getCleanings,listCatalogItems,updateCleaning,uploadMedia,
  type CatalogItem,type CleaningInput,type CleaningOptions,type CleaningProduct,type CleaningRecord} from './api';
import {RecordMedia} from './RecordMedia';
const labels={FUMIGACION:'Fumigación',TALA_SELECTIVA:'Tala selectiva',
  DESBROCE:'Desbroce',OTRA:'Otra labor'};
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const message=(error:unknown)=>error instanceof ApiRequestError?error.message:
  error instanceof Error?error.message:'No se pudo guardar la limpieza.';
type ProductLine=CleaningInput['products'][number];
type OperatorLine=CleaningInput['operators'][number];
export function CleaningPanel({accessToken,canManage,canViewMedia,canManageMedia}:{accessToken:string;
  canManage:boolean;canViewMedia:boolean;canManageMedia:boolean}){
  const [records,setRecords]=useState<CleaningRecord[]|null>(null);
  const [options,setOptions]=useState<CleaningOptions|null>(null);
  const [products,setProducts]=useState<CleaningProduct[]>([]);
  const [categories,setCategories]=useState<CatalogItem[]>([]);
  const [revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [showForm,setShowForm]=useState(false);
  const [showProduct,setShowProduct]=useState(false);
  const [editing,setEditing]=useState<CleaningRecord|null>(null);
  const [photos,setPhotos]=useState<File[]>([]);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [search,setSearch]=useState('');
  const [activityFilter,setActivityFilter]=useState<CleaningInput['activities'][number]|''>('');
  const [newest,setNewest]=useState(true);
  const [locationId,setLocationId]=useState('');
  const [areaType,setAreaType]=useState<CleaningInput['areaType']>('TOTAL');
  const [activities,setActivities]=useState<CleaningInput['activities']>([]);
  const [applicationUnit,setApplicationUnit]=useState<'TANQUES'|'BOMBADAS'>('TANQUES');
  const [applicationCount,setApplicationCount]=useState('');
  const [lines,setLines]=useState<ProductLine[]>([]);
  const [operators,setOperators]=useState<OperatorLine[]>([]);
  useEffect(()=>{let active=true;void Promise.all([getCleanings(accessToken),
    getCleaningOptions(accessToken),getCleaningProducts(accessToken),
    listCatalogItems(accessToken,'AGROCHEMICAL_CATEGORIES')]).then(([items,choices,catalog,types])=>{
    if(active){setRecords(items);setOptions(choices);setProducts(catalog);setCategories(types);}
  }).catch((failure)=>{if(active)setError(message(failure));});return ()=>{active=false;};
  },[accessToken,revision]);
  function reset(){setEditing(null);setShowForm(false);setPhotos([]);setLocationId('');setAreaType('TOTAL');
    setActivities([]);setApplicationCount('');setApplicationUnit('TANQUES');setLines([]);setOperators([]);}
  function edit(item:CleaningRecord){setSelectedId(null);setEditing(item);setShowForm(true);setLocationId(item.locationId);
    setAreaType(item.areaType);setActivities(item.activities);setApplicationUnit(item.applicationUnit??'TANQUES');
    setApplicationCount(item.applicationCount==null?'':String(item.applicationCount));
    setLines(item.products.map(({productId,unitCode,quantityPerApplication,notes})=>({
      productId,unitCode,quantityPerApplication,notes:notes??null})));setOperators(item.operators);
    window.scrollTo({top:0,behavior:'smooth'});}
  async function run(action:()=>Promise<unknown>,done?:()=>void){setBusy(true);setError(null);
    try{await action();done?.();setRevision((value)=>value+1);}
    catch(failure){setError(message(failure));window.scrollTo({top:0,behavior:'smooth'});}
    finally{setBusy(false);}}
  function saveProduct(event:FormEvent<HTMLFormElement>){event.preventDefault();
    const data=new FormData(event.currentTarget);
    void run(()=>createCleaningProduct(accessToken,{name:String(data.get('name')).trim(),
      category:String(data.get('category')).trim()||null,
      activeIngredient:String(data.get('activeIngredient')).trim()||null,
      formulatedBy:String(data.get('formulatedBy')).trim()||null,
      description:String(data.get('description')).trim()||null}),()=>setShowProduct(false));}
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);
    const spray=activities.includes('FUMIGACION');
    const input:CleaningInput={locationId,startedOn:String(data.get('startedOn')),
      finishedOn:String(data.get('finishedOn'))||null,activities,applicationUnit:spray?applicationUnit:null,
      applicationCount:spray&&applicationCount?Number(applicationCount):null,
      tankCapacityLiters:spray&&data.get('capacity')?Number(data.get('capacity')):null,
      areaType,partialPercent:areaType==='PARCIAL'?Number(data.get('partialPercent')):null,
      notes:String(data.get('notes')).trim()||null,products:spray?lines:[],operators,
      ...(editing?{expectedVersion:editing.version}:{})};
    setBusy(true);setError(null);let saved:CleaningRecord|null=null;
    try{
      saved=editing?await updateCleaning(accessToken,editing.id,input):await createCleaning(accessToken,input);
      for(const file of photos)await uploadMedia(accessToken,{file,entityType:'CLEANING',
        entityId:saved.id,relationCode:'GENERAL'});
      reset();setRevision(value=>value+1);
    }catch(failure){if(saved){reset();setRevision(value=>value+1);setSelectedId(saved.id);
        setError(`La limpieza se guardó, pero no se completó la carga de fotografías: ${message(failure)}`);
      }else setError(message(failure));}
    finally{setBusy(false);}
  }
  const location=options?.locations.find((item)=>item.id===locationId);
  const visible=useMemo(()=>records?.filter(item=>(!activityFilter||item.activities.includes(activityFilter))&&
    [item.locationName,item.notes??'',...item.activities.map(activity=>labels[activity]),
      ...item.products.map(product=>product.productName)].join(' ').toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()))
    .sort((a,b)=>(newest?-1:1)*(a.startedOn.localeCompare(b.startedOn)||
      a.createdAt.localeCompare(b.createdAt)))??[],[records,activityFilter,search,newest]);
  const viewing=records?.find(item=>item.id===selectedId);
  return <section className="module-no-header cleanings-panel">
    <div className="activity-type-strip" aria-label="Filtrar tipo de labor">
      <button type="button" className={!activityFilter?'selected':''} onClick={()=>setActivityFilter('')}>
        <span><Sprout size={20}/></span><small>Todas</small></button>
      {(Object.keys(labels) as CleaningInput['activities'][number][]).map(code=><button type="button"
        key={code} className={activityFilter===code?'selected':''} onClick={()=>setActivityFilter(code)}>
        <span>{labels[code].slice(0,1)}</span><small>{labels[code]}</small></button>)}
    </div>
    <CompactToolbar search={search} onSearch={setSearch} placeholder="Buscar potrero, labor o producto…"
      count={visible.length} actions={<><IconButton label={newest?'Más recientes':'Más antiguos'}
        onClick={()=>setNewest(value=>!value)}><ArrowUpDown size={18}/></IconButton>
        {canManage&&<IconButton label="Nuevo producto" onClick={()=>setShowProduct(true)}>
          <Plus size={18}/><Sprout size={15}/></IconButton>}</>}/>
    {error&&<div role="alert" className="form-error admin-error">{error}</div>}
    {canManage&&showProduct&&<Modal title="Nuevo producto compartido en la cuenta" wide
      onClose={()=>setShowProduct(false)} footer={<Button variant="ghost"
        onClick={()=>setShowProduct(false)}>Cerrar</Button>}><form className="movement-form" onSubmit={saveProduct}>
      <label><span>Nombre *</span><input name="name" required minLength={2} maxLength={160}/></label>
      <label><span>Categoría *</span><select name="category" required><option value="">Selecciona</option>
        {categories.filter(item=>item.active).map(item=><option key={item.id} value={item.name}>{item.name}</option>)}
      </select><small>Agrega categorías nuevas desde Catálogos.</small></label>
      <label><span>Principio activo</span><textarea name="activeIngredient" maxLength={2000}/></label>
      <label><span>Formulado por</span><input name="formulatedBy" maxLength={200}/></label>
      <label className="movement-wide"><span>Descripción</span><textarea name="description" maxLength={2000}/></label>
      <button className="primary-button compact" disabled={busy}>Guardar producto</button></form></Modal>}
    {canManage&&showForm&&options&&<Modal title={editing?'Editar borrador':'Nueva limpieza'} wide
      onClose={reset} footer={<Button variant="ghost" onClick={reset}>Cerrar</Button>}>
      <form className="movement-form" onSubmit={save} key={editing?.id??'new'}>
      <label><span>Potrero *</span><select required value={locationId}
        onChange={(event)=>setLocationId(event.target.value)}><option value="">Selecciona</option>
        {options.locations.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>Inicio *</span><input name="startedOn" type="date" max={today()} required
        defaultValue={editing?.startedOn??today()}/></label>
      <label><span>Finalización</span><input name="finishedOn" type="date" max={today()}
        defaultValue={editing?.finishedOn??''}/></label>
      <label><span>Área intervenida</span><select value={areaType}
        onChange={(event)=>setAreaType(event.target.value as CleaningInput['areaType'])}>
        <option value="TOTAL">Total</option><option value="PARCIAL">Parcial</option></select></label>
      {areaType==='PARCIAL'&&<label><span>Porcentaje del potrero *</span>
        <input name="partialPercent" type="number" min="0.01" max="99.99" step="0.01"
          required defaultValue={editing?.partialPercent??''}/></label>}
      {location?.areaValue&&<p className="muted movement-wide">Área del potrero: {location.areaValue} {location.areaUnitCode}.
        El área intervenida se calculará automáticamente.</p>}
      <fieldset className="movement-wide cleaning-activities"><legend>Actividades *</legend>
        {Object.entries(labels).map(([code,label])=><label key={code}><input type="checkbox"
          checked={activities.includes(code as CleaningInput['activities'][number])}
          onChange={(event)=>setActivities(event.target.checked
            ?[...activities,code as CleaningInput['activities'][number]]
            :activities.filter((item)=>item!==code))}/>{label}</label>)}</fieldset>
      {activities.includes('FUMIGACION')&&<><label><span>Unidad de aplicación</span><select value={applicationUnit}
        onChange={(event)=>setApplicationUnit(event.target.value as 'TANQUES'|'BOMBADAS')}>
        <option value="TANQUES">Tanques</option><option value="BOMBADAS">Bombadas</option></select></label>
      <label><span>Cantidad de {applicationUnit==='TANQUES'?'tanques':'bombadas'}</span>
        <input type="number" min="0.01" step="0.01" value={applicationCount}
          onChange={(event)=>setApplicationCount(event.target.value)}/></label>
      <label><span>Capacidad (litros)</span><input name="capacity" type="number" min="0.01"
        step="0.01" defaultValue={editing?.tankCapacityLiters??''}/></label></>}
      <label className="movement-wide"><span>Observaciones</span><textarea name="notes" maxLength={5000}
        defaultValue={editing?.notes??''}/></label>
      {activities.includes('FUMIGACION')&&<div className="movement-wide cleaning-lines"><div className="movement-card-top"><h3>Productos</h3>
        <button type="button" className="secondary-button compact" onClick={()=>setLines([...lines,
          {productId:'',unitCode:'MILLILITER',quantityPerApplication:1}])}>+ Producto aplicado</button></div>
        {lines.map((line,index)=><div className="cleaning-line" key={index}>
          <select aria-label="Producto" value={line.productId} required onChange={(event)=>setLines(lines.map(
            (item,i)=>i===index?{...item,productId:event.target.value}:item))}>
            <option value="">Selecciona</option>{products.filter((item)=>item.active).map((item)=><option
              key={item.id} value={item.id}>{item.name}</option>)}</select>
          <input type="number" min="0.0001" step="any" value={line.quantityPerApplication}
            aria-label="Cantidad por aplicación" required onChange={(event)=>setLines(lines.map((item,i)=>
              i===index?{...item,quantityPerApplication:Number(event.target.value)}:item))}/>
          <select aria-label="Unidad" value={line.unitCode} onChange={(event)=>setLines(lines.map((
            item,i)=>i===index?{...item,unitCode:event.target.value}:item))}>
            {options.units.map((unit)=><option key={unit.code} value={unit.code}>{unit.symbol}</option>)}</select>
          <strong>Total: {applicationCount?Number((Number(applicationCount)*line.quantityPerApplication)
            .toFixed(4)):'—'}</strong><button type="button" className="secondary-button compact"
              onClick={()=>setLines(lines.filter((_,i)=>i!==index))}>Quitar</button>
        </div>)}</div>}
      <div className="movement-wide cleaning-lines"><div className="movement-card-top"><h3>Operadores</h3>
        <button type="button" className="secondary-button compact" onClick={()=>setOperators([...operators,
          {name:'',function:null}])}>+ Operador</button></div>
        {operators.map((item,index)=><div className="cleaning-line" key={index}>
          <input aria-label="Nombre de operador" placeholder="Nombre" required value={item.name}
            onChange={(event)=>setOperators(operators.map((entry,i)=>i===index
              ?{...entry,name:event.target.value}:entry))}/>
          <input aria-label="Función" placeholder="Función" value={item.function??''}
            onChange={(event)=>setOperators(operators.map((entry,i)=>i===index
              ?{...entry,function:event.target.value}:entry))}/>
          <button type="button" className="secondary-button compact"
            onClick={()=>setOperators(operators.filter((_,i)=>i!==index))}>Quitar</button></div>)}</div>
      {canManageMedia&&!editing&&<div className="movement-wide record-photo-picker">
        <strong>Fotografías de la limpieza</strong><small>Hasta tres imágenes. Se cargarán al guardar el borrador.</small>
        {photos.length>0&&<div className="record-photo-grid">{photos.map((file,index)=><div
          key={`${file.name}-${index}`}><CleaningPhotoPreview file={file}/><button type="button"
            aria-label={`Quitar ${file.name}`} onClick={()=>setPhotos(current=>current.filter((_,i)=>i!==index))}>×</button>
        </div>)}</div>}
        <label className={`photo-upload-button ${photos.length>=3?'disabled':''}`}>
          <ImagePlus size={18}/>Agregar fotografías
          <input hidden type="file" accept="image/jpeg,image/png,image/webp" multiple
            disabled={photos.length>=3} onChange={event=>{setPhotos(current=>[
              ...current,...Array.from(event.target.files??[])].slice(0,3));event.currentTarget.value='';}}/>
        </label><small>{photos.length} de 3</small></div>}
      <button className="primary-button compact" disabled={busy||!activities.length||!locationId
        ||activities.includes('FUMIGACION')&&lines.length>0&&!applicationCount}>
        {editing?'Guardar borrador':'Crear borrador'}</button>
    </form></Modal>}
    {records===null&&!error?<LoadingState/>:records===null?<ErrorState
      message={error??'No se pudieron cargar las limpiezas.'}
      onRetry={()=>setRevision(value=>value+1)}/>:visible.length?<Card className="cleaning-list">
      <div className="cleaning-list-head"><span>Potrero</span><span>Inicio</span><span>Actividades</span>
        <span>Área</span><span>Estado</span><span/></div>
      {visible.map(item=><button type="button" className="cleaning-list-row" key={item.id}
        onClick={()=>setSelectedId(item.id)}><span className="cleaning-identity"><span><MapPin size={19}/></span>
          <span><strong>{item.locationName}</strong><small>{item.notes||'Sin observaciones'}</small></span></span>
        <span>{formatDate(item.startedOn)}</span><span>{item.activities.map(activity=>labels[activity]).join(', ')}</span>
        <span>{item.areaType==='TOTAL'?'Total':`${item.partialPercent}%`}</span>
        <span><Badge tone={item.status==='COMPLETADO'?'success':item.status==='BORRADOR'?'warning':'danger'}>
          {item.status==='BORRADOR'?'Borrador':item.status==='COMPLETADO'?'Completado':'Cancelado'}</Badge></span>
        <ChevronRight size={18}/></button>)}</Card>:<EmptyState icon={Sprout} title="Sin limpiezas"
        description={records.length?'Prueba otra búsqueda o filtro.':'Registra la primera labor en un potrero.'}/>}
    {viewing&&<Modal title="Detalle de la limpieza" wide onClose={()=>setSelectedId(null)}
      footer={<><Button variant="ghost" onClick={()=>setSelectedId(null)}>Cerrar</Button>
        {canManage&&viewing.status==='BORRADOR'&&<><Button variant="secondary"
          onClick={()=>edit(viewing)}><Edit3 size={16}/>Editar</Button>
          <Button disabled={busy} onClick={()=>void run(()=>applyCleaning(accessToken,viewing.id),
            ()=>setSelectedId(null))}>Completar</Button>
          <Button variant="ghost" disabled={busy} onClick={()=>void run(()=>cancelCleaning(accessToken,viewing.id),
            ()=>setSelectedId(null))}>Cancelar limpieza</Button></>}</>}>
      <div className="cleaning-detail"><div className="cleaning-detail-heading">
        <span className="record-icon"><MapPin size={22}/></span><div><h2>{viewing.locationName}</h2>
          <p>{formatDate(viewing.startedOn)}{viewing.finishedOn?` – ${formatDate(viewing.finishedOn)}`:''}</p></div>
        <Badge tone={viewing.status==='COMPLETADO'?'success':viewing.status==='BORRADOR'?'warning':'danger'}>
          {viewing.status==='BORRADOR'?'Borrador':viewing.status==='COMPLETADO'?'Completado':'Cancelado'}</Badge></div>
        <div className="cleaning-detail-grid"><div><small>Actividades</small><strong>{viewing.activities
          .map(activity=>labels[activity]).join(', ')}</strong></div><div><small>Área intervenida</small>
          <strong>{viewing.areaType==='TOTAL'?'Total':`${viewing.partialPercent}%`}
            {viewing.areaValue!=null?` · ${viewing.areaValue} ${viewing.areaUnitCode??''}`:''}</strong></div>
          {viewing.applicationCount!=null&&<div><small>Aplicaciones</small><strong>
            {viewing.applicationCount} {viewing.applicationUnit==='TANQUES'?'tanques':'bombadas'}</strong></div>}</div>
        {viewing.products.length>0&&<section><h3>Productos aplicados</h3><div className="cleaning-detail-lines">
          {viewing.products.map(product=><div key={product.productId}><strong>{product.productName}</strong>
            <small>{product.totalQuantity} {product.unitCode} en total</small></div>)}</div></section>}
        {viewing.operators.length>0&&<section><h3>Operadores</h3><div className="cleaning-detail-lines">
          {viewing.operators.map((operator,index)=><div key={`${operator.name}-${index}`}>
            <strong>{operator.name}</strong><small>{operator.function||'Sin función indicada'}</small></div>)}</div></section>}
        {viewing.notes&&<section><h3>Observaciones</h3><p>{viewing.notes}</p></section>}
        {canViewMedia&&<section><h3>Fotografías</h3><RecordMedia accessToken={accessToken}
          entityType="CLEANING" entityId={viewing.id} canManage={canManageMedia}/></section>}
      </div></Modal>}
    {canManage&&<FloatingActionDock><IconButton label="Nueva limpieza" onClick={()=>{
      reset();setShowForm(true);}}><Plus size={22}/></IconButton></FloatingActionDock>}
  </section>;
}

function CleaningPhotoPreview({file}:{file:File}){
  const [url,setUrl]=useState('');
  useEffect(()=>{const next=URL.createObjectURL(file);setUrl(next);
    return()=>URL.revokeObjectURL(next);},[file]);
  return <img src={url} alt={file.name}/>;
}
