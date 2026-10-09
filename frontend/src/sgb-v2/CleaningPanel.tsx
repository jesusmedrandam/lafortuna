import {DateInput} from '../components/ui';
import {type FormEvent,useEffect,useMemo,useRef,useState} from 'react';
import {ArrowUpDown,Axe,ChevronRight,Edit3,Gauge,ImagePlus,MapPin,Plus,SlidersHorizontal,Scissors,SprayCan,Sprout,Trash2,X} from 'lucide-react';
import {useLocation,useNavigate,useSearchParams} from 'react-router-dom';
import {Badge,Button,CompactToolbar,EmptyState,ErrorState,FloatingActionDock,
  IconButton,LoadingState,Modal,Select} from '../components/ui';
import {formatDate,formatNumber} from '../utils';
import {ApiRequestError,applyCleaning,cancelCleaning,createCleaning,
  getCleaningOptions,getCleaningProducts,getCleanings,updateCleaning,uploadMedia,
  type CatalogItem,type CleaningInput,type CleaningOptions,type CleaningProduct,type CleaningRecord} from './api';
import {RecordMedia} from './RecordMedia';
import {CleaningProductCatalog} from './CleaningProductCatalog';
const labels={FUMIGACION:'Fumigación',TALA_SELECTIVA:'Tala selectiva',
  DESBROCE:'Desbroce',OTRA:'Otra labor'};
const activityIcons={FUMIGACION:SprayCan,TALA_SELECTIVA:Axe,DESBROCE:Scissors,OTRA:Sprout};
const statuses={BORRADOR:'Borrador',COMPLETADO:'Completado',CANCELADO:'Cancelado'};
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const message=(error:unknown)=>error instanceof ApiRequestError?error.message:
  error instanceof Error?error.message:'No se pudo guardar la limpieza.';
