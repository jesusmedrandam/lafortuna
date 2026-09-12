import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, Edit3, HeartOff, ImagePlus, MapPin, Plus, Search, Trash2, Weight } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { ImageLightbox } from '../../components/ImageLightbox';
import { AnimalSelect, animalOption, useAnimalDirectory } from '../../components/AnimalPicker';
import { isInOwnershipScope, OwnershipScopeFilter, type OwnershipScope } from '../../components/OwnershipScopeFilter';
import { Badge, Button, CompactToolbar, ConfirmDialog, EmptyState, ErrorState, Field, FloatingActionDock, IconButton, Input, LoadingState, Modal, Textarea } from '../../components/ui';
import type { AnimalStatusNews, GenericRecord } from '../../types/api';
import { currentDateInput, dateInputValue, formatDate, formatNumber, nullIfEmpty } from '../../utils';

type Mode = 'pesajes' | 'muertes';
type NewsFilter = 'TODOS' | AnimalStatusNews['tipo'];

interface RecordForm {
  id?: string;
  id_animal: string;
  fecha: string;
  peso: string;
  metodo: string;
  causa: string;
  descripcion: string;
  observaciones: string;
}
const emptyForm = (): RecordForm => ({ id_animal: '', fecha: currentDateInput(), peso: '', metodo: '', causa: '', descripcion: '', observaciones: '' });

