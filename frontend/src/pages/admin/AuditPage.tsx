import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Eye } from 'lucide-react';
import { apiRequest } from '../../api/client';
import { Badge, Button, EmptyState, ErrorState, LoadingState, Modal, PageHeader, SearchBox, Select } from '../../components/ui';
import type { AuditEntry } from '../../types/api';
import { formatDateTime, humanizeCode } from '../../utils';

export function AuditPage() {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const query = useQuery({ queryKey: ['audit'], queryFn: () => apiRequest<AuditEntry[]>('/auditoria?limit=200') });
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (query.data ?? []).filter((item) => {
      if (action && item.accion !== action) return false;
      if (!term) return true;
      return `${item.usuario ?? ''} ${item.tabla_afectada} ${item.id_registro ?? ''} ${item.accion}`.toLowerCase().includes(term);
    });
  }, [query.data, search, action]);

  return <div>
    <PageHeader title="Auditoría" description="Consulta quién realizó cada cambio, cuándo ocurrió y qué datos fueron modificados." />
    <div className="toolbar"><SearchBox value={search} onChange={setSearch} placeholder="Buscar usuario, tabla o registro" /><div className="toolbar-filters"><Select value={action} onChange={(event) => setAction(event.target.value)}><option value="">Todas las acciones</option><option value="INSERT">Creación</option><option value="UPDATE">Actualización</option><option value="DELETE">Eliminación</option></Select></div></div>
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} /> : rows.length ? <div className="table-card"><div className="table-responsive"><table className="data-table"><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Tabla</th><th>Registro</th><th>Origen</th><th>Detalle</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id_auditoria}><td>{formatDateTime(item.created_at)}</td><td><strong>{item.usuario || 'Sistema'}</strong></td><td><Badge tone={item.accion === 'INSERT' ? 'success' : item.accion === 'DELETE' ? 'danger' : 'info'}>{humanizeCode(item.accion)}</Badge></td><td>{humanizeCode(item.tabla_afectada)}</td><td><code className="record-id">{item.id_registro || '—'}</code></td><td>{item.ip || '—'}<small>{item.user_agent ? item.user_agent.slice(0, 45) : ''}</small></td><td><Button variant="ghost" onClick={() => setSelected(item)}><Eye size={16} />Ver</Button></td></tr>)}</tbody></table></div></div> : <EmptyState icon={ClipboardList} title="Sin registros de auditoría" description="Las operaciones auditadas aparecerán aquí." />}
    {selected ? <Modal title={`Auditoría #${selected.id_auditoria}`} wide onClose={() => setSelected(null)} footer={<Button variant="ghost" onClick={() => setSelected(null)}>Cerrar</Button>}><div className="audit-detail-grid"><div className="form-section"><h3>Datos generales</h3><dl className="audit-meta"><div><dt>Fecha</dt><dd>{formatDateTime(selected.created_at)}</dd></div><div><dt>Usuario</dt><dd>{selected.usuario || 'Sistema'}</dd></div><div><dt>Acción</dt><dd>{humanizeCode(selected.accion)}</dd></div><div><dt>Tabla</dt><dd>{selected.tabla_afectada}</dd></div><div><dt>ID</dt><dd>{selected.id_registro || '—'}</dd></div><div><dt>IP</dt><dd>{selected.ip || '—'}</dd></div></dl></div><div className="json-compare"><div><h3>Datos anteriores</h3><pre>{JSON.stringify(selected.datos_anteriores, null, 2) || 'Sin datos'}</pre></div><div><h3>Datos nuevos</h3><pre>{JSON.stringify(selected.datos_nuevos, null, 2) || 'Sin datos'}</pre></div></div></div></Modal> : null}
  </div>;
}
