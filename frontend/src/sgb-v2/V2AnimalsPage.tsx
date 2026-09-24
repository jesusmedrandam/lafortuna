import {useEffect,useState} from 'react';
import {Beef,CalendarClock,ClipboardCheck,MapPin,Mars,Paintbrush,Plus,SlidersHorizontal,
  UserRound,Venus,VenusAndMars,X} from 'lucide-react';
import {useNavigate,useSearchParams} from 'react-router-dom';
import {Badge,Button,EmptyState,ErrorState,Field,IconButton,Input,LoadingState,SearchBox,Select}
  from '../components/ui';
import {formatDate} from '../utils';
import {getAnimalClassificationPolicy,getAnimals,listBrands,listCatalogItems,listGroups,
  listLocations,listOwners,type AnimalList,type AnimalFilters,type CatalogItem,
  type LivestockBrand,type LivestockGroup,type LivestockOwner,type PhysicalLocation} from './api';
import {useV2Session} from './V2Session';

const classifications=['VACA','VACONA','TERNERA','TORO','TORETE','TERNERO'] as const;
const names:Record<string,string>={VACA:'Vacas',VACONA:'Vaconas',TERNERA:'Terneras',
  TORO:'Toros',TORETE:'Toretes',TERNERO:'Terneros'};
const fields=['sex','status','groupId','locationId','ownerId','breedId','colorId',
  'brandId','birthFrom','birthTo'] as const;

