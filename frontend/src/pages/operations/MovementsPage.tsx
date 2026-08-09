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
import { itemId, itemLabel, useCatalog } from '../../hooks/useCatalog';
import type { Group, Location, Movement, Property, SelectableAnimal } from '../../types/api';
import { currentDateInput, dateInputValue, formatDate, humanizeCode } from '../../utils';

type MovementKind = 'UBICACION' | 'GRUPO' | 'PROPIEDAD' | 'COMBINADO';

interface MovementForm {
  kind: MovementKind;
  id_propiedad_origen: string;
  id_propiedad_destino: string;
  selection: AnimalSelectionValue;
  id_ubicacion_destino: string;
  id_grupo_destino: string;
  fecha_movimiento: string;
  id_motivo_movimiento: string;
  observaciones: string;
}

const emptyForm = (): MovementForm => ({
  kind: 'UBICACION',
  id_propiedad_origen: '',
  id_propiedad_destino: '',
  selection: { mode: 'GRUPO', groupId: '', animals: [] },
  id_ubicacion_destino: '',
  id_grupo_destino: '',
  fecha_movimiento: currentDateInput(),
  id_motivo_movimiento: '',
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
  const properties = useQuery({ queryKey: ['properties', 'movement'], queryFn: () => apiRequest<Property[]>('/propiedades') });
  const groups = useQuery({ queryKey: ['groups', 'movement'], queryFn: () => apiRequest<Group[]>('/grupos?limit=100') });
  const locations = useQuery({ queryKey: ['locations', 'movement'], queryFn: () => apiRequest<Location[]>('/ubicaciones') });
  const reasons = useCatalog('motivos-movimiento');

  const sourceGroup = groups.data?.find((item) => item.id_grupo === form.selection.groupId);
  const destinationGroup = groups.data?.find((item) => item.id_grupo === form.id_grupo_destino);
  const sourceLocationId = sourceGroup?.id_ubicacion_actual ?? null;
  const selectedLocationIds = [...new Set(form.selection.animals.filter((item) => item.seleccionado).map((item) => item.id_ubicacion_actual).filter(Boolean))];
  const destinationGroups = groups.data?.filter((item) => item.activo && item.id_propiedad === form.id_propiedad_destino && Boolean(item.id_ubicacion_actual) && (form.kind !== 'GRUPO' || item.id_grupo !== form.selection.groupId));
  const destinationLocations = locations.data?.filter((item) => item.activo && item.id_propiedad === form.id_propiedad_destino && ['POTRERO', 'CORRAL'].includes(item.tipo) && (form.kind !== 'UBICACION' || item.id_ubicacion !== sourceLocationId));

  useEffect(() => {
    if (editing || form.id_propiedad_origen || !properties.data?.length) return;
    const preferred = properties.data.find((item) => item.es_principal && item.activa) ?? properties.data.find((item) => item.activa);
    if (preferred) setForm((current) => ({ ...current, id_propiedad_origen: preferred.id_propiedad, id_propiedad_destino: current.kind === 'PROPIEDAD' ? '' : preferred.id_propiedad }));
  }, [editing,form.id_propiedad_origen,properties.data]);

  useEffect(() => {
    if (consumedInitialAnimal.current) return;
    const initialAnimal = (route.state as { initialAnimal?: SelectableAnimal } | null)?.initialAnimal;
    if (!initialAnimal) return;
    consumedInitialAnimal.current = true;
    const propertyId = initialAnimal.id_propiedad ?? groups.data?.find((item) => item.id_grupo === initialAnimal.id_grupo_actual)?.id_propiedad ?? '';
    setForm({ ...emptyForm(), kind: 'GRUPO', id_propiedad_origen: propertyId, id_propiedad_destino: propertyId, selection: { mode: 'SELECCION_MANUAL', groupId: '', animals: [{ ...initialAnimal, seleccionado: true }] } });
    setCreating(true);
    navigate(route.pathname, { replace: true, state: null });
  }, [groups.data,navigate,route.pathname,route.state]);

  const operationCode = form.kind === 'UBICACION'
    ? 'MOVIMIENTO_UBICACION'
    : form.kind === 'GRUPO'
      ? 'MOVIMIENTO_GRUPO'
      : ['MOVIMIENTO_PROPIEDAD', 'MOVIMIENTO_GRUPO'];

  const updateSelection = (selection: AnimalSelectionValue) => setForm((current) => {
    const nextSourceGroup = groups.data?.find((item) => item.id_grupo === selection.groupId);
    if (current.kind === 'UBICACION') {
      return {
        ...current,
        selection: { ...selection, mode: 'GRUPO' },
        id_grupo_destino: selection.groupId,
        id_ubicacion_destino: nextSourceGroup?.id_ubicacion_actual === current.id_ubicacion_destino ? '' : current.id_ubicacion_destino,
      };
    }
    return { ...current, selection };
  });

  const save = useMutation({
    mutationFn: async () => {
      const canChangeRoute = !editing || editing.estado === 'BORRADOR';
      const selectedAnimals = form.selection.animals.filter((animal) => animal.seleccionado);
      if (canChangeRoute && !form.id_propiedad_origen) throw new Error('Selecciona la propiedad de origen.');
      if (canChangeRoute && !form.id_propiedad_destino) throw new Error('Selecciona la propiedad de destino.');
      if (canChangeRoute && !selectedAnimals.length) throw new Error('Selecciona al menos un animal.');
      if (canChangeRoute && form.kind === 'UBICACION' && (!form.selection.groupId || form.selection.mode !== 'GRUPO')) throw new Error('Selecciona el grupo completo que deseas cambiar de potrero o corral.');
      if (canChangeRoute && !form.id_grupo_destino) throw new Error('Selecciona el grupo de destino.');
      if (canChangeRoute && !form.id_ubicacion_destino) throw new Error('Selecciona o define el potrero o corral de destino.');
      if (!form.id_motivo_movimiento) throw new Error('Selecciona el motivo del movimiento.');

      const commonOriginLocation = sourceGroup?.id_ubicacion_actual ?? (selectedLocationIds.length === 1 ? selectedLocationIds[0] : null);
      const body = {
        tipo_movimiento: form.kind,
        modo_seleccion: form.kind === 'UBICACION' ? 'GRUPO' : form.selection.mode,
        id_propiedad_origen: form.id_propiedad_origen,
        id_propiedad_destino: form.id_propiedad_destino,
        id_grupo_filtro: form.selection.mode === 'GRUPO' ? form.selection.groupId : null,
        id_ubicacion_origen: commonOriginLocation,
        id_ubicacion_destino: form.id_ubicacion_destino,
        id_grupo_origen: form.selection.mode === 'GRUPO' ? form.selection.groupId : null,
        id_grupo_destino: form.id_grupo_destino,
        id_motivo_movimiento: form.id_motivo_movimiento,
        fecha_movimiento: form.fecha_movimiento,
        observaciones: form.observaciones.trim() || null,
        animales: form.selection.animals.map((animal) => ({
          id_animal: animal.id_animal,
          seleccionado: animal.seleccionado,
          id_ubicacion_destino: form.id_ubicacion_destino,
          id_grupo_destino: form.id_grupo_destino,
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
      setCreating(false); setEditing(null); setForm(emptyForm());
      void queryClient.invalidateQueries({ queryKey: ['movements'] });
    },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  const list = useListControls({
    items: movements.data ?? [], storageKey: 'movements',
    searchText: (item) => `${item.motivo_catalogo ?? item.motivo ?? ''} ${item.propiedad_origen ?? ''} ${item.propiedad_destino ?? ''} ${item.ubicacion_origen ?? ''} ${item.ubicacion_destino ?? ''} ${item.grupo_origen ?? ''} ${item.grupo_destino ?? ''} ${item.detalles.map((detail) => `${detail.animal} ${detail.arete ?? ''}`).join(' ')}`,
    dateValue: (item) => item.fecha_movimiento,
    nameValue: (item) => item.motivo_catalogo || item.motivo || item.propiedad_destino || '',
  });

  const editMovement = (item: Movement) => {
    const kind = item.tipo_movimiento ?? 'GRUPO';
    setForm({
      kind,
      id_propiedad_origen: item.id_propiedad_origen,
      id_propiedad_destino: item.id_propiedad_destino,
      selection: {
        mode: item.modo_seleccion,
        groupId: item.id_grupo_filtro ?? '',
        animals: item.detalles.map((detail) => ({
          id_animal: detail.id_animal, nombre: detail.nombre ?? detail.animal,
          codigo_arete: detail.codigo_arete ?? detail.arete, sexo: detail.sexo ?? 'HEMBRA',
          id_categoria_animal: detail.id_categoria_animal ?? '', categoria: detail.categoria ?? '',
          id_propiedad: detail.id_propiedad ?? item.id_propiedad_origen,
          id_grupo_actual: detail.id_grupo_actual ?? null, grupo: detail.grupo ?? null,
          id_ubicacion_actual: detail.id_ubicacion_actual ?? null, ubicacion: detail.ubicacion ?? null,
          seleccionado: detail.seleccionado, observaciones: detail.observaciones ?? null,
        })),
      },
      id_ubicacion_destino: item.id_ubicacion_destino ?? '',
      id_grupo_destino: item.id_grupo_destino ?? '',
      id_motivo_movimiento: item.id_motivo_movimiento ?? '',
      fecha_movimiento: dateInputValue(item.fecha_movimiento),
      observaciones: item.observaciones ?? '',
    });
    setEditing(item); setSelected(null); setCreating(true);
  };

  const action = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'apply' | 'cancel' }) => apiRequest(`/movimientos/${id}/${kind === 'apply' ? 'aplicar' : 'cancelar'}`, { method: 'POST' }),
    onSuccess: (_, variables) => {
      toast.show(variables.kind === 'apply' ? 'Movimiento aplicado.' : 'Movimiento cancelado.');
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: ['movements'] });
      void queryClient.invalidateQueries({ queryKey: ['animals'] });
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
      void queryClient.invalidateQueries({ queryKey: ['pastures'] });
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const openNew = () => { setEditing(null); setForm(emptyForm()); setCreating(true); };
  const routeLocked = Boolean(editing && editing.estado !== 'BORRADOR');

  return <div>
    <PageHeader title="Movimientos" description="Mueve grupos completos entre potreros, cambia animales de grupo o trasládalos entre propiedades." action={hasPermission('MOVIMIENTO_CREAR') ? <Button onClick={openNew}><Plus size={18} />Nuevo movimiento</Button> : undefined} />
    <ListToolbar search={list.search} onSearch={list.setSearch} order={list.order} onOrder={list.setOrder} placeholder="Buscar por propiedad, motivo, origen, destino o animal…" count={list.visible.length} />

    {movements.isLoading ? <LoadingState /> : movements.isError ? <ErrorState message={(movements.error as Error).message} onRetry={() => void movements.refetch()} /> : list.visible.length ? <Card className="record-list movements-record-list"><div className="record-list-head"><span>Movimiento</span><span>Fecha</span><span>Origen</span><span>Destino</span><span>Estado</span><span /></div>{list.visible.map((movement) => <button type="button" className="record-list-row" key={movement.id_movimiento} onClick={() => setSelected(movement)}><span><strong>{movement.motivo_catalogo || movement.motivo || 'Movimiento de animales'}</strong><small>{movement.total_seleccionados} animales · {humanizeCode(movement.tipo_movimiento)}</small></span><span><strong>{formatDate(movement.fecha_movimiento)}</strong></span><span><strong>{movement.propiedad_origen}</strong><small>{movement.grupo_origen || movement.ubicacion_origen || 'Varios grupos'}</small></span><span><strong>{movement.propiedad_destino}</strong><small>{movement.grupo_destino || movement.ubicacion_destino || 'Sin destino'}</small></span><span><Badge tone={movementTone(movement.estado)}>{humanizeCode(movement.estado)}</Badge></span><span className="record-row-actions">{movement.estado !== 'CANCELADO' && hasPermission('MOVIMIENTO_CREAR') ? <Button variant="ghost" onClick={(event) => { event.stopPropagation(); editMovement(movement); }}><Edit3 size={16} />Editar</Button> : null}<ChevronRight size={18} /></span></button>)}</Card> : <EmptyState icon={ArrowLeftRight} title="Aún no hay movimientos" description="Registra un cambio de grupo, potrero, corral o propiedad." action={hasPermission('MOVIMIENTO_CREAR') ? <Button onClick={openNew}><Plus size={18} />Crear movimiento</Button> : undefined} />}

    {selected ? <MovementDetailModal item={selected} onClose={() => setSelected(null)} onEdit={selected.estado !== 'CANCELADO' && hasPermission('MOVIMIENTO_CREAR') ? () => editMovement(selected) : undefined} onApply={selected.estado === 'BORRADOR' && hasPermission('MOVIMIENTO_CREAR') ? () => action.mutate({ id: selected.id_movimiento, kind: 'apply' }) : undefined} onCancel={selected.estado === 'BORRADOR' && hasPermission('MOVIMIENTO_ANULAR') ? () => action.mutate({ id: selected.id_movimiento, kind: 'cancel' }) : undefined} loading={action.isPending} /> : null}

    {creating ? <Modal title={editing ? 'Editar movimiento' : 'Nuevo movimiento'} wide onClose={() => { setCreating(false); setEditing(null); }} footer={<><Button variant="ghost" onClick={() => { setCreating(false); setEditing(null); }}>Cancelar</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!routeLocked && !form.selection.animals.some((item) => item.seleccionado)}>{editing ? 'Guardar cambios' : 'Guardar borrador'}</Button></>}>
      <div className="form-stack">
        <div className="form-section"><h3>1. Tipo de movimiento</h3><Field label="Tipo" required><Select disabled={routeLocked} value={form.kind} onChange={(event) => { const kind = event.target.value as MovementKind; setForm((current) => ({ ...emptyForm(), kind, id_propiedad_origen: current.id_propiedad_origen, id_propiedad_destino: kind === 'PROPIEDAD' ? '' : current.id_propiedad_origen, selection: { mode: kind === 'UBICACION' ? 'GRUPO' : 'SELECCION_MANUAL', groupId: '', animals: [] } })); }}><option value="UBICACION">Cambiar grupo de potrero o corral</option><option value="GRUPO">Cambiar animales de grupo</option><option value="PROPIEDAD">Trasladar a otra propiedad</option>{form.kind === 'COMBINADO' ? <option value="COMBINADO">Movimiento combinado anterior</option> : null}</Select></Field></div>

        {routeLocked ? <div className="form-alert"><strong>Movimiento aplicado.</strong> Solo puedes corregir la fecha, el motivo y las observaciones.</div> : <>
          <div className="form-section"><h3>2. Propiedad de origen{form.kind === 'PROPIEDAD' ? ' y destino' : ''}</h3><div className="form-grid"><Field label={form.kind === 'PROPIEDAD' ? 'Propiedad de origen' : 'Propiedad'} required><Select value={form.id_propiedad_origen} onChange={(event) => { const id = event.target.value; setForm((current) => ({ ...current, id_propiedad_origen: id, id_propiedad_destino: current.kind === 'PROPIEDAD' ? (current.id_propiedad_destino === id ? '' : current.id_propiedad_destino) : id, selection: { mode: current.kind === 'UBICACION' ? 'GRUPO' : current.selection.mode, groupId: '', animals: [] }, id_grupo_destino: '', id_ubicacion_destino: '' })); }}><option value="">Selecciona</option>{properties.data?.filter((item) => item.activa).map((item) => <option key={item.id_propiedad} value={item.id_propiedad}>{item.nombre}{item.es_principal ? ' · Principal' : ''}</option>)}</Select></Field>{form.kind === 'PROPIEDAD' ? <Field label="Propiedad de destino" required><Select value={form.id_propiedad_destino} onChange={(event) => setForm((current) => ({ ...current, id_propiedad_destino: event.target.value, id_grupo_destino: '', id_ubicacion_destino: '' }))}><option value="">Selecciona</option>{properties.data?.filter((item) => item.activa && item.id_propiedad !== form.id_propiedad_origen).map((item) => <option key={item.id_propiedad} value={item.id_propiedad}>{item.nombre}{item.es_principal ? ' · Principal' : ''}</option>)}</Select></Field> : null}</div></div>

          <div className="form-section"><h3>3. {form.kind === 'UBICACION' ? 'Grupo que se trasladará' : 'Animales de origen'}</h3>{form.id_propiedad_origen ? <AnimalSelectionBuilder value={form.selection} propertyId={form.id_propiedad_origen} operationCode={operationCode} allowedModes={form.kind === 'UBICACION' ? ['GRUPO'] : undefined} onChange={updateSelection} /> : <p className="muted">Selecciona primero la propiedad de origen.</p>}</div>

          <div className="form-section"><h3>4. Destino</h3><div className="form-grid">
            {form.kind === 'UBICACION' ? <Field label="Potrero o corral de destino" required hint="No se muestra la ubicación actual del grupo."><Select disabled={!sourceGroup} value={form.id_ubicacion_destino} onChange={(event) => setForm((current) => ({ ...current, id_ubicacion_destino: event.target.value, id_grupo_destino: current.selection.groupId }))}><option value="">Selecciona</option>{destinationLocations?.map((item) => <option key={item.id_ubicacion} value={item.id_ubicacion}>{item.nombre} · {humanizeCode(item.tipo)}</option>)}</Select></Field> : <Field label="Grupo de destino" required hint="El potrero o corral se asignará automáticamente desde este grupo."><Select disabled={!form.id_propiedad_destino} value={form.id_grupo_destino} onChange={(event) => { const group = groups.data?.find((item) => item.id_grupo === event.target.value); setForm((current) => ({ ...current, id_grupo_destino: event.target.value, id_ubicacion_destino: group?.id_ubicacion_actual ?? '', selection: { ...current.selection, animals: current.selection.animals.filter((animal) => animal.id_grupo_actual !== event.target.value) } })); }}><option value="">Selecciona</option>{destinationGroups?.map((item) => <option key={item.id_grupo} value={item.id_grupo}>{item.nombre} · {item.ubicacion} · {item.propiedad}</option>)}</Select></Field>}
            {form.kind === 'UBICACION' ? <Field label="Grupo" hint="El grupo se conserva y todos sus animales se moverán juntos."><Input readOnly value={sourceGroup?.nombre ?? ''} placeholder="Selecciona el grupo de origen" /></Field> : <Field label="Potrero o corral asignado"><Input readOnly value={destinationGroup?.ubicacion ?? ''} placeholder="Se define al seleccionar el grupo" /></Field>}
          </div></div>
        </>}

        <div className="form-section"><h3>{routeLocked ? 'Datos editables' : '5. Datos del movimiento'}</h3><div className="form-grid"><Field label="Fecha" required><Input type="date" value={form.fecha_movimiento} onChange={(event) => setForm((current) => ({ ...current, fecha_movimiento: event.target.value }))} /></Field><Field label="Motivo" required><Select value={form.id_motivo_movimiento} onChange={(event) => setForm((current) => ({ ...current, id_motivo_movimiento: event.target.value }))}><option value="">Selecciona</option>{reasons.data?.filter((item) => item.activo !== false || itemId(item) === form.id_motivo_movimiento).map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field></div><Field label="Observaciones"><Textarea value={form.observaciones} onChange={(event) => setForm((current) => ({ ...current, observaciones: event.target.value }))} /></Field></div>
      </div>
    </Modal> : null}
  </div>;
}

function MovementDetailModal({ item, onClose, onEdit, onApply, onCancel, loading }: { item: Movement; onClose: () => void; onEdit?: () => void; onApply?: () => void; onCancel?: () => void; loading: boolean }) {
  return <Modal title="Detalle del movimiento" wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cerrar</Button>{onCancel ? <Button variant="ghost" onClick={onCancel} loading={loading}><Ban size={17} />Cancelar movimiento</Button> : null}{onEdit ? <Button variant="secondary" onClick={onEdit}><Edit3 size={17} />Editar</Button> : null}{onApply ? <Button onClick={onApply} loading={loading}><CheckCircle2 size={17} />Aplicar</Button> : null}</>}><div className="record-detail"><div className="record-detail-heading"><div className="record-icon"><ArrowLeftRight size={22} /></div><div><h2>{item.motivo_catalogo || item.motivo || 'Movimiento de animales'}</h2><p>{formatDate(item.fecha_movimiento)}</p></div><Badge tone={movementTone(item.estado)}>{humanizeCode(item.estado)}</Badge></div><div className="detail-grid"><div><small>Propiedad de origen</small><strong>{item.propiedad_origen}</strong></div><div><small>Propiedad de destino</small><strong>{item.propiedad_destino}</strong></div><div><small>Grupo de origen</small><strong>{item.grupo_origen || 'Varios grupos'}</strong></div><div><small>Grupo de destino</small><strong>{item.grupo_destino || '—'}</strong></div><div><small>Ubicación de origen</small><strong>{item.ubicacion_origen || 'Varias ubicaciones'}</strong></div><div><small>Ubicación de destino</small><strong>{item.ubicacion_destino || '—'}</strong></div><div><small>Seleccionados</small><strong>{item.total_seleccionados}</strong></div></div><section><h3>Animales</h3><div className="detail-lines compact">{item.detalles.map((detail) => <div key={detail.id_detalle} className={!detail.seleccionado ? 'excluded' : ''}><span><strong>{detail.animal}</strong><small>{detail.arete ? `Arete ${detail.arete}` : 'Sin arete'}</small></span><Badge tone={detail.seleccionado ? 'success' : 'neutral'}>{detail.seleccionado ? humanizeCode(detail.estado) : 'Excluido'}</Badge></div>)}</div></section>{item.observaciones ? <section><h3>Observaciones</h3><p>{item.observaciones}</p></section> : null}</div></Modal>;
}
