import {useEffect,useMemo,useState,type CSSProperties,type FormEvent} from 'react';
import {ImageLightbox,type LightboxMedia} from '../components/ImageLightbox';
import {mediaThumbnailUrl} from '../media';
import {ApiRequestError,deleteMediaObject,getAnimals,getMedia,getMediaUsage,
  listCatalogItems,uploadMedia,type Animal,type CatalogItem,type MediaItem,type MediaUsage} from './api';

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
const shownDate=(item:MediaItem)=>new Date(`${item.captured_on??item.created_at.slice(0,10)}T12:00:00`)
  .toLocaleDateString('es',{day:'numeric',month:'short',year:'numeric'});

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
  useEffect(()=>{let active=true;void Promise.all([getMedia(accessToken),getMediaUsage(accessToken)])
    .then(([media,quota])=>{if(active){setItems(media);setUsage(quota);setLoading(false);setError(null);}})
    .catch(e=>{if(active){setError(message(e));setLoading(false);}});return()=>{active=false;};},[accessToken,revision]);
  useEffect(()=>{if(!permissions.includes('CATALOG_VIEW'))return;let active=true;
    void listCatalogItems(accessToken,'MEDIA_TAGS').then(data=>{if(active)setTags(data);})
      .catch(e=>{if(active)setError(message(e));});return()=>{active=false;};},[accessToken,permissions.join(',')]);
  useEffect(()=>{if(!uploadOpen||!permissions.includes('ANIMAL_VIEW'))return;let active=true;
    const timer=setTimeout(()=>{void getAnimals(accessToken,1,search.trim()).then(page=>{
      if(active){setAnimals(page.items);setAnimalError(null);}
    }).catch(e=>{if(active)setAnimalError(message(e));});},220);
    return()=>{active=false;clearTimeout(timer);};},[accessToken,search,revision,uploadOpen,permissions.join(',')]);
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
      title:animals||'Multimedia de la propiedad',date:main.captured_on??main.created_at.slice(0,10),
      subtitle:[main.description,animals?categoryName:null,main.tags.map(tag=>tag.name).join(', ')||null,
        size(main.byteSize)].filter(Boolean).join(' · '),filename:animals||categoryName};
  }),[gallery]);
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
      <div className="media-zoom"><label htmlFor="media-zoom-range">Tamaño de fotos</label>
        <input id="media-zoom-range" type="range" min="96" max="260" step="8" value={thumbnailSize}
          onChange={event=>setThumbnailSize(Number(event.target.value))}/></div>
    </div>
    {usage&&<p className="media-usage">Espacio de la cuenta: {size(usage.storedBytes)} / {size(usage.limitBytes)}</p>}
    {error&&<div className="form-error" role="alert">{error}</div>}
    {loading?<p className="muted">Cargando galería…</p>:gallery.length===0?<div className="media-empty"><span aria-hidden="true">▧</span>
      <h3>{items.length?'No hay archivos con estos filtros':'Aún no hay archivos'}</h3>
      <p>{items.length?'Prueba con otra categoría o búsqueda.':'Agrega fotos o videos de los animales de esta propiedad.'}</p>
      {permissions.includes('MEDIA_MANAGE')&&<button type="button" className="primary-button compact"
        onClick={()=>setUploadOpen(true)}>Agregar foto o video</button>}</div>:
      <div className="media-gallery" style={{'--media-thumbnail-size':`${thumbnailSize}px`} as CSSProperties}>
        {gallery.map(({id,main,attachments})=>{
          const title=attachments.filter(item=>item.entity_type==='ANIMAL').map(item=>item.entity_name)
            .filter(Boolean).join(', ')||categories.find(item=>item.code===categoryOf(main.entity_type))?.label||'Registro';
          return <article className="media-tile" key={id}>
            <button className="media-tile-open" type="button" onClick={()=>setViewerId(id)}
              aria-label={`Ver ${main.kind==='VIDEO'?'video':'foto'} de ${title}`}>
              {main.kind==='IMAGE'?<img src={main.thumbnailUrl??mediaThumbnailUrl(main.url)} loading="lazy" decoding="async" alt=""/>:
                <span className="media-video-placeholder">▶<small>Toca para reproducir</small></span>}
              <span className="media-tile-type" aria-hidden="true">{main.kind==='VIDEO'?'▶':'▣'}</span>
              <span className="media-tile-caption"><strong>{title}</strong>
                {thumbnailSize>=132&&<small>{shownDate(main)} · {size(main.byteSize)}</small>}</span>
            </button>
          </article>;
        })}</div>}
    {permissions.includes('MEDIA_MANAGE')&&<button className="media-fab" type="button"
      aria-label="Subir foto o video" onClick={()=>setUploadOpen(true)}>＋</button>}

    {viewer&&viewerIndex>=0&&<ImageLightbox items={lightboxItems} initialIndex={viewerIndex}
      onClose={()=>setViewerId(null)} actions={item=>permissions.includes('MEDIA_MANAGE')?
        <button type="button" className="media-delete" disabled={busy}
          onClick={()=>void remove(item.key)}>Eliminar archivo</button>:null}/>}

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
              <label><span>Fecha de toma</span><input type="date" name="capturedOn"/></label>
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
