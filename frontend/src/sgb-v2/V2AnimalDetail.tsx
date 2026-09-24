import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowLeftRight,Baby,Beef,Camera,Droplets,Edit3,MapPin,Milk,Users,Weight} from 'lucide-react';
import {useNavigate,useParams} from 'react-router-dom';
import {Badge,Card,IconButton,LoadingState,ErrorState} from '../components/ui';
import {formatDate} from '../utils';
import {getAnimal,getMedia,uploadMedia,type Animal,type MediaItem} from './api';
import {useV2Session} from './V2Session';

export function V2AnimalDetail(){
  const {id}=useParams();const navigate=useNavigate();const {session,hasPermission}=useV2Session();
  const [animal,setAnimal]=useState<Animal|null>(null);const [media,setMedia]=useState<MediaItem[]>([]);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const [viewer,setViewer]=useState<MediaItem|null>(null);const [purpose,setPurpose]=useState<'PROFILE'|'COVER'>('PROFILE');
  const fileRef=useRef<HTMLInputElement>(null);
  const token=session!.accessToken;
  const property=session!.overview.properties.find(value=>value.id===session!.overview.activeContext?.propertyId);
  const modules=property?.enabledModules??[];
  const canViewMedia=hasPermission('MEDIA_VIEW')&&modules.includes('MULTIMEDIA');
  const canManageMedia=hasPermission('MEDIA_MANAGE')&&modules.includes('MULTIMEDIA');
  useEffect(()=>{
    if(!id)return;let active=true;setAnimal(null);setError('');
    void getAnimal(token,id).then(value=>{if(active)setAnimal(value);})
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'No se pudo abrir el animal.');});
    if(canViewMedia)void getMedia(token,'ANIMAL',id).then(value=>{if(active)setMedia(value);})
      .catch(()=>{});
    return()=>{active=false;};
  },[id,token,canViewMedia]);
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
    ?'Fallecido':animal?.availabilityStatusCode==='MISSING'?'Desaparecido':'Inactivo';
  const go=(path:string)=>navigate(`${path}?animal=${encodeURIComponent(id??'')}`);
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
      {canManageMedia&&<IconButton label="Cambiar foto de perfil" onClick={()=>{setPurpose('PROFILE');fileRef.current?.click();}}>
        <Camera size={19}/></IconButton>}
      {canManageMedia&&<IconButton label="Cambiar portada" onClick={()=>{setPurpose('COVER');fileRef.current?.click();}}>
        <Camera size={19}/></IconButton>}
      {hasPermission('ANIMAL_UPDATE')&&<IconButton label="Editar animal" onClick={()=>go('/animales/gestionar')}>
        <Edit3 size={19}/></IconButton>}
      {usable&&hasPermission('MOVEMENT_VIEW')&&modules.includes('MOVEMENTS')&&<IconButton label="Movimientos"
        onClick={()=>go('/movimientos')}><ArrowLeftRight size={19}/></IconButton>}
      {usable&&hasPermission('WEIGHING_VIEW')&&modules.includes('WEIGHING')&&<IconButton label="Pesajes"
        onClick={()=>go('/pesajes')}><Weight size={19}/></IconButton>}
      {usable&&hasPermission('HEALTH_VIEW')&&modules.includes('HEALTH')&&<IconButton label="Sanidad"
        onClick={()=>go('/sanidad')}><Droplets size={19}/></IconButton>}
      {usable&&animal.sex==='FEMALE'&&hasPermission('REPRODUCTION_VIEW')&&modules.includes('REPRODUCTION')&&
        <IconButton label="Reproducción" onClick={()=>go('/reproduccion')}><Baby size={19}/></IconButton>}
      {usable&&animal.sex==='FEMALE'&&hasPermission('PRODUCTION_VIEW')&&modules.includes('PRODUCTION')&&
        <IconButton label="Producción" onClick={()=>go('/produccion')}><Milk size={19}/></IconButton>}
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
        {animal.mother&&<div><Baby size={18}/><span><small>Madre</small><strong>{animal.mother.name}</strong></span></div>}
        {animal.father&&<div><Baby size={18}/><span><small>Padre</small><strong>{animal.father.name}</strong></span></div>}
      </div>
    </Card>
    {gallery.length>0&&<section className="v2-animal-gallery"><h2>Fotos</h2><div>
      {gallery.map(item=><button key={item.id} type="button" onClick={()=>setViewer(item)}>
        <img src={item.thumbnailUrl??item.url} alt={item.description??animal.name}/></button>)}
    </div></section>}
    {viewer&&<div className="v2-media-viewer" role="dialog" aria-modal="true" aria-label="Foto del animal"
      onClick={()=>setViewer(null)}><button type="button" aria-label="Cerrar foto" onClick={()=>setViewer(null)}>×</button>
      <img src={viewer.url} alt={viewer.description??animal.name} onClick={event=>event.stopPropagation()}/></div>}
  </div>;
}
