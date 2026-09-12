import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowDownAZ, ArrowUpAZ, Baby, ClockArrowDown, ClockArrowUp, CloudOff, FileVideo2, Image, ImagePlus, Images, MapPinned, Paintbrush, Pencil, Plus, SlidersHorizontal, Trash2, Video, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest, apiRequestAllPages, apiRequestWithMeta, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AnimalMultiPicker } from '../../components/AnimalMultiPicker';
import { AnimalSelect, animalOption } from '../../components/AnimalPicker';
import { ImageLightbox, type LightboxMedia } from '../../components/ImageLightbox';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, CompactToolbar, ConfirmDialog, EmptyState, ErrorState, Field, FloatingActionDock, IconButton, Input, LoadingState, Modal, Select } from '../../components/ui';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { itemId, itemLabel, useCatalog } from '../../hooks/useCatalog';
import type { Animal, AnimalFilterOptions, CatalogItem, MultimediaItem } from '../../types/api';
import { currentDateInput, formatDate, humanizeCode } from '../../utils';

const pageSize=18;
const categories=[['','Todas'],['ANIMALES','Animales'],['MOVIMIENTOS','Movimientos'],['PARTOS','Partos'],['ACTIVIDADES','Actividades'],['LIMPIEZAS','Limpiezas']] as const;
const contextualKeys=['id_animal','id_grupo','id_ubicacion','id_ubicacion_origen','id_ubicacion_destino','id_tipo_actividad','id_etiqueta','lado','sexo'] as const;
const filterKeys=['categoria','tipo','perfil',...contextualKeys,'fecha_desde','fecha_hasta'] as const;

function categoryIcon(item:MultimediaItem) {
  if(item.categoria==='MOVIMIENTOS')return <MapPinned size={15}/>;
  if(item.categoria==='PARTOS')return <Baby size={15}/>;
  if(item.categoria==='ACTIVIDADES')return <Activity size={15}/>;
  return item.tipo_archivo==='VIDEO'?<FileVideo2 size={15}/>:<Images size={15}/>;
}

