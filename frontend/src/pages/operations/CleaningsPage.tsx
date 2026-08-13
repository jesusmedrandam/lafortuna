import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronRight, Droplets, Edit3, Gauge, ImagePlus, MapPin, Plus, Sprout, Trash2, UserRound, UsersRound } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { ImageLightbox } from '../../components/ImageLightbox';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, ListToolbar, LoadingState, Modal, PageHeader, Select, Textarea } from '../../components/ui';
import { itemId, itemLabel, useCatalog } from '../../hooks/useCatalog';
import { useListControls } from '../../hooks/useListControls';
import type { Operator, Pasture, PastureCleaning, RecordImage } from '../../types/api';
import { currentDateInput, dateInputValue, formatDate, formatNumber, humanizeCode, nullIfEmpty, numberOrNull } from '../../utils';

interface ProductLine { id_producto: string; id_unidad: string; cantidad_por_tanque: string; observaciones: string; }
interface OperatorLine { id_operador: string; funcion: string; observaciones: string; }
type ApplicationUnit = 'TANQUES' | 'BOMBADAS';
interface CleaningForm {
  id_potrero: string; id_tipos_limpieza: string[]; fecha_inicio: string; fecha_finalizacion: string; unidad_aplicacion: ApplicationUnit; cantidad_tanques: string;
  capacidad_tanque_litros: string; tipo_area_intervenida: 'TOTAL' | 'PARCIAL'; estado: string; observaciones: string;
  productos: ProductLine[]; operadores: OperatorLine[];
}
const emptyCleaning = (): CleaningForm => ({ id_potrero: '', id_tipos_limpieza: [], fecha_inicio: currentDateInput(), fecha_finalizacion: '', unidad_aplicacion: 'TANQUES', cantidad_tanques: '', capacidad_tanque_litros: '', tipo_area_intervenida: 'TOTAL', estado: 'COMPLETADO', observaciones: '', productos: [], operadores: [] });
interface OperatorForm { id_operador?: string; nombres: string; apellidos: string; telefono: string; especialidad: string; activo: boolean; }
const emptyOperator = (): OperatorForm => ({ nombres: '', apellidos: '', telefono: '', especialidad: '', activo: true });

