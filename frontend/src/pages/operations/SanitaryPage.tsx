import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Edit3, Plus, Stethoscope, Syringe, Trash2, Users } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AnimalSelectionBuilder, type AnimalSelectionValue } from '../../components/AnimalSelectionBuilder';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Textarea } from '../../components/ui';
import { itemId, itemLabel, useCatalog } from '../../hooks/useCatalog';
import type { Animal, GenericRecord, SanitaryCampaign } from '../../types/api';
import { formatDateTime, formatNumber, humanizeCode, nullIfEmpty } from '../../utils';

const localNow = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

type Tab = 'campaigns' | 'individual';

interface CampaignForm {
  id_tipo_tratamiento: string;
  id_medicamento: string;
  id_via_administracion: string;
  dosis_general: string;
  id_unidad_dosis: string;
  fecha_aplicacion: string;
  responsable: string;
  observaciones: string;
  selection: AnimalSelectionValue;
}

const emptyCampaign = (): CampaignForm => ({
  id_tipo_tratamiento: '', id_medicamento: '', id_via_administracion: '', dosis_general: '', id_unidad_dosis: '',
  fecha_aplicacion: localNow(), responsable: '', observaciones: '', selection: { mode: 'GRUPO', groupId: '', animals: [] },
});

interface TreatmentForm {
  id_tratamiento?: string;
  id_animal: string;
  id_tipo_tratamiento: string;
  id_medicamento: string;
  id_via_administracion: string;
  dosis: string;
  id_unidad_dosis: string;
  fecha_aplicacion: string;
  proxima_aplicacion: string;
  aplicado_por: string;
  descripcion: string;
  observaciones: string;
}

const emptyTreatment = (): TreatmentForm => ({
  id_animal: '', id_tipo_tratamiento: '', id_medicamento: '', id_via_administracion: '', dosis: '', id_unidad_dosis: '',
  fecha_aplicacion: localNow(), proxima_aplicacion: '', aplicado_por: '', descripcion: '', observaciones: '',
});