type ProductLine=CleaningInput['products'][number];
type OperatorLine=CleaningInput['operators'][number];
export function CleaningPanel({accessToken,canManage,canViewMedia,canManageMedia,canEditProducts=false}:{accessToken:string;
  canManage:boolean;canViewMedia:boolean;canManageMedia:boolean;canEditProducts?:boolean}){
  const [records,setRecords]=useState<CleaningRecord[]|null>(null);
  const [options,setOptions]=useState<CleaningOptions|null>(null);
  const [products,setProducts]=useState<CleaningProduct[]>([]);
  const [categories,setCategories]=useState<CatalogItem[]>([]);
  const [revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [showForm,setShowForm]=useState(false);
  const saving=useRef(false);
  const [editing,setEditing]=useState<CleaningRecord|null>(null);
  const [photos,setPhotos]=useState<File[]>([]);
  const [params,setParams]=useSearchParams();const navigate=useNavigate();const route=useLocation();
  const selectedId=params.get('limpieza');const showProduct=params.has('productos');
  function setShowProduct(open:boolean){
    if(!open&&route.state?.cleaningProducts){navigate(-1);return;}
    const next=new URLSearchParams(params);if(open)next.set('productos','1');else{next.delete('productos');next.delete('producto');}
    setParams(next,{replace:!open,state:open?{cleaningProducts:true}:null});
  }
  function setSelectedId(id:string|null){
    if(!id&&route.state?.cleaningDetail){navigate(-1);return;}
    const next=new URLSearchParams(params);if(id)next.set('limpieza',id);else next.delete('limpieza');
    setParams(next,{replace:!id,state:id?{cleaningDetail:true}:null});
  }
  const [search,setSearch]=useState('');
  const [activityFilter,setActivityFilter]=useState<CleaningInput['activities'][number]|''>('');
  const [order,setOrder]=useState<'NEWEST'|'OLDEST'|'AZ'|'ZA'>('NEWEST');
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [filters,setFilters]=useState({locationId:'',since:'',until:'',status:''});
  const [locationId,setLocationId]=useState('');
  const [areaType,setAreaType]=useState<CleaningInput['areaType']>('TOTAL');
  const [activities,setActivities]=useState<CleaningInput['activities']>([]);
  const [applicationUnit,setApplicationUnit]=useState<'TANQUES'|'BOMBADAS'>('TANQUES');
  const [applicationCount,setApplicationCount]=useState('');
  const [startedOn,setStartedOn]=useState(today());
  const [lines,setLines]=useState<ProductLine[]>([]);
  const [operators,setOperators]=useState<OperatorLine[]>([]);
  useEffect(()=>{let active=true;void Promise.all([getCleanings(accessToken),
    getCleaningOptions(accessToken),getCleaningProducts(accessToken)]).then(([items,choices,catalog])=>{
    if(active){setRecords(items);setOptions(choices);setProducts(catalog);setCategories(choices.categories??[]);}
  }).catch((failure)=>{if(active)setError(message(failure));});return ()=>{active=false;};
  },[accessToken,revision]);
  function reset(){setEditing(null);setShowForm(false);setPhotos([]);setError(null);
    setLocationId('');setAreaType('TOTAL');
    setStartedOn(today());setActivities([]);setApplicationCount('');setApplicationUnit('TANQUES');setLines([]);setOperators([]);}
  function edit(item:CleaningRecord){setSelectedId(null);setError(null);setEditing(item);
    setShowForm(true);setLocationId(item.locationId);
    setStartedOn(item.startedOn);setAreaType(item.areaType);setActivities(item.activities);setApplicationUnit(item.applicationUnit??'TANQUES');
    setApplicationCount(item.applicationCount==null?'':String(item.applicationCount));
    setLines(item.products.map(({productId,unitCode,quantityPerApplication,notes})=>({
      productId,unitCode,quantityPerApplication,notes:notes??null})));setOperators(item.operators);
    window.scrollTo({top:0,behavior:'smooth'});}
  async function run(action:()=>Promise<unknown>,done?:()=>void){setBusy(true);setError(null);
    try{await action();done?.();setRevision((value)=>value+1);}
    catch(failure){setError(message(failure));window.scrollTo({top:0,behavior:'smooth'});}
    finally{setBusy(false);}}
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();if(saving.current||busy)return;const data=new FormData(event.currentTarget);
    const spray=activities.includes('FUMIGACION');
    if(spray&&new Set(lines.map(line=>line.productId)).size!==lines.length){
      setError('No repitas un producto en la misma limpieza.');return;
    }
    if(new Set(operators.map(item=>item.name.trim().toLocaleLowerCase())).size!==operators.length){
      setError('No repitas un operador en la misma limpieza.');return;
    }
    const input:CleaningInput={locationId,startedOn:String(data.get('startedOn')),
      finishedOn:String(data.get('finishedOn'))||null,activities,applicationUnit:spray?applicationUnit:null,
      applicationCount:spray&&applicationCount?Number(applicationCount):null,
      tankCapacityLiters:spray&&data.get('capacity')?Number(data.get('capacity')):null,
      areaType,partialPercent:areaType==='PARCIAL'?Number(data.get('partialPercent')):null,
      notes:String(data.get('notes')).trim()||null,products:spray?lines:[],operators,
      ...(editing?{expectedVersion:editing.version}:{})};
    saving.current=true;setBusy(true);setError(null);let saved:CleaningRecord|null=null;
    try{
      saved=editing?await updateCleaning(accessToken,editing.id,input):await createCleaning(accessToken,input);
      for(const file of photos)await uploadMedia(accessToken,{file,entityType:'CLEANING',
        entityId:saved.id,relationCode:'GENERAL'});
      reset();setRevision(value=>value+1);
    }catch(failure){if(saved){reset();setRevision(value=>value+1);setSelectedId(saved.id);
        setError(`La limpieza se guardó, pero no se completó la carga de fotografías: ${message(failure)}`);
      }else setError(message(failure));}
    finally{saving.current=false;setBusy(false);}
  }
  const location=options?.locations.find((item)=>item.id===locationId);
  const unitLabel=(code:string)=>options?.units.find(item=>item.code===code)?.symbol??
    ({HECTARE:'ha',SQUARE_METER:'m²',MILLILITER:'ml',LITER:'L',GRAM:'g',KILOGRAM:'kg'} as Record<string,string>)[code]??code;
  const activeFilters=Object.values(filters).filter(Boolean).length;
  const visible=useMemo(()=>records?.filter(item=>(!activityFilter||item.activities.includes(activityFilter))&&
    (!filters.locationId||item.locationId===filters.locationId)&&(!filters.status||item.status===filters.status)&&
    (!filters.since||item.startedOn>=filters.since)&&(!filters.until||item.startedOn<=filters.until)&&
    [item.locationName,item.notes??'',...item.activities.map(activity=>labels[activity]),
      ...item.products.map(product=>product.productName)].join(' ').toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()))
    .sort((a,b)=>order==='AZ'||order==='ZA'?(order==='AZ'?1:-1)*a.locationName.localeCompare(b.locationName,'es'):
      (order==='NEWEST'?-1:1)*(a.startedOn.localeCompare(b.startedOn)||a.createdAt.localeCompare(b.createdAt)))??[],
      [records,activityFilter,search,order,filters]);
  const viewing=records?.find(item=>item.id===selectedId);
  return <section className="module-no-header cleanings-panel">
    <div className="activity-type-strip" aria-label="Filtrar tipo de labor">
      <button type="button" className={!activityFilter?'selected':''} onClick={()=>setActivityFilter('')}>
        <span><Sprout size={20}/></span><small>Todas</small></button>
      {(Object.keys(labels) as CleaningInput['activities'][number][]).map(code=>{const Icon=activityIcons[code];return <button type="button"
        key={code} className={activityFilter===code?'selected':''} onClick={()=>setActivityFilter(code)}>
        <span><Icon size={20}/></span><small>{labels[code]}</small></button>;})}
    </div>
    <CompactToolbar search={search} onSearch={setSearch} placeholder="Buscar potrero, labor o producto…"
      count={visible.length} actions={<><IconButton label="Cambiar orden" title={{NEWEST:'Más recientes',OLDEST:'Más antiguos',AZ:'Potrero A–Z',ZA:'Potrero Z–A'}[order]}
        onClick={()=>setOrder(value=>value==='NEWEST'?'OLDEST':value==='OLDEST'?'AZ':value==='AZ'?'ZA':'NEWEST')}><ArrowUpDown size={18}/></IconButton>
        <IconButton label="Filtros de limpieza" className={filtersOpen||activeFilters?'active':''} onClick={()=>setFiltersOpen(value=>!value)}>
          <SlidersHorizontal size={18}/>{activeFilters>0&&<span className="filter-count">{activeFilters}</span>}</IconButton>
        {<IconButton label="Administrar productos" onClick={()=>{
          setError(null);setShowProduct(true);}}>
          <Sprout size={21}/></IconButton>}</>}/>
    {filtersOpen&&<section className="advanced-filters"><div className="advanced-filters-heading"><h2>Filtrar limpiezas</h2>
      <div className="advanced-filter-actions"><IconButton label="Limpiar filtros" onClick={()=>setFilters({locationId:'',since:'',until:'',status:''})}><Trash2 size={17}/></IconButton>
        <IconButton label="Cerrar filtros" onClick={()=>setFiltersOpen(false)}><X size={18}/></IconButton></div></div>
      <div className="advanced-filters-grid"><label><span>Potrero</span><Select value={filters.locationId} onChange={event=>setFilters({...filters,locationId:event.target.value})}>
        <option value="">Todos los potreros</option>{options?.locations.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
        <label><span>Desde</span><DateInput type="date" value={filters.since} max={filters.until||undefined} onChange={event=>setFilters({...filters,since:event.target.value})}/></label>
        <label><span>Hasta</span><DateInput type="date" value={filters.until} min={filters.since||undefined} onChange={event=>setFilters({...filters,until:event.target.value})}/></label>
        <label><span>Estado</span><Select value={filters.status} onChange={event=>setFilters({...filters,status:event.target.value})}><option value="">Todos los estados</option>
          {Object.entries(statuses).map(([code,name])=><option key={code} value={code}>{name}</option>)}</Select></label></div></section>}
    {error&&<div role="alert" className="form-error admin-error">{error}</div>}
    {showProduct&&<Modal title="Administrar productos de limpieza" wide onClose={()=>setShowProduct(false)}>
      <CleaningProductCatalog accessToken={accessToken} canManage={canManage} canEdit={canEditProducts} categories={categories}/>
    </Modal>}
    {canManage&&showForm&&options&&<Modal title={editing?'Editar borrador':'Nueva limpieza'} wide
      onClose={()=>{if(!saving.current)reset();}} footer={<Button variant="ghost" disabled={busy} onClick={reset}>Cerrar</Button>}>
      <form className="movement-form" onSubmit={save} key={editing?.id??'new'}><fieldset disabled={busy} className="movement-wide cleaning-product-fields">
      {error&&<div role="alert" className="form-error movement-wide">{error}</div>}
      <label><span>Potrero *</span><Select required value={locationId}
        onChange={(event)=>setLocationId(event.target.value)}><option value="">Selecciona</option>
        {options.locations.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
      <label><span>Inicio *</span><DateInput name="startedOn" type="date" max={today()} required
        value={startedOn} onChange={event=>setStartedOn(event.target.value)}/></label>
      <label><span>Finalización</span><DateInput name="finishedOn" type="date" min={startedOn} max={today()}
        defaultValue={editing?.finishedOn??''}/></label>
      <label><span>Área intervenida</span><Select value={areaType}
        onChange={(event)=>setAreaType(event.target.value as CleaningInput['areaType'])}>
        <option value="TOTAL">Total</option><option value="PARCIAL">Parcial</option></Select></label>
      {areaType==='PARCIAL'&&<label><span>Porcentaje del potrero *</span>
        <input name="partialPercent" type="number" min="0.01" max="99.99" step="0.01"
          required defaultValue={editing?.partialPercent??''}/></label>}
      {location?.areaValue!=null&&<p className="muted movement-wide">Área del potrero: {formatNumber(location.areaValue)} {unitLabel(location.areaUnitCode??'')}.
        El área intervenida se calculará automáticamente.</p>}
      <fieldset className="movement-wide cleaning-activities"><legend>Actividades *</legend>
        {Object.entries(labels).map(([code,label])=><label key={code}><input type="checkbox"
          checked={activities.includes(code as CleaningInput['activities'][number])}
          onChange={(event)=>setActivities(event.target.checked
            ?[...activities,code as CleaningInput['activities'][number]]
            :activities.filter((item)=>item!==code))}/>{label}</label>)}</fieldset>
      {activities.includes('FUMIGACION')&&<><label><span>Unidad de aplicación</span><Select value={applicationUnit}
        onChange={(event)=>setApplicationUnit(event.target.value as 'TANQUES'|'BOMBADAS')}>
        <option value="TANQUES">Tanques</option><option value="BOMBADAS">Bombadas</option></Select></label>
      <label><span>Cantidad de {applicationUnit==='TANQUES'?'tanques':'bombadas'}</span>
        <input type="number" min="0.01" max="100000" step="0.01" value={applicationCount}
          onChange={(event)=>setApplicationCount(event.target.value)}/></label>
      <label><span>Capacidad de cada {applicationUnit==='TANQUES'?'tanque':'bombada'} (L)</span><input name="capacity" type="number" min="0.01" max="100000"
        step="0.01" defaultValue={editing?.tankCapacityLiters??''}/></label></>}
      <label className="movement-wide"><span>Observaciones</span><textarea name="notes" maxLength={5000}
        defaultValue={editing?.notes??''}/></label>
      {activities.includes('FUMIGACION')&&<div className="movement-wide cleaning-lines"><div className="movement-card-top"><h3>Productos</h3>
        <button type="button" className="secondary-button compact" onClick={()=>setLines([...lines,
          {productId:'',unitCode:'MILLILITER',quantityPerApplication:1}])}>+ Producto aplicado</button></div>
        {lines.map((line,index)=><fieldset className="cleaning-form-line" key={index}><legend>Producto {index+1}</legend>
          <label><span>Producto *</span><Select aria-label="Producto" value={line.productId} required onChange={event=>setLines(lines.map(
            (item,i)=>i===index?{...item,productId:event.target.value}:item))}>
            <option value="">Selecciona</option>{products.filter(item=>item.active||item.id===line.productId).map(item=><option
              key={item.id} value={item.id}>{item.name}{item.active?'':' (inactivo)'}</option>)}</Select></label>
          <label><span>Cantidad por {applicationUnit==='TANQUES'?'tanque':'bombada'} *</span><input type="number" min="0.0001" max="1000000" step="any"
            value={line.quantityPerApplication} aria-label="Cantidad por aplicación" required onChange={event=>setLines(lines.map(
              (item,i)=>i===index?{...item,quantityPerApplication:Number(event.target.value)}:item))}/></label>
          <label><span>Unidad *</span><Select aria-label="Unidad" value={line.unitCode} onChange={event=>setLines(lines.map(
            (item,i)=>i===index?{...item,unitCode:event.target.value}:item))}>
            {options.units.map(unit=><option key={unit.code} value={unit.code}>{unit.name} ({unit.symbol})</option>)}</Select></label>
          <label><span>Cantidad total utilizada</span><input readOnly tabIndex={-1} aria-label="Cantidad total utilizada"
            value={applicationCount?`${formatNumber(Number(applicationCount)*line.quantityPerApplication,4)} ${unitLabel(line.unitCode)}`:''}
            placeholder="Cantidad × aplicaciones"/><small>Se calcula automáticamente.</small></label>
          <label className="movement-wide"><span>Observaciones del producto</span><input aria-label="Observaciones del producto" maxLength={300} value={line.notes??''}
            onChange={event=>setLines(lines.map((item,i)=>i===index?{...item,notes:event.target.value}:item))}/></label>
          <button type="button" className="secondary-button compact" onClick={()=>setLines(lines.filter((_,i)=>i!==index))}>Quitar producto</button>
        </fieldset>)}</div>}
      <div className="movement-wide cleaning-lines"><div className="movement-card-top"><h3>Operadores</h3>
        <button type="button" className="secondary-button compact" onClick={()=>setOperators([...operators,
          {name:'',function:null}])}>+ Operador</button></div>
        {operators.map((item,index)=><fieldset className="cleaning-form-line" key={index}><legend>Operador {index+1}</legend>
          <label><span>Nombre *</span><input aria-label="Nombre de operador" placeholder="Nombre" required minLength={2} maxLength={160}
            value={item.name} onChange={event=>setOperators(operators.map((entry,i)=>i===index?{...entry,name:event.target.value}:entry))}/></label>
          <label><span>Función</span><input aria-label="Función" placeholder="Función" maxLength={100} value={item.function??''}
            onChange={event=>setOperators(operators.map((entry,i)=>i===index?{...entry,function:event.target.value}:entry))}/></label>
          <label className="movement-wide"><span>Observaciones del operador</span><input aria-label="Observaciones del operador" maxLength={300} value={item.notes??''}
            onChange={event=>setOperators(operators.map((entry,i)=>i===index?{...entry,notes:event.target.value}:entry))}/></label>
          <button type="button" className="secondary-button compact" onClick={()=>setOperators(operators.filter((_,i)=>i!==index))}>Quitar operador</button>
        </fieldset>)}</div>
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
    </fieldset></form></Modal>}
    {records===null&&!error?<LoadingState/>:records===null?<ErrorState
      message={error??'No se pudieron cargar las limpiezas.'}
      onRetry={()=>setRevision(value=>value+1)}/>:visible.length?<div className="cleaning-summary-list">
      {visible.map(item=><button type="button" className="cleaning-summary-row" key={item.id} onClick={()=>setSelectedId(item.id)}>
        <span className="cleaning-summary-icon"><MapPin size={19}/></span>
        <span className="cleaning-summary-main"><strong>{item.locationName} · {item.activities.map(activity=>labels[activity]).join(', ')}</strong>
          <small>{formatDate(item.startedOn)} · {item.areaType==='TOTAL'?'Todo el potrero':`${formatNumber(item.partialPercent)}% del potrero`}</small>
          <small>{item.operators.length?item.operators.map(operator=>`${operator.name}${operator.function?` · ${operator.function}`:''}`).join(' | '):'Sin operador registrado'}</small>
          {item.products.length>0&&<small className="cleaning-products">{item.products.map(product=>product.productName).join(', ')}</small>}
          {item.applicationCount!=null&&<small className="cleaning-dose"><Gauge size={14}/>{formatNumber(item.applicationCount)} {item.applicationUnit==='TANQUES'?'tanques':'bombadas'}</small>}
        </span><Badge tone={item.status==='COMPLETADO'?'success':item.status==='BORRADOR'?'warning':'danger'}>{statuses[item.status]}</Badge>
        <span className="record-row-actions" aria-hidden="true"><ChevronRight size={18}/></span></button>)}</div>:<EmptyState icon={Sprout} title="Sin limpiezas"
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
            {viewing.areaValue!=null?` · ${formatNumber(viewing.areaValue)} ${unitLabel(viewing.areaUnitCode??'')}`:''}</strong></div>
          {viewing.applicationCount!=null&&<div><small>Aplicaciones</small><strong>
            {formatNumber(viewing.applicationCount)} {viewing.applicationUnit==='TANQUES'?'tanques':'bombadas'}</strong></div>}
          {viewing.tankCapacityLiters!=null&&<div><small>Capacidad por {viewing.applicationUnit==='TANQUES'?'tanque':'bombada'}</small><strong>{formatNumber(viewing.tankCapacityLiters)} L</strong></div>}
          {viewing.tankCapacityLiters!=null&&viewing.applicationCount!=null&&<div><small>Volumen aplicado</small><strong>{formatNumber(viewing.tankCapacityLiters*viewing.applicationCount)} L</strong></div>}</div>
        {viewing.products.length>0&&<section><h3>Productos aplicados</h3><div className="cleaning-detail-lines">
          {viewing.products.map(product=><div key={product.productId}><strong>{product.productName}</strong>
            <small>{formatNumber(product.quantityPerApplication,4)} {unitLabel(product.unitCode)} por {viewing.applicationUnit==='TANQUES'?'tanque':'bombada'}</small>
            <small>{formatNumber(product.totalQuantity,4)} {unitLabel(product.unitCode)} en total</small>{product.notes&&<p>{product.notes}</p>}</div>)}</div></section>}
        {viewing.operators.length>0&&<section><h3>Operadores</h3><div className="cleaning-detail-lines">
          {viewing.operators.map((operator,index)=><div key={`${operator.name}-${index}`}>
            <strong>{operator.name}</strong><small>{operator.function||'Sin función indicada'}</small>{operator.notes&&<p>{operator.notes}</p>}</div>)}</div></section>}
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
