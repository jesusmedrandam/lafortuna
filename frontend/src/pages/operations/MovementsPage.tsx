import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Ban, CheckCircle2, ChevronRight, Edit3, Plus } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AnimalSelectionBuilder, type AnimalSelectionValue } from '../../components/AnimalSelectionBuilder';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, ListToolbar, LoadingState, Modal, PageHeader, Select, Textarea } from '../../components/ui';
import { useListControls } from '../../hooks/useListControls';
import type { Group, Location, Movement, SelectableAnimal } from '../../types/api';
import { currentDateInput, dateInputValue, formatDate, humanizeCode } from '../../utils';

type MovementKind = 'UBICACION' | 'GRUPO' | 'PROPIEDAD' | 'COMBINADO';

interface MovementForm {
  kind: MovementKind;
  selection: AnimalSelectionValue;
  id_ubicacion_destino: string;
  id_grupo_destino: string;
  fecha_movimiento: string;
  motivo: string;
  observaciones: string;
}

const emptyForm = (): MovementForm => ({
  kind: 'UBICACION',
  selection: { mode: 'GRUPO', groupId: '', animals: [] },
  id_ubicacion_destino: '',
  id_grupo_destino: '',
  fecha_movimiento: currentDateInput(),
  motivo: '',
  observaciones: '',
});

function movementTone(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (status === 'COMPLETADO') return 'success';
  if (status === 'CANCELADO') return 'danger';
  if (status === 'EN_PROCESO') return 'info';
  return 'warning';
}

