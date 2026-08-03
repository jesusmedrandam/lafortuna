import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, Edit3, Milk, Plus, Trash2 } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Textarea } from '../../components/ui';
import type { Animal, Birth, GenericRecord } from '../../types/api';
import { formatDate, formatNumber, humanizeCode, nullIfEmpty } from '../../utils';

type Tab = 'lactations' | 'milk';
interface LactationForm { id_lactancia?: string; id_vaca: string; id_parto: string; fecha_inicio: string; fecha_fin: string; activa: boolean; observaciones: string; }
const emptyLactation = (): LactationForm => ({ id_vaca: '', id_parto: '', fecha_inicio: new Date().toISOString().slice(0, 10), fecha_fin: '', activa: true, observaciones: '' });
interface MilkForm { id_produccion?: string; id_vaca: string; id_lactancia: string; fecha_produccion: string; turno: string; litros: string; observaciones: string; }
const emptyMilk = (): MilkForm => ({ id_vaca: '', id_lactancia: '', fecha_produccion: new Date().toISOString().slice(0, 10), turno: 'UNICO', litros: '', observaciones: '' });

export function ProductionPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const canReadLactations = hasPermission('LACTANCIA_CONSULTAR');
  const canReadProduction = hasPermission('PRODUCCION_CONSULTAR');
  const [tab, setTab] = useState<Tab>(() => canReadLactations ? 'lactations' : 'milk');
  const [lactationOpen, setLactationOpen] = useState(false);
  const [lactation, setLactation] = useState<LactationForm>(emptyLactation);
  const [milkOpen, setMilkOpen] = useState(false);
  const [milk, setMilk] = useState<MilkForm>(emptyMilk);
  const [deleteItem, setDeleteItem] = useState<{ type: Tab; id: string } | null>(null);

  const lactations = useQuery({ queryKey: ['records', 'lactancias'], queryFn: () => apiRequest<GenericRecord[]>('/registros/lactancias'), enabled: canReadLactations });
  const productions = useQuery({ queryKey: ['records', 'producciones'], queryFn: () => apiRequest<GenericRecord[]>('/registros/producciones'), enabled: canReadProduction });
  const females = useQuery({ queryKey: ['animals', 'production-females'], queryFn: () => apiRequest<Animal[]>('/animales?limit=100&sexo=HEMBRA') });
  const births = useQuery({ queryKey: ['births', 'production'], queryFn: () => apiRequest<Birth[]>('/partos') });

  const saveLactation = useMutation({
    mutationFn: () => {
      if (!lactation.id_vaca || !lactation.fecha_inicio) throw new Error('Selecciona la vaca y la fecha de inicio.');
      const body = { id_vaca: lactation.id_vaca, id_parto: lactation.id_parto || null, fecha_inicio: lactation.fecha_inicio, fecha_fin: lactation.activa ? null : lactation.fecha_fin || null, activa: lactation.activa, observaciones: nullIfEmpty(lactation.observaciones) };
      return apiRequest(`/registros/lactancias${lactation.id_lactancia ? `/${lactation.id_lactancia}` : ''}`, { method: lactation.id_lactancia ? 'PATCH' : 'POST', body });
    },
    onSuccess: () => { toast.show(lactation.id_lactancia ? 'Lactancia actualizada.' : 'Lactancia registrada.'); setLactationOpen(false); setLactation(emptyLactation()); void client.invalidateQueries({ queryKey: ['records', 'lactancias'] }); },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  const saveMilk = useMutation({
    mutationFn: () => {
      if (!milk.id_vaca || !milk.id_lactancia || !milk.fecha_produccion || !milk.litros) throw new Error('Completa vaca, lactancia, fecha y litros.');
      const body = { id_vaca: milk.id_vaca, id_lactancia: milk.id_lactancia, fecha_produccion: milk.fecha_produccion, turno: milk.turno, litros: Number(milk.litros), observaciones: nullIfEmpty(milk.observaciones) };
      return apiRequest(`/registros/producciones${milk.id_produccion ? `/${milk.id_produccion}` : ''}`, { method: milk.id_produccion ? 'PATCH' : 'POST', body });
    },
    onSuccess: () => { toast.show(milk.id_produccion ? 'Producción actualizada.' : 'Producción registrada.'); setMilkOpen(false); setMilk(emptyMilk()); void client.invalidateQueries({ queryKey: ['records', 'producciones'] }); },
    onError: (error) => toast.show(error instanceof ApiError ? error.message : (error as Error).message, 'error'),
  });

  const remove = useMutation({
    mutationFn: ({ type, id }: { type: Tab; id: string }) => apiRequest(`/registros/${type === 'lactations' ? 'lactancias' : 'producciones'}/${id}`, { method: 'DELETE' }),
    onSuccess: (_, variables) => { toast.show('Registro eliminado.'); setDeleteItem(null); void client.invalidateQueries({ queryKey: ['records', variables.type === 'lactations' ? 'lactancias' : 'producciones'] }); },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const editLactation = (record: GenericRecord) => {
    setLactation({ id_lactancia: String(record.id_lactancia), id_vaca: String(record.id_vaca), id_parto: String(record.id_parto ?? ''), fecha_inicio: String(record.fecha_inicio ?? ''), fecha_fin: String(record.fecha_fin ?? ''), activa: Boolean(record.activa), observaciones: String(record.observaciones ?? '') });
    setLactationOpen(true);
  };
  const editMilk = (record: GenericRecord) => {
    setMilk({ id_produccion: String(record.id_produccion), id_vaca: String(record.id_vaca), id_lactancia: String(record.id_lactancia), fecha_produccion: String(record.fecha_produccion ?? ''), turno: String(record.turno ?? 'UNICO'), litros: String(record.litros ?? ''), observaciones: String(record.observaciones ?? '') });
    setMilkOpen(true);
  };

  const selectedLactations = lactations.data?.filter((record) => !milk.id_vaca || String(record.id_vaca) === milk.id_vaca) ?? [];
  const lactationLabel = (id: unknown) => {
    const row = lactations.data?.find((record) => String(record.id_lactancia) === String(id));
    return row ? `${String(row.animal ?? 'Vaca')} · ${formatDate(String(row.fecha_inicio))}${row.activa ? ' · activa' : ''}` : '—';
  };

  return <div>
    <PageHeader title="Producción y lactancias" description="Controla ciclos productivos y litros por vaca, fecha y turno." action={(tab === 'lactations' ? hasPermission('LACTANCIA_ADMINISTRAR') : hasPermission('PRODUCCION_ADMINISTRAR')) ? <Button onClick={() => tab === 'lactations' ? (setLactation(emptyLactation()), setLactationOpen(true)) : (setMilk(emptyMilk()), setMilkOpen(true))}><Plus size={18} />{tab === 'lactations' ? 'Nueva lactancia' : 'Registrar producción'}</Button> : undefined} />
    <div className="page-tabs">{canReadLactations ? <button className={tab === 'lactations' ? 'active' : ''} onClick={() => setTab('lactations')}><CalendarRange size={17} />Lactancias</button> : null}{canReadProduction ? <button className={tab === 'milk' ? 'active' : ''} onClick={() => setTab('milk')}><Milk size={17} />Producción de leche</button> : null}</div>

    {tab === 'lactations' ? lactations.isLoading ? <LoadingState /> : lactations.isError ? <ErrorState message={(lactations.error as Error).message} onRetry={() => void lactations.refetch()} /> : lactations.data?.length ? <div className="table-card"><div className="table-responsive"><table className="data-table"><thead><tr><th>Vaca</th><th>Inicio</th><th>Fin</th><th>Estado</th><th>Parto relacionado</th><th>Observaciones</th>{hasPermission('LACTANCIA_ADMINISTRAR') ? <th>Acciones</th> : null}</tr></thead><tbody>{lactations.data.map((record) => <tr key={String(record.id_lactancia)}><td><strong>{String(record.animal ?? '—')}</strong><small>{record.codigo_arete ? `Arete ${record.codigo_arete}` : ''}</small></td><td>{formatDate(String(record.fecha_inicio))}</td><td>{formatDate(record.fecha_fin ? String(record.fecha_fin) : null)}</td><td><Badge tone={record.activa ? 'success' : 'neutral'}>{record.activa ? 'Activa' : 'Cerrada'}</Badge></td><td>{record.id_parto ? births.data?.find((item) => item.id_parto === record.id_parto)?.fecha_parto ? formatDate(births.data.find((item) => item.id_parto === record.id_parto)!.fecha_parto) : 'Parto registrado' : '—'}</td><td>{String(record.observaciones ?? '—')}</td>{hasPermission('LACTANCIA_ADMINISTRAR') ? <td><div className="inline-actions"><Button variant="ghost" onClick={() => editLactation(record)}><Edit3 size={16} /></Button><Button variant="ghost" onClick={() => setDeleteItem({ type: 'lactations', id: String(record.id_lactancia) })}><Trash2 size={16} /></Button></div></td> : null}</tr>)}</tbody></table></div></div> : <EmptyState icon={CalendarRange} title="Sin lactancias" description="Abre una lactancia para registrar producción de leche." /> : productions.isLoading ? <LoadingState /> : productions.isError ? <ErrorState message={(productions.error as Error).message} onRetry={() => void productions.refetch()} /> : productions.data?.length ? <div className="table-card"><div className="table-responsive"><table className="data-table"><thead><tr><th>Vaca</th><th>Fecha</th><th>Turno</th><th>Litros</th><th>Lactancia</th><th>Observaciones</th>{hasPermission('PRODUCCION_ADMINISTRAR') ? <th>Acciones</th> : null}</tr></thead><tbody>{productions.data.map((record) => <tr key={String(record.id_produccion)}><td><strong>{String(record.animal ?? '—')}</strong><small>{record.codigo_arete ? `Arete ${record.codigo_arete}` : ''}</small></td><td>{formatDate(String(record.fecha_produccion))}</td><td><Badge tone="info">{humanizeCode(String(record.turno))}</Badge></td><td><strong>{formatNumber(record.litros as number | string, 3)} L</strong></td><td>{lactationLabel(record.id_lactancia)}</td><td>{String(record.observaciones ?? '—')}</td>{hasPermission('PRODUCCION_ADMINISTRAR') ? <td><div className="inline-actions"><Button variant="ghost" onClick={() => editMilk(record)}><Edit3 size={16} /></Button><Button variant="ghost" onClick={() => setDeleteItem({ type: 'milk', id: String(record.id_produccion) })}><Trash2 size={16} /></Button></div></td> : null}</tr>)}</tbody></table></div></div> : <EmptyState icon={Milk} title="Sin producción registrada" description="Registra los litros obtenidos por vaca y turno." />}

    {lactationOpen ? <Modal title={lactation.id_lactancia ? 'Editar lactancia' : 'Nueva lactancia'} onClose={() => setLactationOpen(false)} footer={<><Button variant="ghost" onClick={() => setLactationOpen(false)}>Cancelar</Button><Button onClick={() => saveLactation.mutate()} loading={saveLactation.isPending}>Guardar</Button></>}><div className="form-stack"><Field label="Vaca" required><Select value={lactation.id_vaca} onChange={(event) => setLactation((current) => ({ ...current, id_vaca: event.target.value, id_parto: '' }))}><option value="">Selecciona</option>{females.data?.map((animal) => <option key={animal.id_animal} value={animal.id_animal}>{animal.nombre}{animal.codigo_arete ? ` · ${animal.codigo_arete}` : ''}</option>)}</Select></Field><Field label="Parto relacionado"><Select value={lactation.id_parto} onChange={(event) => setLactation((current) => ({ ...current, id_parto: event.target.value }))}><option value="">Sin relacionar</option>{births.data?.filter((birth) => !lactation.id_vaca || birth.id_madre === lactation.id_vaca).map((birth) => <option key={birth.id_parto} value={birth.id_parto}>{formatDate(birth.fecha_parto)} · {birth.crias.length} cría(s)</option>)}</Select></Field><Field label="Fecha de inicio" required><Input type="date" value={lactation.fecha_inicio} onChange={(event) => setLactation((current) => ({ ...current, fecha_inicio: event.target.value }))} /></Field><label className="checkbox"><input type="checkbox" checked={lactation.activa} onChange={(event) => setLactation((current) => ({ ...current, activa: event.target.checked, fecha_fin: event.target.checked ? '' : current.fecha_fin }))} />Lactancia activa</label>{!lactation.activa ? <Field label="Fecha de fin" required><Input type="date" value={lactation.fecha_fin} onChange={(event) => setLactation((current) => ({ ...current, fecha_fin: event.target.value }))} /></Field> : null}<Field label="Observaciones"><Textarea value={lactation.observaciones} onChange={(event) => setLactation((current) => ({ ...current, observaciones: event.target.value }))} /></Field></div></Modal> : null}

    {milkOpen ? <Modal title={milk.id_produccion ? 'Editar producción' : 'Registrar producción'} onClose={() => setMilkOpen(false)} footer={<><Button variant="ghost" onClick={() => setMilkOpen(false)}>Cancelar</Button><Button onClick={() => saveMilk.mutate()} loading={saveMilk.isPending}>Guardar</Button></>}><div className="form-stack"><Field label="Vaca" required><Select value={milk.id_vaca} onChange={(event) => setMilk((current) => ({ ...current, id_vaca: event.target.value, id_lactancia: '' }))}><option value="">Selecciona</option>{females.data?.map((animal) => <option key={animal.id_animal} value={animal.id_animal}>{animal.nombre}{animal.codigo_arete ? ` · ${animal.codigo_arete}` : ''}</option>)}</Select></Field><Field label="Lactancia" required><Select value={milk.id_lactancia} onChange={(event) => setMilk((current) => ({ ...current, id_lactancia: event.target.value }))}><option value="">Selecciona</option>{selectedLactations.map((record) => <option key={String(record.id_lactancia)} value={String(record.id_lactancia)}>{String(record.animal)} · {formatDate(String(record.fecha_inicio))}{record.activa ? ' · activa' : ''}</option>)}</Select></Field><div className="form-grid"><Field label="Fecha" required><Input type="date" value={milk.fecha_produccion} onChange={(event) => setMilk((current) => ({ ...current, fecha_produccion: event.target.value }))} /></Field><Field label="Turno"><Select value={milk.turno} onChange={(event) => setMilk((current) => ({ ...current, turno: event.target.value }))}>{['MANANA','TARDE','NOCHE','UNICO'].map((turn) => <option value={turn} key={turn}>{humanizeCode(turn)}</option>)}</Select></Field><Field label="Litros" required><Input type="number" min="0" step="0.001" value={milk.litros} onChange={(event) => setMilk((current) => ({ ...current, litros: event.target.value }))} /></Field></div><Field label="Observaciones"><Textarea value={milk.observaciones} onChange={(event) => setMilk((current) => ({ ...current, observaciones: event.target.value }))} /></Field></div></Modal> : null}
    {deleteItem ? <ConfirmDialog title="Eliminar registro" message="¿Deseas eliminar este registro?" onClose={() => setDeleteItem(null)} onConfirm={() => remove.mutate(deleteItem)} loading={remove.isPending} /> : null}
  </div>;
}
