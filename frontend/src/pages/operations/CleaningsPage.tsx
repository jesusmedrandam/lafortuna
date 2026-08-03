import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Droplets, Edit3, Plus, Sprout, Trash2, UserRound, UsersRound } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Textarea } from '../../components/ui';
import { itemId, itemLabel, useCatalog } from '../../hooks/useCatalog';
import type { Operator, Pasture, PastureCleaning } from '../../types/api';
import { formatDateTime, formatNumber, humanizeCode, nullIfEmpty, numberOrNull } from '../../utils';

const localNow = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

interface ProductLine { id_producto: string; cantidad_total: string; id_unidad: string; cantidad_por_tanque: string; observaciones: string; }
interface OperatorLine { id_operador: string; funcion: string; horas_trabajadas: string; observaciones: string; }
interface CleaningForm {
  id_potrero: string; id_tipo_limpieza: string; fecha_inicio: string; fecha_finalizacion: string; cantidad_tanques: string;
  capacidad_tanque_litros: string; area_intervenida: string; id_unidad_area: string; estado: string; observaciones: string;
  productos: ProductLine[]; operadores: OperatorLine[];
}
const emptyCleaning = (): CleaningForm => ({ id_potrero: '', id_tipo_limpieza: '', fecha_inicio: localNow(), fecha_finalizacion: '', cantidad_tanques: '', capacidad_tanque_litros: '', area_intervenida: '', id_unidad_area: '', estado: 'COMPLETADO', observaciones: '', productos: [], operadores: [] });
interface OperatorForm { id_operador?: string; nombres: string; apellidos: string; telefono: string; especialidad: string; activo: boolean; }
const emptyOperator = (): OperatorForm => ({ nombres: '', apellidos: '', telefono: '', especialidad: '', activo: true });