export function MovementsPage() {
  const route = useLocation();
  const navigate = useNavigate();
  const consumedInitialAnimal = useRef(false);
  const { hasPermission } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Movement | null>(null);
  const [selected, setSelected] = useState<Movement | null>(null);
  const [form, setForm] = useState<MovementForm>(emptyForm);
  const movements = useQuery({ queryKey: ['movements'], queryFn: () => apiRequest<Movement[]>('/movimientos') });
  const groups = useQuery({ queryKey: ['groups', 'movement'], queryFn: () => apiRequest<Group[]>('/grupos?limit=100') });
  const locations = useQuery({ queryKey: ['locations', 'movement'], queryFn: () => apiRequest<Location[]>('/ubicaciones') });
  const baseOperationCode = form.kind === 'UBICACION' ? 'MOVIMIENTO_UBICACION' : form.kind === 'GRUPO' ? 'MOVIMIENTO_GRUPO' : form.kind === 'PROPIEDAD' ? 'MOVIMIENTO_PROPIEDAD' : form.id_ubicacion_destino && locations.data?.find((item) => item.id_ubicacion === form.id_ubicacion_destino)?.tipo === 'OTRO' ? 'MOVIMIENTO_PROPIEDAD' : 'MOVIMIENTO_UBICACION';
  const operationCode = form.kind === 'GRUPO' ? baseOperationCode : [baseOperationCode, 'MOVIMIENTO_GRUPO'];
  const selectedCategoryIds = [...new Set(form.selection.animals.filter((item) => item.seleccionado).map((item) => item.id_categoria_animal).filter(Boolean))];
  const selectedLocationIds = [...new Set(form.selection.animals.filter((item) => item.seleccionado).map((item) => item.id_ubicacion_actual).filter(Boolean))];
  const sourceGroup = groups.data?.find((item) => item.id_grupo === form.selection.groupId);
  const sourceCategoryId = sourceGroup?.id_categoria_animal || (selectedCategoryIds.length === 1 ? selectedCategoryIds[0] : null);
  const sourceLocationId = sourceGroup?.id_ubicacion_actual || (selectedLocationIds.length === 1 ? selectedLocationIds[0] : null);
  const targetGroups = groups.data?.filter((item) => {
    if (!item.activo) return false;
    if (form.kind === 'UBICACION' && form.selection.mode === 'GRUPO' && item.id_grupo === form.selection.groupId) return true;
    if (!item.id_ubicacion_actual) return false;
    if (form.kind === 'GRUPO') return (!sourceCategoryId || item.id_categoria_animal === sourceCategoryId) && (!sourceLocationId || item.id_ubicacion_actual === sourceLocationId);
    if (item.id_ubicacion_actual === form.id_ubicacion_destino) return true;
    return false;
  });

  useEffect(() => {
    if (consumedInitialAnimal.current) return;
    const initialAnimal = (route.state as { initialAnimal?: SelectableAnimal } | null)?.initialAnimal;
    if (!initialAnimal) return;
    consumedInitialAnimal.current = true;
    setForm({ ...emptyForm(), selection: { mode: 'SELECCION_MANUAL', groupId: '', animals: [{ ...initialAnimal, seleccionado: true }] } });
    setCreating(true);
    navigate(route.pathname, { replace: true, state: null });
  }, [navigate, route.pathname, route.state]);

  useEffect(() => {
    if (!form.id_grupo_destino || !targetGroups || targetGroups.some((item) => item.id_grupo === form.id_grupo_destino)) return;
    setForm((current) => ({
      ...current,
      id_grupo_destino: '',
      id_ubicacion_destino: current.kind === 'GRUPO' ? '' : current.id_ubicacion_destino,
    }));
  }, [form.id_grupo_destino, form.kind, targetGroups]);

  const save = useMutation({
    mutationFn: async () => {
      const canChangeRoute = !editing || editing.estado === 'BORRADOR';
      const selected = form.selection.animals.filter((animal) => animal.seleccionado);
      if (canChangeRoute && !selected.length) throw new Error('Selecciona al menos un animal.');
      if (canChangeRoute && !form.id_grupo_destino) throw new Error('Selecciona el grupo de destino.');
      if (canChangeRoute && !form.id_ubicacion_destino) throw new Error(form.kind === 'PROPIEDAD' ? 'Selecciona la propiedad de destino.' : 'Selecciona la ubicación de destino.');
      const body = {
          tipo_movimiento: form.kind,
          modo_seleccion: form.selection.mode,
          id_grupo_filtro: form.selection.mode === 'GRUPO' ? form.selection.groupId : null,
          id_ubicacion_destino: form.id_ubicacion_destino || null,
          id_grupo_destino: form.id_grupo_destino || null,
          fecha_movimiento: form.fecha_movimiento,
          motivo: form.motivo.trim() || null,
          observaciones: form.observaciones.trim() || null,
          animales: form.selection.animals.map((animal) => ({
            id_animal: animal.id_animal,
            seleccionado: animal.seleccionado,
            id_ubicacion_destino: form.id_ubicacion_destino || null,
            id_grupo_destino: form.id_grupo_destino || null,
            observaciones: animal.observaciones || null,
          })),
        };
      const movement = await apiRequest<Movement>(editing ? `/movimientos/${editing.id_movimiento}` : '/movimientos', {
        method: editing ? 'PATCH' : 'POST', body: editing ? { ...body, animales: undefined } : body,
      });
      if (editing?.estado === 'BORRADOR') await apiRequest(`/movimientos/${editing.id_movimiento}/seleccion`, { method: 'PUT', body: { animales: body.animales } });
      return movement;
    },
    onSuccess: () => {
      toast.show(editing ? 'Movimiento actualizado.' : 'Movimiento guardado como borrador.');
      setCreating(false);
      setEditing(null);
      setForm(emptyForm());
      void queryClient.invalidateQueries({ queryKey: ['movements'] });
    },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  const list = useListControls({ items: movements.data ?? [], storageKey: 'movements', searchText: (item) => `${item.motivo ?? ''} ${item.ubicacion_origen ?? ''} ${item.ubicacion_destino ?? ''} ${item.grupo_origen ?? ''} ${item.grupo_destino ?? ''} ${item.detalles.map((detail) => `${detail.animal} ${detail.arete ?? ''}`).join(' ')}`, dateValue: (item) => item.fecha_movimiento, nameValue: (item) => item.motivo || item.ubicacion_destino || item.grupo_destino || '' });
  const editMovement = (item: Movement) => {
    const destination = locations.data?.find((location) => location.id_ubicacion === item.id_ubicacion_destino);
    const kind: MovementKind = item.tipo_movimiento ?? (item.id_ubicacion_destino && item.id_grupo_destino ? 'COMBINADO' : item.id_grupo_destino ? 'GRUPO' : destination?.tipo === 'OTRO' ? 'PROPIEDAD' : 'UBICACION');
    setForm({ kind, selection: { mode: item.modo_seleccion, groupId: item.id_grupo_filtro ?? '', animals: item.detalles.map((detail) => ({ id_animal: detail.id_animal, nombre: detail.nombre ?? detail.animal, codigo_arete: detail.codigo_arete ?? detail.arete, sexo: detail.sexo ?? 'HEMBRA', id_categoria_animal: detail.id_categoria_animal ?? '', categoria: detail.categoria ?? '', id_grupo_actual: detail.id_grupo_actual ?? null, grupo: detail.grupo ?? null, id_ubicacion_actual: detail.id_ubicacion_actual ?? null, ubicacion: detail.ubicacion ?? null, seleccionado: detail.seleccionado, observaciones: detail.observaciones ?? null })) }, id_ubicacion_destino: item.id_ubicacion_destino ?? '', id_grupo_destino: item.id_grupo_destino ?? '', fecha_movimiento: dateInputValue(item.fecha_movimiento), motivo: item.motivo ?? '', observaciones: item.observaciones ?? '' });
    setEditing(item); setSelected(null); setCreating(true);
  };

  const action = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'apply' | 'cancel' }) => apiRequest(`/movimientos/${id}/${kind === 'apply' ? 'aplicar' : 'cancelar'}`, { method: 'POST' }),
    onSuccess: (_, variables) => {
      toast.show(variables.kind === 'apply' ? 'Movimiento aplicado.' : 'Movimiento cancelado.');
      void queryClient.invalidateQueries({ queryKey: ['movements'] });
      void queryClient.invalidateQueries({ queryKey: ['animals'] });
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  return <div>
    <PageHeader
      title="Movimientos"
      description="Cambia la ubicación o el grupo de todos, un grupo completo o animales seleccionados."
      action={hasPermission('MOVIMIENTO_CREAR') ? <Button onClick={() => { setForm(emptyForm()); setCreating(true); }}><Plus size={18} />Nuevo movimiento</Button> : undefined}
    />

    <ListToolbar search={list.search} onSearch={list.setSearch} order={list.order} onOrder={list.setOrder} placeholder="Buscar por motivo, origen, destino o animal…" count={list.visible.length} />

    {movements.isLoading ? <LoadingState /> : movements.isError ? <ErrorState message={(movements.error as Error).message} onRetry={() => void movements.refetch()} /> : list.visible.length ? <Card className="record-list movements-record-list"><div className="record-list-head"><span>Movimiento</span><span>Fecha</span><span>Origen</span><span>Destino</span><span>Estado</span><span /></div>{list.visible.map((movement) => <button type="button" className="record-list-row" key={movement.id_movimiento} onClick={() => setSelected(movement)}><span><strong>{movement.motivo || 'Movimiento de animales'}</strong><small>{movement.total_seleccionados} de {movement.total_candidatos} animales</small></span><span><strong>{formatDate(movement.fecha_movimiento)}</strong></span><span><strong>{movement.ubicacion_origen || movement.grupo_origen || 'Varias ubicaciones'}</strong></span><span><strong>{movement.ubicacion_destino || movement.grupo_destino || 'Sin destino'}</strong></span><span><Badge tone={movementTone(movement.estado)}>{humanizeCode(movement.estado)}</Badge></span><span className="record-row-actions">{movement.estado !== 'CANCELADO' && hasPermission('MOVIMIENTO_CREAR') ? <Button variant="ghost" onClick={(event) => { event.stopPropagation(); editMovement(movement); }}><Edit3 size={16} />Editar</Button> : null}<ChevronRight size={18} /></span></button>)}</Card> : <EmptyState icon={ArrowLeftRight} title="Aún no hay movimientos" description="Registra un cambio de grupo, potrero, corral u otra ubicación." action={hasPermission('MOVIMIENTO_CREAR') ? <Button onClick={() => setCreating(true)}><Plus size={18} />Crear movimiento</Button> : undefined} />}

    {selected ? <MovementDetailModal item={selected} onClose={() => setSelected(null)} onEdit={selected.estado !== 'CANCELADO' && hasPermission('MOVIMIENTO_CREAR') ? () => editMovement(selected) : undefined} onApply={selected.estado === 'BORRADOR' && hasPermission('MOVIMIENTO_CREAR') ? () => action.mutate({ id: selected.id_movimiento, kind: 'apply' }) : undefined} onCancel={selected.estado === 'BORRADOR' && hasPermission('MOVIMIENTO_ANULAR') ? () => action.mutate({ id: selected.id_movimiento, kind: 'cancel' }) : undefined} loading={action.isPending} /> : null}

    {creating ? <Modal title={editing ? 'Editar movimiento' : 'Nuevo movimiento'} wide onClose={() => { setCreating(false); setEditing(null); }} footer={<><Button variant="ghost" onClick={() => { setCreating(false); setEditing(null); }}>Cancelar</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={(!editing || editing.estado === 'BORRADOR') && !form.selection.animals.some((item) => item.seleccionado)}>{editing ? 'Guardar cambios' : 'Guardar borrador'}</Button></>}>
      <div className="form-stack">
        <div className="form-section">
          <h3>Destino y fecha</h3>
          <Field label="Tipo de movimiento" required hint="La propiedad se gestiona mediante las ubicaciones externas registradas en Catálogos.">
            <Select disabled={Boolean(editing && editing.estado !== 'BORRADOR')} value={form.kind} onChange={(event) => setForm((current) => {
              const kind = event.target.value as MovementKind;
              return { ...current, kind, selection: { ...current.selection, animals: [] }, id_ubicacion_destino: '', id_grupo_destino: '' };
            })}>
              <option value="UBICACION">Cambiar ubicación (potrero o corral)</option>
              <option value="GRUPO">Cambiar de grupo</option>
              <option value="PROPIEDAD">Trasladar a otra propiedad</option>
              {form.kind === 'COMBINADO' ? <option value="COMBINADO">Movimiento combinado anterior</option> : null}
            </Select>
          </Field>
          <div className="form-grid">
            {form.kind !== 'GRUPO' ? <Field label={form.kind === 'PROPIEDAD' ? 'Propiedad de destino' : 'Potrero o corral de destino'} hint={editing && editing.estado !== 'BORRADOR' ? 'Se conserva porque el movimiento ya fue aplicado.' : 'Después se mostrarán solamente los grupos vinculados con este destino.'} required>
              <Select disabled={Boolean(editing && editing.estado !== 'BORRADOR')} value={form.id_ubicacion_destino} onChange={(event) => setForm((current) => ({ ...current, id_ubicacion_destino: event.target.value, id_grupo_destino: '', selection: { ...current.selection, animals: [] } }))}>
                <option value="">Selecciona</option>
                {locations.data?.filter((item) => item.activo && (item.id_ubicacion === form.id_ubicacion_destino || (form.kind === 'PROPIEDAD' ? item.tipo === 'OTRO' : form.kind === 'UBICACION' ? item.tipo !== 'OTRO' : true))).map((item) => <option key={item.id_ubicacion} value={item.id_ubicacion}>{item.nombre} · {item.tipo === 'OTRO' ? item.categoria : humanizeCode(item.tipo)}</option>)}
              </Select>
            </Field> : null}
            <Field label="Grupo de destino" hint={form.kind === 'GRUPO' ? 'Solo aparecen grupos de la misma situación y ubicación.' : 'El grupo y el destino siempre quedarán vinculados.'} required>
              <Select disabled={Boolean(editing && editing.estado !== 'BORRADOR') || (form.kind !== 'GRUPO' && !form.id_ubicacion_destino)} value={form.id_grupo_destino} onChange={(event) => {
                const group = groups.data?.find((item) => item.id_grupo === event.target.value);
                setForm((current) => ({ ...current, id_grupo_destino: event.target.value, id_ubicacion_destino: current.kind === 'GRUPO' ? group?.id_ubicacion_actual ?? '' : current.id_ubicacion_destino }));
              }}>
                <option value="">Selecciona</option>
                {targetGroups?.map((item) => <option key={item.id_grupo} value={item.id_grupo}>{item.nombre} · {item.categoria} · {item.ubicacion}</option>)}
              </Select>
            </Field>
            <Field label="Fecha" required><Input type="date" value={form.fecha_movimiento} onChange={(event) => setForm((current) => ({ ...current, fecha_movimiento: event.target.value }))} /></Field>
            <Field label="Motivo"><Input value={form.motivo} onChange={(event) => setForm((current) => ({ ...current, motivo: event.target.value }))} placeholder="Rotación de potrero, cambio de lote…" /></Field>
          </div>
          <Field label="Observaciones"><Textarea value={form.observaciones} onChange={(event) => setForm((current) => ({ ...current, observaciones: event.target.value }))} /></Field>
        </div>
        {editing && editing.estado !== 'BORRADOR' ? <div className="form-alert"><strong>Movimiento aplicado.</strong> Puedes corregir fecha, motivo y observaciones. El recorrido y los animales se mantienen para conservar el historial.</div> : <AnimalSelectionBuilder value={form.selection} operationCode={operationCode} excludeLocationId={form.kind === 'GRUPO' ? undefined : form.id_ubicacion_destino || undefined} onChange={(selection) => setForm((current) => ({ ...current, selection }))} />}
      </div>
    </Modal> : null}
  </div>;
}

function MovementDetailModal({ item, onClose, onEdit, onApply, onCancel, loading }: { item: Movement; onClose: () => void; onEdit?: () => void; onApply?: () => void; onCancel?: () => void; loading: boolean }) {
  return <Modal title="Detalle del movimiento" wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cerrar</Button>{onCancel ? <Button variant="ghost" onClick={onCancel} loading={loading}><Ban size={17} />Cancelar movimiento</Button> : null}{onEdit ? <Button variant="secondary" onClick={onEdit}><Edit3 size={17} />Editar</Button> : null}{onApply ? <Button onClick={onApply} loading={loading}><CheckCircle2 size={17} />Aplicar</Button> : null}</>}><div className="record-detail"><div className="record-detail-heading"><div className="record-icon"><ArrowLeftRight size={22} /></div><div><h2>{item.motivo || 'Movimiento de animales'}</h2><p>{formatDate(item.fecha_movimiento)}</p></div><Badge tone={movementTone(item.estado)}>{humanizeCode(item.estado)}</Badge></div><div className="detail-grid"><div><small>Origen</small><strong>{item.ubicacion_origen || item.grupo_origen || 'Varias ubicaciones'}</strong></div><div><small>Destino</small><strong>{item.ubicacion_destino || item.grupo_destino || 'Sin destino'}</strong></div><div><small>Seleccionados</small><strong>{item.total_seleccionados}</strong></div><div><small>Candidatos</small><strong>{item.total_candidatos}</strong></div></div><section><h3>Animales</h3><div className="detail-lines compact">{item.detalles.map((detail) => <div key={detail.id_detalle} className={!detail.seleccionado ? 'excluded' : ''}><span><strong>{detail.animal}</strong><small>{detail.arete ? `Arete ${detail.arete}` : 'Sin arete'}</small></span><Badge tone={detail.seleccionado ? 'success' : 'neutral'}>{detail.seleccionado ? humanizeCode(detail.estado) : 'Excluido'}</Badge></div>)}</div></section>{item.observaciones ? <section><h3>Observaciones</h3><p>{item.observaciones}</p></section> : null}</div></Modal>;
}
