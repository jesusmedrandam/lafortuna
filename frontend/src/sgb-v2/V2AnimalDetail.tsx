import {AnimalIcon} from '../components/AnimalIcon';
import {useEffect,useRef,useState,type ComponentType,type ReactNode} from 'react';
import {Activity,ArrowRightLeft,Baby,CalendarDays,Camera,Edit3,HeartPulse,MapPin,Milk,Users,Weight,
  HeartCrack,HeartOff,LogOut,Search,ShoppingCart,ShoppingBag,Syringe,Tag,UserRound,X,ChevronRight,type LucideIcon} from 'lucide-react';
import {useLocation,useNavigate,useParams} from 'react-router-dom';
import {Badge,Card,IconButton,LoadingState,ErrorState} from '../components/ui';
import {ImageLightbox,type LightboxMedia} from '../components/ImageLightbox';
import {formatAge,formatDate} from '../utils';
import {getAnimal,getMedia,uploadMedia,getMovements,getMovementOptions,getWeighings,getHealthConditions,getHealthMedicines,
  getHealthCampaigns,getReproduction,getProduction,getCommerce,getAnimalStatusEvents,
  getReproductionSettings,type Animal,type MediaItem,type MovementOptions,
  type ReproductionRecords,type ReproductionSettings,type HealthCondition} from './api';
import {useV2Session} from './V2Session';
import {MovementPanel} from './MovementPanel';
import {HealthPanel} from './HealthPanel';
import {ReproductionPanel} from './ReproductionPanel';
import {ProductionPanel} from './ProductionPanel';
import {V2WeighingsPage} from './V2WeighingsPage';
import {V2AnimalStatusPage} from './V2AnimalStatusPage';
import {V2CommercePage} from './V2CommercePage';
import {AnimalPanel} from './AnimalPanel';

type Section={title:string;path:string;entries:Array<{id:string;date:string;label:string;path?:string}>};
const historyIcons:Record<string,LucideIcon>={Novedades:Activity,Movimientos:ArrowRightLeft,Pesajes:Weight,
  'Condiciones de salud':HeartPulse,Tratamientos:Syringe,Crías:Baby,Partos:CalendarDays,Celos:HeartPulse,
  Preñeces:HeartPulse,'Pérdidas gestacionales':HeartCrack,'Reproducción asistida':Syringe,
  Producción:Milk,Ventas:ShoppingCart,Compras:ShoppingBag};
type AnimalAction={label:string;run:()=>void};
type ActionKind='movement'|'health'|'reproduction'|'production'|'weighing'|'status'|'sale'|'purchase'|'edit';
const actionAccess:Record<ActionKind,[string,string?]>={movement:['MOVEMENT_MANAGE','MOVEMENTS'],
  health:['HEALTH_MANAGE','HEALTH'],reproduction:['REPRODUCTION_MANAGE','REPRODUCTION'],
  production:['PRODUCTION_MANAGE','PRODUCTION'],weighing:['WEIGHING_MANAGE','WEIGHING'],
  status:['ANIMAL_UPDATE'],sale:['COMMERCE_MANAGE','SALES_PURCHASES'],purchase:['COMMERCE_MANAGE','SALES_PURCHASES'],edit:['ANIMAL_UPDATE']};
