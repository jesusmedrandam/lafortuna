import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Baby, Edit3, HeartCrack, Plus, Trash2 } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Textarea } from '../../components/ui';
import { itemId, itemLabel, useCatalog } from '../../hooks/useCatalog';
import type { Animal, Birth, GenericRecord, Group, Location } from '../../types/api';
import { formatDateTime, formatNumber, humanizeCode, nullIfEmpty, numberOrNull } from '../../utils';

type Tab = 'births' | 'abortions';

const localNow = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

interface ChildForm {
  codigo_arete: string;
  nombre: string;
  id_especie: string;
  sexo: 'MACHO' | 'HEMBRA';
  id_origen: string;
  id_grupo_actual: string;
  id_ubicacion_actual: string;
  estado: 'ACTIVO' | 'MUERTO';
  estado_nacimiento: 'VIVA' | 'MUERTA' | 'DEBIL' | 'DESCONOCIDO';
  peso_nacimiento_kg: string;
  observaciones: string;
}
interface BirthForm { id_madre: string; id_padre: string; fecha_parto: string; tipo_parto: string; observaciones: string; crias: ChildForm[]; }
const emptyChild = (): ChildForm => ({ codigo_arete: '', nombre: '', id_especie: '', sexo: 'HEMBRA', id_origen: '', id_grupo_actual: '', id_ubicacion_actual: '', estado: 'ACTIVO', estado_nacimiento: 'VIVA', peso_nacimiento_kg: '', observaciones: '' });
const emptyBirth = (): BirthForm => ({ id_madre: '', id_padre: '', fecha_parto: localNow(), tipo_parto: 'NORMAL', observaciones: '', crias: [emptyChild()] });
interface AbortionForm { id_aborto?: string; id_vaca: string; fecha: string; causa: string; meses_gestacion: string; descripcion: string; }
const emptyAbortion = (): AbortionForm => ({ id_vaca: '', fecha: localNow(), causa: '', meses_gestacion: '', descripcion: '' });

