import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileVideo2, ImagePlus, Images, Paintbrush, Pencil, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest, apiRequestWithMeta, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AnimalMultiPicker } from '../../components/AnimalMultiPicker';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, IconButton, Input, LoadingState, Modal, PageHeader, SearchBox, Select } from '../../components/ui';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { itemId, itemLabel, useCatalog } from '../../hooks/useCatalog';
import type { Animal, AnimalFilterOptions, AnimalImage } from '../../types/api';
import { currentDateInput, formatDate, humanizeCode } from '../../utils';

const pageSize=24;
const filterKeys=['tipo','id_animal','id_grupo','id_ubicacion','id_etiqueta','sexo','fecha_desde','fecha_hasta'] as const;

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
  const [editing,setEditing]=useState<AnimalImage|null>(null);
  const [editIds,setEditIds]=useState<string[]>([]);
  const [editDate,setEditDate]=useState('');
  const [editTags,setEditTags]=useState<string[]>([]);
  const [deleteItem,setDeleteItem]=useState<AnimalImage|null>(null);
  const page=Math.max(1,Number(params.get('page')??1));
  const order=params.get('orden')??'NEWEST';
  const filters=Object.fromEntries(filterKeys.map((key)=>[key,params.get(key)??''])) as Record<(typeof filterKeys)[number],string>;
  const activeCount=filterKeys.filter((key)=>Boolean(filters[key])).length;

  const options=useQuery({queryKey:['animal-filter-options'],queryFn:()=>apiRequest<AnimalFilterOptions>('/animales/opciones/filtros'),staleTime:10*60_000});
  const tags=useCatalog('etiquetas-multimedia');
  const animals=useQuery({queryKey:['animals','multimedia-filter'],queryFn:()=>apiRequest<Animal[]>('/animales?limit=100'),enabled:advancedOpen});
  const query=useQuery({
    queryKey:['multimedia',page,debounced,filters,order],
    queryFn:()=>{const queryParams=new URLSearchParams({page:String(page),limit:String(pageSize),orden:order});if(debounced)queryParams.set('q',debounced);filterKeys.forEach((key)=>{if(filters[key])queryParams.set(key,filters[key]);});return apiRequestWithMeta<AnimalImage[]>(`/imagenes?${queryParams}`);},
    placeholderData:(previous)=>previous,
  });
  const total=Number(query.data?.meta?.total??0);
  const pages=Math.max(1,Math.ceil(total/pageSize));
  const setParam=(key:string,value:string)=>{const next=new URLSearchParams(params);if(value)next.set(key,value);else next.delete(key);if(key!=='page')next.set('page','1');setParams(next);};
  const clearFilters=()=>{const next=new URLSearchParams(params);filterKeys.forEach((key)=>next.delete(key));next.set('page','1');setParams(next);};

  const upload=useMutation({
    mutationFn:async()=>{if(!uploadFile||!uploadIds.length)throw new Error('Selecciona un archivo y al menos un animal.');const data=new FormData();data.set('archivo',uploadFile);data.set('es_perfil','false');data.set('id_animales',JSON.stringify(uploadIds));data.set('fecha_toma',uploadDate);data.set('id_etiquetas',JSON.stringify(uploadTags));return apiRequest<AnimalImage>(`/animales/${uploadIds[0]}/imagenes`,{method:'POST',body:data});},
    onSuccess:()=>{toast.show('Archivo subido correctamente.');setUploadFile(null);setUploadIds([]);setUploadTags([]);setUploadDate(currentDateInput());void client.invalidateQueries({queryKey:['multimedia']});},
    onError:(error)=>toast.show(error instanceof ApiError?error.message:(error as Error).message,'error'),
  });
  const update=useMutation({
    mutationFn:()=>apiRequest<AnimalImage>(`/imagenes/${editing?.id_imagen}`,{method:'PATCH',body:{...(editing?.es_perfil?{}:{id_animales:editIds}),fecha_toma:editDate,id_etiquetas:editTags}}),
    onSuccess:()=>{toast.show('Datos de la fotografía actualizados.');setEditing(null);void client.invalidateQueries({queryKey:['multimedia']});void client.invalidateQueries({queryKey:['animal']});},
    onError:(error)=>toast.show((error as ApiError).message,'error'),
  });
  const remove=useMutation({
    mutationFn:()=>apiRequest(`/imagenes/${deleteItem?.id_imagen}`,{method:'DELETE'}),
    onSuccess:()=>{toast.show('Archivo eliminado.');setDeleteItem(null);void client.invalidateQueries({queryKey:['multimedia']});void client.invalidateQueries({queryKey:['animal']});},
    onError:(error)=>toast.show((error as ApiError).message,'error'),
  });

  return <div>
    <input ref={fileRef} hidden type="file" accept="image/*,video/*" onChange={(event)=>{const file=event.target.files?.[0]??null;setUploadFile(file);setUploadIds([]);event.currentTarget.value='';}}/>
    <PageHeader title="Multimedia" description="Archivo central de fotografías y videos relacionados con los animales." action={hasPermission('IMAGEN_ADMINISTRAR')?<IconButton label="Subir archivo" onClick={()=>fileRef.current?.click()}><Plus size={20}/></IconButton>:undefined}/>
    <div className="toolbar animal-search-toolbar"><SearchBox value={search} onChange={(value)=>{setSearch(value);setParam('q',value);}} placeholder="Buscar por animal, arete o archivo…"/><div className="toolbar-filters"><Select aria-label="Ordenar archivos" value={order} onChange={(event)=>setParam('orden',event.target.value)}><option value="NEWEST">Más recientes</option><option value="OLDEST">Más antiguos</option><option value="AZ">Archivo A–Z</option><option value="ZA">Archivo Z–A</option></Select><Select aria-label="Tipo de archivo" value={filters.tipo} onChange={(event)=>setParam('tipo',event.target.value)}><option value="">Fotos y videos</option><option value="IMAGEN">Solo fotos</option><option value="VIDEO">Solo videos</option></Select><Select aria-label="Sexo" value={filters.sexo} onChange={(event)=>setParam('sexo',event.target.value)}><option value="">Todos</option><option value="HEMBRA">Hembras</option><option value="MACHO">Machos</option></Select><Select aria-label="Grupo" value={filters.id_grupo} onChange={(event)=>setParam('id_grupo',event.target.value)}><option value="">Todos los grupos</option>{options.data?.grupos.map((item)=><option key={item.id_grupo} value={item.id_grupo}>{item.nombre}</option>)}</Select><IconButton label="Filtros avanzados" onClick={()=>setAdvancedOpen((value)=>!value)}><SlidersHorizontal size={18}/>{activeCount?<span className="filter-count">{activeCount}</span>:null}</IconButton></div></div>
    {advancedOpen?<section className="advanced-filters"><div className="advanced-filters-heading"><div><h2>Búsqueda avanzada</h2><p>Encuentra archivos por animal, ubicación y fecha.</p></div><div className="advanced-filter-actions"><IconButton label="Limpiar filtros" disabled={!activeCount} onClick={clearFilters}><Paintbrush size={17}/></IconButton><IconButton label="Cerrar filtros" onClick={()=>setAdvancedOpen(false)}><X size={18}/></IconButton></div></div><div className="advanced-filters-grid">
      <Field label="Animal"><Select value={filters.id_animal} onChange={(event)=>setParam('id_animal',event.target.value)}><option value="">Todos los animales</option>{animals.data?.map((animal)=><option key={animal.id_animal} value={animal.id_animal}>{animal.nombre}{animal.codigo_arete?` · ${animal.codigo_arete}`:''}</option>)}</Select></Field>
      <Field label="Corral o potrero"><Select value={filters.id_ubicacion} onChange={(event)=>setParam('id_ubicacion',event.target.value)}><option value="">Todas las ubicaciones</option>{options.data?.ubicaciones.map((item)=><option key={item.id_ubicacion} value={item.id_ubicacion}>{item.nombre} · {humanizeCode(item.tipo)}</option>)}</Select></Field>
      <Field label="Etiqueta"><Select value={filters.id_etiqueta} onChange={(event)=>setParam('id_etiqueta',event.target.value)}><option value="">Todas las etiquetas</option>{tags.data?.filter((item)=>item.activo!==false).map((item)=><option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
      <Field label="Tomada desde"><Input type="date" value={filters.fecha_desde} max={filters.fecha_hasta||undefined} onChange={(event)=>setParam('fecha_desde',event.target.value)}/></Field>
      <Field label="Tomada hasta"><Input type="date" value={filters.fecha_hasta} min={filters.fecha_desde||undefined} onChange={(event)=>setParam('fecha_hasta',event.target.value)}/></Field>
    </div><div className="advanced-filters-footer"><span>{activeCount?`${activeCount} filtros activos`:'Sin filtros aplicados'}</span></div></section>:null}
    {query.isLoading?<LoadingState/>:query.isError?<ErrorState message={(query.error as Error).message} onRetry={()=>void query.refetch()}/>:query.data?.data.length?<><div className="multimedia-grid">{query.data.data.map((item)=>{const animalTitle=item.animales?.[0]?.nombre||'Sin animal relacionado';return <Card className="multimedia-card" key={item.id_imagen}><div className="multimedia-preview">{item.tipo_archivo==='VIDEO'?<video src={item.secure_url} controls preload="metadata"/>:<a href={item.secure_url} target="_blank" rel="noreferrer"><img src={item.secure_url} alt={animalTitle}/></a>}<div className="multimedia-top-actions"><Badge tone={item.tipo_archivo==='VIDEO'?'info':'neutral'}>{item.tipo_archivo==='VIDEO'?<FileVideo2 size={15}/>:<Images size={15}/>}</Badge>{hasPermission('IMAGEN_ADMINISTRAR')?<><IconButton label="Editar fecha y etiquetas" onClick={()=>{setEditing(item);setEditIds(item.animales?.map((animal)=>animal.id_animal)??[]);setEditDate(item.fecha_toma||currentDateInput());setEditTags(item.etiquetas?.map((tag)=>tag.id_etiqueta)??[]);}}><Pencil size={16}/></IconButton><IconButton className="detail-action-danger" label="Eliminar archivo" onClick={()=>setDeleteItem(item)}><Trash2 size={16}/></IconButton></>:null}</div><div className="multimedia-bottom-overlay"><strong>{animalTitle}</strong><small>{formatDate(item.fecha_toma||item.created_at)}</small><span className="media-tags">{item.etiquetas?.slice(0,3).map((tag)=><em key={tag.id_etiqueta}>{tag.nombre}</em>)}</span></div></div></Card>;})}</div><div className="pagination"><span>{total} archivos · página {page} de {pages}</span><div><Button variant="ghost" disabled={page<=1} onClick={()=>setParam('page',String(page-1))}><ChevronLeft size={18}/>Anterior</Button><Button variant="ghost" disabled={page>=pages} onClick={()=>setParam('page',String(page+1))}>Siguiente<ChevronRight size={18}/></Button></div></div></>:<EmptyState icon={ImagePlus} title="No hay archivos" description="Sube la primera fotografía o video, o modifica los filtros."/>}
    {uploadFile?<Modal title="Subir archivo multimedia" wide onClose={()=>setUploadFile(null)} footer={<><Button variant="ghost" onClick={()=>setUploadFile(null)}>Cancelar</Button><Button disabled={!uploadIds.length||!uploadDate} loading={upload.isPending} onClick={()=>upload.mutate()}>Guardar archivo</Button></>}><div className="media-upload-layout"><MediaFilePreview file={uploadFile}/><div className="form-stack"><Field label="Fecha de toma" required><Input type="date" value={uploadDate} onChange={(event)=>setUploadDate(event.target.value)}/></Field><TagPicker value={uploadTags} onChange={setUploadTags} tags={tags.data??[]}/><Field label="Animales relacionados" required hint="La foto o video aparecerá en la ficha de todos los animales seleccionados."><AnimalMultiPicker value={uploadIds} onChange={setUploadIds}/></Field></div></div></Modal>:null}
    {editing?<Modal title="Editar archivo multimedia" wide onClose={()=>setEditing(null)} footer={<><Button variant="ghost" onClick={()=>setEditing(null)}>Cancelar</Button><Button disabled={(!editing.es_perfil&&!editIds.length)||!editDate} loading={update.isPending} onClick={()=>update.mutate()}>Guardar cambios</Button></>}><div className="form-stack"><Field label="Fecha de toma" required><Input type="date" value={editDate} onChange={(event)=>setEditDate(event.target.value)}/></Field><TagPicker value={editTags} onChange={setEditTags} tags={tags.data??[]}/>{editing.es_perfil?<p className="muted">La foto de perfil continuará vinculada únicamente a su animal.</p>:<Field label="Animales relacionados" required><AnimalMultiPicker value={editIds} onChange={setEditIds}/></Field>}</div></Modal>:null}
    {deleteItem?<ConfirmDialog title="Eliminar archivo" message="Se eliminará de Multimedia y de todas las fichas de animales relacionadas." onClose={()=>setDeleteItem(null)} onConfirm={()=>remove.mutate()} loading={remove.isPending}/>:null}
  </div>;
}

function TagPicker({value,onChange,tags}:{value:string[];onChange:(ids:string[])=>void;tags:import('../../types/api').CatalogItem[]}){
  return <Field label="Etiquetas" hint="Puedes seleccionar varias."><div className="tag-picker">{tags.filter((item)=>item.activo!==false).map((item)=>{const id=itemId(item);return <label key={id} className={value.includes(id)?'selected':''}><input type="checkbox" checked={value.includes(id)} onChange={(event)=>onChange(event.target.checked?[...value,id]:value.filter((current)=>current!==id))}/>{itemLabel(item)}</label>;})}</div></Field>;
}

function MediaFilePreview({file}:{file:File}){
  const [url,setUrl]=useState('');
  useEffect(()=>{const next=URL.createObjectURL(file);setUrl(next);return()=>URL.revokeObjectURL(next);},[file]);
  return <div className="media-upload-preview">{file.type.startsWith('video/')?<video src={url} controls/>:<img src={url} alt="Vista previa"/>}<strong>{file.name}</strong></div>;
}