function recent(title:string,path:string,entries:Section['entries']):Section{
  return {title,path,entries:entries.sort((a,b)=>b.date.localeCompare(a.date))};
}
function CompactInfo({icon:Icon,label,value,wide=false}:{icon:ComponentType<{size?:number}>;label:string;value:ReactNode;wide?:boolean}){
  if(value==null||typeof value==='string'&&!value.trim())return null;
  return <div className={`animal-compact-info ${wide?'animal-compact-info-wide':''}`}><Icon size={17}/>
    <span><small>{label}</small><strong>{value}</strong></span></div>;
}
export function V2AnimalDetail(){
  const {id}=useParams();const navigate=useNavigate();const location=useLocation();const {session,hasPermission}=useV2Session();
  const [animal,setAnimal]=useState<Animal|null>(null);const [media,setMedia]=useState<MediaItem[]>([]);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const [viewer,setViewer]=useState<MediaItem|null>(null);const [purpose,setPurpose]=useState<'PROFILE'|'COVER'>('PROFILE');
  const [menu,setMenu]=useState<{title:string;actions:AnimalAction[]}|null>(null);
  const previousAction=useRef(false);
  const [revision,setRevision]=useState(0);
  const [sections,setSections]=useState<Section[]>([]);
  const [expandedHistories,setExpandedHistories]=useState<Record<string,boolean>>({});
  const [movementOptions,setMovementOptions]=useState<MovementOptions|null>(null);
  const [inMilking,setInMilking]=useState(false);
  const [activeLactationId,setActiveLactationId]=useState<string|null>(null);
  const [hasMedicines,setHasMedicines]=useState(false);
  const [healthConditions,setHealthConditions]=useState<HealthCondition[]>([]);
  const [reproduction,setReproduction]=useState<ReproductionRecords|null>(null);
  const [reproductionSettings,setReproductionSettings]=useState<ReproductionSettings|null>(null);
  const fileRef=useRef<HTMLInputElement>(null);
  const token=session!.accessToken;
  const property=session!.overview.properties.find(value=>value.id===session!.overview.activeContext?.propertyId);
  const modules=property?.enabledModules??[];
  const canViewMedia=hasPermission('MEDIA_VIEW')&&modules.includes('MULTIMEDIA');
  const canManageMedia=hasPermission('MEDIA_MANAGE')&&modules.includes('MULTIMEDIA');
  const can=(permission:string,module?:string)=>hasPermission(permission)&&(!module||modules.includes(module));
  const context=session!.overview.activeContext;
  const pending=location.state?.animalAction as {kind:ActionKind;code:string;animalId:string;propertyId:string;roleId:string;supportMode:boolean}|undefined;
  const action=pending&&Object.hasOwn(actionAccess,pending.kind)&&typeof pending.code==='string'
    &&can(...actionAccess[pending.kind])&&pending.animalId===id&&pending.propertyId===context?.propertyId&&pending.roleId===context?.roleId
    &&pending.supportMode===Boolean(session!.overview.supportMode)?pending:null;
  useEffect(()=>{if(previousAction.current&&!action)setRevision(value=>value+1);previousAction.current=Boolean(action);},[action]);
  useEffect(()=>{setAnimal(null);setMedia([]);setViewer(null);setMenu(null);},
    [id,context?.propertyId,context?.roleId,session!.overview.supportMode]);
  useEffect(()=>{
    if(!id)return;let active=true;setError('');if(!canViewMedia)setMedia([]);
    void getAnimal(token,id).then(value=>{if(active)setAnimal(value);})
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'No se pudo abrir el animal.');});
    if(canViewMedia)void getMedia(token,'ANIMAL',id).then(value=>{if(active)setMedia(value);})
      .catch(()=>{});
    return()=>{active=false;};
  },[id,token,canViewMedia,revision,context?.propertyId,context?.roleId,session!.overview.supportMode]);
  useEffect(()=>{if(!id)return;let active=true;setSections([]);setExpandedHistories({});setInMilking(false);
    setActiveLactationId(null);
    setReproduction(null);setReproductionSettings(null);
    setMovementOptions(null);
    setHasMedicines(false);
    setHealthConditions([]);
    if(can('MOVEMENT_MANAGE','MOVEMENTS'))void getMovementOptions(token)
      .then(options=>{if(active)setMovementOptions(options);}).catch(()=>{});
    if(can('HEALTH_MANAGE','HEALTH'))void getHealthMedicines(token)
      .then(items=>{if(active)setHasMedicines(items.some(item=>item.active));}).catch(()=>{});
    const jobs:Array<Promise<Section|Section[]>>=[];
    if(can('ANIMAL_VIEW'))jobs.push(getAnimalStatusEvents(token,id).then(items=>
      recent('Novedades','/bajas',items.map(item=>({id:item.id,date:item.occurredAt,
        label:{REPORT_MISSING:'Desaparición',MARK_FOUND:'Recuperación',RECORD_DEATH:'Muerte',
          RECORD_EXIT:'Salida'}[item.action]})))));
    if(can('MOVEMENT_VIEW','MOVEMENTS'))jobs.push(getMovements(token).then(items=>
      recent('Movimientos','/movimientos',items.filter(item=>item.animals.some(row=>row.id===id))
        .map(item=>({id:item.id,date:item.movementOn,
          label:`${item.reason} · ${item.destinationGroupName}${item.destinationLocationName?
            ` · ${item.destinationLocationName}`:''}`})))));
    if(can('WEIGHING_VIEW','WEIGHING'))jobs.push(getWeighings(token,id).then(items=>
      recent('Pesajes','/pesajes',items.filter(item=>!item.voidedAt).map(item=>({
        id:item.id,date:item.weighedOn,label:`${item.weight} ${item.unitCode==='POUND'?'lb':'kg'}`})))));
    if(can('HEALTH_VIEW','HEALTH')){
      jobs.push(getHealthConditions(token).then(items=>{const own=items.filter(item=>item.animalId===id);
        if(active)setHealthConditions(own);
        return recent('Condiciones de salud','/sanidad',own.map(item=>({id:item.id,date:item.detectedOn,
          label:`${item.kind??'Condición'} · ${item.description}`})));}));
      jobs.push(getHealthCampaigns(token).then(items=>recent('Tratamientos','/sanidad?vista=tratamientos',
        items.filter(item=>item.animals.some(row=>row.animalId===id&&row.selected))
          .map(item=>({id:item.id,date:item.appliedOn,
            label:`${item.medicineName} · ${item.status==='COMPLETADO'?'Aplicado':item.status==='BORRADOR'?'Borrador':'Cancelado'}`})))));
    }
    if(can('REPRODUCTION_VIEW','REPRODUCTION')){
      if(can('REPRODUCTION_MANAGE'))void getReproductionSettings(token)
        .then(value=>{if(active)setReproductionSettings(value);}).catch(()=>{});
      jobs.push(getReproduction(token).then(items=>{
        if(active)setReproduction(items);
        return [
          recent('Crías','/reproduccion',items.births.filter(item=>item.motherId===id).flatMap(item=>
            item.calves.map(calf=>({id:`${item.id}:${calf.id}`,date:item.occurredOn,label:calf.name,path:`/animales/${encodeURIComponent(calf.id)}`})))),
          recent('Partos','/reproduccion',items.births.filter(item=>item.motherId===id||item.calves.some(calf=>calf.id===id))
            .map(item=>({id:item.id,date:item.occurredOn,label:item.calves.map(calf=>calf.name).filter(Boolean).join(', ')||'Parto registrado'}))),
          recent('Celos','/reproduccion',items.heats.filter(item=>item.cowId===id).map(item=>
            ({id:item.id,date:item.startsOn,label:item.isFalse?'Celo falso':'Celo registrado'}))),
          recent('Preñeces','/reproduccion',items.pregnancies.filter(item=>item.cowId===id||item.fatherId===id)
            .map(item=>({id:item.id,date:item.confirmedOn,label:'Preñez'}))),
          recent('Pérdidas gestacionales','/reproduccion',items.losses.filter(item=>item.cowId===id)
            .map(item=>({id:item.id,date:item.occurredOn,label:item.notes?.trim()||'Pérdida gestacional'}))),
          recent('Reproducción asistida','/reproduccion',items.services.filter(item=>item.cowId===id||item.fatherId===id||item.donorId===id)
            .map(item=>({id:item.id,date:item.occurredOn,label:item.kind==='INSEMINATION'?'Inseminación':'Transferencia de embrión'}))),
        ];
      }));
    }
    if(can('PRODUCTION_VIEW','PRODUCTION'))jobs.push(getProduction(token).then(items=>{
      if(active)setInMilking(Boolean(items.cows.find(row=>row.id===id)?.inMilking));
      if(active)setActiveLactationId(items.lactations.find(row=>row.cowId===id&&!row.endedOn)?.id??null);
      return recent('Producción','/produccion',[
        ...items.milk.filter(item=>item.cowId===id)
          .map(item=>({id:item.id,date:item.producedOn,label:`Leche · ${item.liters} L`})),
        ...items.lactations.filter(item=>item.cowId===id)
          .map(item=>({id:item.id,date:item.startedOn,label:'Lactancia'})),
      ]);
    }));
    if(can('COMMERCE_VIEW','SALES_PURCHASES')){
      const commerce=getCommerce(token);
      for(const [kind,title,path] of [['SALE','Ventas','/ventas'],
        ['PURCHASE','Compras','/compras']] as const)jobs.push(commerce.then(items=>
        recent(title,path,items.filter(item=>item.kind===kind&&
          item.lines.some(line=>line.animalId===id)).map(item=>({id:item.id,date:item.tradedOn,
          label:item.counterpartyName})))));
    }
    void Promise.allSettled(jobs).then(results=>{if(active)setSections(results.flatMap(result=>
      result.status==='fulfilled'?[result.value].flat().filter(section=>section.entries.length>0):[]));});
    return()=>{active=false;};
  },[id,token,modules.join(','),session?.overview.activeContext?.roleId,revision]);
  async function photo(file:File){
    if(!id)return;setBusy(true);setError('');
    try{await uploadMedia(token,{file,animalIds:[id],relationCode:purpose});
      setMedia(await getMedia(token,'ANIMAL',id));}
    catch(reason){setError(reason instanceof Error?reason.message:'No se pudo guardar la foto.');}
    finally{setBusy(false);}
  }
  const profile=media.find(item=>item.relation_code==='PROFILE'&&item.kind==='IMAGE');
  const cover=media.find(item=>item.relation_code==='COVER'&&item.kind==='IMAGE');
  const gallery=media.filter(item=>item.kind==='IMAGE'&&item.relation_code!=='PROFILE');
  const usable=animal?.availabilityStatusCode==='ACTIVE';
  const status=animal?.availabilityStatusCode==='ACTIVE'?'Activo':animal?.availabilityStatusCode==='DEAD'
    ?'Fallecido':animal?.availabilityStatusCode==='MISSING'?'Desaparecido':
      animal?.availabilityStatusCode==='EXITED'?'Salió de la propiedad':'Inactivo';
  const go=(path:string,action?:string)=>{setMenu(null);navigate(`${path}${path.includes('?')?'&':'?'}animal=${encodeURIComponent(id??'')}`+
    (action?`&accion=${encodeURIComponent(action)}`:''));};
  const openAction=(kind:ActionKind,code:string)=>{setMenu(null);navigate(location.pathname+location.search,
    {state:{animalAction:{kind,code,animalId:id,propertyId:context?.propertyId,roleId:context?.roleId,
      supportMode:Boolean(session!.overview.supportMode)}}});};
  const closeAction=()=>navigate(-1);
  const choose=(title:string,actions:AnimalAction[])=>{
    if(actions.length===1)actions[0]!.run();else if(actions.length>1)setMenu({title,actions});};
  const photoAction=()=>choose('Fotos del animal',[
    {label:'Cambiar foto de perfil',run:()=>{setMenu(null);setPurpose('PROFILE');fileRef.current?.click();}},
    {label:'Cambiar portada',run:()=>{setMenu(null);setPurpose('COVER');fileRef.current?.click();}},
  ]);
  const groupId=animal?.group?.id;
  const ownGroup=movementOptions?.groups.find(item=>item.id===groupId);
  const canMove=Boolean(usable&&groupId&&can('MOVEMENT_MANAGE','MOVEMENTS'));
  const moveOtherProperty=Boolean(canMove&&(movementOptions?.properties.some(item=>
    item.id!==property?.id)||session!.overview.properties.some(item=>item.id!==property?.id)));
  const rotate=Boolean(canMove&&ownGroup&&can('LOCATION_MANAGE')&&
    (modules.includes('PASTURES')||modules.includes('CORRALS'))&&
    movementOptions?.locations.some(item=>item.propertyId===property?.id&&
      item.id!==ownGroup.locationId&&!movementOptions.groups.some(group=>group.locationId===item.id)));
  const movementActions:AnimalAction[]=[
    ...(canMove?[{label:'Cambiar de grupo',run:()=>openAction('movement','GRUPO')}]:[]),
    ...(moveOtherProperty?[{label:'Cambiar de propiedad',run:()=>openAction('movement','PROPIEDAD')}]:[]),
    ...(rotate?[{label:'Rotación de potrero o corral · todo el grupo',
      run:()=>openAction('movement','UBICACION')}]:[]),
  ];
  const movementHistory=sections.find(section=>section.title==='Movimientos');
  const movementMenuActions:AnimalAction[]=[...movementActions,
    {label:movementHistory?.entries.length?'Ver historial de movimientos':'Ver movimientos',
      run:()=>go('/movimientos')}];
  const activeHealthConditions=healthConditions.filter(condition=>condition.status!=='RESUELTA');
  const treatedHealthConditions=activeHealthConditions.filter(condition=>condition.status==='EN_TRATAMIENTO');
  const hasHealthHistory=sections.some(section=>
    (section.title==='Condiciones de salud'||section.title==='Tratamientos')&&section.entries.length>0);
  const healthActions:AnimalAction[]=[
    ...(usable&&can('HEALTH_MANAGE','HEALTH')?[{label:'Crear condición de salud',
      run:()=>openAction('health','CONDICION')}]:[]),
    ...(usable&&can('HEALTH_MANAGE','HEALTH')&&hasMedicines?[{label:'Aplicar tratamiento preventivo',
      run:()=>openAction('health','TRATAMIENTO_PREVENTIVO')}]:[]),
    ...(usable&&can('HEALTH_MANAGE','HEALTH')&&hasMedicines&&activeHealthConditions.length?[{
      label:'Aplicar tratamiento sobre condición de salud',
      run:()=>openAction('health','TRATAMIENTO_CONDICION')}]:[]),
    ...(usable&&can('HEALTH_MANAGE','HEALTH')?treatedHealthConditions.map(condition=>({
      label:`Marcar como resuelta · ${condition.kind??'Condición de salud'}`,
      run:()=>openAction('health',`RESOLVER_CONDICION:${condition.id}`),
    })):[]),
    ...(hasHealthHistory?[{label:'Ver historial de sanidad',run:()=>go('/sanidad')}]:[]),
  ];
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const birth=animal?.birthDate;
  const minimumDate=birth&&reproductionSettings?new Date(`${birth}T12:00:00Z`):null;
  if(minimumDate)minimumDate.setUTCMonth(minimumDate.getUTCMonth()+reproductionSettings!.minimumCowMonths);
  const reproductiveAge=Boolean(reproductionSettings&&(!minimumDate||
    minimumDate.toISOString().slice(0,10)<=today));
  const activePregnancy=reproduction?.pregnancies.find(item=>item.cowId===id&&item.status==='CONFIRMED');
  const reproductiveActions:AnimalAction[]=reproductiveAge?(activePregnancy?[
    {label:'Registrar parto',run:()=>openAction('reproduction','PARTO')},
    {label:'Registrar pérdida de preñez',run:()=>openAction('reproduction','PERDIDA')},
  ]:[
    {label:'Registrar celo',run:()=>openAction('reproduction','CELO')},
    {label:'Registrar inseminación o transferencia',run:()=>openAction('reproduction','SERVICIO')},
    {label:'Confirmar preñez',run:()=>openAction('reproduction','PRENEZ')},
  ]):[];
  const productionHistory=sections.find(section=>section.title==='Producción');
  const productionActions:AnimalAction[]=[
    ...(inMilking&&usable&&can('PRODUCTION_MANAGE','PRODUCTION')?[{
      label:'Registrar producción',run:()=>openAction('production','LECHE')}]:[]),
    ...(activeLactationId&&usable&&can('PRODUCTION_MANAGE','PRODUCTION')?[{
      label:'Cerrar lactancia',run:()=>openAction('production','CERRAR_LACTANCIA')}]:[]),
    ...(productionHistory?.entries.length?[{label:'Ver historial de producción',run:()=>go('/produccion')}]:[]),
  ];
  const lightboxItems:LightboxMedia[]=media.filter(item=>item.kind==='IMAGE').map(item=>({
    key:item.id,url:item.url,type:'IMAGEN',title:animal?.name??'Animal',
    subtitle:[item.relation_code==='PROFILE'?'Foto de perfil':item.relation_code==='COVER'?'Foto de portada':
      item.description||'Galería',animal?.earTagCode?`Arete ${animal.earTagCode}`:null,
      animal?.classification?.name,animal?.group?.name?`Grupo ${animal.group.name}`:null,
      animal?.location?.name?`Ubicación ${animal.location.name}`:null].filter(Boolean).join(' · '),
    date:item.captured_on??item.created_at.slice(0,10),filename:`${animal?.name??'animal'}-${item.relation_code.toLowerCase()}`,
  }));
  const viewerIndex=viewer?lightboxItems.findIndex(item=>item.key===viewer.id):-1;
  const breeds=animal?.breeds?.length?animal.breeds:animal?.breed?[animal.breed]:[];
  const lastWeighing=sections.find(section=>section.title==='Pesajes')?.entries[0];
  const lastTreatment=sections.find(section=>section.title==='Tratamientos')?.entries[0];
  const lastMovement=sections.find(section=>section.title==='Movimientos')?.entries[0];
  if(error&&!animal)return <ErrorState message={error} onRetry={()=>navigate('/animales')}/>;
  if(!animal)return <LoadingState text="Abriendo ficha…"/>;
  return <div className="animal-detail-page sgb-v2-animal-detail">
    <section className={`animal-social-cover ${cover?'has-cover':''}`}>
      {cover?<button type="button" className="animal-cover-media" onClick={()=>setViewer(cover)}>
        <img src={cover.url} alt={`Portada de ${animal.name}`}/></button>:<div className="animal-cover-placeholder"/>}
      <div className="animal-cover-shade"/><div className="animal-cover-name"><h1>{animal.name}</h1>
        {animal.description?.trim()&&<p>{animal.description}</p>}</div>
      <button type="button" className="animal-social-avatar" disabled={!profile}
        onClick={()=>setViewer(profile??null)}>{profile?<img src={profile.thumbnailUrl??profile.url}
          alt={`Perfil de ${animal.name}`}/>:<AnimalIcon size={48}/>}</button>
    </section>
    <div className="animal-profile-action-strip" aria-label="Acciones del animal">
      {canManageMedia&&<IconButton label="Fotos del animal" onClick={photoAction}><Camera size={21}/></IconButton>}
      {hasPermission('ANIMAL_UPDATE')&&<IconButton label="Editar animal" onClick={()=>openAction('edit','EDITAR')}>
        <Edit3 size={21}/></IconButton>}
      {movementMenuActions.length>0&&can('MOVEMENT_VIEW','MOVEMENTS')&&<IconButton label="Movimientos"
        onClick={()=>setMenu({title:'Movimientos de '+animal.name,actions:movementMenuActions})}>
        <ArrowRightLeft size={21}/></IconButton>}
      {healthActions.length>0&&can('HEALTH_VIEW','HEALTH')&&<IconButton label="Sanidad"
        onClick={()=>setMenu({title:'Sanidad de '+animal.name,actions:healthActions})}>
        <Syringe size={21}/></IconButton>}
      {usable&&can('WEIGHING_MANAGE','WEIGHING')&&<IconButton label="Registrar pesaje"
        onClick={()=>openAction('weighing','NUEVO')}><Weight size={21}/></IconButton>}
      {animal.sex==='FEMALE'&&productionActions.length>0&&can('PRODUCTION_VIEW','PRODUCTION')&&
        <IconButton label="Producción" onClick={()=>setMenu({title:'Producción de '+animal.name,
          actions:productionActions})}><Milk size={21}/></IconButton>}
      {usable&&animal.sex==='FEMALE'&&can('REPRODUCTION_MANAGE','REPRODUCTION')&&
        reproductiveActions.length>0&&<IconButton label="Reproducción"
          onClick={()=>choose('Reproducción de '+animal.name,reproductiveActions)}>
          <Baby size={21}/></IconButton>}
      {usable&&can('COMMERCE_MANAGE','SALES_PURCHASES')&&<IconButton label="Ventas"
        onClick={()=>openAction('sale','NUEVA')}><ShoppingCart size={21}/></IconButton>}
      {['ACTIVE','MISSING','INACTIVE'].includes(animal.availabilityStatusCode)&&hasPermission('ANIMAL_UPDATE')&&<>
        <IconButton label="Registrar fallecimiento" className="danger" onClick={()=>openAction('status','RECORD_DEATH')}><HeartOff size={21}/></IconButton>
        {usable&&<IconButton label="Reportar desaparición" onClick={()=>openAction('status','REPORT_MISSING')}><Search size={21}/></IconButton>}
        {animal.availabilityStatusCode==='MISSING'&&<IconButton label="Marcar como encontrado" onClick={()=>openAction('status','MARK_FOUND')}><MapPin size={21}/></IconButton>}
        <IconButton label="Registrar salida" onClick={()=>openAction('status','RECORD_EXIT')}><LogOut size={21}/></IconButton>
      </>}
    </div>
    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden
      disabled={busy} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';
        if(file)void photo(file);}}/>
    {error&&<div className="form-alert form-alert-error" role="alert">{error}</div>}
    <Card className="animal-detail-summary-card animal-data-only-card">
      <div className="animal-summary-heading"><div><h2>Información</h2>
        {animal.earTagCode?.trim()&&<p>Arete {animal.earTagCode}</p>}</div>
        <Badge tone={usable?'success':animal.availabilityStatusCode==='DEAD'?'danger':'warning'}>
          {status}</Badge></div>
      <div className="animal-compact-info-grid">
        <CompactInfo icon={AnimalIcon} label="Especie / sexo" value={[animal.speciesCode==='BOVINE'?'Bovino':animal.speciesCode,
          animal.sex==='FEMALE'?'Hembra':animal.sex==='MALE'?'Macho':null].filter(Boolean).join(' · ')}/>
        <CompactInfo icon={Users} label="Grupo" value={animal.group?.name}/>
        <CompactInfo icon={MapPin} label="Ubicación actual" value={animal.location?.name}/>
        {animal.classification?.code!=='SIN_CLASIFICAR'&&<CompactInfo icon={AnimalIcon} label="Clasificación" value={animal.classification?.name}/>}
        {lastWeighing&&<CompactInfo icon={Weight} label="Último peso" value={`${lastWeighing.label} · ${formatDate(lastWeighing.date)}`}/>}
        <CompactInfo icon={UserRound} label="Propietarios" wide value={animal.owners?.filter(owner=>owner.name?.trim())
          .map(owner=>`${owner.name}${Number.isFinite(owner.percent)?` (${owner.percent}%)`:''}`).join(', ')}/>
        {animal.birthDate?.trim()&&<><CompactInfo icon={CalendarDays} label="Nacimiento" value={formatDate(animal.birthDate)}/>
          <CompactInfo icon={CalendarDays} label="Edad" value={formatAge(animal.birthDate)}/></>}
        {animal.entryDate?.trim()&&<CompactInfo icon={CalendarDays} label="Ingreso" value={formatDate(animal.entryDate)}/>}
        <CompactInfo icon={Tag} label="Marquillas" value={animal.brands?.map(brand=>brand.name).filter(value=>value?.trim()).join(', ')}/>
        {typeof animal.initialWeight==='number'&&Number.isFinite(animal.initialWeight)&&<CompactInfo icon={Weight} label="Peso inicial"
          value={`${animal.initialWeight} ${animal.initialWeightUnitCode==='POUND'?'lb':'kg'}`}/>}
        <CompactInfo icon={UserRound} label="Padres" wide value={[animal.mother?.name?.trim()?`Madre: ${animal.mother.name}`:null,
          animal.father?.name?.trim()?`Padre: ${animal.father.name}`:null].filter(Boolean).join(' · ')}/>
        {lastTreatment&&<CompactInfo icon={Syringe} label="Último tratamiento" wide value={`${lastTreatment.label} · ${formatDate(lastTreatment.date)}`}/>}
        {lastMovement&&<CompactInfo icon={ArrowRightLeft} label="Último traslado" wide value={`${lastMovement.label} · ${formatDate(lastMovement.date)}`}/>}
      </div>
      {(breeds.some(breed=>breed.name?.trim())||animal.colors?.some(color=>color.name?.trim()))&&<div className="animal-compact-tags">
        {breeds.some(breed=>breed.name?.trim())&&<span><strong>Razas:</strong> {breeds.map(breed=>breed.name).filter(value=>value?.trim()).join(', ')}</span>}
        {animal.colors?.some(color=>color.name?.trim())&&<span><strong>Colores:</strong> {animal.colors.map(color=>color.name).filter(value=>value?.trim()).join(', ')}</span>}
      </div>}
    </Card>
    {sections.length>0&&<div className="animal-profile-history-grid" aria-label="Resumen del animal">
      {sections.map(section=>{const Icon=historyIcons[section.title]??Activity;const expanded=Boolean(expandedHistories[section.title]);
        return <Card className="animal-history-preview" key={section.title}>
          <header><span className="history-count">{section.entries.length}</span><h2><Icon size={19}/>{section.title}</h2>
            <IconButton label={`Abrir ${section.title}`} onClick={()=>go(section.path)}><ChevronRight size={19}/></IconButton></header>
          <div className="history-stack">{(expanded?section.entries:section.entries.slice(0,3)).map(item=>
            <button type="button" className="history-entry history-entry-link" key={item.id}
              onClick={()=>item.path?navigate(item.path):go(section.path)}><span><strong>{item.label}</strong></span>
              {item.date&&<time>{formatDate(item.date)}</time>}</button>)}</div>
          {section.entries.length>3&&<button type="button" className="history-toggle" aria-expanded={expanded}
            onClick={()=>setExpandedHistories(current=>({...current,[section.title]:!expanded}))}>
            {expanded?'Mostrar solo 3':`Mostrar todo (${section.entries.length})`}</button>}
        </Card>;})}
    </div>}
    {gallery.length>0&&<section className="v2-animal-gallery"><h2>Fotos</h2><div>
      {gallery.map(item=><button key={item.id} type="button" onClick={()=>setViewer(item)}>
        <img src={item.thumbnailUrl??item.url} alt={item.description??animal.name}/></button>)}
    </div></section>}
    {viewer&&viewerIndex>=0&&<ImageLightbox items={lightboxItems} initialIndex={viewerIndex}
      onClose={()=>setViewer(null)}/>}
    {menu&&<div className="v2-animal-sheet-backdrop" role="presentation"
      onMouseDown={event=>{if(event.target===event.currentTarget)setMenu(null);}}>
      <section className="v2-animal-sheet" role="dialog" aria-modal="true" aria-label={menu.title}>
        <header><h2>{menu.title}</h2><IconButton label="Cerrar" onClick={()=>setMenu(null)}>
          <X size={22}/></IconButton></header>
        {menu.actions.map(action=><button type="button" key={action.label} onClick={action.run}>
          <span>{action.label}</span><ChevronRight size={20}/></button>)}
      </section></div>}
    {action&&id&&<div className={`v2-animal-action-host action-${action.kind}`}
      role="dialog" aria-modal="true" aria-label={`Acción de ${animal.name}`}>
      <div className="v2-animal-action-content" key={`${action.kind}:${action.code}`}>
        {action.kind==='movement'&&<MovementPanel accessToken={token} propertyId={property!.id}
          canManage canCancel={hasPermission('MOVEMENT_CANCEL')}
          canChangeLocation={hasPermission('LOCATION_MANAGE')} initialAnimalId={id}
          initialAction={action.code} onCompleted={closeAction}/>}
        {action.kind==='health'&&<HealthPanel accessToken={token} canManage
          initialAnimalId={id} initialAction={action.code} onCompleted={closeAction}/>}
        {action.kind==='reproduction'&&<ReproductionPanel accessToken={token} canManage
          initialAnimalId={id} initialAction={action.code} onCompleted={closeAction}/>}
        {action.kind==='production'&&<ProductionPanel accessToken={token} canManage
          initialAnimalId={id} initialAction={action.code} onCompleted={closeAction}/>}
        {action.kind==='weighing'&&<V2WeighingsPage profileAnimalId={id}
          profileAction={action.code} onCompleted={closeAction}/>}
        {action.kind==='status'&&<V2AnimalStatusPage profileAnimalId={id}
          profileAction={action.code} onCompleted={closeAction}/>}
        {(action.kind==='sale'||action.kind==='purchase')&&<V2CommercePage
          kind={action.kind==='sale'?'SALE':'PURCHASE'} profileAnimalId={id}
          profileAction={action.code} onCompleted={closeAction}/>}
        {action.kind==='edit'&&<AnimalPanel accessToken={token} canCreate={false} canUpdate
          canViewCatalogs={hasPermission('CATALOG_VIEW')} canManageBrands={hasPermission('CATALOG_MANAGE')}
          canViewMedia={canViewMedia} canManageMedia={canManageMedia}
          canViewLocations={hasPermission('LOCATION_VIEW')} modules={modules}
          initialAnimalId={id} initialEdit onBack={closeAction}
          onNavigate={()=>{}}/>}
      </div>
    </div>}
  </div>;
}