export function MultimediaPage(){
  const {hasPermission}=useAuth();
  const toast=useToast();
  const client=useQueryClient();
  const fileRef=useRef<HTMLInputElement|null>(null);
  const loadMoreRef=useRef<HTMLDivElement|null>(null);
  const [params,setParams]=useSearchParams();
  const [search,setSearch]=useState(params.get('q')??'');
  const debounced=useDebouncedValue(search);
  const [advancedOpen,setAdvancedOpen]=useState(()=>filterKeys.some((key)=>params.has(key)));
  const [uploadFile,setUploadFile]=useState<File|null>(null);
  const [uploadIds,setUploadIds]=useState<string[]>([]);
  const [uploadDate,setUploadDate]=useState(currentDateInput());
  const [uploadTags,setUploadTags]=useState<string[]>([]);
  const [editing,setEditing]=useState<MultimediaItem|null>(null);
  const [editIds,setEditIds]=useState<string[]>([]);
  const [editDate,setEditDate]=useState('');
  const [editTags,setEditTags]=useState<string[]>([]);
  const [deleteItem,setDeleteItem]=useState<MultimediaItem|null>(null);
  const [viewerIndex,setViewerIndex]=useState<number|null>(null);
  const [thumbnailSize,setThumbnailSize]=useState(()=>Math.min(260,Math.max(96,Number(localStorage.getItem('sgb:multimedia-thumbnail-size')??176))));
  const thumbnailGesture=useRef<{distance:number;size:number}|null>(null);
  const order=params.get('orden')??'NEWEST';
  const requestedCategory=params.get('categoria');
  const category=requestedCategory===null?'ANIMALES':requestedCategory==='TODAS'?'':requestedCategory;
  const filters={...Object.fromEntries(filterKeys.map((key)=>[key,params.get(key)??''])),categoria:category} as Record<(typeof filterKeys)[number],string>;
  const activeCount=filterKeys.filter((key)=>key!=='categoria'&&Boolean(filters[key])).length;

  const options=useQuery({queryKey:['animal-filter-options'],queryFn:()=>apiRequest<AnimalFilterOptions>('/animales/opciones/filtros'),staleTime:10*60_000});
  const tags=useCatalog('etiquetas-multimedia');
  const activityTypes=useCatalog('tipos-actividad');
  const animals=useQuery({queryKey:['animals','multimedia-filter'],queryFn:async()=>(await apiRequestAllPages<Animal>('/animales?limit=100',100)).data,enabled:advancedOpen&&['ANIMALES','PARTOS','ACTIVIDADES'].includes(category)});
  const query=useInfiniteQuery({
    queryKey:['multimedia','all',debounced,filters,order],
    initialPageParam:1,
    queryFn:({pageParam})=>{const queryParams=new URLSearchParams({orden:order,page:String(pageParam),limit:String(pageSize)});if(debounced)queryParams.set('q',debounced);filterKeys.forEach((key)=>{if(filters[key])queryParams.set(key,filters[key]);});return apiRequestWithMeta<MultimediaItem[]>(`/imagenes/multimedia?${queryParams}`);},
    getNextPageParam:(lastPage,allPages)=>{const loaded=allPages.reduce((total,page)=>total+(page.data?.length??0),0);const total=Number(lastPage.meta?.total??loaded);return loaded<total?allPages.length+1:undefined;},
  });
  const items=query.data?.pages.flatMap((page)=>page.data??[])??[];
  const totalItems=Number(query.data?.pages.at(-1)?.meta?.total??items.length);
  const viewerItems=useMemo<LightboxMedia[]>(()=>items.map((item)=>({key:item.id_multimedia,url:item.secure_url,type:item.tipo_archivo,title:item.titulo,subtitle:item.categoria==='PARTOS'?item.subtitulo:[item.subcategoria,item.subtitulo].filter(Boolean).join(' · '),date:item.categoria==='PARTOS'?null:item.fecha_toma,filename:item.nombre_original})),[items]);

  const setParam=(key:string,value:string)=>{const next=new URLSearchParams(params);if(value)next.set(key,value);else next.delete(key);next.delete('page');setParams(next);};
  const setCategory=(value:string)=>{const next=new URLSearchParams(params);contextualKeys.forEach((key)=>next.delete(key));next.set('categoria',value||'TODAS');next.delete('page');setParams(next);};
  const clearFilters=()=>{const next=new URLSearchParams(params);filterKeys.filter((key)=>key!=='categoria').forEach((key)=>next.delete(key));next.delete('page');setParams(next);};
  const changeThumbnailSize=(value:number)=>{const next=Math.min(260,Math.max(96,Math.round(value)));setThumbnailSize(next);localStorage.setItem('sgb:multimedia-thumbnail-size',String(next));};
  const cycleOrder=()=>{const values=['NEWEST','OLDEST','AZ','ZA'];setParam('orden',values[(values.indexOf(order)+1)%values.length]);};
  const cycleType=()=>{const values=['','IMAGEN','VIDEO'];setParam('tipo',values[(values.indexOf(filters.tipo)+1)%values.length]);};
  const orderLabel=order==='NEWEST'?'Más recientes':order==='OLDEST'?'Más antiguos':order==='AZ'?'Nombre A–Z':'Nombre Z–A';
  const OrderIcon=order==='NEWEST'?ClockArrowUp:order==='OLDEST'?ClockArrowDown:order==='AZ'?ArrowDownAZ:ArrowUpAZ;
  const TypeIcon=filters.tipo==='IMAGEN'?Image:filters.tipo==='VIDEO'?Video:Images;
  const compactThumbnails=thumbnailSize<132;

  useEffect(()=>{
    const target=loadMoreRef.current;
    if(!target||!query.hasNextPage)return;
    const observer=new IntersectionObserver((entries)=>{
      if(entries.some((entry)=>entry.isIntersecting)&&!query.isFetchingNextPage)void query.fetchNextPage();
    },{rootMargin:'500px 0px'});
    observer.observe(target);
    return()=>observer.disconnect();
  },[query.hasNextPage,query.isFetchingNextPage,query.fetchNextPage]);

  const upload=useMutation({mutationFn:async()=>{if(!uploadFile||!uploadIds.length)throw new Error('Selecciona un archivo y al menos un animal.');const data=new FormData();data.set('archivo',uploadFile);data.set('es_perfil','false');data.set('id_animales',JSON.stringify(uploadIds));data.set('fecha_toma',uploadDate);data.set('id_etiquetas',JSON.stringify(uploadTags));return apiRequest(`/animales/${uploadIds[0]}/imagenes`,{method:'POST',body:data});},onSuccess:()=>{toast.show('Archivo subido correctamente.');setUploadFile(null);setUploadIds([]);setUploadTags([]);setUploadDate(currentDateInput());void client.invalidateQueries({queryKey:['multimedia']});},onError:(error)=>toast.show(error instanceof ApiError?error.message:(error as Error).message,'error')});
  const update=useMutation({mutationFn:()=>apiRequest(`/imagenes/${editing?.id_origen}`,{method:'PATCH',body:{...(editing?.es_perfil?{}:{id_animales:editIds}),fecha_toma:editDate,id_etiquetas:editTags}}),onSuccess:()=>{toast.show('Datos de la fotografía actualizados.');setEditing(null);void client.invalidateQueries({queryKey:['multimedia']});void client.invalidateQueries({queryKey:['animal']});},onError:(error)=>toast.show((error as ApiError).message,'error')});
  const remove=useMutation({mutationFn:()=>apiRequest(`/imagenes/${deleteItem?.id_origen}`,{method:'DELETE'}),onSuccess:()=>{toast.show('Archivo eliminado.');setDeleteItem(null);setViewerIndex(null);void client.invalidateQueries({queryKey:['multimedia']});void client.invalidateQueries({queryKey:['animal']});},onError:(error)=>toast.show((error as ApiError).message,'error')});
  const beginEdit=(item:MultimediaItem)=>{if(item.es_perfil||!item.editable)return;setEditing(item);setEditIds(item.animales?.map((animal)=>animal.id_animal)??[]);setEditDate(item.fecha_toma||currentDateInput());setEditTags(item.etiquetas?.map((tag)=>tag.id_etiqueta)??[]);};

  return <div>
    <input ref={fileRef} hidden type="file" accept="image/*,video/*" onChange={(event)=>{const file=event.target.files?.[0]??null;setUploadFile(file);setUploadIds([]);event.currentTarget.value='';}}/>
    <CompactToolbar search={search} onSearch={(value)=>{setSearch(value);setParam('q',value);}} placeholder="Buscar multimedia…" count={totalItems} actions={<>
      <IconButton label={`${orderLabel}. Presiona para cambiar el orden`} onClick={cycleOrder}><OrderIcon size={20}/></IconButton>
      <IconButton className={filters.tipo?'active':''} label={`${filters.tipo==='IMAGEN'?'Solo fotos':filters.tipo==='VIDEO'?'Solo videos':'Fotos y videos'}. Presiona para cambiar`} onClick={cycleType}><TypeIcon size={20}/></IconButton>
      <IconButton className={advancedOpen?'active':''} label="Filtros avanzados" onClick={()=>setAdvancedOpen((value)=>!value)}><SlidersHorizontal size={20}/>{activeCount?<span className="filter-count">{activeCount}</span>:null}</IconButton>
    </>} below={<div className="compact-scroll-tabs" aria-label="Categoría multimedia">{categories.map(([value,label])=><button key={label} type="button" className={category===value?'active':''} onClick={()=>setCategory(value)}>{label}</button>)}</div>}/>
    {advancedOpen?<section className="advanced-filters"><div className="advanced-filters-heading"><div><h2>Filtros de {categories.find(([value])=>value===category)?.[1].toLowerCase()??'multimedia'}</h2><p>Solo aparecen los campos que tienen sentido para la categoría elegida.</p></div><div className="advanced-filter-actions"><IconButton label="Limpiar filtros" disabled={!activeCount} onClick={clearFilters}><Paintbrush size={17}/></IconButton><IconButton label="Cerrar filtros" onClick={()=>setAdvancedOpen(false)}><X size={18}/></IconButton></div></div><div className="advanced-filters-grid">
      {['ANIMALES','PARTOS','ACTIVIDADES'].includes(category)?<Field label="Animal"><AnimalSelect value={filters.id_animal} options={(animals.data??[]).map(animalOption)} emptyLabel="Todos los animales" onChange={(id)=>setParam('id_animal',id)}/></Field>:null}
      {category==='ANIMALES'?<><Field label="Grupo"><Select value={filters.id_grupo} onChange={(event)=>setParam('id_grupo',event.target.value)}><option value="">Todos los grupos</option>{options.data?.grupos.map((item)=><option key={item.id_grupo} value={item.id_grupo}>{item.nombre}</option>)}</Select></Field><LocationFilter label="Corral o potrero" value={filters.id_ubicacion} onChange={(value)=>setParam('id_ubicacion',value)} options={options.data}/><Field label="Sexo"><Select value={filters.sexo} onChange={(event)=>setParam('sexo',event.target.value)}><option value="">Todos</option><option value="HEMBRA">Hembras</option><option value="MACHO">Machos</option></Select></Field><Field label="Etiqueta"><Select value={filters.id_etiqueta} onChange={(event)=>setParam('id_etiqueta',event.target.value)}><option value="">Todas las etiquetas</option>{tags.data?.filter((item)=>item.activo!==false).map((item)=><option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field></>:null}
      {category==='MOVIMIENTOS'?<><LocationFilter label="Potrero de origen" value={filters.id_ubicacion_origen} onChange={(value)=>setParam('id_ubicacion_origen',value)} options={options.data}/><LocationFilter label="Potrero de destino" value={filters.id_ubicacion_destino} onChange={(value)=>setParam('id_ubicacion_destino',value)} options={options.data}/><Field label="Fotografía del"><Select value={filters.lado} onChange={(event)=>setParam('lado',event.target.value)}><option value="">Origen y destino</option><option value="ORIGEN">Origen</option><option value="DESTINO">Destino</option></Select></Field></>:null}
      {category==='ACTIVIDADES'?<Field label="Tipo de actividad"><Select value={filters.id_tipo_actividad} onChange={(event)=>setParam('id_tipo_actividad',event.target.value)}><option value="">Todas las actividades</option>{activityTypes.data?.filter((item)=>item.activo!==false).map((item)=><option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>:null}
      {category==='LIMPIEZAS'?<LocationFilter label="Potrero" value={filters.id_ubicacion} onChange={(value)=>setParam('id_ubicacion',value)} options={options.data}/>:null}
      <Field label="Fotos de perfil"><Select value={filters.perfil} onChange={(event)=>setParam('perfil',event.target.value)}><option value="">Todas</option><option value="SI">Solo fotos de perfil</option><option value="NO">Excluir fotos de perfil</option></Select></Field><Field label="Tomada desde"><Input type="date" value={filters.fecha_desde} max={filters.fecha_hasta||undefined} onChange={(event)=>setParam('fecha_desde',event.target.value)}/></Field><Field label="Tomada hasta"><Input type="date" value={filters.fecha_hasta} min={filters.fecha_desde||undefined} onChange={(event)=>setParam('fecha_hasta',event.target.value)}/></Field>
    </div><div className="advanced-filters-footer"><span>{activeCount?`${activeCount} filtros activos`:'Sin filtros aplicados'}</span></div></section>:null}
    {query.isLoading?<LoadingState/>:query.isError?<ErrorState message={(query.error as Error).message} onRetry={()=>void query.refetch()}/>:items.length?<div
      className={`multimedia-grid multimedia-zoom-grid ${compactThumbnails?'compact-thumbnails':''}`}
      style={{'--media-thumbnail-size':`${thumbnailSize}px`} as CSSProperties}
      onTouchStart={(event)=>{if(event.touches.length!==2)return;const [first,second]=[event.touches[0],event.touches[1]];thumbnailGesture.current={distance:Math.hypot(second.clientX-first.clientX,second.clientY-first.clientY),size:thumbnailSize};}}
      onTouchMove={(event)=>{if(event.touches.length!==2||!thumbnailGesture.current)return;const [first,second]=[event.touches[0],event.touches[1]];const distance=Math.hypot(second.clientX-first.clientX,second.clientY-first.clientY);changeThumbnailSize(thumbnailGesture.current.size*distance/thumbnailGesture.current.distance);}}
      onTouchEnd={()=>{thumbnailGesture.current=null;}}
      onWheel={(event)=>{if(!event.ctrlKey)return;event.preventDefault();changeThumbnailSize(thumbnailSize+(event.deltaY<0?16:-16));}}
    >{items.map((item,index)=>{const pending=Boolean((item as MultimediaItem&{__offline?:boolean;__sync_state?:string}).__offline||(item as MultimediaItem&{__sync_state?:string}).__sync_state==='PENDING');const title=pending&&item.titulo==='Pendiente de sincronizar'?(item.animales?.map((animal)=>animal.nombre).filter(Boolean).join(', ')||'Archivo local'):item.titulo;return <Card className="multimedia-card" key={item.id_multimedia}><div className="multimedia-preview"><button className="multimedia-open-button" type="button" onClick={()=>setViewerIndex(index)}>{item.tipo_archivo==='VIDEO'?<span className="multimedia-video-placeholder"><FileVideo2 size={34}/><small>Toca para reproducir</small></span>:<img src={item.thumbnail_url||item.secure_url} alt={title} loading="lazy" decoding="async" onError={(event)=>{if(event.currentTarget.src!==item.secure_url)event.currentTarget.src=item.secure_url;}}/>}</button>{pending?<span className="multimedia-sync-pending" title="Pendiente de sincronizar" aria-label="Pendiente de sincronizar"><CloudOff size={15}/></span>:null}<div className="multimedia-top-actions"><Badge tone={item.categoria==='MOVIMIENTOS'?'info':item.categoria==='PARTOS'?'success':'neutral'}>{categoryIcon(item)}</Badge>{item.editable&&hasPermission('IMAGEN_ADMINISTRAR')?<><IconButton label="Editar fecha y etiquetas" onClick={()=>beginEdit(item)}><Pencil size={16}/></IconButton><IconButton className="detail-action-danger" label="Eliminar archivo" onClick={()=>setDeleteItem(item)}><Trash2 size={16}/></IconButton></>:null}</div><div className="multimedia-bottom-overlay"><strong>{title}</strong><small>{item.subcategoria} · {formatDate(item.fecha_toma||item.created_at)}</small></div></div></Card>;})}</div>:<EmptyState icon={ImagePlus} title="No hay archivos" description="Modifica la categoría o los filtros, o agrega nuevas fotografías."/>}
    {query.hasNextPage||query.isFetchingNextPage?<div ref={loadMoreRef} className="multimedia-auto-loader" aria-live="polite">{query.isFetchingNextPage?<span>Cargando más archivos…</span>:null}</div>:null}
    {viewerIndex!==null?<ImageLightbox items={viewerItems} initialIndex={viewerIndex} onClose={()=>setViewerIndex(null)} minimalControls/>:null}
    {uploadFile?<Modal title="Subir archivo multimedia" wide onClose={()=>setUploadFile(null)} footer={<><Button variant="ghost" onClick={()=>setUploadFile(null)}>Cancelar</Button><Button disabled={!uploadIds.length||!uploadDate} loading={upload.isPending} onClick={()=>upload.mutate()}>Guardar archivo</Button></>}><div className="media-upload-layout"><MediaFilePreview file={uploadFile}/><div className="form-stack"><Field label="Fecha de toma" required><Input type="date" value={uploadDate} onChange={(event)=>setUploadDate(event.target.value)}/></Field><TagPicker value={uploadTags} onChange={setUploadTags} tags={tags.data??[]}/><Field label="Animales relacionados" required hint="La foto o video aparecerá en la ficha de todos los animales seleccionados."><AnimalMultiPicker value={uploadIds} onChange={setUploadIds}/></Field></div></div></Modal>:null}
    {editing?<Modal title="Editar archivo multimedia" wide onClose={()=>setEditing(null)} footer={<><Button variant="ghost" onClick={()=>setEditing(null)}>Cancelar</Button><Button disabled={(!editing.es_perfil&&!editIds.length)||!editDate} loading={update.isPending} onClick={()=>update.mutate()}>Guardar cambios</Button></>}><div className="form-stack"><Field label="Fecha de toma" required><Input type="date" value={editDate} onChange={(event)=>setEditDate(event.target.value)}/></Field><TagPicker value={editTags} onChange={setEditTags} tags={tags.data??[]}/>{editing.es_perfil?<p className="muted">La foto de perfil continuará vinculada únicamente a su animal.</p>:<Field label="Animales relacionados" required><AnimalMultiPicker value={editIds} onChange={setEditIds}/></Field>}</div></Modal>:null}
    {deleteItem?<ConfirmDialog title="Eliminar archivo" message="Se eliminará de Multimedia y de todas las fichas de animales relacionadas." onClose={()=>setDeleteItem(null)} onConfirm={()=>remove.mutate()} loading={remove.isPending}/>:null}
    {hasPermission('IMAGEN_ADMINISTRAR')?<FloatingActionDock><IconButton label="Agregar fotografía o video" onClick={()=>fileRef.current?.click()}><Plus size={23}/></IconButton></FloatingActionDock>:null}
  </div>;
}

function LocationFilter({label,value,onChange,options}:{label:string;value:string;onChange:(value:string)=>void;options?:AnimalFilterOptions}){return <Field label={label}><Select value={value} onChange={(event)=>onChange(event.target.value)}><option value="">Todas las ubicaciones</option>{options?.ubicaciones.map((item)=><option key={item.id_ubicacion} value={item.id_ubicacion}>{item.nombre} · {humanizeCode(item.tipo)}</option>)}</Select></Field>;}
function TagPicker({value,onChange,tags}:{value:string[];onChange:(ids:string[])=>void;tags:CatalogItem[]}){return <Field label="Etiquetas" hint="Puedes seleccionar varias."><div className="tag-picker">{tags.filter((item)=>item.activo!==false).map((item)=>{const id=itemId(item);return <label key={id} className={value.includes(id)?'selected':''}><input type="checkbox" checked={value.includes(id)} onChange={(event)=>onChange(event.target.checked?[...value,id]:value.filter((current)=>current!==id))}/>{itemLabel(item)}</label>;})}</div></Field>;}
function MediaFilePreview({file}:{file:File}){const [url,setUrl]=useState('');useEffect(()=>{const next=URL.createObjectURL(file);setUrl(next);return()=>URL.revokeObjectURL(next);},[file]);return <div className="media-upload-preview">{file.type.startsWith('video/')?<video src={url} controls/>:<img src={url} alt="Vista previa"/>}<strong>{file.name}</strong></div>;}