export function V2AnimalsPage(){
  const {session,hasPermission}=useV2Session();const navigate=useNavigate();
  const [params,setParams]=useSearchParams();const [advancedOpen,setAdvancedOpen]=useState(false);
  const [search,setSearch]=useState(params.get('q')??'');const [debounced,setDebounced]=useState(search);
  const [list,setList]=useState<AnimalList|null>(null);const [busy,setBusy]=useState(true);
  const [retry,setRetry]=useState(0);
  const [error,setError]=useState('');const [groups,setGroups]=useState<LivestockGroup[]>([]);
  const [locations,setLocations]=useState<PhysicalLocation[]>([]);
  const [owners,setOwners]=useState<LivestockOwner[]>([]);
  const [breeds,setBreeds]=useState<CatalogItem[]>([]);const [colors,setColors]=useState<CatalogItem[]>([]);
  const [brands,setBrands]=useState<LivestockBrand[]>([]);
  const [classificationNames,setClassificationNames]=useState<Record<string,string>>(names);
  const token=session!.accessToken;
  const query=params.toString();
  const filters=Object.fromEntries(fields.map(key=>[key,params.get(key)??''])) as Record<(typeof fields)[number],string>;
  const classification=params.get('clasificacion')??'';
  const page=Math.max(1,Number(params.get('page')??1)||1);
  const count=fields.filter(key=>Boolean(filters[key])).length+Number(Boolean(classification));
  const property=session!.overview.properties.find(item=>item.id===session!.overview.activeContext?.propertyId);
  const canViewLocations=hasPermission('LOCATION_VIEW')&&Boolean(property?.enabledModules.includes('MOVEMENTS'));

  useEffect(()=>{const timer=window.setTimeout(()=>setDebounced(search),280);
    return()=>window.clearTimeout(timer);},[search]);
  useEffect(()=>{
    let active=true;setBusy(true);setError('');
    const parsed=new URLSearchParams(query);
    const current=Object.fromEntries(fields.map(key=>[key,parsed.get(key)??''])) as Record<(typeof fields)[number],string>;
    void getAnimals(token,Math.max(1,Number(parsed.get('page')??1)||1),debounced,
      parsed.get('clasificacion')??'',current as AnimalFilters)
      .then(result=>{if(active)setList(result);})
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'No se pudieron cargar los animales.');})
      .finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[token,query,debounced,retry]);
  useEffect(()=>{
    let active=true;
    const use=<T,>(promise:Promise<T>,setter:(result:T)=>void)=>
      void promise.then(value=>{if(active)setter(value);}).catch(()=>{});
    use(listGroups(token),setGroups);use(listOwners(token),setOwners);use(listBrands(token),setBrands);
    use(getAnimalClassificationPolicy(token).then(value=>value.names),setClassificationNames);
    if(hasPermission('CATALOG_VIEW')){
      use(listCatalogItems(token,'BREEDS'),setBreeds);
      use(listCatalogItems(token,'COLORS'),setColors);
    }
    if(canViewLocations)use(listLocations(token),setLocations);
    return()=>{active=false;};
  },[token,canViewLocations,hasPermission]);

  function update(key:string,value:string){
    const next=new URLSearchParams(params);if(value)next.set(key,value);else next.delete(key);
    if(key!=='page')next.delete('page');setParams(next);
  }
  function clear(){const next=new URLSearchParams(params);
    [...fields,'clasificacion'].forEach(key=>next.delete(key));next.delete('page');setParams(next);}
  const cycleSex=()=>update('sex',filters.sex===''?'FEMALE':filters.sex==='FEMALE'?'MALE':'');
  const sexLabel=filters.sex==='FEMALE'?'Solo hembras':filters.sex==='MALE'?'Solo machos':'Todos los sexos';
  return <div className="module-no-header animals-page">
    <div className="animal-controls-sticky"><div className="animal-primary-controls">
      <SearchBox value={search} onChange={value=>{setSearch(value);update('q',value);}}
        placeholder="Buscar animal, arete o marquilla…"/>
      <IconButton className={`quick-icon-filter ${filters.sex?'active':''}`} label={sexLabel} onClick={cycleSex}>
        {filters.sex==='FEMALE'?<Venus size={20}/>:filters.sex==='MALE'?<Mars size={20}/>:<VenusAndMars size={20}/>}</IconButton>
      <IconButton className={`advanced-filter-trigger ${advancedOpen?'active':''}`} label="Filtros avanzados"
        aria-expanded={advancedOpen} onClick={()=>setAdvancedOpen(value=>!value)}>
        <SlidersHorizontal size={20}/>{count>0&&<span className="filter-count">{count}</span>}</IconButton>
      <span className="animal-visible-count" aria-label={`${list?.total??0} animales`}>
        <Beef size={16}/><strong>{list?.total??0}</strong></span>
    </div><div className="animal-secondary-filters">
      <Select aria-label="Filtrar por grupo" value={filters.groupId} onChange={event=>update('groupId',event.target.value)}>
        <option value="">Todos los grupos</option>{groups.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select>
      <Select aria-label="Clasificación" value={classification} onChange={event=>update('clasificacion',event.target.value)}>
        <option value="">Todos los animales</option>{classifications.map(code=><option key={code} value={code}>
          {classificationNames[code]??names[code]}</option>)}</Select>
    </div></div>
    {advancedOpen&&<section className="advanced-filters" aria-label="Búsqueda avanzada de animales">
      <div className="advanced-filters-heading"><div><h2>Búsqueda avanzada</h2>
        <p>Combina varios criterios para encontrar animales específicos.</p></div>
        <div className="advanced-filter-actions"><IconButton label="Limpiar filtros" disabled={!count} onClick={clear}>
          <Paintbrush size={17}/></IconButton><IconButton label="Cerrar filtros" onClick={()=>setAdvancedOpen(false)}>
          <X size={18}/></IconButton></div></div>
      <div className="advanced-filters-grid">
        <Field label="Estado"><Select value={filters.status} onChange={event=>update('status',event.target.value)}>
          <option value="">Todos</option><option value="ACTIVE">Activo</option><option value="INACTIVE">Inactivo</option>
          <option value="DEAD">Fallecido</option><option value="MISSING">Desaparecido</option></Select></Field>
        <Field label="Propietario"><Select value={filters.ownerId} onChange={event=>update('ownerId',event.target.value)}>
          <option value="">Todos</option>{owners.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
        {canViewLocations&&<Field label="Potrero o corral"><Select value={filters.locationId}
          onChange={event=>update('locationId',event.target.value)}><option value="">Todos</option>
          {locations.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>}
        <Field label="Raza"><Select value={filters.breedId} onChange={event=>update('breedId',event.target.value)}>
          <option value="">Todas</option>{breeds.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
        <Field label="Color"><Select value={filters.colorId} onChange={event=>update('colorId',event.target.value)}>
          <option value="">Todos</option>{colors.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
        <Field label="Marquilla"><Select value={filters.brandId} onChange={event=>update('brandId',event.target.value)}>
          <option value="">Todas</option>{brands.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
        <Field label="Nacimiento desde"><Input type="date" value={filters.birthFrom} max={filters.birthTo||undefined}
          onChange={event=>update('birthFrom',event.target.value)}/></Field>
        <Field label="Nacimiento hasta"><Input type="date" value={filters.birthTo} min={filters.birthFrom||undefined}
          onChange={event=>update('birthTo',event.target.value)}/></Field>
      </div><div className="advanced-filters-footer">{count} filtros activos</div>
    </section>}
    {busy?<LoadingState/>:error?<ErrorState message={error} onRetry={()=>setRetry(value=>value+1)}/>:
      !list?.items.length?<EmptyState icon={Beef} title="No hay animales" description="Registra el primer animal o modifica los filtros."
        action={hasPermission('ANIMAL_CREATE')?<Button onClick={()=>navigate('/animales/gestionar?create=1')}>
          <Plus size={18}/>Registrar animal</Button>:undefined}/>:<div className="animal-list animal-compact-list" role="list" aria-label="Listado de animales">
        {list.items.map(animal=><button type="button" className="animal-list-row" role="listitem" key={animal.id}
          onClick={()=>navigate(`/animales/${animal.id}`)}>
          <span className="animal-list-photo">{animal.profilePhotoUrl?<img src={animal.profilePhotoUrl} alt=""/>:<Beef size={24}/>}</span>
          <span className="animal-compact-content"><span className="animal-compact-heading"><strong>{animal.name}</strong>
            <Badge tone={animal.availabilityStatusCode==='ACTIVE'?'success':animal.availabilityStatusCode==='DEAD'?'danger':'warning'}>
              {animal.availabilityStatusCode==='ACTIVE'?'Activo':animal.availabilityStatusCode}</Badge></span>
            <small className="animal-compact-description">{animal.description||'Sin descripción'}</small>
            <span className="animal-compact-facts"><span>{animal.classification?.name??'Animal'}</span>
              <span>{animal.sex==='FEMALE'?'Hembra':'Macho'} · {animal.group?.name??'Sin grupo'}</span>
              {animal.location&&<span><MapPin size={14}/>{animal.location.name}</span>}</span>
            <span className="animal-compact-footer"><span><CalendarClock size={15}/>{formatDate(animal.birthDate)}</span>
              <span><UserRound size={15}/>{animal.primaryOwnerName??'Sin propietario'}</span></span></span>
        </button>)}</div>}
    {list&&(page>1||list.hasMore)&&<div className="animal-pages">
      <Button variant="secondary" disabled={page<=1} onClick={()=>update('page',String(page-1))}>Anterior</Button>
      <span>Página {page}</span><Button variant="secondary" disabled={!list.hasMore}
        onClick={()=>update('page',String(page+1))}>Siguiente</Button></div>}
    <div className="animal-floating-actions">
      {hasPermission('ANIMAL_CREATE')&&<IconButton label="Agregar animal" onClick={()=>navigate('/animales/gestionar?create=1')}>
        <Plus size={23}/></IconButton>}
      <IconButton label="Volver al panel" onClick={()=>navigate('/')}><ClipboardCheck size={22}/></IconButton>
    </div>
  </div>;
}
