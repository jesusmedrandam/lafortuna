import {DateInput} from '../components/ui';
import {useEffect,useMemo,useRef,useState,type CSSProperties,type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {Pencil,Trash2} from 'lucide-react';
import {formatDate} from '../utils';
import {IconButton} from '../components/ui';
import {ShellIcon,type ShellIconName} from './ShellIcon';
import {ImageLightbox,type LightboxMedia} from '../components/ImageLightbox';
import {mediaThumbnailUrl} from '../media';
import {ApiRequestError,deleteMediaObject,getAnimals,getMedia,getMediaUsage,
  listCatalogItems,uploadMedia,updateMediaDetails,type Animal,type CatalogItem,type MediaItem,type MediaUsage} from './api';

const message=(error:unknown)=>error instanceof ApiRequestError?error.message:'No se pudo completar la operación.';
const size=(bytes:number)=>`${(bytes/1048576).toFixed(1)} MiB`;
const categories=[
  {code:'ANIMAL',label:'Animales'}, {code:'ALL',label:'Todas'},
  {code:'LIVESTOCK_MOVEMENT',label:'Movimientos'},
  {code:'REPRODUCTION_BIRTH',label:'Partos'},
  {code:'LIVESTOCK_ACTIVITY',label:'Actividades'},
  {code:'CLEANING',label:'Limpiezas'},
] as const;
type Category=(typeof categories)[number]['code'];
const categoryOf=(type:string):Category=>type==='REPRODUCTION_BIRTH'?'REPRODUCTION_BIRTH':
  type==='LIVESTOCK_MOVEMENT'||type==='LIVESTOCK_ACTIVITY'||type==='CLEANING'?type:
  type==='ANIMAL'?'ANIMAL':'ALL';
const shownDate=(item:MediaItem)=>formatDate(item.captured_on??item.created_at.slice(0,10));
const mediaIcon=(type:string):ShellIconName=>type.startsWith('REPRODUCTION_')?'reproduction':
  type==='LIVESTOCK_MOVEMENT'?'movements':type==='CLEANING'?'cleanings':
  type==='LIVESTOCK_ACTIVITY'?'activities':type.startsWith('MILK_')?'production':
  type==='HEALTH_CAMPAIGN'?'health':'animals';

export function MediaPanel({accessToken,permissions}:{accessToken:string;permissions:string[]}){
  const [items,setItems]=useState<MediaItem[]>([]);
  const [usage,setUsage]=useState<MediaUsage|null>(null);
  const [tags,setTags]=useState<CatalogItem[]>([]);
  const [animals,setAnimals]=useState<Animal[]>([]);
  const [search,setSearch]=useState('');
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState<Category>('ANIMAL');
  const [kind,setKind]=useState<'ALL'|'IMAGE'|'VIDEO'>('ALL');
  const [newest,setNewest]=useState(true);
  const [thumbnailSize,setThumbnailSize]=useState(176);
  const thumbnailGesture=useRef<{distance:number;size:number}|null>(null);
  const galleryRef=useRef<HTMLDivElement>(null);
  const [editing,setEditing]=useState<{id:string;attachments:MediaItem[]}|null>(null);
  const [editDate,setEditDate]=useState('');const [editDescription,setEditDescription]=useState('');
  const [editAnimals,setEditAnimals]=useState<Array<{id:string;name:string}>>([]);
  const [editTags,setEditTags]=useState<string[]>([]);
  const [animalError,setAnimalError]=useState<string|null>(null);
  const [chosen,setChosen]=useState<Array<{id:string;name:string}>>([]);
  const [selectedTags,setSelectedTags]=useState<string[]>([]);
  const [file,setFile]=useState<File|null>(null);
  const [previewUrl,setPreviewUrl]=useState<string|null>(null);
  const [uploadOpen,setUploadOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [revision,setRevision]=useState(0);
  const [viewerId,setViewerId]=useState<string|null>(null);
  useEffect(()=>{let active=true;void getMedia(accessToken)
    .then(media=>{if(active){setItems(media);setLoading(false);setError(null);}})
    .catch(e=>{if(active){setError(message(e));setLoading(false);}});return()=>{active=false;};},[accessToken,revision]);
  useEffect(()=>{let active=true;void getMediaUsage(accessToken).then(quota=>{if(active)setUsage(quota);})
    .catch(()=>{if(active)setUsage(null);});return()=>{active=false;};},[accessToken,revision]);
  useEffect(()=>{if(!permissions.includes('CATALOG_VIEW'))return;let active=true;
    void listCatalogItems(accessToken,'MEDIA_TAGS').then(data=>{if(active)setTags(data);})
      .catch(e=>{if(active)setError(message(e));});return()=>{active=false;};},[accessToken,permissions.join(',')]);
  useEffect(()=>{if((!uploadOpen&&!editing)||!permissions.includes('ANIMAL_VIEW'))return;let active=true;
    const timer=setTimeout(()=>{void getAnimals(accessToken,1,search.trim()).then(page=>{
      if(active){setAnimals(page.items);setAnimalError(null);}
    }).catch(e=>{if(active)setAnimalError(message(e));});},220);
    return()=>{active=false;clearTimeout(timer);};},[accessToken,search,revision,uploadOpen,editing?.id,permissions.join(',')]);
  useEffect(()=>{
    const gallery=galleryRef.current;if(!gallery)return;
    const move=(event:TouchEvent)=>{
      const start=thumbnailGesture.current;if(event.touches.length!==2||!start)return;
      event.preventDefault();const [first,second]=[event.touches[0],event.touches[1]];
      const distance=Math.hypot(second.clientX-first.clientX,second.clientY-first.clientY);
      setThumbnailSize(Math.min(260,Math.max(96,Math.round(start.size*distance/start.distance))));
    };
    gallery.addEventListener('touchmove',move,{passive:false});
    return()=>gallery.removeEventListener('touchmove',move);
  },[loading,category,kind,query,items.length]);
  useEffect(()=>{if(!file){setPreviewUrl(null);return;}
    const url=URL.createObjectURL(file);setPreviewUrl(url);
    return()=>URL.revokeObjectURL(url);},[file]);
  const gallery=useMemo(()=>{
    const grouped=new Map<string,MediaItem[]>();
    for(const item of items){const row=grouped.get(item.storage_object_id)??[];
      row.push(item);grouped.set(item.storage_object_id,row);}
    const matching=[...grouped.entries()].map(([id,attachments])=>({id,attachments,main:attachments[0]!}))
      .filter(({main,attachments})=>{
        const content=[main.description,...attachments.map(item=>item.entity_name),
          ...attachments.flatMap(item=>item.tags.map(tag=>tag.name))].join(' ').toLocaleLowerCase();
        return (category==='ALL'||attachments.some(item=>categoryOf(item.entity_type)===category))
          &&(kind==='ALL'||main.kind===kind)&&content.includes(query.trim().toLocaleLowerCase());
      });
    return newest?matching:matching.reverse();
  },[items,category,kind,query,newest]);
  const viewerIndex=gallery.findIndex(item=>item.id===viewerId);
  const viewer=viewerIndex>=0?gallery[viewerIndex]:null;
  const lightboxItems=useMemo<LightboxMedia[]>(()=>gallery.map(({id,main,attachments})=>{
    const animals=attachments.filter(item=>item.entity_type==='ANIMAL').map(item=>item.entity_name)
      .filter(Boolean).join(', ');
    const categoryName=categories.find(item=>item.code===categoryOf(main.entity_type))?.label??'Registro';
    return {key:id,url:main.url,type:main.kind==='VIDEO'?'VIDEO':'IMAGEN',
      title:animals||'Foto sin animal relacionado',date:main.captured_on??main.created_at.slice(0,10),
      subtitle:[main.description,animals?categoryName:null,main.tags.map(tag=>tag.name).join(', ')||null,
        size(main.byteSize)].filter(Boolean).join(' · '),filename:animals||categoryName};
  }),[gallery]);
  useEffect(()=>{
    if(!editing)return;
    const marker=`media-edit-${editing.id}`;
    window.history.pushState({...window.history.state,sgbMediaEdit:marker},'',window.location.href);
    const close=()=>{if(window.history.state?.sgbMediaEdit!==marker)setEditing(null);};
    window.addEventListener('popstate',close);
    return()=>{window.removeEventListener('popstate',close);
      if(window.history.state?.sgbMediaEdit===marker)window.history.back();};
  },[editing?.id]);
  function beginEdit(id:string){
    const row=gallery.find(item=>item.id===id);if(!row)return;
    setViewerId(id);
    setEditing({id,attachments:row.attachments});setEditDate(row.main.captured_on??'');
    setEditDescription(row.main.description??'');setEditTags([...new Set(row.attachments.flatMap(item=>item.tags.map(tag=>tag.id)))]);
    setEditAnimals(row.attachments.filter(item=>item.entity_type==='ANIMAL')
      .filter((item,index,all)=>all.findIndex(other=>other.entity_id===item.entity_id)===index)
      .map(item=>({id:item.entity_id,name:item.entity_name??'Animal'})));
    setSearch('');setError(null);
  }
  async function saveEdit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!editing||busy)return;
    if(!editAnimals.length&&!editing.attachments.some(item=>item.entity_type!=='ANIMAL')){
      setError('Relaciona el archivo con al menos un animal.');return;
    }
    setBusy(true);setError(null);
    try{await updateMediaDetails(accessToken,editing.id,{capturedOn:editDate||null,
      description:editDescription.trim()||null,tagIds:editTags,animalIds:editAnimals.map(item=>item.id),
      expectedAttachmentIds:editing.attachments.map(item=>item.id)});
      setEditing(null);setRevision(value=>value+1);
    }catch(failure){setError(message(failure));}finally{setBusy(false);}
  }
  useEffect(()=>{if(!uploadOpen)return;
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!busy)setUploadOpen(false);};
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  },[uploadOpen,busy]);
  function choose(animal:Animal){setChosen(prev=>prev.some(item=>item.id===animal.id)
    ?prev.filter(item=>item.id!==animal.id):[...prev,{id:animal.id,name:animal.name}]);}
  function closeUpload(){if(busy)return;setUploadOpen(false);setFile(null);setChosen([]);setSelectedTags([]);setSearch('');}
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!file||!chosen.length)return;
    const data=new FormData(event.currentTarget);setBusy(true);setError(null);
    try{await uploadMedia(accessToken,{file,animalIds:chosen.map(item=>item.id),tagIds:selectedTags,
      description:String(data.get('description')||'').trim(),capturedOn:String(data.get('capturedOn')||'')});
      closeUploadAfterSuccess();setRevision(n=>n+1);
    }catch(e){setError(message(e));}finally{setBusy(false);}}
  function closeUploadAfterSuccess(){setUploadOpen(false);setFile(null);setChosen([]);setSelectedTags([]);setSearch('');}
  async function remove(id:string){if(!window.confirm('¿Eliminar esta foto o video y sus relaciones?'))return;
    setBusy(true);setError(null);try{const result=await deleteMediaObject(accessToken,id);
      if(!result.deletedFromProvider)setError('La relación se quitó. Cloudinary no confirmó la eliminación; queda pendiente para reintento.');
      setViewerId(null);setRevision(n=>n+1);
    }catch(e){setError(message(e));}finally{setBusy(false);}}

  return <section className="media-page" aria-label="Galería multimedia">
    <div className="media-toolbar">
      <div className="media-toolbar-row">
        <label className="media-search"><span className="sr-only">Buscar multimedia</span>
          <span aria-hidden="true">⌕</span><input type="search" value={query}
            placeholder="Buscar multimedia…" onChange={event=>setQuery(event.target.value)}/></label>
        <span className="media-count" title="Archivos encontrados">{gallery.length}</span>
        <button type="button" className="media-tool-button" title={newest?'Más recientes primero':'Más antiguos primero'}
          aria-label={newest?'Ordenar por más antiguos':'Ordenar por más recientes'}
          onClick={()=>setNewest(value=>!value)}>{newest?'↓':'↑'}</button>
        <button type="button" className="media-tool-button" title={kind==='ALL'?'Fotos y videos':kind==='IMAGE'?'Solo fotos':'Solo videos'}
          aria-label="Cambiar filtro de fotos y videos" onClick={()=>setKind(value=>value==='ALL'?'IMAGE':value==='IMAGE'?'VIDEO':'ALL')}>
          {kind==='ALL'?'▣':kind==='IMAGE'?'▧':'▶'}</button>
        {permissions.includes('MEDIA_MANAGE')&&<button type="button" className="media-tool-button media-add"
          title="Subir foto o video" aria-label="Subir foto o video" onClick={()=>setUploadOpen(true)}>＋</button>}
      </div>
      <div className="media-category-tabs" aria-label="Categoría multimedia">
        {categories.map(item=><button key={item.code} type="button" className={category===item.code?'active':''}
          aria-pressed={category===item.code} onClick={()=>setCategory(item.code)}>{item.label}</button>)}
      </div>
    </div>
    {usage&&<p className="media-usage">Espacio de la cuenta: {size(usage.storedBytes)} / {size(usage.limitBytes)}</p>}
    {error&&<div className="form-error" role="alert">{error}</div>}
    {loading?<p className="muted">Cargando galería…</p>:gallery.length===0?<div className="media-empty"><span aria-hidden="true">▧</span>
      <h3>{items.length?'No hay archivos con estos filtros':'Aún no hay archivos'}</h3>
      <p>{items.length?'Prueba con otra categoría o búsqueda.':'Agrega fotos o videos de los animales de esta propiedad.'}</p>
      {permissions.includes('MEDIA_MANAGE')&&<button type="button" className="primary-button compact"
        onClick={()=>setUploadOpen(true)}>Agregar foto o video</button>}</div>:
      <div ref={galleryRef} className="media-gallery" style={{'--media-thumbnail-size':`${thumbnailSize}px`} as CSSProperties}
        onTouchStart={event=>{if(event.touches.length!==2)return;
          const [first,second]=[event.touches[0],event.touches[1]];
          const distance=Math.hypot(second.clientX-first.clientX,second.clientY-first.clientY);
          thumbnailGesture.current=distance>0?{distance,size:thumbnailSize}:null;}}
        onTouchEnd={event=>{if(event.touches.length<2)thumbnailGesture.current=null;}}
        onTouchCancel={()=>{thumbnailGesture.current=null;}}>
        {gallery.map(({id,main,attachments})=>{
          const title=attachments.filter(item=>item.entity_type==='ANIMAL').map(item=>item.entity_name)
            .filter(Boolean).join(', ')||categories.find(item=>item.code===categoryOf(main.entity_type))?.label||'Registro';
          return <article className="media-tile" key={id}>
            <button className="media-tile-open" type="button" onClick={()=>setViewerId(id)}
              aria-label={`Ver ${main.kind==='VIDEO'?'video':'foto'} de ${title}`}>
              {main.kind==='IMAGE'?<img src={main.thumbnailUrl??mediaThumbnailUrl(main.url)} loading="lazy" decoding="async" alt=""/>:
                <span className="media-video-placeholder">▶<small>Toca para reproducir</small></span>}
              <span className="media-tile-type" data-media-module={mediaIcon((attachments.find(item=>item.entity_type!=='ANIMAL')??main).entity_type)} aria-hidden="true">
                <ShellIcon name={mediaIcon((attachments.find(item=>item.entity_type!=='ANIMAL')??main).entity_type)} size={23}/></span>
              <span className="media-tile-caption"><strong>{title}</strong>
                {thumbnailSize>=132&&<small>{shownDate(main)} · {size(main.byteSize)}</small>}</span>
            </button>
          </article>;
        })}</div>}
    {permissions.includes('MEDIA_MANAGE')&&<button className="media-fab" type="button"
      aria-label="Subir foto o video" onClick={()=>setUploadOpen(true)}>＋</button>}

    {viewer&&viewerIndex>=0&&<ImageLightbox items={lightboxItems} initialIndex={viewerIndex}
      onClose={()=>{setViewerId(null);setEditing(null);}} details={item=>{
        const row=gallery.find(entry=>entry.id===item.key);if(!row)return null;
        const related=row.attachments.filter(entry=>entry.entity_type==='ANIMAL')
          .filter((entry,index,all)=>all.findIndex(other=>other.entity_id===entry.entity_id)===index);
        const labels=[...new Set(row.attachments.flatMap(entry=>entry.tags.map(tag=>tag.name)))];
        return <><div className="lightbox-animal-links">{related.length?related.map(animal=><Link
          key={animal.entity_id} to={`/animales/${encodeURIComponent(animal.entity_id)}`} replace>
          {animal.entity_name??'Ver perfil del animal'}</Link>):<strong>Sin animal relacionado</strong>}</div>
          <small>{row.main.captured_on?'Capturada':'Subida'} el {shownDate(row.main)}</small>
          {labels.length>0&&<small>{labels.join(' · ')}</small>}
          {row.main.description&&<p className="lightbox-description">{row.main.description}</p>}</>;
      }} actions={item=>permissions.includes('MEDIA_MANAGE')?<div className="lightbox-actions">
        <IconButton label="Editar información de la foto" disabled={busy} onClick={()=>beginEdit(item.key)}><Pencil size={20}/></IconButton>
        <IconButton label="Eliminar archivo" className="media-delete" disabled={busy}
          onClick={()=>void remove(item.key)}><Trash2 size={20}/></IconButton></div>:null}/>}

    {editing&&<div className="media-overlay media-edit-overlay" role="presentation">
      <section className="media-upload-dialog" role="dialog" aria-modal="true" aria-labelledby="media-edit-title">
        <div className="media-dialog-heading"><h2 id="media-edit-title">Editar información de la foto</h2></div>
        <form onSubmit={event=>void saveEdit(event)}><fieldset disabled={busy} className="media-edit-fields">
          {error&&<div className="form-error" role="alert">{error}</div>}
          <div className="media-upload-fields"><label><span>Fecha de captura</span><DateInput type="date" value={editDate}
            onChange={event=>setEditDate(event.target.value)}/><small>Sin fecha de captura se mostrará la fecha de subida.</small></label>
            <label><span>Descripción</span><textarea maxLength={2000} rows={3} value={editDescription}
              onChange={event=>setEditDescription(event.target.value)}/></label>
            <fieldset className="media-tags"><legend>Etiquetas</legend>
              {[...tags.filter(tag=>tag.active||editTags.includes(tag.id)),
                ...editing.attachments.flatMap(item=>item.tags).filter((tag,index,all)=>
                  !tags.some(option=>option.id===tag.id)&&all.findIndex(option=>option.id===tag.id)===index)]
                .map(tag=><label key={tag.id}><input type="checkbox" checked={editTags.includes(tag.id)}
                  onChange={event=>setEditTags(current=>event.target.checked?[...current,tag.id]:current.filter(id=>id!==tag.id))}/>{tag.name}</label>)}
            </fieldset>
            <div className="media-animal-picker"><label><span>Animales relacionados</span>
              <input type="search" value={search} placeholder="Buscar por nombre o arete" onChange={event=>setSearch(event.target.value)}/></label>
              {animalError&&<p role="alert" className="form-error">{animalError}</p>}
              <div className="media-animal-results">{[...animals,...editAnimals.filter(item=>!animals.some(animal=>animal.id===item.id))]
                .map(animal=><label key={animal.id}><input type="checkbox"
                  disabled={editing.attachments.some(item=>item.entity_type==='ANIMAL'&&item.entity_id===animal.id&&item.relation_code!=='GENERAL')}
                  checked={editAnimals.some(item=>item.id===animal.id)} onChange={event=>setEditAnimals(current=>
                    event.target.checked?[...current,{id:animal.id,name:animal.name}]:current.filter(item=>item.id!==animal.id))}/>{animal.name}</label>)}</div>
              {editing.attachments.some(item=>['PROFILE','COVER'].includes(item.relation_code))&&
                <small>La relación de perfil o portada se conserva en su animal.</small>}
              {editing.attachments.filter(item=>item.entity_type!=='ANIMAL').map(item=><small key={item.id}>
                Se conserva la relación con {categories.find(option=>option.code===categoryOf(item.entity_type))?.label??'su registro'}.</small>)}
            </div>
          </div>
        </fieldset><div className="media-dialog-footer"><button type="button" className="secondary-button compact"
          disabled={busy} onClick={()=>setEditing(null)}>Cancelar</button>
          <button type="submit" className="primary-button compact" disabled={busy}>{busy?'Guardando…':'Guardar'}</button></div></form>
      </section>
    </div>}

    {uploadOpen&&<div className="media-overlay" role="presentation" onMouseDown={event=>{
      if(event.target===event.currentTarget)closeUpload();}}>
      <div className="media-upload-dialog" role="dialog" aria-modal="true" aria-labelledby="media-upload-title">
        <div className="media-dialog-heading"><h2 id="media-upload-title">Subir archivo multimedia</h2>
          <button type="button" aria-label="Cerrar" onClick={closeUpload} disabled={busy}>×</button></div>
        {error&&<div className="form-error media-dialog-error" role="alert">{error}</div>}
        <form onSubmit={event=>void submit(event)}>
          <div className="media-upload-layout">
            <div className="media-upload-preview">
              {previewUrl?(file?.type.startsWith('video/')?<video src={previewUrl} controls/>:<img src={previewUrl} alt="Vista previa del archivo"/>):
                <div className="media-file-empty">▧<span>Selecciona una foto o video</span></div>}
              <input type="file" required accept="image/jpeg,image/png,image/webp,image/heic,video/*"
                aria-label="Elegir foto o video" onChange={event=>setFile(event.target.files?.[0]??null)}/>
              {file&&<small>{file.name}</small>}
            </div>
            <div className="media-upload-fields">
              <label><span>Fecha de toma</span><DateInput type="date" name="capturedOn"/></label>
              <label><span>Descripción</span><textarea name="description" maxLength={2000} rows={3}
                placeholder="Opcional"/></label>
              <div className="media-animal-picker"><label><span>Animales relacionados *</span>
                <input type="search" value={search} placeholder="Buscar por nombre o arete"
                  onChange={event=>setSearch(event.target.value)}/></label>
                {animalError&&<small role="alert" className="form-error">{animalError}</small>}
                <div className="media-animal-results">{animals.map(animal=><label key={animal.id}>
                  <input type="checkbox" checked={chosen.some(item=>item.id===animal.id)} onChange={()=>choose(animal)}/>
                  <span>{animal.name}{animal.earTagCode?` · ${animal.earTagCode}`:''}</span>
                </label>)}{!animalError&&animals.length===0&&<small>No hay animales con esa búsqueda.</small>}</div>
                {chosen.length>0&&<div className="media-chosen">{chosen.map(item=><button
                  key={item.id} type="button" onClick={()=>setChosen(chosen.filter(a=>a.id!==item.id))}>
                  {item.name} ×</button>)}</div>}
              </div>
              {tags.some(tag=>tag.active)&&<fieldset className="media-tags"><legend>Etiquetas (opcional)</legend>
                {tags.filter(tag=>tag.active).map(tag=><label key={tag.id}><input type="checkbox"
                  checked={selectedTags.includes(tag.id)} onChange={event=>setSelectedTags(event.target.checked
                    ?[...selectedTags,tag.id]:selectedTags.filter(id=>id!==tag.id))}/>{tag.name}</label>)}</fieldset>}
            </div>
          </div>
          <div className="media-dialog-footer"><small>El servidor comprime el archivo y elimina sus metadatos.</small>
            <button type="button" className="secondary-button compact" disabled={busy} onClick={closeUpload}>Cancelar</button>
            <button type="submit" className="primary-button compact" disabled={busy||!file||!chosen.length}>
              {busy?'Procesando…':'Guardar archivo'}</button></div>
        </form>
      </div>
    </div>}
  </section>;
}
