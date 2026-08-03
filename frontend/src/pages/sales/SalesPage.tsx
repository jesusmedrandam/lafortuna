import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Plus, ShoppingCart, Users } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AnimalSelectionBuilder, type AnimalSelectionValue } from '../../components/AnimalSelectionBuilder';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Textarea } from '../../components/ui';
import type { AnimalSale } from '../../types/api';
import { formatDate, numberOrNull, nullIfEmpty } from '../../utils';

function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function money(value: number | string | null, currency: string) {
  if (value === null || value === '') return 'Sin precio registrado';
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: currency || 'USD' }).format(Number(value));
}

export function SalesPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const query = useQuery({ queryKey: ['sales'], queryFn: () => apiRequest<AnimalSale[]>('/ventas') });
  const cancelSale = useMutation({
    mutationFn: (id: string) => apiRequest(`/ventas/${id}/anular`, { method: 'PATCH' }),
    onSuccess: async () => {
      toast.show('Venta anulada y animales restaurados.');
      await client.invalidateQueries({ queryKey: ['sales'] });
      await client.invalidateQueries({ queryKey: ['animals'] });
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  return <div>
    <PageHeader
      title="Ventas"
      description="Registra la salida de uno o varios animales y conserva el historial de la operación."
      action={hasPermission('VENTA_ADMINISTRAR') ? <Button onClick={() => setCreating(true)}><Plus size={18} />Nueva venta</Button> : undefined}
    />
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} /> : !query.data?.length ? <EmptyState icon={ShoppingCart} title="No hay ventas" description="Todavía no se han registrado ventas de animales." action={hasPermission('VENTA_ADMINISTRAR') ? <Button onClick={() => setCreating(true)}><Plus size={18} />Registrar venta</Button> : undefined} /> : <div className="sale-list">{query.data.map((sale) => <Card className="sale-card" key={sale.id_venta}>
      <div className="sale-card-header"><div><span className="eyebrow">{formatDate(sale.fecha_venta)}</span><h3>{sale.comprador_nombre}</h3><p>{sale.destino || 'Destino no registrado'}</p></div><Badge tone={sale.estado === 'COMPLETADA' ? 'success' : 'danger'}>{sale.estado}</Badge></div>
      <div className="sale-summary"><span><Users size={17} /><strong>{sale.animales.length}</strong> animal{sale.animales.length === 1 ? '' : 'es'}</span><span><strong>{money(sale.precio_total, sale.moneda)}</strong></span></div>
      <div className="sale-animal-chips">{sale.animales.map((animal) => <span key={animal.id_venta_detalle}>{animal.animal}{animal.codigo_arete ? ` · ${animal.codigo_arete}` : ''}</span>)}</div>
      {sale.comprador_contacto ? <p className="muted">Contacto: {sale.comprador_contacto}</p> : null}
      {sale.observaciones ? <p className="muted">{sale.observaciones}</p> : null}
      {hasPermission('VENTA_ADMINISTRAR') && sale.estado === 'COMPLETADA' ? <div className="record-actions"><Button variant="ghost" onClick={() => cancelSale.mutate(sale.id_venta)} loading={cancelSale.isPending}><Ban size={17} />Anular venta</Button></div> : null}
    </Card>)}</div>}
    {creating ? <SaleForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void query.refetch(); }} /> : null}
  </div>;
}

function SaleForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const client = useQueryClient();
  const [selection, setSelection] = useState<AnimalSelectionValue>({ mode: 'SELECCION_MANUAL', groupId: '', animals: [] });
  const [form, setForm] = useState({ fecha_venta: localDateTime(), comprador_nombre: '', comprador_contacto: '', destino: '', precio_total: '', observaciones: '' });
  const mutation = useMutation({
    mutationFn: () => {
      const selected = selection.animals.filter((animal) => animal.seleccionado);
      if (!selected.length) throw new ApiError(400, 'NO_ANIMALS', 'Selecciona al menos un animal.');
      return apiRequest('/ventas', {
        method: 'POST',
        body: {
          fecha_venta: new Date(form.fecha_venta).toISOString(),
          comprador_nombre: form.comprador_nombre.trim(),
          comprador_contacto: nullIfEmpty(form.comprador_contacto),
          destino: nullIfEmpty(form.destino),
          precio_total: numberOrNull(form.precio_total),
          moneda: 'USD',
          observaciones: nullIfEmpty(form.observaciones),
          animales: selected.map((animal) => ({ id_animal: animal.id_animal, precio_individual: null, observaciones: null })),
        },
      });
    },
    onSuccess: async () => {
      toast.show('Venta registrada correctamente.');
      await client.invalidateQueries({ queryKey: ['sales'] });
      await client.invalidateQueries({ queryKey: ['animals'] });
      onSaved();
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });
  function submit(event: FormEvent) { event.preventDefault(); mutation.mutate(); }
  return <Modal title="Registrar venta" onClose={onClose} wide footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" form="sale-form" loading={mutation.isPending}><ShoppingCart size={18} />Guardar venta</Button></>}>
    <form id="sale-form" className="form-stack" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Fecha" required><Input type="datetime-local" required value={form.fecha_venta} onChange={(event) => setForm({ ...form, fecha_venta: event.target.value })} /></Field>
        <Field label="Comprador" required><Input required value={form.comprador_nombre} onChange={(event) => setForm({ ...form, comprador_nombre: event.target.value })} /></Field>
        <Field label="Contacto"><Input value={form.comprador_contacto} onChange={(event) => setForm({ ...form, comprador_contacto: event.target.value })} /></Field>
        <Field label="Destino"><Input value={form.destino} onChange={(event) => setForm({ ...form, destino: event.target.value })} /></Field>
        <Field label="Precio total (USD)"><Input type="number" min="0" step="0.01" value={form.precio_total} onChange={(event) => setForm({ ...form, precio_total: event.target.value })} /></Field>
      </div>
      <Field label="Observaciones"><Textarea rows={3} value={form.observaciones} onChange={(event) => setForm({ ...form, observaciones: event.target.value })} /></Field>
      <div className="form-section"><h3>Animales vendidos</h3><AnimalSelectionBuilder value={selection} onChange={setSelection} /></div>
    </form>
  </Modal>;
}
