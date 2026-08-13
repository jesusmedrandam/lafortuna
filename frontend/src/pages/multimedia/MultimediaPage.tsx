import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Baby, ChevronLeft, ChevronRight, FileVideo2, ImagePlus, Images, MapPinned, Paintbrush, Pencil, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest, apiRequestWithMeta, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AnimalMultiPicker } from '../../components/AnimalMultiPicker';
import { ImageLightbox, type LightboxMedia } from '../../components/ImageLightbox';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, IconButton, Input, LoadingState, Modal, PageHeader, SearchBox, Select } from '../../components/ui';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { itemId, itemLabel, useCatalog } from '../../hooks/useCatalog';
import type { Animal, AnimalFilterOptions, CatalogItem, MultimediaItem } from '../../types/api';
import { currentDateInput, formatDate, humanizeCode } from '../../utils';

const pageSize=24;
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
  const page=Math.max(1,Number(params.get('page')??1));
  const order=params.get('orden')??'NEWEST';
  const filters=Object.fromEntries(filterKeys.map((key)=>[key,params.get(key)??''])) as Record<(typeof filterKeys)[number],string>;
  const category=filters.categoria;
  const activeCount=filterKeys.filter((key)=>Boolean(filters[key])).length;

  const options=useQuery({queryKey:['animal-filter-options'],queryFn:()=>apiRequest<AnimalFilterOptions>('/animales/opciones/filtros'),staleTime:10*60_000});
  const tags=useCatalog('etiquetas-multimedia');
  const activityTypes=useCatalog('tipos-actividad');
  const animals=useQuery({queryKey:['animals','multimedia-filter'],queryFn:()=>apiRequest<Animal[]>('/animales?limit=100'),enabled:advancedOpen&&['ANIMALES','PARTOS','ACTIVIDADES'].includes(category)});
  const query=useQuery({
    queryKey:['multimedia',page,debounced,filters,order],
    queryFn:()=>{const queryParams=new URLSearchParams({page:String(page),limit:String(pageSize),orden:order});if(debounced)queryParams.set('q',debounced);filterKeys.forEach((key)=>{if(filters[key])queryParams.set(key,filters[key]);});return apiRequestWithMeta<MultimediaItem[]>(`/imagenes/multimedia?${queryParams}`);},
    placeholderData:(previous)=>previous,
  });
  const total=Number(query.data?.meta?.total??0);
  const pages=Math.max(1,Math.ceil(total/pageSize));
  const items=query.data?.data??[];
  const viewerItems=useMemo<LightboxMedia[]>(()=>items.map((item)=>({key:item.id_multimedia,url:item.secure_url,type:item.tipo_archivo,title:item.titulo,subtitle:[item.subcategoria,item.subtitulo].filter(Boolean).join(' · '),date:item.fecha_toma,filename:item.nombre_original})),[items]);

  const setParam=(key:string,value:string)=>{const next=new URLSearchParams(params);if(value)next.set(key,value);else next.delete(key);if(key!=='page')next.set('page','1');setParams(next);};
  const setCategory=(value:string)=>{const next=new URLSearchParams(params);contextualKeys.forEach((key)=>next.delete(key));if(value)next.set('categoria',value);else next.delete('categoria');next.set('page','1');setParams(next);};
  const clearFilters=()=>{const next=new URLSearchParams(params);filterKeys.forEach((key)=>next.delete(key));next.set('page','1');setParams(next);};

  const upload=useMutation({mutationFn:async()=>{if(!uploadFile||!uploadIds.length)throw new Error('Selecciona un archivo y al menos un animal.');const data=new FormData();data.set('archivo',uploadFile);data.set('es_perfil','false');data.set('id_animales',JSON.stringify(uploadIds));data.set('fecha_toma',uploadDate);data.set('id_etiquetas',JSON.stringify(uploadTags));return apiRequest(`/animales/${uploadIds[0]}/imagenes`,{method:'POST',body:data});},onSuccess:()=>{toast.show('Archivo subido correctamente.');setUploadFile(null);setUploadIds([]);setUploadTags([]);setUploadDate(currentDateInput());void client.invalidateQueries({queryKey:['multimedia']});},onError:(error)=>toast.show(error instanceof ApiError?error.message:(error as Error).message,'error')});
  const update=useMutation({mutationFn:()=>apiRequest(`/imagenes/${editing?.id_origen}`,{method:'PATCH',body:{...(editing?.es_perfil?{}:{id_animales:editIds}),fecha_toma:editDate,id_etiquetas:editTags}}),onSuccess:()=>{toast.show('Datos de la fotografía actualizados.');setEditing(null);void client.invalidateQueries({queryKey:['multimedia']});void client.invalidateQueries({queryKey:['animal']});},onError:(error)=>toast.show((error as ApiError).message,'error')});
  const remove=useMutation({mutationFn:()=>apiRequest(`/imagenes/${deleteItem?.id_origen}`,{method:'DELETE'}),onSuccess:()=>{toast.show('Archivo eliminado.');setDeleteItem(null);setViewerIndex(null);void client.invalidateQueries({queryKey:['multimedia']});void client.invalidateQueries({queryKey:['animal']});},onError:(error)=>toast.show((error as ApiError).message,'error')});
  const beginEdit=(item:MultimediaItem)=>{if(item.es_perfil||!item.editable)return;setEditing(item);setEditIds(item.animales?.map((animal)=>animal.id_animal)??[]);setEditDate(item.fecha_toma||currentDateInput());setEditTags(item.etiquetas?.map((tag)=>tag.id_etiqueta)??[]);};

  return <div>
    <input ref={fileRef} hidden type="file" accept="image/*,video/*" onChange={(event)=>{const file=event.target.files?.[0]??null;setUploadFile(file);setUploadIds([]);event.currentTarget.value='';}}/>
    <PageHeader title="Multimedia" description="Archivo visual de animales, partos, actividades, limpiezas y cambios de potrero." action={hasPermission('IMAGEN_ADMINISTRAR')?<IconButton label="Subir archivo de animales" onClick={()=>fileRef.current?.click()}><Plus size={20}/></IconButton>:undefined}/>
    <div className="category-filter-bar" aria-label="Categoría multimedia">{categories.map(([value,label])=><button key={label} type="button" className={category===value?'active':''} onClick={()=>setCategory(value)}>{label}</button>)}</div>
    <div className="toolbar animal-search-toolbar"><SearchBox value={search} onChange={(value)=>{setSearch(value);setParam('q',value);}} placeholder="Buscar archivo, animal, potrero o actividad…"/><div className="toolbar-filters"><Select aria-label="Ordenar archivos" value={order} onChange={(event)=>setParam('orden',event.target.value)}><option value="NEWEST">Más recientes</option><option value="OLDEST">Más antiguos</option><option value="AZ">Nombre A–Z</option><option value="ZA">Nombre Z–A</option></Select><Select aria-label="Tipo de archivo" value={filters.tipo} onChange={(event)=>setParam('tipo',event.target.value)}><option value="">Fotos y videos</option><option value="IMAGEN">Solo fotos</option><option value="VIDEO">Solo videos</option></Select><IconButton label="Filtros avanzados" onClick={()=>setAdvancedOpen((value)=>!value)}><SlidersHorizontal size={18}/>{activeCount?<span className="filter-count">{activeCount}</span>:null}</IconButton></div></div>
    {advancedOpen?<section className="advanced-filters"><div className="advanced-filters-heading"><div><h2>Filtros de {categories.find(([value])=>value===category)?.[1].toLowerCase()??'multimedia'}</h2><p>Solo aparecen los campos que tienen sentido para la categoría elegida.</p></div><div className="advanced-filter-actions"><IconButton label="Limpiar filtros" disabled={!activeCount} onClick={clearFilters}><Paintbrush size={17}/></IconButton><IconButton label="Cerrar filtros" onClick={()=>setAdvancedOpen(false)}><X size={18}/></IconButton></div></div><div className="advanced-filters-grid">
      {['ANIMALES','PARTOS','ACTIVIDADES'].includes(category)?<Field label="Animal"><Select value={filters.id_animal} onChange={(event)=>setParam('id_animal',event.target.value)}><option value="">Todos los animales</option>{animals.data?.map((animal)=><option key={animal.id_animal} value={animal.id_animal}>{animal.nombre}{animal.codigo_arete?` · ${animal.codigo_arete}`:''}</option>)}</Select></Field>:null}
      {category==='ANIMALES'?<><Field label="Grupo"><Select value={filters.id_grupo} onChange={(event)=>setParam('id_grupo',event.target.value)}><option value="">Todos los grupos</option>{options.data?.grupos.map((item)=><option key={item.id_grupo} value={item.id_grupo}>{item.nombre}</option>)}</Select></Field><LocationFilter label="Corral o potrero" value={filters.id_ubicacion} onChange={(value)=>setParam('id_ubicacion',value)} options={options.data}/><Field label="Sexo"><Select value={filters.sexo} onChange={(event)=>setParam('sexo',event.target.value)}><option value="">Todos</option><option value="HEMBRA">Hembras</option><option value="MACHO">Machos</option></Select></Field><Field label="Etiqueta"><Select value={filters.id_etiqueta} onChange={(event)=>setParam('id_etiqueta',event.target.value)}><option value="">Todas las etiquetas</option>{tags.data?.filter((item)=>item.activo!==false).map((item)=><option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field></>:null}
      {category==='MOVIMIENTOS'?<><LocationFilter label="Potrero de origen" value={filters.id_ubicacion_origen} onChange={(value)=>setParam('id_ubicacion_origen',value)} options={options.data}/><LocationFilter label="Potrero de destino" value={filters.id_ubicacion_destino} onChange={(value)=>setParam('id_ubicacion_destino',value)} options={options.data}/><Field label="Fotografía del"><Select value={filters.lado} onChange={(event)=>setParam('lado',event.target.value)}><option value="">Origen y destino</option><option value="ORIGEN">Origen</option><option value="DESTINO">Destino</option></Select></Field></>:null}
      {category==='ACTIVIDADES'?<Field label="Tipo de actividad"><Select value={filters.id_tipo_actividad} onChange={(event)=>setParam('id_tipo_actividad',event.target.value)}><option value="">Todas las actividades</option>{activityTypes.data?.filter((item)=>item.activo!==false).map((item)=><option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>:null}
      {category==='LIMPIEZAS'?<LocationFilter label="Potrero" value={filters.id_ubicacion} onChange={(value)=>setParam('id_ubicacion',value)} options={options.data}/>:null}
      <Field label="Fotos de perfil"><Select value={filters.perfil} onChange={(event)=>setParam('perfil',event.target.value)}><option value="">Todas</option><option value="SI">Solo fotos de perfil</option><option value="NO">Excluir fotos de perfil</option></Select></Field><Field label="Tomada desde"><Input type="date" value={filters.fecha_desde} max={filters.fecha_hasta||undefined} onChange={(event)=>setParam('fecha_desde',event.target.value)}/></Field><Field label="Tomada hasta"><Input type="date" value={filters.fecha_hasta} min={filters.fecha_desde||undefined} onChange={(event)=>setParam('fecha_hasta',event.target.value)}/></Field>
    </div><div className="advanced-filters-footer"><span>{activeCount?`${activeCount} filtros activos`:'Sin filtros aplicados'}</span></div></section>:null}
    {query.isLoading?<LoadingState/>:query.isError?<ErrorState message={(query.error as Error).message} onRetry={()=>void query.refetch()}/>:items.length?<><div className="multimedia-grid">{items.map((item,index)=><Card className="multimedia-card" key={item.id_multimedia}><div className="multimedia-preview"><button className="multimedia-open-button" type="button" onClick={()=>setViewerIndex(index)}>{item.tipo_archivo==='VIDEO'?<video src={item.secure_url} muted preload="metadata"/>:<img src={item.secure_url} alt={item.titulo}/>}</button><div className="multimedia-top-actions"><Badge tone={item.categoria==='MOVIMIENTOS'?'info':item.categoria==='PARTOS'?'success':'neutral'}>{categoryIcon(item)}</Badge>{item.editable&&hasPermission('IMAGEN_ADMINISTRAR')?<><IconButton label="Editar fecha y etiquetas" onClick={()=>beginEdit(item)}><Pencil size={16}/></IconButton><IconButton className="detail-action-danger" label="Eliminar archivo" onClick={()=>setDeleteItem(item)}><Trash2 size={16}/></IconButton></>:null}</div><div className="multimedia-bottom-overlay"><strong>{item.titulo}</strong><small>{item.subcategoria} · {formatDate(item.fecha_toma||item.created_at)}</small></div></div></Card>)}</div><div className="pagination"><span>{total} archivos · página {page} de {pages}</span><div><Button variant="ghost" disabled={page<=1} onClick={()=>setParam('page',String(page-1))}><ChevronLeft size={18}/>Anterior</Button><Button variant="ghost" disabled={page>=pages} onClick={()=>setParam('page',String(page+1))}>Siguiente<ChevronRight size={18}/></Button></div></div></>:<EmptyState icon={ImagePlus} title="No hay archivos" description="Modifica la categoría o los filtros, o agrega nuevas fotografías."/>}
    {viewerIndex!==null?<ImageLightbox items={viewerItems} initialIndex={viewerIndex} onClose={()=>setViewerIndex(null)} actions={(media)=>{const item=items.find((candidate)=>candidate.id_multimedia===media.key);return item?.editable&&!item.es_perfil&&hasPermission('IMAGEN_ADMINISTRAR')?<div className="lightbox-actions"><Button variant="secondary" onClick={()=>{setViewerIndex(null);beginEdit(item);}}><Pencil size={17}/>Editar relaciones y etiquetas</Button><IconButton className="detail-action-danger" label="Eliminar fotografía" onClick={()=>{setViewerIndex(null);setDeleteItem(item);}}><Trash2 size={18}/></IconButton></div>:null;}}/>:null}
    {uploadFile?<Modal title="Subir archivo multimedia" wide onClose={()=>setUploadFile(null)} footer={<><Button variant="ghost" onClick={()=>setUploadFile(null)}>Cancelar</Button><Button disabled={!uploadIds.length||!uploadDate} loading={upload.isPending} onClick={()=>upload.mutate()}>Guardar archivo</Button></>}><div className="media-upload-layout"><MediaFilePreview file={uploadFile}/><div className="form-stack"><Field label="Fecha de toma" required><Input type="date" value={uploadDate} onChange={(event)=>setUploadDate(event.target.value)}/></Field><TagPicker value={uploadTags} onChange={setUploadTags} tags={tags.data??[]}/><Field label="Animales relacionados" required hint="La foto o video aparecerá en la ficha de todos los animales seleccionados."><AnimalMultiPicker value={uploadIds} onChange={setUploadIds}/></Field></div></div></Modal>:null}
    {editing?<Modal title="Editar archivo multimedia" wide onClose={()=>setEditing(null)} footer={<><Button variant="ghost" onClick={()=>setEditing(null)}>Cancelar</Button><Button disabled={(!editing.es_perfil&&!editIds.length)||!editDate} loading={update.isPending} onClick={()=>update.mutate()}>Guardar cambios</Button></>}><div className="form-stack"><Field label="Fecha de toma" required><Input type="date" value={editDate} onChange={(event)=>setEditDate(event.target.value)}/></Field><TagPicker value={editTags} onChange={setEditTags} tags={tags.data??[]}/>{editing.es_perfil?<p className="muted">La foto de perfil continuará vinculada únicamente a su animal.</p>:<Field label="Animales relacionados" required><AnimalMultiPicker value={editIds} onChange={setEditIds}/></Field>}</div></Modal>:null}
    {deleteItem?<ConfirmDialog title="Eliminar archivo" message="Se eliminará de Multimedia y de todas las fichas de animales relacionadas." onClose={()=>setDeleteItem(null)} onConfirm={()=>remove.mutate()} loading={remove.isPending}/>:null}
  </div>;
}

function LocationFilter({label,value,onChange,options}:{label:string;value:string;onChange:(value:string)=>void;options?:AnimalFilterOptions}){return <Field label={label}><Select value={value} onChange={(event)=>onChange(event.target.value)}><option value="">Todas las ubicaciones</option>{options?.ubicaciones.map((item)=><option key={item.id_ubicacion} value={item.id_ubicacion}>{item.nombre} · {humanizeCode(item.tipo)}</option>)}</Select></Field>;}
function TagPicker({value,onChange,tags}:{value:string[];onChange:(ids:string[])=>void;tags:CatalogItem[]}){return <Field label="Etiquetas" hint="Puedes seleccionar varias."><div className="tag-picker">{tags.filter((item)=>item.activo!==false).map((item)=>{const id=itemId(item);return <label key={id} className={value.includes(id)?'selected':''}><input type="checkbox" checked={value.includes(id)} onChange={(event)=>onChange(event.target.checked?[...value,id]:value.filter((current)=>current!==id))}/>{itemLabel(item)}</label>;})}</div></Field>;}
function MediaFilePreview({file}:{file:File}){const [url,setUrl]=useState('');useEffect(()=>{const next=URL.createObjectURL(file);setUrl(next);return()=>URL.revokeObjectURL(next);},[file]);return <div className="media-upload-preview">{file.type.startsWith('video/')?<video src={url} controls/>:<img src={url} alt="Vista previa"/>}<strong>{file.name}</strong></div>;}