export function BirthsPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const canReadBirths = hasPermission('PARTO_CONSULTAR');
  const canReadAbortions = hasPermission('ABORTO_CONSULTAR');
  const [tab, setTab] = useState<Tab>(() => canReadBirths ? 'births' : 'abortions');
  const [birthOpen, setBirthOpen] = useState(false);
  const [birthForm, setBirthForm] = useState<BirthForm>(emptyBirth);
  const [abortionOpen, setAbortionOpen] = useState(false);
  const [abortionForm, setAbortionForm] = useState<AbortionForm>(emptyAbortion);
  const [deleteAbortion, setDeleteAbortion] = useState<string | null>(null);

  const births = useQuery({ queryKey: ['births'], queryFn: () => apiRequest<Birth[]>('/partos'), enabled: canReadBirths });
  const abortions = useQuery({ queryKey: ['records', 'abortos'], queryFn: () => apiRequest<GenericRecord[]>('/registros/abortos'), enabled: canReadAbortions });
  const females = useQuery({ queryKey: ['animals', 'birth-females'], queryFn: () => apiRequest<Animal[]>('/animales?limit=100&sexo=HEMBRA') });
  const males = useQuery({ queryKey: ['animals', 'birth-males'], queryFn: () => apiRequest<Animal[]>('/animales?limit=100&sexo=MACHO') });
  const species = useCatalog('especies');
  const origins = useCatalog('origenes');
  const groups = useQuery({ queryKey: ['groups', 'birth'], queryFn: () => apiRequest<Group[]>('/grupos?limit=100') });
  const locations = useQuery({ queryKey: ['locations', 'birth'], queryFn: () => apiRequest<Location[]>('/ubicaciones') });

  const createBirth = useMutation({
    mutationFn: () => {
      if (!birthForm.id_madre || !birthForm.fecha_parto || !birthForm.crias.length) throw new Error('Selecciona la madre, fecha y al menos una cría.');
      if (birthForm.crias.some((child) => !child.nombre.trim() || !child.id_especie || !child.id_origen)) throw new Error('Cada cría debe tener nombre, especie y origen.');
      return apiRequest('/partos', {
        method: 'POST',
        body: {
          id_madre: birthForm.id_madre,
          id_padre: birthForm.id_padre || null,
          fecha_parto: new Date(birthForm.fecha_parto).toISOString(),
          tipo_parto: birthForm.tipo_parto,
          observaciones: nullIfEmpty(birthForm.observaciones),
          crias: birthForm.crias.map((child) => ({
            animal: {
              codigo_arete: nullIfEmpty(child.codigo_arete),
              nombre: child.nombre.trim(),
              id_especie: child.id_especie,
              sexo: child.sexo,
              id_origen: child.id_origen,
              id_grupo_actual: child.id_grupo_actual || null,
              id_ubicacion_actual: child.id_ubicacion_actual || null,
              estado: child.estado,
            },
            estado_nacimiento: child.estado_nacimiento,
            peso_nacimiento_kg: numberOrNull(child.peso_nacimiento_kg),
            observaciones: nullIfEmpty(child.observaciones),
          })),
        },
      });
    },
    onSuccess: () => { toast.show('Parto y crías registrados.'); setBirthOpen(false); setBirthForm(emptyBirth()); void client.invalidateQueries({ queryKey: ['births'] }); void client.invalidateQueries({ queryKey: ['animals'] }); },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  const saveAbortion = useMutation({
    mutationFn: () => {
      if (!abortionForm.id_vaca) throw new Error('Selecciona la vaca.');
      const body = { id_vaca: abortionForm.id_vaca, fecha: abortionForm.fecha ? new Date(abortionForm.fecha).toISOString() : null, causa: nullIfEmpty(abortionForm.causa), meses_gestacion: numberOrNull(abortionForm.meses_gestacion), descripcion: nullIfEmpty(abortionForm.descripcion) };
      return apiRequest(`/registros/abortos${abortionForm.id_aborto ? `/${abortionForm.id_aborto}` : ''}`, { method: abortionForm.id_aborto ? 'PATCH' : 'POST', body });
    },
    onSuccess: () => { toast.show(abortionForm.id_aborto ? 'Aborto actualizado.' : 'Aborto registrado.'); setAbortionOpen(false); setAbortionForm(emptyAbortion()); void client.invalidateQueries({ queryKey: ['records', 'abortos'] }); },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });
  const removeAbortion = useMutation({ mutationFn: (id: string) => apiRequest(`/registros/abortos/${id}`, { method: 'DELETE' }), onSuccess: () => { toast.show('Registro eliminado.'); setDeleteAbortion(null); void client.invalidateQueries({ queryKey: ['records', 'abortos'] }); }, onError: (error) => toast.show((error as ApiError).message, 'error') });

  const openEditAbortion = (record: GenericRecord) => {
    const date = record.fecha ? new Date(String(record.fecha)) : null;
    if (date) date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    setAbortionForm({ id_aborto: String(record.id_aborto), id_vaca: String(record.id_vaca), fecha: date ? date.toISOString().slice(0, 16) : '', causa: String(record.causa ?? ''), meses_gestacion: String(record.meses_gestacion ?? ''), descripcion: String(record.descripcion ?? '') });
    setAbortionOpen(true);
  };

  return <div>
    <PageHeader title="Reproducción" description="Partos con una o varias crías y registro de abortos." action={(tab === 'births' ? hasPermission('PARTO_ADMINISTRAR') : hasPermission('ABORTO_ADMINISTRAR')) ? <Button onClick={() => tab === 'births' ? (setBirthForm(emptyBirth()), setBirthOpen(true)) : (setAbortionForm(emptyAbortion()), setAbortionOpen(true))}><Plus size={18} />{tab === 'births' ? 'Nuevo parto' : 'Registrar aborto'}</Button> : undefined} />
    <div className="page-tabs">{canReadBirths ? <button className={tab === 'births' ? 'active' : ''} onClick={() => setTab('births')}><Baby size={17} />Partos</button> : null}{canReadAbortions ? <button className={tab === 'abortions' ? 'active' : ''} onClick={() => setTab('abortions')}><HeartCrack size={17} />Abortos</button> : null}</div>

    {tab === 'births' ? births.isLoading ? <LoadingState /> : births.isError ? <ErrorState message={(births.error as Error).message} onRetry={() => void births.refetch()} /> : births.data?.length ? <div className="record-grid operation-grid">{births.data.map((birth) => <Card className="operation-card" key={birth.id_parto}>
      <div className="operation-card-header"><div className="operation-icon"><Baby size={23} /></div><div><h3>{birth.madre}</h3><span>{formatDateTime(birth.fecha_parto)}</span></div><Badge tone="success">{humanizeCode(birth.tipo_parto)}</Badge></div>
      <div className="detail-grid compact"><div><small>Padre</small><strong>{birth.padre || 'No registrado'}</strong></div><div><small>Número de crías</small><strong>{birth.crias?.length ?? 0}</strong></div></div>
      {birth.crias?.length ? <div className="offspring-list">{birth.crias.map((child) => <div key={child.id_parto_cria}><strong>{child.cria}</strong><span>{child.sexo === 'HEMBRA' ? 'Hembra' : 'Macho'} · {humanizeCode(child.estado_nacimiento)}{child.peso_nacimiento_kg ? ` · ${formatNumber(child.peso_nacimiento_kg)} kg` : ''}</span></div>)}</div> : null}
      {birth.observaciones ? <p className="muted operation-notes">{birth.observaciones}</p> : null}
    </Card>)}</div> : <EmptyState icon={Baby} title="Sin partos registrados" description="Registra la madre, el padre opcional y cada cría nacida." action={hasPermission('PARTO_ADMINISTRAR') ? <Button onClick={() => setBirthOpen(true)}><Plus size={18} />Registrar parto</Button> : undefined} /> : abortions.isLoading ? <LoadingState /> : abortions.isError ? <ErrorState message={(abortions.error as Error).message} onRetry={() => void abortions.refetch()} /> : abortions.data?.length ? <div className="table-card"><div className="table-responsive"><table className="data-table"><thead><tr><th>Animal</th><th>Fecha</th><th>Causa</th><th>Meses de gestación</th><th>Descripción</th>{hasPermission('ABORTO_ADMINISTRAR') ? <th>Acciones</th> : null}</tr></thead><tbody>{abortions.data.map((record) => <tr key={String(record.id_aborto)}><td><strong>{String(record.animal ?? '—')}</strong><small>{record.codigo_arete ? `Arete ${record.codigo_arete}` : ''}</small></td><td>{formatDateTime(record.fecha ? String(record.fecha) : null)}</td><td>{String(record.causa ?? '—')}</td><td>{record.meses_gestacion == null ? '—' : formatNumber(record.meses_gestacion as number | string, 1)}</td><td>{String(record.descripcion ?? '—')}</td>{hasPermission('ABORTO_ADMINISTRAR') ? <td><div className="inline-actions"><Button variant="ghost" onClick={() => openEditAbortion(record)}><Edit3 size={16} /></Button><Button variant="ghost" onClick={() => setDeleteAbortion(String(record.id_aborto))}><Trash2 size={16} /></Button></div></td> : null}</tr>)}</tbody></table></div></div> : <EmptyState icon={HeartCrack} title="Sin abortos registrados" description="No existen eventos de aborto en el historial." />}

    {birthOpen ? <Modal title="Registrar parto" wide onClose={() => setBirthOpen(false)} footer={<><Button variant="ghost" onClick={() => setBirthOpen(false)}>Cancelar</Button><Button onClick={() => createBirth.mutate()} loading={createBirth.isPending}>Guardar parto</Button></>}><div className="form-stack">
      <div className="form-section"><h3>Datos del parto</h3><div className="form-grid"><Field label="Madre" required><Select value={birthForm.id_madre} onChange={(event) => { const mother = females.data?.find((animal) => animal.id_animal === event.target.value); setBirthForm((current) => ({ ...current, id_madre: event.target.value, crias: current.crias.map((child) => ({ ...child, id_especie: child.id_especie || mother?.id_especie || '' })) })); }}><option value="">Selecciona</option>{females.data?.filter((animal) => animal.estado === 'ACTIVO').map((animal) => <option key={animal.id_animal} value={animal.id_animal}>{animal.nombre}{animal.codigo_arete ? ` · ${animal.codigo_arete}` : ''}</option>)}</Select></Field><Field label="Padre"><Select value={birthForm.id_padre} onChange={(event) => setBirthForm((current) => ({ ...current, id_padre: event.target.value }))}><option value="">No registrado</option>{males.data?.filter((animal) => animal.estado === 'ACTIVO').map((animal) => <option key={animal.id_animal} value={animal.id_animal}>{animal.nombre}{animal.codigo_arete ? ` · ${animal.codigo_arete}` : ''}</option>)}</Select></Field><Field label="Fecha y hora" required><Input type="datetime-local" value={birthForm.fecha_parto} onChange={(event) => setBirthForm((current) => ({ ...current, fecha_parto: event.target.value }))} /></Field><Field label="Tipo de parto"><Select value={birthForm.tipo_parto} onChange={(event) => setBirthForm((current) => ({ ...current, tipo_parto: event.target.value }))}>{['NORMAL','ASISTIDO','CESAREA','DESCONOCIDO'].map((value) => <option value={value} key={value}>{humanizeCode(value)}</option>)}</Select></Field></div><Field label="Observaciones"><Textarea value={birthForm.observaciones} onChange={(event) => setBirthForm((current) => ({ ...current, observaciones: event.target.value }))} /></Field></div>
      <div className="form-section"><div className="section-heading-inline"><h3>Crías</h3><Button type="button" variant="secondary" onClick={() => setBirthForm((current) => ({ ...current, crias: [...current.crias, emptyChild()] }))}><Plus size={16} />Agregar cría</Button></div><div className="nested-list">{birthForm.crias.map((child, index) => <div className="nested-card" key={`child-${index}`}><div className="nested-card-header"><strong>Cría {index + 1}</strong>{birthForm.crias.length > 1 ? <Button type="button" variant="ghost" onClick={() => setBirthForm((current) => ({ ...current, crias: current.crias.filter((_, childIndex) => childIndex !== index) }))}><Trash2 size={16} /></Button> : null}</div><div className="form-grid">
        <Field label="Nombre" required><Input value={child.nombre} onChange={(event) => setBirthForm((current) => ({ ...current, crias: current.crias.map((item, childIndex) => childIndex === index ? { ...item, nombre: event.target.value } : item) }))} /></Field>
        <Field label="Arete"><Input value={child.codigo_arete} onChange={(event) => setBirthForm((current) => ({ ...current, crias: current.crias.map((item, childIndex) => childIndex === index ? { ...item, codigo_arete: event.target.value } : item) }))} /></Field>
        <Field label="Especie" required><Select value={child.id_especie} onChange={(event) => setBirthForm((current) => ({ ...current, crias: current.crias.map((item, childIndex) => childIndex === index ? { ...item, id_especie: event.target.value } : item) }))}><option value="">Selecciona</option>{species.data?.map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
        <Field label="Sexo"><Select value={child.sexo} onChange={(event) => setBirthForm((current) => ({ ...current, crias: current.crias.map((item, childIndex) => childIndex === index ? { ...item, sexo: event.target.value as ChildForm['sexo'] } : item) }))}><option value="HEMBRA">Hembra</option><option value="MACHO">Macho</option></Select></Field>
        <Field label="Origen" required><Select value={child.id_origen} onChange={(event) => setBirthForm((current) => ({ ...current, crias: current.crias.map((item, childIndex) => childIndex === index ? { ...item, id_origen: event.target.value } : item) }))}><option value="">Selecciona</option>{origins.data?.map((item) => <option key={itemId(item)} value={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
        <Field label="Grupo"><Select value={child.id_grupo_actual} onChange={(event) => setBirthForm((current) => ({ ...current, crias: current.crias.map((item, childIndex) => childIndex === index ? { ...item, id_grupo_actual: event.target.value } : item) }))}><option value="">Sin grupo</option>{groups.data?.map((item) => <option key={item.id_grupo} value={item.id_grupo}>{item.nombre}</option>)}</Select></Field>
        <Field label="Ubicación"><Select value={child.id_ubicacion_actual} onChange={(event) => setBirthForm((current) => ({ ...current, crias: current.crias.map((item, childIndex) => childIndex === index ? { ...item, id_ubicacion_actual: event.target.value } : item) }))}><option value="">Sin ubicación</option>{locations.data?.map((item) => <option key={item.id_ubicacion} value={item.id_ubicacion}>{item.nombre}</option>)}</Select></Field>
        <Field label="Estado al nacer"><Select value={child.estado_nacimiento} onChange={(event) => setBirthForm((current) => ({ ...current, crias: current.crias.map((item, childIndex) => childIndex === index ? { ...item, estado_nacimiento: event.target.value as ChildForm['estado_nacimiento'], estado: event.target.value === 'MUERTA' ? 'MUERTO' : 'ACTIVO' } : item) }))}>{['VIVA','MUERTA','DEBIL','DESCONOCIDO'].map((value) => <option value={value} key={value}>{humanizeCode(value)}</option>)}</Select></Field>
        <Field label="Peso al nacer (kg)"><Input type="number" min="0.01" step="0.001" value={child.peso_nacimiento_kg} onChange={(event) => setBirthForm((current) => ({ ...current, crias: current.crias.map((item, childIndex) => childIndex === index ? { ...item, peso_nacimiento_kg: event.target.value } : item) }))} /></Field>
      </div><Field label="Observaciones"><Input value={child.observaciones} onChange={(event) => setBirthForm((current) => ({ ...current, crias: current.crias.map((item, childIndex) => childIndex === index ? { ...item, observaciones: event.target.value } : item) }))} /></Field></div>)}</div></div>
    </div></Modal> : null}

    {abortionOpen ? <Modal title={abortionForm.id_aborto ? 'Editar aborto' : 'Registrar aborto'} onClose={() => setAbortionOpen(false)} footer={<><Button variant="ghost" onClick={() => setAbortionOpen(false)}>Cancelar</Button><Button onClick={() => saveAbortion.mutate()} loading={saveAbortion.isPending}>Guardar</Button></>}><div className="form-stack"><Field label="Vaca" required><Select value={abortionForm.id_vaca} onChange={(event) => setAbortionForm((current) => ({ ...current, id_vaca: event.target.value }))}><option value="">Selecciona</option>{females.data?.map((animal) => <option key={animal.id_animal} value={animal.id_animal}>{animal.nombre}{animal.codigo_arete ? ` · ${animal.codigo_arete}` : ''}</option>)}</Select></Field><Field label="Fecha"><Input type="datetime-local" value={abortionForm.fecha} onChange={(event) => setAbortionForm((current) => ({ ...current, fecha: event.target.value }))} /></Field><Field label="Causa"><Input value={abortionForm.causa} onChange={(event) => setAbortionForm((current) => ({ ...current, causa: event.target.value }))} /></Field><Field label="Meses de gestación"><Input type="number" min="0" max="12" step="0.1" value={abortionForm.meses_gestacion} onChange={(event) => setAbortionForm((current) => ({ ...current, meses_gestacion: event.target.value }))} /></Field><Field label="Descripción"><Textarea value={abortionForm.descripcion} onChange={(event) => setAbortionForm((current) => ({ ...current, descripcion: event.target.value }))} /></Field></div></Modal> : null}
    {deleteAbortion ? <ConfirmDialog title="Eliminar aborto" message="¿Deseas eliminar este registro?" onClose={() => setDeleteAbortion(null)} onConfirm={() => removeAbortion.mutate(deleteAbortion)} loading={removeAbortion.isPending} /> : null}
  </div>;
}