export function CleaningsPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CleaningForm>(emptyCleaning);
  const [operatorsOpen, setOperatorsOpen] = useState(false);
  const [operatorForm, setOperatorForm] = useState<OperatorForm>(emptyOperator);
  const [deleteOperator, setDeleteOperator] = useState<string | null>(null);

  const cleanings = useQuery({ queryKey: ['cleanings'], queryFn: () => apiRequest<PastureCleaning[]>('/limpiezas-potrero') });
  const pastures = useQuery({ queryKey: ['pastures', 'cleanings'], queryFn: () => apiRequest<Pasture[]>('/potreros') });
  const operators = useQuery({ queryKey: ['operators'], queryFn: () => apiRequest<Operator[]>('/operadores') });
  const types = useCatalog('tipos-limpieza');
  const products = useCatalog('agroquimicos');
  const units = useCatalog('unidades');

  const create = useMutation({
    mutationFn: () => {
      if (!form.id_potrero || !form.id_tipo_limpieza || !form.fecha_inicio) throw new Error('Selecciona potrero, tipo de limpieza y fecha.');
      return apiRequest('/limpiezas-potrero', {
        method: 'POST',
        body: {
          id_potrero: form.id_potrero,
          id_tipo_limpieza: form.id_tipo_limpieza,
          fecha_inicio: new Date(form.fecha_inicio).toISOString(),
          fecha_finalizacion: form.fecha_finalizacion ? new Date(form.fecha_finalizacion).toISOString() : null,
          cantidad_tanques: numberOrNull(form.cantidad_tanques),
          capacidad_tanque_litros: numberOrNull(form.capacidad_tanque_litros),
          area_intervenida: numberOrNull(form.area_intervenida),
          id_unidad_area: form.id_unidad_area || null,
          estado: form.estado,
          observaciones: nullIfEmpty(form.observaciones),
          productos: form.productos.filter((item) => item.id_producto && item.cantidad_total && item.id_unidad).map((item) => ({ id_producto: item.id_producto, cantidad_total: Number(item.cantidad_total), id_unidad: item.id_unidad, cantidad_por_tanque: numberOrNull(item.cantidad_por_tanque), observaciones: nullIfEmpty(item.observaciones) })),
          operadores: form.operadores.filter((item) => item.id_operador).map((item) => ({ id_operador: item.id_operador, funcion: nullIfEmpty(item.funcion), horas_trabajadas: numberOrNull(item.horas_trabajadas), observaciones: nullIfEmpty(item.observaciones) })),
        },
      });
    },
    onSuccess: () => { toast.show('Limpieza registrada.'); setCreating(false); setForm(emptyCleaning()); void queryClient.invalidateQueries({ queryKey: ['cleanings'] }); },
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

  const addProduct = () => setForm((current) => ({ ...current, productos: [...current.productos, { id_producto: '', cantidad_total: '', id_unidad: '', cantidad_por_tanque: '', observaciones: '' }] }));
  const addOperator = () => setForm((current) => ({ ...current, operadores: [...current.operadores, { id_operador: '', funcion: '', horas_trabajadas: '', observaciones: '' }] }));

  return <div>
    <PageHeader title="Limpieza de potreros" description="Registra fumigaciones, tala de maleza, productos, tanques y responsables." action={hasPermission('LIMPIEZA_ADMINISTRAR') ? <div className="header-actions"><Button variant="secondary" onClick={() => setOperatorsOpen(true)}><UsersRound size={18} />Operadores</Button><Button onClick={() => { setForm(emptyCleaning()); setCreating(true); }}><Plus size={18} />Nueva limpieza</Button></div> : undefined} />
    {cleanings.isLoading ? <LoadingState /> : cleanings.isError ? <ErrorState message={(cleanings.error as Error).message} onRetry={() => void cleanings.refetch()} /> : cleanings.data?.length ? <div className="record-grid operation-grid">{cleanings.data.map((item) => <Card className="operation-card" key={item.id_limpieza}>
      <div className="operation-card-header"><div className="operation-icon"><Droplets size={23} /></div><div><h3>{item.tipo_limpieza}</h3><span>{item.potrero} · {formatDateTime(item.fecha_inicio)}</span></div><Badge tone={item.estado === 'COMPLETADO' ? 'success' : item.estado === 'CANCELADO' ? 'danger' : 'warning'}>{humanizeCode(item.estado)}</Badge></div>
      <div className="detail-grid compact"><div><small>Tanques o bombadas</small><strong>{item.cantidad_tanques == null ? '—' : formatNumber(item.cantidad_tanques)}</strong></div><div><small>Capacidad</small><strong>{item.capacidad_tanque_litros == null ? '—' : `${formatNumber(item.capacidad_tanque_litros)} L`}</strong></div><div><small>Área intervenida</small><strong>{item.area_intervenida == null ? '—' : formatNumber(item.area_intervenida)}</strong></div><div><small>Finalización</small><strong>{formatDateTime(item.fecha_finalizacion)}</strong></div></div>
      {item.productos?.length ? <details className="operation-details"><summary>Productos aplicados ({item.productos.length})</summary><div>{item.productos.map((product, index) => <span key={`${item.id_limpieza}-p-${index}`}>{product.producto}: {formatNumber(product.cantidad_total, 4)} {product.unidad}{product.cantidad_por_tanque ? ` · ${formatNumber(product.cantidad_por_tanque, 4)} por tanque` : ''}</span>)}</div></details> : null}
      {item.operadores?.length ? <details className="operation-details"><summary>Operadores ({item.operadores.length})</summary><div>{item.operadores.map((operator) => <span key={`${item.id_limpieza}-${operator.id_operador}`}>{operator.nombre}{operator.funcion ? ` · ${operator.funcion}` : ''}{operator.horas_trabajadas ? ` · ${formatNumber(operator.horas_trabajadas)} h` : ''}</span>)}</div></details> : null}
      {item.observaciones ? <p className="muted operation-notes">{item.observaciones}</p> : null}
    </Card>)}</div> : <EmptyState icon={Sprout} title="Sin limpiezas registradas" description="Registra trabajos de fumigación, tala manual o mantenimiento mecanizado." action={hasPermission('LIMPIEZA_ADMINISTRAR') ? <Button onClick={() => setCreating(true)}><Plus size={18} />Registrar limpieza</Button> : undefined} />}

    {creating ? <Modal title="Registrar limpieza de potrero" wide onClose={() => setCreating(false)} footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button><Button onClick={() => create.mutate()} loading={create.isPending}>Guardar</Button></>}><div className="form-stack">
      <div className="form-section"><h3>Datos de la actividad</h3><div className="form-grid">
        <Field label="Potrero" required><Select value={form.id_potrero} onChange={(event) => setForm((current) => ({ ...current, id_potrero: event.target.value }))}><option value="">Selecciona</option>{pastures.data?.map((item) => <option key={item.id_potrero} value={item.id_potrero}>{item.nombre}</option>)}</Select></Field>
        <Field label="Tipo de limpieza" required><Select value={form.id_tipo_limpieza} onChange={(event) => setForm((current) => ({ ...current, id_tipo_limpieza: event.target.value }))}><option value="">Selecciona</option>{types.data?.filter((item) => item.activo !== false).map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
        <Field label="Inicio" required><Input type="datetime-local" value={form.fecha_inicio} onChange={(event) => setForm((current) => ({ ...current, fecha_inicio: event.target.value }))} /></Field>
        <Field label="Finalización"><Input type="datetime-local" value={form.fecha_finalizacion} onChange={(event) => setForm((current) => ({ ...current, fecha_finalizacion: event.target.value }))} /></Field>
        <Field label="Cantidad de tanques o bombadas"><Input type="number" min="0" step="0.01" value={form.cantidad_tanques} onChange={(event) => setForm((current) => ({ ...current, cantidad_tanques: event.target.value }))} /></Field>
        <Field label="Capacidad de cada tanque (L)"><Input type="number" min="0.01" step="0.01" value={form.capacidad_tanque_litros} onChange={(event) => setForm((current) => ({ ...current, capacidad_tanque_litros: event.target.value }))} /></Field>
        <Field label="Área intervenida"><Input type="number" min="0.01" step="0.001" value={form.area_intervenida} onChange={(event) => setForm((current) => ({ ...current, area_intervenida: event.target.value }))} /></Field>
        <Field label="Unidad del área"><Select value={form.id_unidad_area} onChange={(event) => setForm((current) => ({ ...current, id_unidad_area: event.target.value }))}><option value="">Sin unidad</option>{units.data?.map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)} {item.simbolo ? `(${item.simbolo})` : ''}</option>)}</Select></Field>
        <Field label="Estado"><Select value={form.estado} onChange={(event) => setForm((current) => ({ ...current, estado: event.target.value }))}>{['BORRADOR','PENDIENTE','EN_PROCESO','COMPLETADO','CANCELADO'].map((status) => <option key={status} value={status}>{humanizeCode(status)}</option>)}</Select></Field>
      </div><Field label="Observaciones"><Textarea value={form.observaciones} onChange={(event) => setForm((current) => ({ ...current, observaciones: event.target.value }))} /></Field></div>

      <div className="form-section"><div className="section-heading-inline"><h3>Productos aplicados</h3><Button type="button" variant="secondary" onClick={addProduct}><Plus size={16} />Agregar producto</Button></div>{form.productos.length ? <div className="nested-list">{form.productos.map((line, index) => <div className="nested-card" key={`product-${index}`}><div className="nested-card-header"><strong>Producto {index + 1}</strong><Button type="button" variant="ghost" onClick={() => setForm((current) => ({ ...current, productos: current.productos.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 size={16} /></Button></div><div className="form-grid">
        <Field label="Producto" required><Select value={line.id_producto} onChange={(event) => setForm((current) => ({ ...current, productos: current.productos.map((item, itemIndex) => itemIndex === index ? { ...item, id_producto: event.target.value } : item) }))}><option value="">Selecciona</option>{products.data?.map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
        <Field label="Cantidad total" required><Input type="number" min="0.0001" step="0.0001" value={line.cantidad_total} onChange={(event) => setForm((current) => ({ ...current, productos: current.productos.map((item, itemIndex) => itemIndex === index ? { ...item, cantidad_total: event.target.value } : item) }))} /></Field>
        <Field label="Unidad" required><Select value={line.id_unidad} onChange={(event) => setForm((current) => ({ ...current, productos: current.productos.map((item, itemIndex) => itemIndex === index ? { ...item, id_unidad: event.target.value } : item) }))}><option value="">Selecciona</option>{units.data?.map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)} {item.simbolo ? `(${item.simbolo})` : ''}</option>)}</Select></Field>
        <Field label="Cantidad por tanque"><Input type="number" min="0.0001" step="0.0001" value={line.cantidad_por_tanque} onChange={(event) => setForm((current) => ({ ...current, productos: current.productos.map((item, itemIndex) => itemIndex === index ? { ...item, cantidad_por_tanque: event.target.value } : item) }))} /></Field>
      </div><Field label="Observaciones"><Input value={line.observaciones} onChange={(event) => setForm((current) => ({ ...current, productos: current.productos.map((item, itemIndex) => itemIndex === index ? { ...item, observaciones: event.target.value } : item) }))} /></Field></div>)}</div> : <p className="muted">Agrega productos cuando corresponda, por ejemplo en una fumigación.</p>}</div>

      <div className="form-section"><div className="section-heading-inline"><h3>Operadores responsables</h3><Button type="button" variant="secondary" onClick={addOperator}><Plus size={16} />Agregar operador</Button></div>{form.operadores.length ? <div className="nested-list">{form.operadores.map((line, index) => <div className="nested-card" key={`operator-${index}`}><div className="nested-card-header"><strong>Operador {index + 1}</strong><Button type="button" variant="ghost" onClick={() => setForm((current) => ({ ...current, operadores: current.operadores.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 size={16} /></Button></div><div className="form-grid">
        <Field label="Operador" required><Select value={line.id_operador} onChange={(event) => setForm((current) => ({ ...current, operadores: current.operadores.map((item, itemIndex) => itemIndex === index ? { ...item, id_operador: event.target.value } : item) }))}><option value="">Selecciona</option>{operators.data?.filter((item) => item.activo).map((item) => <option key={item.id_operador} value={item.id_operador}>{item.nombres} {item.apellidos ?? ''}</option>)}</Select></Field>
        <Field label="Función"><Input value={line.funcion} onChange={(event) => setForm((current) => ({ ...current, operadores: current.operadores.map((item, itemIndex) => itemIndex === index ? { ...item, funcion: event.target.value } : item) }))} /></Field>
        <Field label="Horas trabajadas"><Input type="number" min="0" step="0.25" value={line.horas_trabajadas} onChange={(event) => setForm((current) => ({ ...current, operadores: current.operadores.map((item, itemIndex) => itemIndex === index ? { ...item, horas_trabajadas: event.target.value } : item) }))} /></Field>
        <Field label="Observaciones"><Input value={line.observaciones} onChange={(event) => setForm((current) => ({ ...current, operadores: current.operadores.map((item, itemIndex) => itemIndex === index ? { ...item, observaciones: event.target.value } : item) }))} /></Field>
      </div></div>)}</div> : <p className="muted">Puedes registrar uno o varios fumigadores u operadores.</p>}</div>
    </div></Modal> : null}

    {operatorsOpen ? <Modal title="Operadores" wide onClose={() => setOperatorsOpen(false)} footer={<Button variant="ghost" onClick={() => setOperatorsOpen(false)}>Cerrar</Button>}><div className="operator-manager"><div className="form-section"><h3>{operatorForm.id_operador ? 'Editar operador' : 'Nuevo operador'}</h3><div className="form-grid"><Field label="Nombres" required><Input value={operatorForm.nombres} onChange={(event) => setOperatorForm((current) => ({ ...current, nombres: event.target.value }))} /></Field><Field label="Apellidos"><Input value={operatorForm.apellidos} onChange={(event) => setOperatorForm((current) => ({ ...current, apellidos: event.target.value }))} /></Field><Field label="Teléfono"><Input value={operatorForm.telefono} onChange={(event) => setOperatorForm((current) => ({ ...current, telefono: event.target.value }))} /></Field><Field label="Especialidad"><Input value={operatorForm.especialidad} onChange={(event) => setOperatorForm((current) => ({ ...current, especialidad: event.target.value }))} /></Field></div><label className="checkbox"><input type="checkbox" checked={operatorForm.activo} onChange={(event) => setOperatorForm((current) => ({ ...current, activo: event.target.checked }))} />Activo</label><div className="card-actions"><Button variant="ghost" onClick={() => setOperatorForm(emptyOperator())}>Limpiar</Button><Button onClick={() => saveOperator.mutate()} loading={saveOperator.isPending}>Guardar operador</Button></div></div><div className="operator-list">{operators.data?.map((item) => <Card key={item.id_operador} className="operator-card"><div className="operation-card-header"><div className="operation-icon"><UserRound size={21} /></div><div><h3>{item.nombres} {item.apellidos}</h3><span>{item.especialidad || 'Sin especialidad'} · {item.telefono || 'Sin teléfono'}</span></div><Badge tone={item.activo ? 'success' : 'neutral'}>{item.activo ? 'Activo' : 'Inactivo'}</Badge></div><div className="card-actions"><Button variant="ghost" onClick={() => setOperatorForm({ id_operador: item.id_operador, nombres: item.nombres, apellidos: item.apellidos ?? '', telefono: item.telefono ?? '', especialidad: item.especialidad ?? '', activo: item.activo })}><Edit3 size={16} />Editar</Button><Button variant="ghost" onClick={() => setDeleteOperator(item.id_operador)}><Trash2 size={16} />Eliminar</Button></div></Card>)}</div></div></Modal> : null}
    {deleteOperator ? <ConfirmDialog title="Eliminar operador" message="El operador quedará inactivo y se conservará su historial." onClose={() => setDeleteOperator(null)} onConfirm={() => removeOperator.mutate(deleteOperator)} loading={removeOperator.isPending} /> : null}
  </div>;
}
