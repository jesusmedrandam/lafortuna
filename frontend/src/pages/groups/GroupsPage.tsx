import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit3, Plus, Trash2, Users } from 'lucide-react';
import { apiRequest, apiRequestWithMeta, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, SearchBox, Select, Textarea } from '../../components/ui';
import { itemId, itemLabel, useCatalog } from '../../hooks/useCatalog';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import type { Group, Location } from '../../types/api';
import { nullIfEmpty, numberOrNull } from '../../utils';

interface GroupForm {
  codigo: string;
  nombre: string;
  id_tipo_grupo: string;
  id_categoria_animal: string;
  id_ubicacion_actual: string;
  id_especie: string;
  descripcion: string;
  capacidad: string;
  activo: boolean;
}

const empty = (): GroupForm => ({
  codigo: '', nombre: '', id_tipo_grupo: '', id_categoria_animal: '', id_ubicacion_actual: '', id_especie: '', descripcion: '', capacidad: '', activo: true,
});

function GroupModal({ group, onClose }: { group?: Group | null; onClose: () => void }) {
  const toast = useToast();
  const client = useQueryClient();
  const types = useCatalog('tipos-grupo');
  const categories = useCatalog('categorias-animales');
  const species = useCatalog('especies');
  const locations = useQuery({ queryKey: ['locations', 'group-form'], queryFn: () => apiRequest<Location[]>('/ubicaciones') });
  const [form, setForm] = useState<GroupForm>(empty);

  useEffect(() => {
    setForm(group ? {
      codigo: group.codigo ?? '',
      nombre: group.nombre,
      id_tipo_grupo: group.id_tipo_grupo,
      id_categoria_animal: group.id_categoria_animal,
      id_ubicacion_actual: group.id_ubicacion_actual ?? '',
      id_especie: group.id_especie ?? '',
      descripcion: group.descripcion ?? '',
      capacidad: group.capacidad?.toString() ?? '',
      activo: group.activo,
    } : empty());
  }, [group]);

  useEffect(() => {
    if (!form.id_tipo_grupo && types.data?.length) {
      setForm((current) => ({ ...current, id_tipo_grupo: itemId(types.data![0]) }));
    }
  }, [types.data, form.id_tipo_grupo]);

  useEffect(() => {
    if (!group && !form.id_categoria_animal && categories.data?.length) {
      const owned = categories.data.find((item) => String(item.codigo) === 'EN_PROPIEDAD') ?? categories.data[0];
      setForm((current) => ({ ...current, id_categoria_animal: itemId(owned) }));
    }
  }, [categories.data, form.id_categoria_animal, group]);

  const mutation = useMutation({
    mutationFn: () => apiRequest(group ? `/grupos/${group.id_grupo}` : '/grupos', {
      method: group ? 'PATCH' : 'POST',
      body: {
        codigo: nullIfEmpty(form.codigo),
        nombre: form.nombre,
        id_tipo_grupo: form.id_tipo_grupo,
        id_categoria_animal: form.id_categoria_animal,
        id_ubicacion_actual: form.id_ubicacion_actual || null,
        id_especie: form.id_especie || null,
        descripcion: nullIfEmpty(form.descripcion),
        capacidad: numberOrNull(form.capacidad),
        activo: form.activo,
      },
    }),
    onSuccess: async () => {
      toast.show(group ? 'Grupo actualizado.' : 'Grupo creado.');
      await client.invalidateQueries({ queryKey: ['groups'] });
      onClose();
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate();
  }

  return <Modal
    title={group ? 'Editar grupo' : 'Nuevo grupo'}
    onClose={onClose}
    footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" form="group-form" loading={mutation.isPending}>Guardar</Button></>}
  >
    <form id="group-form" className="form-stack" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Nombre" required><Input value={form.nombre} onChange={(event) => setForm((current) => ({ ...current, nombre: event.target.value }))} required /></Field>
        <Field label="Código"><Input value={form.codigo} onChange={(event) => setForm((current) => ({ ...current, codigo: event.target.value }))} /></Field>
        <Field label="Tipo de grupo" required><Select value={form.id_tipo_grupo} onChange={(event) => setForm((current) => ({ ...current, id_tipo_grupo: event.target.value }))} required><option value="">Selecciona</option>{types.data?.map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
        <Field label="Situación de propiedad" hint={group?.total_animales ? 'Para cambiarla, traslada primero todos los animales.' : 'Define qué operaciones pueden realizarse con los animales del grupo.'} required><Select disabled={Boolean(group?.total_animales)} value={form.id_categoria_animal} onChange={(event) => setForm((current) => ({ ...current, id_categoria_animal: event.target.value, id_ubicacion_actual: '' }))} required><option value="">Selecciona</option>{categories.data?.map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
        <Field label="Potrero, corral o propiedad" hint={group?.total_animales ? 'La ubicación de un grupo ocupado se modifica desde Movimientos.' : 'Todos los animales del grupo compartirán esta ubicación.'} required><Select disabled={Boolean(group?.total_animales)} value={form.id_ubicacion_actual} onChange={(event) => setForm((current) => ({ ...current, id_ubicacion_actual: event.target.value }))} required><option value="">Selecciona</option>{locations.data?.filter((item) => item.activo && item.id_categoria_animal === form.id_categoria_animal).map((item) => <option key={item.id_ubicacion} value={item.id_ubicacion}>{item.nombre} · {item.tipo === 'OTRO' ? item.categoria : item.tipo === 'POTRERO' ? 'Potrero' : 'Corral'}</option>)}</Select></Field>
        <Field label="Especie"><Select value={form.id_especie} onChange={(event) => setForm((current) => ({ ...current, id_especie: event.target.value }))}><option value="">Cualquier especie</option>{species.data?.map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
        <Field label="Capacidad"><Input type="number" min="1" value={form.capacidad} onChange={(event) => setForm((current) => ({ ...current, capacidad: event.target.value }))} /></Field>
        <Field label="Estado"><Select value={String(form.activo)} onChange={(event) => setForm((current) => ({ ...current, activo: event.target.value === 'true' }))}><option value="true">Activo</option><option value="false">Inactivo</option></Select></Field>
      </div>
      <Field label="Descripción"><Textarea rows={3} value={form.descripcion} onChange={(event) => setForm((current) => ({ ...current, descripcion: event.target.value }))} /></Field>
    </form>
  </Modal>;
}

export function GroupsPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search);
  const [editing, setEditing] = useState<Group | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Group | null>(null);
  const query = useQuery({
    queryKey: ['groups', debounced],
    queryFn: () => apiRequestWithMeta<Group[]>(`/grupos?limit=100${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiRequest(`/grupos/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.show('Grupo eliminado.');
      setDeleting(null);
      await client.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  return <div>
    <PageHeader title="Grupos" description="Organiza los animales y define si están dentro o fuera de la propiedad." action={hasPermission('GRUPO_ADMINISTRAR') ? <Button onClick={() => setEditing(null)}><Plus size={18} />Nuevo grupo</Button> : undefined} />
    <div className="toolbar"><SearchBox value={search} onChange={setSearch} placeholder="Buscar grupo…" /></div>
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} /> : query.data?.data.length === 0 ? <EmptyState icon={Users} title="Sin grupos" description="Crea un grupo para clasificar tus animales." /> : <div className="record-grid">
      {query.data?.data.map((group) => <Card key={group.id_grupo} className="record-card">
        <div className="record-card-header"><div className="record-icon"><Users size={22} /></div><div><h3>{group.nombre}</h3><span>{group.codigo || 'Sin código'}</span></div><Badge tone={group.activo ? 'success' : 'neutral'}>{group.activo ? 'Activo' : 'Inactivo'}</Badge></div>
        <div className="record-details">
          <span><small>Situación</small><strong>{group.categoria}</strong></span>
          <span><small>Ubicación del grupo</small><strong>{group.ubicacion || 'Pendiente de asignar'}</strong></span>
          <span><small>Tipo</small><strong>{group.tipo_grupo}</strong></span>
          <span><small>Especie</small><strong>{group.especie || 'Todas'}</strong></span>
          <span><small>Animales</small><strong>{group.total_animales}</strong></span>
          <span><small>Capacidad</small><strong>{group.capacidad ?? 'Sin límite'}</strong></span>
        </div>
        <p>{group.descripcion || 'Sin descripción.'}</p>
        {hasPermission('GRUPO_ADMINISTRAR') ? <div className="record-actions"><Button variant="ghost" onClick={() => setEditing(group)}><Edit3 size={17} />Editar</Button><Button variant="ghost" onClick={() => setDeleting(group)}><Trash2 size={17} />Eliminar</Button></div> : null}
      </Card>)}
    </div>}
    {editing !== undefined ? <GroupModal group={editing} onClose={() => setEditing(undefined)} /> : null}
    {deleting ? <ConfirmDialog title="Eliminar grupo" message={`¿Eliminar el grupo ${deleting.nombre}? Los animales conservarán su historial, pero deberás asignarlos a otro grupo.`} onClose={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting.id_grupo)} loading={remove.isPending} /> : null}
  </div>;
}
