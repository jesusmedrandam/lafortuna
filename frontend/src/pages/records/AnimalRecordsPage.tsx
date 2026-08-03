import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit3, HeartOff, Plus, Trash2, Weight } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Textarea } from '../../components/ui';
import type { Animal, GenericRecord } from '../../types/api';
import { formatDateTime, formatNumber, nullIfEmpty } from '../../utils';

type Mode = 'pesajes' | 'muertes';

const localNow = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

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
const emptyForm = (): RecordForm => ({ id_animal: '', fecha: localNow(), peso: '', metodo: '', causa: '', descripcion: '', observaciones: '' });

export function AnimalRecordsPage({ mode }: { mode: Mode }) {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<RecordForm>(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const permission = mode === 'pesajes' ? 'PESAJE_ADMINISTRAR' : 'MUERTE_ADMINISTRAR';
  const idField = mode === 'pesajes' ? 'id_pesaje' : 'id_muerte';
  const records = useQuery({ queryKey: ['records', mode], queryFn: () => apiRequest<GenericRecord[]>(`/registros/${mode}`) });
  const animals = useQuery({ queryKey: ['animals', mode], queryFn: () => apiRequest<Animal[]>('/animales?limit=100') });

  const save = useMutation({
    mutationFn: () => {
      if (!form.id_animal || !form.fecha) throw new Error('Selecciona un animal y la fecha.');
      const body = mode === 'pesajes'
        ? { id_animal: form.id_animal, fecha_pesaje: new Date(form.fecha).toISOString(), peso_kg: Number(form.peso), metodo: nullIfEmpty(form.metodo), observaciones: nullIfEmpty(form.observaciones) }
        : { id_animal: form.id_animal, fecha: new Date(form.fecha).toISOString(), causa: nullIfEmpty(form.causa), descripcion: nullIfEmpty(form.descripcion) };
      if (mode === 'pesajes' && (!form.peso || Number(form.peso) <= 0)) throw new Error('Ingresa un peso válido.');
      return apiRequest(`/registros/${mode}${form.id ? `/${form.id}` : ''}`, { method: form.id ? 'PATCH' : 'POST', body });
    },
    onSuccess: () => { toast.show(form.id ? 'Registro actualizado.' : 'Registro creado.'); setOpen(false); setForm(emptyForm()); void client.invalidateQueries({ queryKey: ['records', mode] }); void client.invalidateQueries({ queryKey: ['animals'] }); },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });
  const remove = useMutation({ mutationFn: (id: string) => apiRequest(`/registros/${mode}/${id}`, { method: 'DELETE' }), onSuccess: () => { toast.show('Registro eliminado.'); setDeleteId(null); void client.invalidateQueries({ queryKey: ['records', mode] }); }, onError: (error) => toast.show((error as ApiError).message, 'error') });

  const edit = (record: GenericRecord) => {
    const dateValue = mode === 'pesajes' ? record.fecha_pesaje : record.fecha;
    const date = dateValue ? new Date(String(dateValue)) : new Date();
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    setForm({ id: String(record[idField]), id_animal: String(record.id_animal), fecha: date.toISOString().slice(0, 16), peso: String(record.peso_kg ?? ''), metodo: String(record.metodo ?? ''), causa: String(record.causa ?? ''), descripcion: String(record.descripcion ?? ''), observaciones: String(record.observaciones ?? '') });
    setOpen(true);
  };

  const title = mode === 'pesajes' ? 'Pesajes' : 'Muertes y bajas';
  const description = mode === 'pesajes' ? 'Historial de peso por animal y fecha.' : 'Registro de fallecimientos y causa asociada.';
  const Icon = mode === 'pesajes' ? Weight : HeartOff;

  return <div><PageHeader title={title} description={description} action={hasPermission(permission) ? <Button onClick={() => { setForm(emptyForm()); setOpen(true); }}><Plus size={18} />Nuevo registro</Button> : undefined} />
    {records.isLoading ? <LoadingState /> : records.isError ? <ErrorState message={(records.error as Error).message} onRetry={() => void records.refetch()} /> : records.data?.length ? <div className="table-card"><div className="table-responsive"><table className="data-table"><thead><tr><th>Animal</th><th>Fecha</th>{mode === 'pesajes' ? <><th>Peso</th><th>Método</th><th>Observaciones</th></> : <><th>Causa</th><th>Descripción</th></>}{hasPermission(permission) ? <th>Acciones</th> : null}</tr></thead><tbody>{records.data.map((record) => <tr key={String(record[idField])}><td><strong>{String(record.animal ?? '—')}</strong><small>{record.codigo_arete ? `Arete ${record.codigo_arete}` : ''}</small></td><td>{formatDateTime(String(mode === 'pesajes' ? record.fecha_pesaje : record.fecha))}</td>{mode === 'pesajes' ? <><td><strong>{formatNumber(record.peso_kg as number | string, 3)} kg</strong></td><td>{String(record.metodo ?? '—')}</td><td>{String(record.observaciones ?? '—')}</td></> : <><td>{String(record.causa ?? '—')}</td><td>{String(record.descripcion ?? '—')}</td></>}{hasPermission(permission) ? <td><div className="inline-actions"><Button variant="ghost" onClick={() => edit(record)}><Edit3 size={16} /></Button><Button variant="ghost" onClick={() => setDeleteId(String(record[idField]))}><Trash2 size={16} /></Button></div></td> : null}</tr>)}</tbody></table></div></div> : <EmptyState icon={Icon} title={`Sin ${mode === 'pesajes' ? 'pesajes' : 'muertes'} registrados`} description={description} />}
    {open ? <Modal title={form.id ? `Editar ${mode === 'pesajes' ? 'pesaje' : 'muerte'}` : `Nuevo ${mode === 'pesajes' ? 'pesaje' : 'registro de muerte'}`} onClose={() => setOpen(false)} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={() => save.mutate()} loading={save.isPending}>Guardar</Button></>}><div className="form-stack"><Field label="Animal" required><Select value={form.id_animal} onChange={(event) => setForm((current) => ({ ...current, id_animal: event.target.value }))}><option value="">Selecciona</option>{animals.data?.map((animal) => <option key={animal.id_animal} value={animal.id_animal}>{animal.nombre}{animal.codigo_arete ? ` · ${animal.codigo_arete}` : ''}</option>)}</Select></Field><Field label="Fecha" required><Input type="datetime-local" value={form.fecha} onChange={(event) => setForm((current) => ({ ...current, fecha: event.target.value }))} /></Field>{mode === 'pesajes' ? <><Field label="Peso (kg)" required><Input type="number" min="0.001" step="0.001" value={form.peso} onChange={(event) => setForm((current) => ({ ...current, peso: event.target.value }))} /></Field><Field label="Método"><Input value={form.metodo} onChange={(event) => setForm((current) => ({ ...current, metodo: event.target.value }))} /></Field><Field label="Observaciones"><Textarea value={form.observaciones} onChange={(event) => setForm((current) => ({ ...current, observaciones: event.target.value }))} /></Field></> : <><Field label="Causa"><Input value={form.causa} onChange={(event) => setForm((current) => ({ ...current, causa: event.target.value }))} /></Field><Field label="Descripción"><Textarea value={form.descripcion} onChange={(event) => setForm((current) => ({ ...current, descripcion: event.target.value }))} /></Field></>}</div></Modal> : null}
    {deleteId ? <ConfirmDialog title="Eliminar registro" message="¿Deseas eliminar este registro?" onClose={() => setDeleteId(null)} onConfirm={() => remove.mutate(deleteId)} loading={remove.isPending} /> : null}
  </div>;
}