export function AnimalRecordsPage({ mode }: { mode: Mode }) {
  const navigate=useNavigate();
  const [searchParams]=useSearchParams();
  const consumedDetail=useRef(false);
  const initialAnimalId=searchParams.get('animal')??'';
  const { hasPermission } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const [open, setOpen] = useState(searchParams.get('nuevo')==='1'&&Boolean(initialAnimalId));
  const [search,setSearch]=useState('');
  const [newest,setNewest]=useState(true);
  const [ownershipScope, setOwnershipScope] = useState<OwnershipScope>('EN_PROPIEDAD');
  const [form, setForm] = useState<RecordForm>(()=>({...emptyForm(),id_animal:initialAnimalId}));
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [detail,setDetail]=useState<GenericRecord|null>(null);
  const [photo,setPhoto]=useState<File|null>(null);
  const [newsFilter,setNewsFilter]=useState<NewsFilter>('TODOS');
  const [viewer,setViewer]=useState<AnimalStatusNews|null>(null);
  const permission = mode === 'pesajes' ? 'PESAJE_ADMINISTRAR' : 'MUERTE_ADMINISTRAR';
  const idField = mode === 'pesajes' ? 'id_pesaje' : 'id_muerte';
  const records = useQuery({ queryKey: ['records', mode], queryFn: () => apiRequest<GenericRecord[]>(`/registros/${mode}`) });
  const news=useQuery({queryKey:['animal-status-news'],queryFn:()=>apiRequest<AnimalStatusNews[]>('/animales/novedades'),enabled:mode==='muertes'});
  useEffect(()=>{if(consumedDetail.current)return;const id=searchParams.get('registro');if(id&&records.data){const match=records.data.find(record=>String(record[idField])===id);if(match){setDetail(match);consumedDetail.current=true;}}},[idField,records.data,searchParams]);
  const animalDirectory = useAnimalDirectory();
  const visibleRecords = useMemo(()=>{const term=search.trim().toLowerCase();return (mode === 'muertes' ? (records.data ?? []).filter((record) => isInOwnershipScope(String(record.categoria_codigo ?? ''), ownershipScope)) : records.data ?? []).filter((record)=>(!initialAnimalId||String(record.id_animal)===initialAnimalId)&&(!term||`${record.animal??''} ${record.codigo_arete??''} ${record.metodo??''} ${record.causa??''} ${record.descripcion??''}`.toLowerCase().includes(term))).sort((a,b)=>{const aDate=Date.parse(String(mode==='pesajes'?a.fecha_pesaje:a.fecha));const bDate=Date.parse(String(mode==='pesajes'?b.fecha_pesaje:b.fecha));return newest?bDate-aDate:aDate-bDate;});},[initialAnimalId,mode,records.data,ownershipScope,search,newest]);
  const visibleNews=useMemo(()=>{const term=search.trim().toLowerCase();return (news.data??[]).filter((item)=>isInOwnershipScope(item.categoria_codigo??'',ownershipScope)&&(!initialAnimalId||item.id_animal===initialAnimalId)&&(newsFilter==='TODOS'||item.tipo===newsFilter)&&(!term||`${item.animal} ${item.codigo_arete??''} ${item.detalle??''} ${item.ubicacion??''} ${item.grupo??''}`.toLowerCase().includes(term))).sort((a,b)=>newest?Date.parse(b.fecha)-Date.parse(a.fecha):Date.parse(a.fecha)-Date.parse(b.fecha));},[initialAnimalId,news.data,newsFilter,newest,ownershipScope,search]);
  const visibleAnimals = mode === 'muertes' ? animalDirectory.animals.filter((animal) => isInOwnershipScope(animal.categoria_codigo, ownershipScope)) : animalDirectory.animals;

  const save = useMutation({
    mutationFn: () => {
      if (!form.id_animal || !form.fecha) throw new Error('Selecciona un animal y la fecha.');
      const body = mode === 'pesajes'
        ? { id_animal: form.id_animal, fecha_pesaje: form.fecha, peso_kg: Number(form.peso), metodo: nullIfEmpty(form.metodo), observaciones: nullIfEmpty(form.observaciones) }
        : { id_animal: form.id_animal, fecha: form.fecha, causa: nullIfEmpty(form.causa), descripcion: nullIfEmpty(form.descripcion) };
      if (mode === 'pesajes' && (!form.peso || Number(form.peso) <= 0)) throw new Error('Ingresa un peso válido.');
      if(mode==='muertes'&&!form.id&&photo){const data=new FormData();data.set('data',JSON.stringify(body));data.set('imagen',photo);return apiRequest(`/registros/${mode}`,{method:'POST',body:data});}
      return apiRequest(`/registros/${mode}${form.id ? `/${form.id}` : ''}`, { method: form.id ? 'PATCH' : 'POST', body });
    },
    onSuccess: () => { toast.show(form.id ? 'Registro actualizado.' : 'Registro creado.'); setOpen(false); setPhoto(null); setForm({...emptyForm(),id_animal:initialAnimalId}); void client.invalidateQueries({ queryKey: ['records', mode] }); void client.invalidateQueries({ queryKey: ['animals'] }); void client.invalidateQueries({queryKey:['animal',initialAnimalId]}); void client.invalidateQueries({queryKey:['animal-status-news']}); },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });
  const remove = useMutation({ mutationFn: (id: string) => apiRequest(`/registros/${mode}/${id}`, { method: 'DELETE' }), onSuccess: () => { toast.show('Registro eliminado.'); setDeleteId(null); void client.invalidateQueries({ queryKey: ['records', mode] }); void client.invalidateQueries({queryKey:['animal-status-news']}); void client.invalidateQueries({queryKey:['animals']}); }, onError: (error) => toast.show((error as ApiError).message, 'error') });

  const edit = (record: GenericRecord) => {
    const dateValue = mode === 'pesajes' ? record.fecha_pesaje : record.fecha;
    setForm({ id: String(record[idField]), id_animal: String(record.id_animal), fecha: dateInputValue(String(dateValue ?? '')), peso: String(record.peso_kg ?? ''), metodo: String(record.metodo ?? ''), causa: String(record.causa ?? ''), descripcion: String(record.descripcion ?? ''), observaciones: String(record.observaciones ?? '') });
    setPhoto(null);
    setOpen(true);
  };

  const description = mode === 'pesajes' ? 'Historial de peso por animal y fecha.' : 'Animales reportados como desaparecidos, recuperados o muertos.';
  const Icon = mode === 'pesajes' ? Weight : HeartOff;

  const loading=mode==='muertes'?news.isLoading:records.isLoading;
  const queryError=mode==='muertes'?news.error:records.error;
  return <div className="module-no-header"><CompactToolbar search={search} onSearch={setSearch} placeholder={mode==='pesajes'?'Buscar pesaje…':'Buscar animal o novedad…'} count={mode==='muertes'?visibleNews.length:visibleRecords.length} actions={<><IconButton label="Cambiar orden" onClick={()=>setNewest((value)=>!value)}><ArrowUpDown size={19}/></IconButton>{mode==='muertes'?<OwnershipScopeFilter compact value={ownershipScope} onChange={(scope) => { setOwnershipScope(scope); setOpen(false); setPhoto(null); setForm(emptyForm()); }} />:null}</>}/>
    {mode==='muertes'?<div className="animal-news-filters">{(['TODOS','DESAPARECIDO','RECUPERADO','MUERTO'] as NewsFilter[]).map((filter)=><Button key={filter} variant={newsFilter===filter?'primary':'ghost'} onClick={()=>setNewsFilter(filter)}>{filter==='TODOS'?'Todos':filter==='DESAPARECIDO'?'Desaparecidos':filter==='RECUPERADO'?'Recuperados':'Muertos'}</Button>)}</div>:null}
    {loading?<LoadingState/>:queryError?<ErrorState message={(queryError as Error).message} onRetry={()=>void (mode==='muertes'?news.refetch():records.refetch())}/>:mode==='muertes'?(visibleNews.length?<div className="animal-news-list">{visibleNews.map((item)=>{const death=records.data?.find((record)=>String(record.id_muerte)===item.id_registro);return <article className="animal-news-entry" key={item.id_novedad} onClick={()=>navigate(`/animales/${item.id_animal}`)}><button type="button" className="animal-news-photo" onClick={(event)=>{event.stopPropagation();if(item.imagen)setViewer(item);}}>{item.imagen?<img src={item.imagen.secure_url} alt={item.animal}/>:item.tipo==='DESAPARECIDO'?<Search size={23}/>:item.tipo==='RECUPERADO'?<MapPin size={23}/>:<HeartOff size={23}/>}</button><span><strong>{item.animal}</strong><small>{[item.codigo_arete?`Arete ${item.codigo_arete}`:null,item.detalle,item.ubicacion,item.grupo].filter(Boolean).join(' · ')||'Sin detalles adicionales'}</small><small>{formatDate(item.fecha)}{item.usuario?` · ${item.usuario}`:''}</small></span><div className="animal-news-actions"><Badge tone={item.tipo==='RECUPERADO'?'success':item.tipo==='MUERTO'?'danger':'warning'}>{item.tipo==='DESAPARECIDO'?'Desaparecido':item.tipo==='RECUPERADO'?'Recuperado':'Muerto'}</Badge>{death&&hasPermission(permission)?<div className="inline-actions"><IconButton label="Editar muerte" onClick={(event)=>{event.stopPropagation();edit(death);}}><Edit3 size={16}/></IconButton><IconButton label="Eliminar muerte" onClick={(event)=>{event.stopPropagation();setDeleteId(item.id_registro);}}><Trash2 size={16}/></IconButton></div>:null}</div></article>;})}</div>:<EmptyState icon={HeartOff} title="Sin novedades registradas" description={description}/>):visibleRecords.length?<div className="table-card"><div className="table-responsive"><table className="data-table"><thead><tr><th>Animal</th><th>Fecha</th><th>Peso</th><th>Método</th><th>Observaciones</th>{hasPermission(permission)?<th>Acciones</th>:null}</tr></thead><tbody>{visibleRecords.map((record)=><tr key={String(record[idField])}><td><strong>{String(record.animal??'—')}</strong><small>{record.codigo_arete?`Arete ${record.codigo_arete}`:''}</small></td><td>{formatDate(String(record.fecha_pesaje))}</td><td><strong>{formatNumber(record.peso_kg as number|string,3)} kg</strong></td><td>{String(record.metodo??'—')}</td><td>{String(record.observaciones??'—')}</td>{hasPermission(permission)?<td><div className="inline-actions"><Button variant="ghost" onClick={()=>edit(record)}><Edit3 size={16}/></Button><Button variant="ghost" onClick={()=>setDeleteId(String(record[idField]))}><Trash2 size={16}/></Button></div></td>:null}</tr>)}</tbody></table></div></div>:<EmptyState icon={Icon} title="Sin pesajes registrados" description={description}/>}
    {viewer?.imagen?<ImageLightbox items={[{key:viewer.id_novedad,url:viewer.imagen.secure_url,type:'IMAGEN',title:`${viewer.tipo==='RECUPERADO'?'Recuperación':'Registro'} de ${viewer.animal}`,date:viewer.fecha}]} initialIndex={0} onClose={()=>setViewer(null)} minimalControls/>:null}
    {open ? <Modal title={form.id ? `Editar ${mode === 'pesajes' ? 'pesaje' : 'muerte'}` : `Nuevo ${mode === 'pesajes' ? 'pesaje' : 'registro de muerte'}`} onClose={() => {setOpen(false);setPhoto(null);}} footer={<><Button variant="ghost" onClick={() => {setOpen(false);setPhoto(null);}}>Cancelar</Button><Button onClick={() => save.mutate()} loading={save.isPending}>Guardar</Button></>}><div className="form-stack"><Field label="Animal" required><AnimalSelect value={form.id_animal} options={visibleAnimals.map(animalOption)} onChange={(id) => setForm((current) => ({ ...current, id_animal: id }))}/></Field><Field label="Fecha" required><Input type="date" value={form.fecha} onChange={(event) => setForm((current) => ({ ...current, fecha: event.target.value }))} /></Field>{mode === 'pesajes' ? <><Field label="Peso (kg)" required><Input type="number" min="0.001" step="0.001" value={form.peso} onChange={(event) => setForm((current) => ({ ...current, peso: event.target.value }))} /></Field><Field label="Método"><Input value={form.metodo} onChange={(event) => setForm((current) => ({ ...current, metodo: event.target.value }))} /></Field><Field label="Observaciones"><Textarea value={form.observaciones} onChange={(event) => setForm((current) => ({ ...current, observaciones: event.target.value }))} /></Field></> : <><Field label="Causa"><Input value={form.causa} onChange={(event) => setForm((current) => ({ ...current, causa: event.target.value }))} /></Field><Field label="Descripción"><Textarea value={form.descripcion} onChange={(event) => setForm((current) => ({ ...current, descripcion: event.target.value }))} /></Field>{!form.id?<Field label="Fotografía" hint="Opcional. Se admite una sola imagen."><label className="photo-upload-button"><ImagePlus size={18}/>{photo?'Cambiar fotografía':'Seleccionar fotografía'}<input type="file" accept="image/*" onChange={(event)=>{setPhoto(event.target.files?.[0]??null);event.currentTarget.value='';}}/></label>{photo?<small>{photo.name}</small>:null}</Field>:null}</>}</div></Modal> : null}
    {detail?<Modal title={mode==='pesajes'?'Detalle del pesaje':'Detalle de la muerte o baja'} onClose={()=>setDetail(null)} footer={<Button variant="ghost" onClick={()=>setDetail(null)}>Cerrar</Button>}><div className="detail-grid"><div><small>Animal</small><strong>{String(detail.animal??'—')}</strong></div><div><small>Fecha</small><strong>{formatDate(String(mode==='pesajes'?detail.fecha_pesaje:detail.fecha))}</strong></div>{mode==='pesajes'?<><div><small>Peso</small><strong>{formatNumber(detail.peso_kg as number|string,3)} kg</strong></div><div><small>Método</small><strong>{String(detail.metodo??'No registrado')}</strong></div>{detail.observaciones?<div><small>Observaciones</small><strong>{String(detail.observaciones)}</strong></div>:null}</>:<><div><small>Causa</small><strong>{String(detail.causa??'No registrada')}</strong></div><div><small>Descripción</small><strong>{String(detail.descripcion??'No registrada')}</strong></div></>}</div></Modal>:null}
    {deleteId ? <ConfirmDialog title="Eliminar registro" message="¿Deseas eliminar este registro?" onClose={() => setDeleteId(null)} onConfirm={() => remove.mutate(deleteId)} loading={remove.isPending} /> : null}
    {hasPermission(permission)?<FloatingActionDock><IconButton label={mode==='pesajes'?'Nuevo pesaje':'Registrar muerte'} onClick={()=>{setPhoto(null);setForm({...emptyForm(),id_animal:initialAnimalId});setOpen(true);}}><Plus size={23}/></IconButton></FloatingActionDock>:null}
  </div>;
}