export function CleaningsPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PastureCleaning | null>(null);
  const [selected, setSelected] = useState<PastureCleaning | null>(null);
  const [form, setForm] = useState<CleaningForm>(emptyCleaning);
  const [operatorsOpen, setOperatorsOpen] = useState(false);
  const [operatorForm, setOperatorForm] = useState<OperatorForm>(emptyOperator);
  const [deleteOperator, setDeleteOperator] = useState<string | null>(null);
  const [photoFiles,setPhotoFiles]=useState<File[]>([]);

  const cleanings = useQuery({ queryKey: ['cleanings'], queryFn: () => apiRequest<PastureCleaning[]>('/limpiezas-potrero') });
  const pastures = useQuery({ queryKey: ['pastures', 'cleanings'], queryFn: () => apiRequest<Pasture[]>('/potreros') });
  const operators = useQuery({ queryKey: ['operators'], queryFn: () => apiRequest<Operator[]>('/operadores') });
  const types = useCatalog('tipos-limpieza');
  const products = useCatalog('agroquimicos');
  const units = useCatalog('unidades');

  const save = useMutation({
    mutationFn: async () => {
      if (!form.id_potrero || !form.id_tipos_limpieza.length || !form.fecha_inicio) throw new Error('Selecciona potrero, al menos una actividad de limpieza y fecha.');
      if (form.productos.length && !form.cantidad_tanques) throw new Error('Ingresa la cantidad de tanques o bombadas para calcular el consumo total.');
      if (form.productos.some((item) => !item.id_producto || !item.cantidad_por_tanque || !item.id_unidad)) throw new Error('Completa producto, cantidad por tanque o bombada y unidad.');
      const cleaning=await apiRequest<PastureCleaning>(editing ? `/limpiezas-potrero/${editing.id_limpieza}` : '/limpiezas-potrero', {
        method: editing ? 'PATCH' : 'POST',
        body: {
          id_potrero: form.id_potrero,
          id_tipos_limpieza: form.id_tipos_limpieza,
          fecha_inicio: form.fecha_inicio,
          fecha_finalizacion: form.fecha_finalizacion || null,
          unidad_aplicacion: form.unidad_aplicacion,
          cantidad_tanques: numberOrNull(form.cantidad_tanques),
          capacidad_tanque_litros: numberOrNull(form.capacidad_tanque_litros),
          tipo_area_intervenida: form.tipo_area_intervenida,
          estado: form.estado,
          observaciones: nullIfEmpty(form.observaciones),
          productos: form.productos.map((item) => ({ id_producto: item.id_producto, id_unidad: item.id_unidad, cantidad_por_tanque: Number(item.cantidad_por_tanque), observaciones: nullIfEmpty(item.observaciones) })),
          operadores: form.operadores.filter((item) => item.id_operador).map((item) => ({ id_operador: item.id_operador, funcion: nullIfEmpty(item.funcion), observaciones: nullIfEmpty(item.observaciones) })),
        },
      });
      const cleaningId=editing?.id_limpieza??cleaning.id_limpieza;
      if(photoFiles.length){const data=new FormData();photoFiles.forEach((file)=>data.append('imagenes',file));await apiRequest(`/limpiezas-potrero/${cleaningId}/imagenes`,{method:'POST',body:data});}
      return cleaning;
    },
    onSuccess: () => { toast.show(editing ? 'Limpieza actualizada.' : 'Limpieza registrada.'); setCreating(false); setEditing(null); setForm(emptyCleaning());setPhotoFiles([]); void queryClient.invalidateQueries({ queryKey: ['cleanings'] }); void queryClient.invalidateQueries({ queryKey: ['cleaning-detail'] }); },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  const saveOperator = useMutation({
    mutationFn: () => {
      if (!operatorForm.nombres.trim()) throw new Error('Ingresa los nombres del operador.');
      return apiRequest(`/operadores${operatorForm.id_operador ? `/${operatorForm.id_operador}` : ''}`, {
        method: operatorForm.id_operador ? 'PATCH' : 'POST',
        body: { nombres: operatorForm.nombres.trim(), apellidos: nullIfEmpty(operatorForm.apellidos), telefono: nullIfEmpty(operatorForm.telefono), especialidad: nullIfEmpty(operatorForm.especialidad), activo: operatorForm.activo },
      });
    },
    onSuccess: () => { toast.show(operatorForm.id_operador ? 'Operador actualizado.' : 'Operador creado.'); setOperatorForm(emptyOperator()); void queryClient.invalidateQueries({ queryKey: ['operators'] }); },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });
  const removeOperator = useMutation({
    mutationFn: (id: string) => apiRequest(`/operadores/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.show('Operador desactivado.'); setDeleteOperator(null); void queryClient.invalidateQueries({ queryKey: ['operators'] }); },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const addProduct = () => setForm((current) => ({ ...current, productos: [...current.productos, { id_producto: '', id_unidad: '', cantidad_por_tanque: '', observaciones: '' }] }));
  const addOperator = () => setForm((current) => ({ ...current, operadores: [...current.operadores, { id_operador: '', funcion: '', observaciones: '' }] }));
  const list = useListControls({ items: cleanings.data ?? [], storageKey: 'cleanings', searchText: (item) => `${item.tipo_limpieza} ${item.potrero} ${item.estado} ${item.productos.map((product) => product.producto).join(' ')} ${item.operadores.map((operator) => operator.nombre).join(' ')}`, dateValue: (item) => item.fecha_inicio, nameValue: (item) => `${item.potrero} ${item.tipo_limpieza}` });
  const editCleaning = (item: PastureCleaning) => {
    const applications = Number(item.cantidad_tanques ?? 0);
    setForm({ id_potrero: item.id_potrero, id_tipos_limpieza: item.tipos_limpieza?.map((type)=>type.id_tipo_limpieza)??[item.id_tipo_limpieza], fecha_inicio: dateInputValue(item.fecha_inicio), fecha_finalizacion: dateInputValue(item.fecha_finalizacion), unidad_aplicacion: item.unidad_aplicacion ?? 'TANQUES', cantidad_tanques: item.cantidad_tanques == null ? '' : String(item.cantidad_tanques), capacidad_tanque_litros: item.capacidad_tanque_litros == null ? '' : String(item.capacidad_tanque_litros), tipo_area_intervenida: item.tipo_area_intervenida ?? (item.area_intervenida == null ? 'TOTAL' : 'PARCIAL'), estado: item.estado, observaciones: item.observaciones ?? '', productos: item.productos.map((product) => ({ id_producto: product.id_producto, id_unidad: product.id_unidad, cantidad_por_tanque: product.cantidad_por_tanque == null && applications > 0 ? String(Number(product.cantidad_total) / applications) : String(product.cantidad_por_tanque ?? ''), observaciones: product.observaciones ?? '' })), operadores: item.operadores.map((operator) => ({ id_operador: operator.id_operador, funcion: operator.funcion ?? '', observaciones: operator.observaciones ?? '' })) });
    setPhotoFiles([]);setEditing(item); setSelected(null); setCreating(true);
  };

  const deletePhoto=useMutation({mutationFn:(image:RecordImage)=>apiRequest(`/limpiezas-potrero/imagenes/${image.id_limpieza_imagen}`,{method:'DELETE'}),onSuccess:(_,image)=>{setEditing((current)=>current?{...current,imagenes:current.imagenes.filter((item)=>item.id_limpieza_imagen!==image.id_limpieza_imagen)}:current);toast.show('Fotografía eliminada.');void queryClient.invalidateQueries({queryKey:['cleanings']});void queryClient.invalidateQueries({queryKey:['cleaning-detail']});},onError:(error)=>toast.show((error as ApiError).message,'error')});

  return <div>
    <PageHeader title="Limpieza de potreros" description="Registra fumigaciones, tala de maleza, productos, tanques o bombadas y responsables." action={hasPermission('LIMPIEZA_ADMINISTRAR') ? <div className="header-actions"><Button variant="secondary" onClick={() => setOperatorsOpen(true)}><UsersRound size={18} />Operadores</Button><Button onClick={() => { setForm(emptyCleaning());setPhotoFiles([]); setCreating(true); }}><Plus size={18} />Nueva limpieza</Button></div> : undefined} />
    <ListToolbar search={list.search} onSearch={list.setSearch} order={list.order} onOrder={list.setOrder} placeholder="Buscar actividad, potrero, producto u operador…" count={list.visible.length} />
    {cleanings.isLoading ? <LoadingState /> : cleanings.isError ? <ErrorState message={(cleanings.error as Error).message} onRetry={() => void cleanings.refetch()} /> : list.visible.length ? <div className="cleaning-list"><div className="cleaning-list-head"><span>Potrero</span><span>Actividad</span><span>Fecha</span><span>Aplicación</span><span>Estado</span><span /></div>{list.visible.map((item) => <button type="button" className="cleaning-list-row" key={item.id_limpieza} onClick={() => setSelected(item)}><span className="cleaning-identity"><span><MapPin size={19} /></span><span><strong>{item.potrero}</strong><small>{item.productos.length} productos · {item.operadores.length} operadores</small></span></span><span><Droplets size={15} />{item.tipo_limpieza}</span><span><CalendarDays size={15} />{formatDate(item.fecha_inicio)}</span><span><Gauge size={15} />{item.cantidad_tanques == null ? 'Sin cantidad' : `${formatNumber(item.cantidad_tanques)} ${item.unidad_aplicacion === 'BOMBADAS' ? 'bombadas' : 'tanques'}`}</span><span><Badge tone={item.estado === 'COMPLETADO' ? 'success' : item.estado === 'CANCELADO' ? 'danger' : 'warning'}>{humanizeCode(item.estado)}</Badge></span><span className="record-row-actions">{hasPermission('LIMPIEZA_ADMINISTRAR') ? <Button variant="ghost" onClick={(event) => { event.stopPropagation(); editCleaning(item); }}><Edit3 size={16} />Editar</Button> : null}<ChevronRight size={18}/></span></button>)}</div> : <EmptyState icon={Sprout} title="Sin limpiezas registradas" description="Registra trabajos de fumigación, tala manual o mantenimiento mecanizado." action={hasPermission('LIMPIEZA_ADMINISTRAR') ? <Button onClick={() => setCreating(true)}><Plus size={18} />Registrar limpieza</Button> : undefined} />}

    {selected ? <CleaningDetail item={selected} onClose={() => setSelected(null)} onEdit={hasPermission('LIMPIEZA_ADMINISTRAR') ? editCleaning : undefined} /> : null}

    {creating ? <Modal title={editing ? 'Editar limpieza de potrero' : 'Registrar limpieza de potrero'} wide onClose={() => { setCreating(false); setEditing(null); }} footer={<><Button variant="ghost" onClick={() => { setCreating(false); setEditing(null); }}>Cancelar</Button><Button onClick={() => save.mutate()} loading={save.isPending}>{editing ? 'Guardar cambios' : 'Guardar'}</Button></>}><div className="form-stack">
      <div className="form-section"><h3>Datos de la actividad</h3><div className="form-grid">
        <Field label="Potrero" required><Select value={form.id_potrero} onChange={(event) => setForm((current) => ({ ...current, id_potrero: event.target.value }))}><option value="">Selecciona</option>{pastures.data?.map((item) => <option key={item.id_potrero} value={item.id_potrero}>{item.nombre}</option>)}</Select></Field>
        <Field label="Actividades de limpieza" required hint="Puedes seleccionar varias para el mismo potrero."><div className="tag-picker">{types.data?.filter((item)=>item.activo!==false).map((item)=>{const id=itemId(item);return <label key={id} className={form.id_tipos_limpieza.includes(id)?'selected':''}><input type="checkbox" checked={form.id_tipos_limpieza.includes(id)} onChange={(event)=>setForm((current)=>({...current,id_tipos_limpieza:event.target.checked?[...current.id_tipos_limpieza,id]:current.id_tipos_limpieza.filter((value)=>value!==id)}))}/>{itemLabel(item)}</label>;})}</div></Field>
        <Field label="Inicio" required><Input type="date" value={form.fecha_inicio} onChange={(event) => setForm((current) => ({ ...current, fecha_inicio: event.target.value }))} /></Field>
        <Field label="Finalización"><Input type="date" value={form.fecha_finalizacion} onChange={(event) => setForm((current) => ({ ...current, fecha_finalizacion: event.target.value }))} /></Field>
        <Field label="Contabilizar aplicación por"><Select value={form.unidad_aplicacion} onChange={(event) => setForm((current) => ({ ...current, unidad_aplicacion: event.target.value as ApplicationUnit }))}><option value="TANQUES">Tanques</option><option value="BOMBADAS">Bombadas</option></Select></Field>
        <Field label={`Cantidad de ${form.unidad_aplicacion === 'BOMBADAS' ? 'bombadas' : 'tanques'}`}><Input type="number" min="0" step="0.01" value={form.cantidad_tanques} onChange={(event) => setForm((current) => ({ ...current, cantidad_tanques: event.target.value }))} /></Field>
        <Field label={`Capacidad de cada ${form.unidad_aplicacion === 'BOMBADAS' ? 'bombada' : 'tanque'} (L)`}><Input type="number" min="0.01" step="0.01" value={form.capacidad_tanque_litros} onChange={(event) => setForm((current) => ({ ...current, capacidad_tanque_litros: event.target.value }))} /></Field>
        <Field label="Área intervenida" required><Select value={form.tipo_area_intervenida} onChange={(event) => setForm((current) => ({ ...current, tipo_area_intervenida: event.target.value as CleaningForm['tipo_area_intervenida'] }))}><option value="TOTAL">Total</option><option value="PARCIAL">Parcial</option></Select></Field>
        <Field label="Estado"><Select value={form.estado} onChange={(event) => setForm((current) => ({ ...current, estado: event.target.value }))}>{['BORRADOR','PENDIENTE','EN_PROCESO','COMPLETADO','CANCELADO'].map((status) => <option key={status} value={status}>{humanizeCode(status)}</option>)}</Select></Field>
      </div><Field label="Observaciones"><Textarea value={form.observaciones} onChange={(event) => setForm((current) => ({ ...current, observaciones: event.target.value }))} /></Field></div>

      <div className="form-section"><h3>Fotografías del estado del potrero</h3><CleaningPhotoPicker existing={editing?.imagenes??[]} files={photoFiles} onFiles={setPhotoFiles} onDelete={(image)=>deletePhoto.mutate(image)}/></div>

      <div className="form-section"><div className="section-heading-inline"><h3>Productos aplicados</h3><Button type="button" variant="secondary" onClick={addProduct}><Plus size={16} />Agregar producto</Button></div>{form.productos.length ? <div className="nested-list">{form.productos.map((line, index) => <div className="nested-card" key={`product-${index}`}><div className="nested-card-header"><strong>Producto {index + 1}</strong><Button type="button" variant="ghost" onClick={() => setForm((current) => ({ ...current, productos: current.productos.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 size={16} /></Button></div><div className="form-grid">
        <Field label="Producto" required><Select value={line.id_producto} onChange={(event) => setForm((current) => ({ ...current, productos: current.productos.map((item, itemIndex) => itemIndex === index ? { ...item, id_producto: event.target.value } : item) }))}><option value="">Selecciona</option>{products.data?.map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
        <Field label="Unidad" required><Select value={line.id_unidad} onChange={(event) => setForm((current) => ({ ...current, productos: current.productos.map((item, itemIndex) => itemIndex === index ? { ...item, id_unidad: event.target.value } : item) }))}><option value="">Selecciona</option>{units.data?.map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)} {item.simbolo ? `(${item.simbolo})` : ''}</option>)}</Select></Field>
        <Field label={`Cantidad por ${form.unidad_aplicacion === 'BOMBADAS' ? 'bombada' : 'tanque'}`} required><Input type="number" min="0.0001" step="0.0001" value={line.cantidad_por_tanque} onChange={(event) => setForm((current) => ({ ...current, productos: current.productos.map((item, itemIndex) => itemIndex === index ? { ...item, cantidad_por_tanque: event.target.value } : item) }))} /></Field>
        <Field label="Cantidad total utilizada" hint="Se calcula automáticamente."><Input value={form.cantidad_tanques && line.cantidad_por_tanque ? formatNumber(Number(form.cantidad_tanques) * Number(line.cantidad_por_tanque), 4) : ''} placeholder="Cantidad × tanques o bombadas" readOnly tabIndex={-1} /></Field>
      </div><Field label="Observaciones"><Input value={line.observaciones} onChange={(event) => setForm((current) => ({ ...current, productos: current.productos.map((item, itemIndex) => itemIndex === index ? { ...item, observaciones: event.target.value } : item) }))} /></Field></div>)}</div> : <p className="muted">Agrega productos cuando corresponda, por ejemplo en una fumigación.</p>}</div>

      <div className="form-section"><div className="section-heading-inline"><h3>Operadores responsables</h3><Button type="button" variant="secondary" onClick={addOperator}><Plus size={16} />Agregar operador</Button></div>{form.operadores.length ? <div className="nested-list">{form.operadores.map((line, index) => <div className="nested-card" key={`operator-${index}`}><div className="nested-card-header"><strong>Operador {index + 1}</strong><Button type="button" variant="ghost" onClick={() => setForm((current) => ({ ...current, operadores: current.operadores.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 size={16} /></Button></div><div className="form-grid">
        <Field label="Operador" required><Select value={line.id_operador} onChange={(event) => setForm((current) => ({ ...current, operadores: current.operadores.map((item, itemIndex) => itemIndex === index ? { ...item, id_operador: event.target.value } : item) }))}><option value="">Selecciona</option>{operators.data?.filter((item) => item.activo).map((item) => <option key={item.id_operador} value={item.id_operador}>{item.nombres} {item.apellidos ?? ''}</option>)}</Select></Field>
        <Field label="Función"><Input value={line.funcion} onChange={(event) => setForm((current) => ({ ...current, operadores: current.operadores.map((item, itemIndex) => itemIndex === index ? { ...item, funcion: event.target.value } : item) }))} /></Field>
        <Field label="Observaciones"><Input value={line.observaciones} onChange={(event) => setForm((current) => ({ ...current, operadores: current.operadores.map((item, itemIndex) => itemIndex === index ? { ...item, observaciones: event.target.value } : item) }))} /></Field>
      </div></div>)}</div> : <p className="muted">Puedes registrar uno o varios fumigadores u operadores.</p>}</div>
    </div></Modal> : null}

    {operatorsOpen ? <Modal title="Operadores" wide onClose={() => setOperatorsOpen(false)} footer={<Button variant="ghost" onClick={() => setOperatorsOpen(false)}>Cerrar</Button>}><div className="operator-manager"><div className="form-section"><h3>{operatorForm.id_operador ? 'Editar operador' : 'Nuevo operador'}</h3><div className="form-grid"><Field label="Nombres" required><Input value={operatorForm.nombres} onChange={(event) => setOperatorForm((current) => ({ ...current, nombres: event.target.value }))} /></Field><Field label="Apellidos"><Input value={operatorForm.apellidos} onChange={(event) => setOperatorForm((current) => ({ ...current, apellidos: event.target.value }))} /></Field><Field label="Teléfono"><Input value={operatorForm.telefono} onChange={(event) => setOperatorForm((current) => ({ ...current, telefono: event.target.value }))} /></Field><Field label="Especialidad"><Input value={operatorForm.especialidad} onChange={(event) => setOperatorForm((current) => ({ ...current, especialidad: event.target.value }))} /></Field></div><label className="checkbox"><input type="checkbox" checked={operatorForm.activo} onChange={(event) => setOperatorForm((current) => ({ ...current, activo: event.target.checked }))} />Activo</label><div className="card-actions"><Button variant="ghost" onClick={() => setOperatorForm(emptyOperator())}>Limpiar</Button><Button onClick={() => saveOperator.mutate()} loading={saveOperator.isPending}>Guardar operador</Button></div></div><div className="operator-list">{operators.data?.map((item) => <Card key={item.id_operador} className="operator-card"><div className="operation-card-header"><div className="operation-icon"><UserRound size={21} /></div><div><h3>{item.nombres} {item.apellidos}</h3><span>{item.especialidad || 'Sin especialidad'} · {item.telefono || 'Sin teléfono'}</span></div><Badge tone={item.activo ? 'success' : 'neutral'}>{item.activo ? 'Activo' : 'Inactivo'}</Badge></div><div className="card-actions"><Button variant="ghost" onClick={() => setOperatorForm({ id_operador: item.id_operador, nombres: item.nombres, apellidos: item.apellidos ?? '', telefono: item.telefono ?? '', especialidad: item.especialidad ?? '', activo: item.activo })}><Edit3 size={16} />Editar</Button><Button variant="ghost" onClick={() => setDeleteOperator(item.id_operador)}><Trash2 size={16} />Eliminar</Button></div></Card>)}</div></div></Modal> : null}
    {deleteOperator ? <ConfirmDialog title="Eliminar operador" message="El operador quedará inactivo y se conservará su historial." onClose={() => setDeleteOperator(null)} onConfirm={() => removeOperator.mutate(deleteOperator)} loading={removeOperator.isPending} /> : null}
  </div>;
}

function CleaningDetail({item,onClose,onEdit}:{item:PastureCleaning;onClose:()=>void;onEdit?:(item:PastureCleaning)=>void}){
  const [viewer,setViewer]=useState<number|null>(null);
  const detail=useQuery({queryKey:['cleaning-detail',item.id_limpieza],queryFn:()=>apiRequest<PastureCleaning>(`/limpiezas-potrero/${item.id_limpieza}`)});
  const current=detail.data??item;
  const application=current.unidad_aplicacion==='BOMBADAS'?'bombadas':'tanques';
  const singular=current.unidad_aplicacion==='BOMBADAS'?'bombada':'tanque';
  return <Modal title="Detalle de la limpieza" wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cerrar</Button>{onEdit?<Button onClick={()=>onEdit(current)}><Edit3 size={17}/>Editar limpieza</Button>:null}</>}>
    <div className="cleaning-detail">
      <div className="cleaning-detail-heading"><div className="operation-icon"><MapPin size={24}/></div><div><h2>{current.potrero}</h2><p>{current.tipo_limpieza}</p></div><Badge tone={current.estado==='COMPLETADO'?'success':current.estado==='CANCELADO'?'danger':'warning'}>{humanizeCode(current.estado)}</Badge></div>
      <div className="cleaning-detail-grid">
        <div><small>Fecha de inicio</small><strong>{formatDate(current.fecha_inicio)}</strong></div>
        <div><small>Fecha de finalización</small><strong>{formatDate(current.fecha_finalizacion)}</strong></div>
        <div><small>Unidad de aplicación</small><strong>{humanizeCode(current.unidad_aplicacion||'TANQUES')}</strong></div>
        <div><small>Cantidad de {application}</small><strong>{current.cantidad_tanques==null?'—':formatNumber(current.cantidad_tanques)}</strong></div>
        <div><small>Capacidad por {singular}</small><strong>{current.capacidad_tanque_litros==null?'—':`${formatNumber(current.capacidad_tanque_litros)} L`}</strong></div>
        <div><small>Área intervenida</small><strong>{current.tipo_area_intervenida === 'PARCIAL' ? 'Parcial' : 'Total'}</strong></div>
      </div>
      <section><h3>Productos aplicados</h3>{current.productos.length?<div className="cleaning-detail-lines">{current.productos.map((product,index)=><div key={`${current.id_limpieza}-product-${index}`}><strong>{product.producto}</strong><span>{formatNumber(product.cantidad_por_tanque,4)} {product.unidad} por {singular}</span><span><strong>Total utilizado: {formatNumber(product.cantidad_total,4)} {product.unidad}</strong></span>{product.observaciones?<small>{product.observaciones}</small>:null}</div>)}</div>:<p className="muted">No se registraron productos.</p>}</section>
      <section><h3>Operadores responsables</h3>{current.operadores.length?<div className="cleaning-detail-lines">{current.operadores.map((operator)=><div key={`${current.id_limpieza}-${operator.id_operador}`}><strong>{operator.nombre}</strong><span>{operator.funcion || 'Sin función registrada'}</span>{operator.observaciones?<small>{operator.observaciones}</small>:null}</div>)}</div>:<p className="muted">No se registraron operadores.</p>}</section>
      <section><h3>Fotografías del estado del potrero</h3>{current.imagenes?.length?<div className="record-photo-grid record-photo-gallery">{current.imagenes.map((image,index)=><button className="record-photo-view" type="button" key={image.id_limpieza_imagen} onClick={()=>setViewer(index)} aria-label={`Abrir fotografía ${index+1} del potrero ${current.potrero}`}><img src={image.secure_url} alt={`Estado de ${current.potrero}`}/><span>Fotografía {index+1}</span></button>)}</div>:<p className="muted">No hay fotografías registradas en esta limpieza.</p>}</section>
      <section><h3>Observaciones generales</h3><p>{current.observaciones||'Sin observaciones.'}</p></section>
    </div>{viewer!==null?<ImageLightbox items={current.imagenes.map((image,index)=>({key:image.id_limpieza_imagen??String(index),url:image.secure_url,title:`Limpieza de ${current.potrero}`,subtitle:current.tipo_limpieza,date:current.fecha_inicio,filename:image.nombre_original}))} initialIndex={viewer} onClose={()=>setViewer(null)}/>:null}
  </Modal>;
}

function CleaningPhotoPicker({existing,files,onFiles,onDelete}:{existing:RecordImage[];files:File[];onFiles:(files:File[])=>void;onDelete:(image:RecordImage)=>void}){
  const capacity=Math.max(0,3-existing.length);
  const disabled=files.length>=capacity;
  return <div className="record-photo-picker"><div className="record-photo-grid">{existing.map((image)=><div key={image.id_limpieza_imagen}><img src={image.secure_url} alt=""/><button type="button" onClick={()=>onDelete(image)} aria-label="Eliminar fotografía"><Trash2 size={14}/></button></div>)}{files.map((file,index)=><div key={`${file.name}-${index}`}><CleaningFilePreview file={file}/><button type="button" onClick={()=>onFiles(files.filter((_,position)=>position!==index))} aria-label="Quitar fotografía"><Trash2 size={14}/></button></div>)}</div><label className={`photo-upload-button ${disabled?'disabled':''}`}><ImagePlus size={18}/>Agregar fotografías<input type="file" multiple accept="image/*" disabled={disabled} onChange={(event)=>{onFiles([...files,...Array.from(event.target.files??[])].slice(0,capacity));event.currentTarget.value='';}}/></label><small>{existing.length+files.length} de 3</small></div>;
}

function CleaningFilePreview({file}:{file:File}){const [url,setUrl]=useState('');useEffect(()=>{const next=URL.createObjectURL(file);setUrl(next);return()=>URL.revokeObjectURL(next);},[file]);return <img src={url} alt={file.name}/>;}
