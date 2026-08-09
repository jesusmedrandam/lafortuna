import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit3, MapPinned, Plus, Trash2 } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { Badge, Card, ConfirmDialog, EmptyState, ErrorState, Field, IconButton, Input, LoadingState, Modal, PageHeader, Select, Textarea, Button } from '../../components/ui';
import { itemId, itemLabel, useCatalog } from '../../hooks/useCatalog';
import type { Location } from '../../types/api';
import { nullIfEmpty, numberOrNull } from '../../utils';

interface LocationForm {
  codigo: string;
  nombre: string;
  id_categoria_animal: string;
  descripcion: string;
  latitud: string;
  longitud: string;
  activo: boolean;
}

const emptyForm = (category = ''): LocationForm => ({
  codigo: '', nombre: '', id_categoria_animal: category, descripcion: '',
  latitud: '', longitud: '', activo: true,
});

function LocationModal({ location, defaultCategory, onClose }: { location?: Location | null; defaultCategory: string; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const categories = useCatalog('categorias-animales');
  const [form, setForm] = useState<LocationForm>(() => emptyForm(defaultCategory));

  useEffect(() => {
    setForm(location ? {
      codigo: location.codigo ?? '', nombre: location.nombre,
      id_categoria_animal: location.id_categoria_animal,
      descripcion: location.descripcion ?? '', latitud: location.latitud?.toString() ?? '',
      longitud: location.longitud?.toString() ?? '', activo: location.activo,
    } : emptyForm(defaultCategory));
  }, [location, defaultCategory]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!form.id_categoria_animal) throw new Error('Selecciona la categoría de los animales.');
      return apiRequest(location ? `/ubicaciones/${location.id_ubicacion}` : '/ubicaciones', {
        method: location ? 'PATCH' : 'POST',
        body: {
          codigo: nullIfEmpty(form.codigo), nombre: form.nombre, tipo: 'OTRO',
          id_categoria_animal: form.id_categoria_animal,
          descripcion: nullIfEmpty(form.descripcion), latitud: numberOrNull(form.latitud),
          longitud: numberOrNull(form.longitud), activo: form.activo,
        },
      });
    },
    onSuccess: async () => {
      toast.show(location ? 'Otra propiedad actualizada.' : 'Otra propiedad registrada.');
      await client.invalidateQueries({ queryKey: ['locations'] });
      await client.invalidateQueries({ queryKey: ['animal-filter-options'] });
      onClose();
    },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  return <Modal title={location ? 'Editar otra propiedad' : 'Nueva propiedad o ubicación externa'} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" form="location-form" loading={mutation.isPending}>Guardar</Button></>}>
    <form id="location-form" className="form-stack" onSubmit={(event: FormEvent) => { event.preventDefault(); mutation.mutate(); }}>
      <div className="form-grid">
        <Field label="Nombre" required><Input value={form.nombre} onChange={(event) => setForm((current) => ({ ...current, nombre: event.target.value }))} required /></Field>
        <Field label="Código"><Input value={form.codigo} onChange={(event) => setForm((current) => ({ ...current, codigo: event.target.value }))} /></Field>
        <Field label="Categoría" required hint="Determina si los animales están dentro o fuera de la propiedad."><Select value={form.id_categoria_animal} onChange={(event) => setForm((current) => ({ ...current, id_categoria_animal: event.target.value }))} required><option value="">Selecciona</option>{categories.data?.filter((item) => item.activo !== false).map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
        <Field label="Estado"><Select value={String(form.activo)} onChange={(event) => setForm((current) => ({ ...current, activo: event.target.value === 'true' }))}><option value="true">Activo</option><option value="false">Inactivo</option></Select></Field>
        <Field label="Latitud"><Input type="number" step="any" value={form.latitud} onChange={(event) => setForm((current) => ({ ...current, latitud: event.target.value }))} /></Field>
        <Field label="Longitud"><Input type="number" step="any" value={form.longitud} onChange={(event) => setForm((current) => ({ ...current, longitud: event.target.value }))} /></Field>
      </div>
      <Field label="Descripción"><Textarea rows={3} value={form.descripcion} onChange={(event) => setForm((current) => ({ ...current, descripcion: event.target.value }))} /></Field>
    </form>
  </Modal>;
}

export function LocationsPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const categories = useCatalog('categorias-animales');
  const [editing, setEditing] = useState<Location | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Location | null>(null);
  const [category, setCategory] = useState('');
  const outsideCategory = String(categories.data?.find((item) => item.codigo === 'FUERA_PROPIEDAD')?.id_categoria_animal ?? categories.data?.find((item) => item.activo !== false)?.id_categoria_animal ?? '');
  const query = useQuery({
    queryKey: ['locations', 'other-properties', category],
    queryFn: () => apiRequest<Location[]>(`/ubicaciones?tipo=OTRO${category ? `&id_categoria_animal=${category}` : ''}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiRequest(`/ubicaciones/${id}`, { method: 'DELETE' }),
    onSuccess: async () => { toast.show('Ubicación desactivada.'); setDeleting(null); await client.invalidateQueries({ queryKey: ['locations'] }); },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  return <div>
    <PageHeader title="Otras propiedades" description="Registra fincas, terrenos o lugares que no son potreros ni corrales de esta propiedad." action={hasPermission('UBICACION_ADMINISTRAR') ? <IconButton label="Agregar otra propiedad" onClick={() => setEditing(null)}><Plus size={20} /></IconButton> : undefined} />
    <div className="toolbar"><Select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Todas las categorías</option>{categories.data?.filter((item) => item.activo !== false).map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></div>
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} /> : query.data?.length === 0 ? <EmptyState icon={MapPinned} title="Sin otras propiedades" description="Registra una finca, terreno o ubicación externa para asignar allí los animales." /> : <div className="record-grid">
      {query.data?.map((location) => <Card key={location.id_ubicacion} className="record-card"><div className="record-card-header"><div className="record-icon"><MapPinned size={22} /></div><div><h3>{location.nombre}</h3><span>{location.codigo || 'Sin código'}</span></div><Badge tone={location.categoria_codigo === 'FUERA_PROPIEDAD' ? 'warning' : 'info'}>{location.categoria}</Badge></div><div className="record-details"><span><small>Animales actuales</small><strong>{location.total_animales}</strong></span><span><small>Coordenadas</small><strong>{location.latitud != null && location.longitud != null ? `${location.latitud}, ${location.longitud}` : 'Sin registrar'}</strong></span></div><p>{location.descripcion || 'Sin descripción.'}</p>{hasPermission('UBICACION_ADMINISTRAR') ? <div className="record-actions"><IconButton label="Editar ubicación" onClick={() => setEditing(location)}><Edit3 size={17} /></IconButton><IconButton label="Eliminar ubicación" onClick={() => setDeleting(location)}><Trash2 size={17} /></IconButton></div> : null}</Card>)}
    </div>}
    {editing !== undefined ? <LocationModal location={editing} defaultCategory={outsideCategory} onClose={() => setEditing(undefined)} /> : null}
    {deleting ? <ConfirmDialog title="Desactivar otra propiedad" message={`Se desactivará ${deleting.nombre}. Los animales relacionados conservarán el dato hasta que sean trasladados.`} onClose={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting.id_ubicacion)} loading={remove.isPending} /> : null}
  </div>;
}