export function SanitaryPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('campaigns');
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [campaign, setCampaign] = useState<CampaignForm>(emptyCampaign);
  const [treatmentOpen, setTreatmentOpen] = useState(false);
  const [treatment, setTreatment] = useState<TreatmentForm>(emptyTreatment);
  const [deleteRecord, setDeleteRecord] = useState<string | null>(null);

  const types = useCatalog('tipos-tratamiento');
  const medicines = useCatalog('medicamentos');
  const routes = useCatalog('vias');
  const units = useCatalog('unidades');
  const animals = useQuery({ queryKey: ['animals', 'sanitary'], queryFn: () => apiRequest<Animal[]>('/animales?limit=100') });
  const campaigns = useQuery({ queryKey: ['sanitary-campaigns'], queryFn: () => apiRequest<SanitaryCampaign[]>('/jornadas-sanitarias') });
  const treatments = useQuery({ queryKey: ['records', 'tratamientos'], queryFn: () => apiRequest<GenericRecord[]>('/registros/tratamientos') });

  const createCampaign = useMutation({
    mutationFn: () => {
      const selected = campaign.selection.animals.filter((animal) => animal.seleccionado);
      if (!selected.length) throw new Error('Selecciona al menos un animal.');
      if (!campaign.id_tipo_tratamiento || !campaign.id_medicamento || !campaign.id_via_administracion || !campaign.id_unidad_dosis || !campaign.dosis_general) throw new Error('Completa tipo, medicamento, vía, dosis y unidad.');
      return apiRequest<SanitaryCampaign>('/jornadas-sanitarias', {
        method: 'POST',
        body: {
          id_tipo_tratamiento: campaign.id_tipo_tratamiento,
          id_medicamento: campaign.id_medicamento,
          id_via_administracion: campaign.id_via_administracion,
          dosis_general: Number(campaign.dosis_general),
          id_unidad_dosis: campaign.id_unidad_dosis,
          modo_seleccion: campaign.selection.mode,
          id_grupo_filtro: campaign.selection.mode === 'GRUPO' ? campaign.selection.groupId : null,
          fecha_aplicacion: new Date(campaign.fecha_aplicacion).toISOString(),
          responsable: nullIfEmpty(campaign.responsable),
          observaciones: nullIfEmpty(campaign.observaciones),
          animales: campaign.selection.animals.map((animal) => ({
            id_animal: animal.id_animal,
            seleccionado: animal.seleccionado,
            dosis_aplicada: animal.dosis_aplicada || null,
            id_unidad_dosis: animal.dosis_aplicada ? campaign.id_unidad_dosis : null,
            observaciones: animal.observaciones || null,
          })),
        },
      });
    },
    onSuccess: () => { toast.show('Jornada guardada como borrador.'); setCampaignOpen(false); setCampaign(emptyCampaign()); void queryClient.invalidateQueries({ queryKey: ['sanitary-campaigns'] }); },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  const applyCampaign = useMutation({
    mutationFn: (id: string) => apiRequest(`/jornadas-sanitarias/${id}/aplicar`, { method: 'POST' }),
    onSuccess: () => { toast.show('Jornada aplicada y registros individuales generados.'); void queryClient.invalidateQueries({ queryKey: ['sanitary-campaigns'] }); void queryClient.invalidateQueries({ queryKey: ['records', 'tratamientos'] }); },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const saveTreatment = useMutation({
    mutationFn: () => {
      if (!treatment.id_animal || !treatment.id_tipo_tratamiento || !treatment.id_medicamento || !treatment.id_via_administracion || !treatment.id_unidad_dosis || !treatment.dosis) throw new Error('Completa los campos obligatorios.');
      const body = {
        id_animal: treatment.id_animal,
        id_tipo_tratamiento: treatment.id_tipo_tratamiento,
        id_medicamento: treatment.id_medicamento,
        id_via_administracion: treatment.id_via_administracion,
        dosis: Number(treatment.dosis),
        id_unidad_dosis: treatment.id_unidad_dosis,
        fecha_aplicacion: new Date(treatment.fecha_aplicacion).toISOString(),
        proxima_aplicacion: treatment.proxima_aplicacion ? new Date(treatment.proxima_aplicacion).toISOString() : null,
        aplicado_por: nullIfEmpty(treatment.aplicado_por),
        descripcion: nullIfEmpty(treatment.descripcion),
        observaciones: nullIfEmpty(treatment.observaciones),
      };
      return apiRequest(`/registros/tratamientos${treatment.id_tratamiento ? `/${treatment.id_tratamiento}` : ''}`, { method: treatment.id_tratamiento ? 'PATCH' : 'POST', body });
    },
    onSuccess: () => { toast.show(treatment.id_tratamiento ? 'Tratamiento actualizado.' : 'Tratamiento registrado.'); setTreatmentOpen(false); setTreatment(emptyTreatment()); void queryClient.invalidateQueries({ queryKey: ['records', 'tratamientos'] }); },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  const removeTreatment = useMutation({
    mutationFn: (id: string) => apiRequest(`/registros/tratamientos/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.show('Tratamiento eliminado.'); setDeleteRecord(null); void queryClient.invalidateQueries({ queryKey: ['records', 'tratamientos'] }); },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const typeName = (id: unknown) => {
    const item = types.data?.find((value) => itemId(value) === String(id));
    return item ? itemLabel(item) : '—';
  };
  const medicineName = (id: unknown) => {
    const item = medicines.data?.find((value) => itemId(value) === String(id));
    return item ? itemLabel(item) : '—';
  };
  const routeName = (id: unknown) => {
    const item = routes.data?.find((value) => itemId(value) === String(id));
    return item ? itemLabel(item) : '—';
  };
  const unitName = (id: unknown) => {
    const item = units.data?.find((value) => itemId(value) === String(id));
    return item ? String(item.simbolo ?? item.nombre ?? '—') : '—';
  };

  const editTreatment = (record: GenericRecord) => {
    const toLocal = (value: unknown) => {
      if (!value) return '';
      const date = new Date(String(value));
      date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
      return date.toISOString().slice(0, 16);
    };
    setTreatment({
      id_tratamiento: String(record.id_tratamiento), id_animal: String(record.id_animal), id_tipo_tratamiento: String(record.id_tipo_tratamiento),
      id_medicamento: String(record.id_medicamento), id_via_administracion: String(record.id_via_administracion), dosis: String(record.dosis ?? ''),
      id_unidad_dosis: String(record.id_unidad_dosis), fecha_aplicacion: toLocal(record.fecha_aplicacion), proxima_aplicacion: toLocal(record.proxima_aplicacion),
      aplicado_por: String(record.aplicado_por ?? ''), descripcion: String(record.descripcion ?? ''), observaciones: String(record.observaciones ?? ''),
    });
    setTreatmentOpen(true);
  };

  return <div>
    <PageHeader title="Sanidad" description="Jornadas colectivas y tratamientos individuales con historial por animal." action={hasPermission('SANIDAD_ADMINISTRAR') ? <Button onClick={() => tab === 'campaigns' ? (setCampaign(emptyCampaign()), setCampaignOpen(true)) : (setTreatment(emptyTreatment()), setTreatmentOpen(true))}><Plus size={18} />{tab === 'campaigns' ? 'Nueva jornada' : 'Nuevo tratamiento'}</Button> : undefined} />
    <div className="page-tabs"><button className={tab === 'campaigns' ? 'active' : ''} onClick={() => setTab('campaigns')}><Users size={17} />Jornadas colectivas</button><button className={tab === 'individual' ? 'active' : ''} onClick={() => setTab('individual')}><Stethoscope size={17} />Tratamientos individuales</button></div>

    {tab === 'campaigns' ? <>
      {campaigns.isLoading ? <LoadingState /> : campaigns.isError ? <ErrorState message={(campaigns.error as Error).message} onRetry={() => void campaigns.refetch()} /> : campaigns.data?.length ? <div className="record-grid operation-grid">{campaigns.data.map((item) => <Card className="operation-card" key={item.id_jornada}>
        <div className="operation-card-header"><div className="operation-icon"><Syringe size={23} /></div><div><h3>{item.tipo_tratamiento}</h3><span>{formatDateTime(item.fecha_aplicacion)}</span></div><Badge tone={item.estado === 'COMPLETADO' ? 'success' : item.estado === 'CANCELADO' ? 'danger' : 'warning'}>{humanizeCode(item.estado)}</Badge></div>
        <div className="detail-grid compact"><div><small>Medicamento</small><strong>{item.medicamento}</strong></div><div><small>Dosis</small><strong>{formatNumber(item.dosis_general, 4)} {item.unidad}</strong></div><div><small>Vía</small><strong>{item.via}</strong></div><div><small>Responsable</small><strong>{item.responsable || 'Sin registrar'}</strong></div></div>
        <div className="operation-stats"><span><Users size={16} />{item.total_seleccionados} seleccionados</span><span>{item.detalles?.filter((detail) => detail.estado === 'APLICADO').length ?? 0} aplicados</span></div>
        {item.detalles?.length ? <details className="operation-details"><summary>Ver animales</summary><div>{item.detalles.map((detail) => <span key={detail.id_detalle} className={!detail.seleccionado ? 'excluded' : ''}>{detail.seleccionado ? '✓' : '—'} {detail.animal} · {humanizeCode(detail.estado)}{detail.dosis_aplicada ? ` · ${detail.dosis_aplicada}` : ''}</span>)}</div></details> : null}
        {item.estado === 'BORRADOR' && hasPermission('SANIDAD_ADMINISTRAR') ? <div className="card-actions"><Button onClick={() => applyCampaign.mutate(item.id_jornada)} loading={applyCampaign.isPending}><CheckCircle2 size={17} />Aplicar jornada</Button></div> : null}
      </Card>)}</div> : <EmptyState icon={Syringe} title="Sin jornadas sanitarias" description="Crea una vacunación, desparasitación o tratamiento para varios animales." action={hasPermission('SANIDAD_ADMINISTRAR') ? <Button onClick={() => setCampaignOpen(true)}><Plus size={18} />Nueva jornada</Button> : undefined} />}
    </> : <>
      {treatments.isLoading ? <LoadingState /> : treatments.isError ? <ErrorState message={(treatments.error as Error).message} onRetry={() => void treatments.refetch()} /> : treatments.data?.length ? <div className="table-card"><div className="table-responsive"><table className="data-table"><thead><tr><th>Animal</th><th>Tratamiento</th><th>Medicamento</th><th>Dosis</th><th>Aplicación</th><th>Próxima</th>{hasPermission('SANIDAD_ADMINISTRAR') ? <th>Acciones</th> : null}</tr></thead><tbody>{treatments.data.map((record) => <tr key={String(record.id_tratamiento)}><td><strong>{String(record.animal ?? '—')}</strong><small>{record.codigo_arete ? `Arete ${record.codigo_arete}` : ''}</small></td><td>{typeName(record.id_tipo_tratamiento)}</td><td>{medicineName(record.id_medicamento)}</td><td>{formatNumber(record.dosis as number | string, 4)} {unitName(record.id_unidad_dosis)}</td><td>{formatDateTime(String(record.fecha_aplicacion))}<small>{routeName(record.id_via_administracion)}</small></td><td>{formatDateTime(record.proxima_aplicacion ? String(record.proxima_aplicacion) : null)}</td>{hasPermission('SANIDAD_ADMINISTRAR') ? <td><div className="inline-actions"><Button variant="ghost" onClick={() => editTreatment(record)}><Edit3 size={16} /></Button><Button variant="ghost" onClick={() => setDeleteRecord(String(record.id_tratamiento))}><Trash2 size={16} /></Button></div></td> : null}</tr>)}</tbody></table></div></div> : <EmptyState icon={Stethoscope} title="Sin tratamientos individuales" description="Registra medicamentos y dosis aplicadas a un animal." />}
    </>}

    {campaignOpen ? <Modal title="Nueva jornada sanitaria" wide onClose={() => setCampaignOpen(false)} footer={<><Button variant="ghost" onClick={() => setCampaignOpen(false)}>Cancelar</Button><Button onClick={() => createCampaign.mutate()} loading={createCampaign.isPending}>Guardar borrador</Button></>}><div className="form-stack"><div className="form-section"><h3>Tratamiento general</h3><div className="form-grid">
      <Field label="Tipo" required><Select value={campaign.id_tipo_tratamiento} onChange={(event) => setCampaign((current) => ({ ...current, id_tipo_tratamiento: event.target.value }))}><option value="">Selecciona</option>{types.data?.filter((item) => item.activo !== false).map((item) => <option value={itemId(item)} key={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
      <Field label="Medicamento" required><Select value={campaign.id_medicamento} onChange={(event) => setCampaign((current) => ({ ...current, id_medicamento: event.target.value }))}><option value="">Selecciona</option>{medicines.data?.filter((item) => item.activo !== false).map((item) => <option value={itemId(item)} key={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
      <Field label="Vía" required><Select value={campaign.id_via_administracion} onChange={(event) => setCampaign((current) => ({ ...current, id_via_administracion: event.target.value }))}><option value="">Selecciona</option>{routes.data?.filter((item) => item.activo !== false).map((item) => <option value={itemId(item)} key={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
      <Field label="Dosis general" required><Input type="number" min="0.0001" step="0.0001" value={campaign.dosis_general} onChange={(event) => setCampaign((current) => ({ ...current, dosis_general: event.target.value }))} /></Field>
      <Field label="Unidad" required><Select value={campaign.id_unidad_dosis} onChange={(event) => setCampaign((current) => ({ ...current, id_unidad_dosis: event.target.value }))}><option value="">Selecciona</option>{units.data?.filter((item) => item.activo !== false).map((item) => <option value={itemId(item)} key={itemId(item)}>{itemLabel(item)} {item.simbolo ? `(${item.simbolo})` : ''}</option>)}</Select></Field>
      <Field label="Fecha y hora" required><Input type="datetime-local" value={campaign.fecha_aplicacion} onChange={(event) => setCampaign((current) => ({ ...current, fecha_aplicacion: event.target.value }))} /></Field>
      <Field label="Responsable"><Input value={campaign.responsable} onChange={(event) => setCampaign((current) => ({ ...current, responsable: event.target.value }))} /></Field>
    </div><Field label="Observaciones"><Textarea value={campaign.observaciones} onChange={(event) => setCampaign((current) => ({ ...current, observaciones: event.target.value }))} /></Field></div><AnimalSelectionBuilder value={campaign.selection} doseUnitId={campaign.id_unidad_dosis} allowDose onChange={(selection) => setCampaign((current) => ({ ...current, selection }))} /></div></Modal> : null}

    {treatmentOpen ? <Modal title={treatment.id_tratamiento ? 'Editar tratamiento' : 'Nuevo tratamiento'} wide onClose={() => setTreatmentOpen(false)} footer={<><Button variant="ghost" onClick={() => setTreatmentOpen(false)}>Cancelar</Button><Button onClick={() => saveTreatment.mutate()} loading={saveTreatment.isPending}>Guardar</Button></>}><div className="form-stack"><div className="form-grid">
      <Field label="Animal" required><Select value={treatment.id_animal} onChange={(event) => setTreatment((current) => ({ ...current, id_animal: event.target.value }))}><option value="">Selecciona</option>{animals.data?.map((animal) => <option value={animal.id_animal} key={animal.id_animal}>{animal.nombre}{animal.codigo_arete ? ` · ${animal.codigo_arete}` : ''}</option>)}</Select></Field>
      <Field label="Tipo" required><Select value={treatment.id_tipo_tratamiento} onChange={(event) => setTreatment((current) => ({ ...current, id_tipo_tratamiento: event.target.value }))}><option value="">Selecciona</option>{types.data?.map((item) => <option value={itemId(item)} key={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
      <Field label="Medicamento" required><Select value={treatment.id_medicamento} onChange={(event) => setTreatment((current) => ({ ...current, id_medicamento: event.target.value }))}><option value="">Selecciona</option>{medicines.data?.map((item) => <option value={itemId(item)} key={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
      <Field label="Vía" required><Select value={treatment.id_via_administracion} onChange={(event) => setTreatment((current) => ({ ...current, id_via_administracion: event.target.value }))}><option value="">Selecciona</option>{routes.data?.map((item) => <option value={itemId(item)} key={itemId(item)}>{itemLabel(item)}</option>)}</Select></Field>
      <Field label="Dosis" required><Input type="number" min="0.0001" step="0.0001" value={treatment.dosis} onChange={(event) => setTreatment((current) => ({ ...current, dosis: event.target.value }))} /></Field>
      <Field label="Unidad" required><Select value={treatment.id_unidad_dosis} onChange={(event) => setTreatment((current) => ({ ...current, id_unidad_dosis: event.target.value }))}><option value="">Selecciona</option>{units.data?.map((item) => <option value={itemId(item)} key={itemId(item)}>{itemLabel(item)} {item.simbolo ? `(${item.simbolo})` : ''}</option>)}</Select></Field>
      <Field label="Fecha de aplicación" required><Input type="datetime-local" value={treatment.fecha_aplicacion} onChange={(event) => setTreatment((current) => ({ ...current, fecha_aplicacion: event.target.value }))} /></Field>
      <Field label="Próxima aplicación"><Input type="datetime-local" value={treatment.proxima_aplicacion} onChange={(event) => setTreatment((current) => ({ ...current, proxima_aplicacion: event.target.value }))} /></Field>
      <Field label="Aplicado por"><Input value={treatment.aplicado_por} onChange={(event) => setTreatment((current) => ({ ...current, aplicado_por: event.target.value }))} /></Field>
      <Field label="Descripción"><Input value={treatment.descripcion} onChange={(event) => setTreatment((current) => ({ ...current, descripcion: event.target.value }))} /></Field>
    </div><Field label="Observaciones"><Textarea value={treatment.observaciones} onChange={(event) => setTreatment((current) => ({ ...current, observaciones: event.target.value }))} /></Field></div></Modal> : null}
    {deleteRecord ? <ConfirmDialog title="Eliminar tratamiento" message="¿Deseas eliminar este registro del historial?" onClose={() => setDeleteRecord(null)} onConfirm={() => removeTreatment.mutate(deleteRecord)} loading={removeTreatment.isPending} /> : null}
  </div>;
}
