import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit3, MapPinned, Plus, Star, Trash2 } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, IconButton, Input, LoadingState, Modal, PageHeader, Select, Textarea } from '../../components/ui';
import type { Property } from '../../types/api';
import { nullIfEmpty, numberOrNull } from '../../utils';

interface PropertyForm {
  codigo: string;
  nombre: string;
  descripcion: string;
  latitud: string;
  longitud: string;
  es_principal: boolean;
  activa: boolean;
}

const emptyForm = (): PropertyForm => ({
  codigo: '', nombre: '', descripcion: '', latitud: '', longitud: '', es_principal: false, activa: true,
});

function PropertyModal({ property, onClose }: { property?: Property | null; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<PropertyForm>(emptyForm);

  useEffect(() => {
    setForm(property ? {
      codigo: property.codigo ?? '', nombre: property.nombre, descripcion: property.descripcion ?? '',
      latitud: property.latitud?.toString() ?? '', longitud: property.longitud?.toString() ?? '',
      es_principal: property.es_principal, activa: property.activa,
    } : emptyForm());
  }, [property]);

  const mutation = useMutation({
    mutationFn: () => apiRequest(property ? `/propiedades/${property.id_propiedad}` : '/propiedades', {
      method: property ? 'PATCH' : 'POST',
      body: {
        codigo: nullIfEmpty(form.codigo), nombre: form.nombre, descripcion: nullIfEmpty(form.descripcion),
        latitud: numberOrNull(form.latitud), longitud: numberOrNull(form.longitud),
        es_principal: form.es_principal, activa: form.activa,
      },
    }),
    onSuccess: async () => {
      toast.show(property ? 'Propiedad actualizada.' : 'Propiedad registrada.');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['properties'] }),
        client.invalidateQueries({ queryKey: ['groups'] }),
        client.invalidateQueries({ queryKey: ['locations'] }),
        client.invalidateQueries({ queryKey: ['animals'] }),
      ]);
      onClose();
    },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  return <Modal title={property ? 'Editar propiedad' : 'Nueva propiedad'} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" form="property-form" loading={mutation.isPending}>Guardar</Button></>}>
    <form id="property-form" className="form-stack" onSubmit={(event: FormEvent) => { event.preventDefault(); mutation.mutate(); }}>
      <div className="form-grid">
        <Field label="Nombre" required><Input value={form.nombre} onChange={(event) => setForm((current) => ({ ...current, nombre: event.target.value }))} required /></Field>
        <Field label="Código"><Input value={form.codigo} onChange={(event) => setForm((current) => ({ ...current, codigo: event.target.value }))} /></Field>
        <Field label="Estado"><Select disabled={property?.es_principal} value={String(form.activa)} onChange={(event) => setForm((current) => ({ ...current, activa: event.target.value === 'true' }))}><option value="true">Activa</option><option value="false">Inactiva</option></Select></Field>
        <Field label="Propiedad principal" hint="Solo una propiedad puede ser principal; allí se habilitan lactancias y ordeño."><Select disabled={property?.es_principal} value={String(form.es_principal)} onChange={(event) => setForm((current) => ({ ...current, es_principal: event.target.value === 'true', activa: event.target.value === 'true' ? true : current.activa }))}><option value="false">No</option><option value="true">Sí, hacer principal</option></Select></Field>
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
  const [editing, setEditing] = useState<Property | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Property | null>(null);
  const query = useQuery({ queryKey: ['properties'], queryFn: () => apiRequest<Property[]>('/propiedades') });
  const remove = useMutation({
    mutationFn: (id: string) => apiRequest(`/propiedades/${id}`, { method: 'DELETE' }),
    onSuccess: async () => { toast.show('Propiedad eliminada.'); setDeleting(null); await client.invalidateQueries({ queryKey: ['properties'] }); },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  return <div>
    <PageHeader title="Propiedades" description="Relaciona cada grupo, potrero y corral con su propiedad. La propiedad principal es la única habilitada para ordeño." action={hasPermission('UBICACION_ADMINISTRAR') ? <Button onClick={() => setEditing(null)}><Plus size={18} />Nueva propiedad</Button> : undefined} />
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} /> : query.data?.length === 0 ? <EmptyState icon={MapPinned} title="Sin propiedades" description="Registra la primera propiedad para organizar grupos, potreros y corrales." /> : <div className="record-grid">
      {query.data?.map((property) => <Card key={property.id_propiedad} className="record-card">
        <div className="record-card-header"><div className="record-icon">{property.es_principal ? <Star size={22} /> : <MapPinned size={22} />}</div><div><h3>{property.nombre}</h3><span>{property.codigo || 'Sin código'}</span></div><Badge tone={property.es_principal ? 'success' : property.activa ? 'info' : 'neutral'}>{property.es_principal ? 'Principal' : property.activa ? 'Externa' : 'Inactiva'}</Badge></div>
        <div className="record-details">
          <span><small>Animales</small><strong>{property.total_animales}</strong></span>
          <span><small>Grupos</small><strong>{property.total_grupos}</strong></span>
          <span><small>Potreros</small><strong>{property.total_potreros}</strong></span>
          <span><small>Corrales</small><strong>{property.total_corrales}</strong></span>
          <span><small>Coordenadas</small><strong>{property.latitud != null && property.longitud != null ? `${property.latitud}, ${property.longitud}` : 'Sin registrar'}</strong></span>
        </div>
        <p>{property.descripcion || 'Sin descripción.'}</p>
        {hasPermission('UBICACION_ADMINISTRAR') ? <div className="record-actions"><Button variant="ghost" onClick={() => setEditing(property)}><Edit3 size={17} />Editar</Button>{!property.es_principal ? <IconButton label="Eliminar propiedad" onClick={() => setDeleting(property)}><Trash2 size={17} /></IconButton> : null}</div> : null}
      </Card>)}
    </div>}
    {editing !== undefined ? <PropertyModal property={editing} onClose={() => setEditing(undefined)} /> : null}
    {deleting ? <ConfirmDialog title="Eliminar propiedad" message={`Se eliminará ${deleting.nombre}. Solo es posible si ya no tiene grupos, potreros ni corrales asociados.`} onClose={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting.id_propiedad)} loading={remove.isPending} /> : null}
  </div>;
}
