import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowLeftRight,Baby,Beef,Camera,Droplets,Edit3,MapPin,Milk,Users,Weight,
  HeartCrack,ShoppingCart,ShoppingBag,X,ChevronRight} from 'lucide-react';
import {useNavigate,useParams} from 'react-router-dom';
import {Badge,Card,IconButton,LoadingState,ErrorState} from '../components/ui';
import {formatDate} from '../utils';
import {getAnimal,getMedia,uploadMedia,getMovements,getMovementOptions,getWeighings,getHealthConditions,
  getHealthCampaigns,getReproduction,getProduction,getCommerce,getAnimalStatusEvents,
  getReproductionSettings,type Animal,type MediaItem,type MovementOptions,
  type ReproductionRecords,type ReproductionSettings} from './api';
import {useV2Session} from './V2Session';

type Section={title:string;path:string;entries:Array<{id:string;date:string;label:string}>};
type AnimalAction={label:string;run:()=>void};
function recent(title:string,path:string,entries:Section['entries']):Section{
  return {title,path,entries:entries.sort((a,b)=>b.date.localeCompare(a.date))};
}
export function V2AnimalDetail(){
  const {id}=useParams();const navigate=useNavigate();const {session,hasPermission}=useV2Session();
  const [animal,setAnimal]=useState<Animal|null>(null);const [media,setMedia]=useState<MediaItem[]>([]);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const [viewer,setViewer]=useState<MediaItem|null>(null);const [purpose,setPurpose]=useState<'PROFILE'|'COVER'>('PROFILE');
  const [menu,setMenu]=useState<{title:string;actions:AnimalAction[]}|null>(null);
  const [sections,setSections]=useState<Section[]>([]);
  const [movementOptions,setMovementOptions]=useState<MovementOptions|null>(null);
  const [inMilking,setInMilking]=useState(false);
  const [reproduction,setReproduction]=useState<ReproductionRecords|null>(null);
  const [reproductionSettings,setReproductionSettings]=useState<ReproductionSettings|null>(null);
  const fileRef=useRef<HTMLInputElement>(null);
  const token=session!.accessToken;
  const property=session!.overview.properties.find(value=>value.id===session!.overview.activeContext?.propertyId);
  const modules=property?.enabledModules??[];
  const canViewMedia=hasPermission('MEDIA_VIEW')&&modules.includes('MULTIMEDIA');
  const canManageMedia=hasPermission('MEDIA_MANAGE')&&modules.includes('MULTIMEDIA');
  const can=(permission:string,module?:string)=>hasPermission(permission)&&(!module||modules.includes(module));
  useEffect(()=>{
    if(!id)return;let active=true;setAnimal(null);setError('');
    void getAnimal(token,id).then(value=>{if(active)setAnimal(value);})
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'No se pudo abrir el animal.');});
    if(canViewMedia)void getMedia(token,'ANIMAL',id).then(value=>{if(active)setMedia(value);})
      .catch(()=>{});
    return()=>{active=false;};
  },[id,token,canViewMedia]);
  useEffect(()=>{if(!id)return;let active=true;setSections([]);setInMilking(false);
    setReproduction(null);setReproductionSettings(null);
    setMovementOptions(null);
    if(can('MOVEMENT_MANAGE','MOVEMENTS'))void getMovementOptions(token)
      .then(options=>{if(active)setMovementOptions(options);}).catch(()=>{});
    const jobs:Array<Promise<Section>>=[];
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
      jobs.push(getHealthConditions(token).then(items=>recent('Condiciones de salud','/sanidad',
        items.filter(item=>item.animalId===id).map(item=>({id:item.id,date:item.detectedOn,
          label:`${item.kind??'Condición'} · ${item.description}`})))));
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
        return recent('Reproducción','/reproduccion',[
        ...items.heats.filter(item=>item.cowId===id).map(item=>({id:item.id,date:item.startsOn,label:'Celo'})),
        ...items.services.filter(item=>item.cowId===id||item.fatherId===id||item.donorId===id)
          .map(item=>({id:item.id,date:item.occurredOn,label:item.kind==='INSEMINATION'?'Inseminación':'Transferencia de embrión'})),
        ...items.pregnancies.filter(item=>item.cowId===id||item.fatherId===id)
          .map(item=>({id:item.id,date:item.confirmedOn,label:'Preñez'})),
        ...items.births.filter(item=>item.motherId===id||item.calves.some(calf=>calf.id===id))
          .map(item=>({id:item.id,date:item.occurredOn,label:'Parto'})),
        ...items.losses.filter(item=>item.cowId===id)
          .map(item=>({id:item.id,date:item.occurredOn,label:'Pérdida gestacional'})),
        ]);
      }));
    }
    if(can('PRODUCTION_VIEW','PRODUCTION'))jobs.push(getProduction(token).then(items=>{
      if(active)setInMilking(Boolean(items.cows.find(row=>row.id===id)?.inMilking));
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
      result.status==='fulfilled'?[result.value]:[]));});
    return()=>{active=false;};
  },[id,token,modules.join(','),session?.overview.activeContext?.roleId]);
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
  const choose=(title:string,actions:AnimalAction[])=>{
    if(actions.length===1)actions[0]!.run();else if(actions.length>1)setMenu({title,actions});};
  const photoAction=()=>choose('Fotos del animal',[
    {label:'Cambiar foto de perfil',run:()=>{setMenu(null);setPurpose('PROFILE');fileRef.current?.click();}},
    {label:'Cambiar portada',run:()=>{setMenu(null);setPurpose('COVER');fileRef.current?.click();}},
  ]);
  const groupId=animal?.group?.id;
  const ownGroup=movementOptions?.groups.find(item=>item.id===groupId);
  const moveSameProperty=Boolean(ownGroup&&movementOptions?.groups.some(item=>
    item.propertyId===property?.id&&item.id!==groupId));
  const moveOtherProperty=Boolean(ownGroup&&movementOptions?.groups.some(item=>
    item.propertyId!==property?.id));
  const rotate=Boolean(ownGroup&&can('LOCATION_MANAGE')&&
    (modules.includes('PASTURES')||modules.includes('CORRALS'))&&
    movementOptions?.locations.some(item=>item.propertyId===property?.id&&
      item.id!==ownGroup.locationId&&!movementOptions.groups.some(group=>group.locationId===item.id)));
  const movementActions:AnimalAction[]=[
    ...(moveSameProperty?[{label:'Cambiar de grupo',run:()=>go('/movimientos','GRUPO')}]:[]),
    ...(moveOtherProperty?[{label:'Cambiar de propiedad',run:()=>go('/movimientos','PROPIEDAD')}]:[]),
    ...(rotate?[{label:'Rotación de potrero o corral · todo el grupo',
      run:()=>go('/movimientos','UBICACION')}]:[]),
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
    {label:'Registrar parto',run:()=>go('/reproduccion','PARTO')},
    {label:'Registrar pérdida de preñez',run:()=>go('/reproduccion','PERDIDA')},
  ]:[
    {label:'Registrar celo',run:()=>go('/reproduccion','CELO')},
    {label:'Registrar inseminación o transferencia',run:()=>go('/reproduccion','SERVICIO')},
    {label:'Confirmar preñez',run:()=>go('/reproduccion','PRENEZ')},
  ]):[];
  if(error&&!animal)return <ErrorState message={error} onRetry={()=>navigate('/animales')}/>;
  if(!animal)return <LoadingState text="Abriendo ficha…"/>;
  return <div className="animal-detail-page sgb-v2-animal-detail">
    <button className="animal-back" type="button" onClick={()=>navigate('/animales')}>
      <ArrowLeft size={17}/> Volver a animales</button>
    <section className={`animal-social-cover ${cover?'has-cover':''}`}>
      {cover?<button type="button" className="animal-cover-media" onClick={()=>setViewer(cover)}>
        <img src={cover.url} alt={`Portada de ${animal.name}`}/></button>:<div className="animal-cover-placeholder"/>}
      <div className="animal-cover-shade"/><div className="animal-cover-name"><h1>{animal.name}</h1>
        {animal.description&&<p>{animal.description}</p>}</div>
      <button type="button" className="animal-social-avatar" disabled={!profile}
        onClick={()=>setViewer(profile??null)}>{profile?<img src={profile.thumbnailUrl??profile.url}
          alt={`Perfil de ${animal.name}`}/>:<Beef size={48}/>}</button>
    </section>
    <div className="animal-profile-action-strip" aria-label="Acciones del animal">
      {canManageMedia&&<IconButton label="Fotos del animal" onClick={photoAction}><Camera size={21}/></IconButton>}
      {hasPermission('ANIMAL_UPDATE')&&<IconButton label="Editar animal" onClick={()=>go('/animales/gestionar')}>
        <Edit3 size={21}/></IconButton>}
      {['ACTIVE','MISSING','INACTIVE'].includes(animal.availabilityStatusCode)&&
        hasPermission('ANIMAL_UPDATE')&&<IconButton label="Bajas y novedades"
          onClick={()=>choose('Novedades de '+animal.name,
            (animal.availabilityStatusCode==='MISSING'?
              [{label:'Marcar como encontrado',code:'MARK_FOUND'},{label:'Registrar fallecimiento',code:'RECORD_DEATH'},
                {label:'Registrar salida',code:'RECORD_EXIT'}]:animal.availabilityStatusCode==='INACTIVE'?
              [{label:'Registrar fallecimiento',code:'RECORD_DEATH'},{label:'Registrar salida',code:'RECORD_EXIT'}]:
              [{label:'Reportar desaparición',code:'REPORT_MISSING'},
                {label:'Registrar fallecimiento',code:'RECORD_DEATH'},
                {label:'Registrar salida',code:'RECORD_EXIT'}]).map(item=>({label:item.label,
                run:()=>go('/bajas',item.code)})))}><HeartCrack size={21}/></IconButton>}
      {usable&&can('COMMERCE_MANAGE','SALES_PURCHASES')&&<IconButton label="Ventas"
        onClick={()=>go('/ventas','NUEVA')}><ShoppingCart size={21}/></IconButton>}
      {usable&&can('COMMERCE_MANAGE','SALES_PURCHASES')&&<IconButton label="Compras"
        onClick={()=>go('/compras','NUEVA')}><ShoppingBag size={21}/></IconButton>}
      {usable&&movementActions.length>0&&<IconButton label="Movimientos"
        onClick={()=>choose('Movimiento de '+animal.name,movementActions)}>
        <ArrowLeftRight size={21}/></IconButton>}
      {usable&&can('WEIGHING_MANAGE','WEIGHING')&&<IconButton label="Registrar pesaje"
        onClick={()=>go('/pesajes','NUEVO')}><Weight size={21}/></IconButton>}
      {usable&&can('HEALTH_MANAGE','HEALTH')&&<IconButton label="Sanidad"
        onClick={()=>choose('Sanidad de '+animal.name,[
          {label:'Aplicar tratamiento',run:()=>go('/sanidad','TRATAMIENTO')},
          {label:'Crear condición de salud',run:()=>go('/sanidad','CONDICION')},
        ])}><Droplets size={21}/></IconButton>}
      {usable&&animal.sex==='FEMALE'&&can('REPRODUCTION_MANAGE','REPRODUCTION')&&
        reproductiveActions.length>0&&<IconButton label="Reproducción"
          onClick={()=>choose('Reproducción de '+animal.name,reproductiveActions)}>
          <Baby size={21}/></IconButton>}
      {usable&&animal.sex==='FEMALE'&&inMilking&&can('PRODUCTION_MANAGE','PRODUCTION')&&
        <IconButton label="Registrar producción" onClick={()=>go('/produccion','LECHE')}><Milk size={21}/></IconButton>}
    </div>
    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden
      disabled={busy} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';
        if(file)void photo(file);}}/>
    {error&&<div className="form-alert form-alert-error" role="alert">{error}</div>}
    <Card className="animal-detail-summary-card animal-data-only-card">
      <div className="animal-summary-heading"><div><h2>Información</h2>
        {animal.earTagCode&&<p>Arete {animal.earTagCode}</p>}</div>
        <Badge tone={usable?'success':animal.availabilityStatusCode==='DEAD'?'danger':'warning'}>
          {status}</Badge></div>
      <div className="animal-compact-info-grid">
        <div><Beef size={18}/><span><small>Clasificación / sexo</small><strong>{animal.classification?.name??'Animal'} · {animal.sex==='FEMALE'?'Hembra':'Macho'}</strong></span></div>
        <div><Users size={18}/><span><small>Grupo</small><strong>{animal.group?.name??'Sin grupo'}</strong></span></div>
        {animal.location&&<div><MapPin size={18}/><span><small>Ubicación actual</small><strong>{animal.location.name}</strong></span></div>}
        <div><Beef size={18}/><span><small>Nacimiento</small><strong>{formatDate(animal.birthDate)}</strong></span></div>
        <div><Beef size={18}/><span><small>Ingreso</small><strong>{formatDate(animal.entryDate)}</strong></span></div>
        {animal.owners?.length>0&&<div><Users size={18}/><span><small>Propietarios</small>
          <strong>{animal.owners.map(owner=>`${owner.name} (${owner.percent}%)`).join(', ')}</strong></span></div>}
        {animal.breeds?.length>0&&<div><Beef size={18}/><span><small>Razas</small>
          <strong>{animal.breeds.map(breed=>breed.name).join(', ')}</strong></span></div>}
        {Boolean(animal.colors?.length)&&<div><Beef size={18}/><span><small>Colores</small>
          <strong>{animal.colors?.map(color=>color.name).join(', ')}</strong></span></div>}
        {animal.brands?.length>0&&<div><Beef size={18}/><span><small>Marquillas</small>
          <strong>{animal.brands.map(brand=>brand.name).join(', ')}</strong></span></div>}
        {animal.initialWeight!==null&&<div><Weight size={18}/><span><small>Peso inicial</small>
          <strong>{animal.initialWeight} {animal.initialWeightUnitCode==='POUND'?'lb':'kg'}</strong></span></div>}
        {animal.mother&&<div><Baby size={18}/><span><small>Madre</small><strong>{animal.mother.name}</strong></span></div>}
        {animal.father&&<div><Baby size={18}/><span><small>Padre</small><strong>{animal.father.name}</strong></span></div>}
      </div>
    </Card>
    {sections.length>0&&<div className="v2-animal-history" aria-label="Resumen del animal">
      {sections.map(section=><Card className="v2-animal-history-card" key={section.title}>
        <div className="v2-animal-history-title"><h2>{section.title} <span>{section.entries.length}</span></h2>
          <button type="button" onClick={()=>go(section.path)}>Ver todo <ChevronRight size={16}/></button></div>
        {section.entries.length?section.entries.slice(0,3).map(item=><div className="v2-animal-history-row"
          key={item.id}><strong>{item.label}</strong><time>{formatDate(item.date)}</time></div>)
          :<p className="muted">Sin registros</p>}
      </Card>)}
    </div>}
    {gallery.length>0&&<section className="v2-animal-gallery"><h2>Fotos</h2><div>
      {gallery.map(item=><button key={item.id} type="button" onClick={()=>setViewer(item)}>
        <img src={item.thumbnailUrl??item.url} alt={item.description??animal.name}/></button>)}
    </div></section>}
    {viewer&&<div className="v2-media-viewer" role="dialog" aria-modal="true" aria-label="Foto del animal"
      onClick={()=>setViewer(null)}><button type="button" aria-label="Cerrar foto" onClick={()=>setViewer(null)}>×</button>
      <img src={viewer.url} alt={viewer.description??animal.name} onClick={event=>event.stopPropagation()}/></div>}
    {menu&&<div className="v2-animal-sheet-backdrop" role="presentation"
      onMouseDown={event=>{if(event.target===event.currentTarget)setMenu(null);}}>
      <section className="v2-animal-sheet" role="dialog" aria-modal="true" aria-label={menu.title}>
        <header><h2>{menu.title}</h2><IconButton label="Cerrar" onClick={()=>setMenu(null)}>
          <X size={22}/></IconButton></header>
        {menu.actions.map(action=><button type="button" key={action.label} onClick={action.run}>
          <span>{action.label}</span><ChevronRight size={20}/></button>)}
      </section></div>}
  </div>;
}
