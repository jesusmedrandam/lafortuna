import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Ban, CheckCircle2, ClipboardCheck, Plus, Users } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AnimalSelectionBuilder, type AnimalSelectionValue } from '../../components/AnimalSelectionBuilder';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Textarea } from '../../components/ui';
import type { Group, Location, Movement } from '../../types/api';
import { formatDateTime, humanizeCode } from '../../utils';

const nowLocal = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

interface MovementForm {
  selection: AnimalSelectionValue;
  id_ubicacion_destino: string;
  id_grupo_destino: string;
  fecha_movimiento: string;
  motivo: string;
  observaciones: string;
}

const emptyForm = (): MovementForm => ({
  selection: { mode: 'GRUPO', groupId: '', animals: [] },
  id_ubicacion_destino: '',
  id_grupo_destino: '',
  fecha_movimiento: nowLocal(),
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
  const { hasPermission } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<MovementForm>(emptyForm);
  const movements = useQuery({ queryKey: ['movements'], queryFn: () => apiRequest<Movement[]>('/movimientos') });
  const groups = useQuery({ queryKey: ['groups', 'movement'], queryFn: () => apiRequest<Group[]>('/grupos?limit=100') });
  const locations = useQuery({ queryKey: ['locations', 'movement'], queryFn: () => apiRequest<Location[]>('/ubicaciones') });

  const create = useMutation({
    mutationFn: async () => {
      const selected = form.selection.animals.filter((animal) => animal.seleccionado);
      if (!selected.length) throw new Error('Selecciona al menos un animal.');
      if (!form.id_ubicacion_destino && !form.id_grupo_destino) throw new Error('Selecciona una ubicación o grupo de destino.');
      const movement = await apiRequest<Movement>('/movimientos', {
        method: 'POST',
        body: {
          modo_seleccion: form.selection.mode,
          id_grupo_filtro: form.selection.mode === 'GRUPO' ? form.selection.groupId : null,
          id_ubicacion_destino: form.id_ubicacion_destino || null,
          id_grupo_destino: form.id_grupo_destino || null,
          fecha_movimiento: new Date(form.fecha_movimiento).toISOString(),
          motivo: form.motivo.trim() || null,
          observaciones: form.observaciones.trim() || null,
          animales: form.selection.animals.map((animal) => ({
            id_animal: animal.id_animal,
            seleccionado: animal.seleccionado,
            id_ubicacion_destino: form.id_ubicacion_destino || null,
            id_grupo_destino: form.id_grupo_destino || null,
            observaciones: animal.observaciones || null,
          })),
        },
      });
      return movement;
    },
    onSuccess: () => {
      toast.show('Movimiento guardado como borrador.');
      setCreating(false);
      setForm(emptyForm());
      void queryClient.invalidateQueries({ queryKey: ['movements'] });
    },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

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

    {movements.isLoading ? <LoadingState /> : movements.isError ? <ErrorState message={(movements.error as Error).message} onRetry={() => void movements.refetch()} /> : movements.data?.length ? <div className="record-grid operation-grid">
      {movements.data.map((movement) => <Card className="operation-card" key={movement.id_movimiento}>
        <div className="operation-card-header">
          <div className="operation-icon"><ArrowLeftRight size={23} /></div>
          <div><h3>{movement.motivo || 'Movimiento de animales'}</h3><span>{formatDateTime(movement.fecha_movimiento)}</span></div>
          <Badge tone={movementTone(movement.estado)}>{humanizeCode(movement.estado)}</Badge>
        </div>
        <div className="route-summary">
          <div><small>Origen</small><strong>{movement.ubicacion_origen || movement.grupo_origen || 'Varias ubicaciones'}</strong></div>
          <ArrowLeftRight size={20} />
          <div><small>Destino</small><strong>{movement.ubicacion_destino || movement.grupo_destino || 'Sin destino'}</strong></div>
        </div>
        <div className="operation-stats"><span><Users size={16} />{movement.total_seleccionados} seleccionados</span><span><ClipboardCheck size={16} />{movement.total_candidatos} candidatos</span></div>
        {movement.detalles?.length ? <details className="operation-details"><summary>Ver animales</summary><div>{movement.detalles.map((detail) => <span key={detail.id_detalle} className={!detail.seleccionado ? 'excluded' : ''}>{detail.seleccionado ? '✓' : '—'} {detail.animal}{detail.arete ? ` · ${detail.arete}` : ''}{detail.estado !== 'PENDIENTE' ? ` · ${humanizeCode(detail.estado)}` : ''}</span>)}</div></details> : null}
        {movement.observaciones ? <p className="muted operation-notes">{movement.observaciones}</p> : null}
        {movement.estado === 'BORRADOR' ? <div className="card-actions">
          {hasPermission('MOVIMIENTO_ANULAR') ? <Button variant="ghost" onClick={() => action.mutate({ id: movement.id_movimiento, kind: 'cancel' })} loading={action.isPending}><Ban size={17} />Cancelar</Button> : null}
          {hasPermission('MOVIMIENTO_CREAR') ? <Button onClick={() => action.mutate({ id: movement.id_movimiento, kind: 'apply' })} loading={action.isPending}><CheckCircle2 size={17} />Aplicar</Button> : null}
        </div> : null}
      </Card>)}
    </div> : <EmptyState icon={ArrowLeftRight} title="Aún no hay movimientos" description="Registra un cambio de grupo, potrero, corral u otra ubicación." action={hasPermission('MOVIMIENTO_CREAR') ? <Button onClick={() => setCreating(true)}><Plus size={18} />Crear movimiento</Button> : undefined} />}

    {creating ? <Modal title="Nuevo movimiento" wide onClose={() => setCreating(false)} footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button><Button onClick={() => create.mutate()} loading={create.isPending} disabled={!form.selection.animals.some((item) => item.seleccionado)}>Guardar borrador</Button></>}>
      <div className="form-stack">
        <div className="form-section">
          <h3>Destino y fecha</h3>
          <div className="form-grid">
            <Field label="Ubicación de destino">
              <Select value={form.id_ubicacion_destino} onChange={(event) => setForm((current) => ({ ...current, id_ubicacion_destino: event.target.value }))}>
                <option value="">No cambiar ubicación</option>
                {locations.data?.filter((item) => item.activo).map((item) => <option key={item.id_ubicacion} value={item.id_ubicacion}>{item.nombre} · {item.tipo}</option>)}
              </Select>
            </Field>
            <Field label="Grupo de destino">
              <Select value={form.id_grupo_destino} onChange={(event) => setForm((current) => ({ ...current, id_grupo_destino: event.target.value }))}>
                <option value="">No cambiar grupo</option>
                {groups.data?.filter((item) => item.activo).map((item) => <option key={item.id_grupo} value={item.id_grupo}>{item.nombre}</option>)}
              </Select>
            </Field>
            <Field label="Fecha y hora" required><Input type="datetime-local" value={form.fecha_movimiento} onChange={(event) => setForm((current) => ({ ...current, fecha_movimiento: event.target.value }))} /></Field>
            <Field label="Motivo"><Input value={form.motivo} onChange={(event) => setForm((current) => ({ ...current, motivo: event.target.value }))} placeholder="Rotación de potrero, cambio de lote…" /></Field>
          </div>
          <Field label="Observaciones"><Textarea value={form.observaciones} onChange={(event) => setForm((current) => ({ ...current, observaciones: event.target.value }))} /></Field>
        </div>
        <AnimalSelectionBuilder value={form.selection} onChange={(selection) => setForm((current) => ({ ...current, selection }))} />
      </div>
    </Modal> : null}
  </div>;
}
