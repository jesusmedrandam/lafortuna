import {useEffect,useMemo,useState} from 'react';
import {ClipboardList,Eye,SlidersHorizontal} from 'lucide-react';
import {Badge,Button,CompactToolbar,EmptyState,ErrorState,IconButton,LoadingState,Modal,Select}
  from '../components/ui';
import {formatDateTime,humanizeCode} from '../utils';
import {getAudit,type AuditPage,type AuditRecord} from './api';
import {useV2Session} from './V2Session';

const tone=(action:string)=>action.endsWith('VOIDED')||action.endsWith('CANCELLED')?'danger' as const
  :action.endsWith('CREATED')?'success' as const:'info' as const;
export function V2AuditPage(){
  const {session}=useV2Session();const token=session!.accessToken;
  const [data,setData]=useState<AuditPage|null>(null);
  const [search,setSearch]=useState('');const [page,setPage]=useState(1);
  const [action,setAction]=useState('');const [filters,setFilters]=useState(false);
  const [selected,setSelected]=useState<AuditRecord|null>(null);
  const [error,setError]=useState('');const [revision,setRevision]=useState(0);
  useEffect(()=>{let active=true;setData(null);setError('');
    void getAudit(token,page,action).then(result=>{if(active)setData(result);})
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'No se pudo abrir la auditoría.');});
    return()=>{active=false;};},[token,page,action,revision]);
  const rows=useMemo(()=>data?.items.filter(item=>{
    const term=search.trim().toLocaleLowerCase();
    return !term||[item.actorName,item.entityType,item.entityId,item.action,item.reason]
      .filter(Boolean).join(' ').toLocaleLowerCase().includes(term);
  })??[],[data,search]);
  return <div className="module-no-header">
    <CompactToolbar search={search} onSearch={setSearch} placeholder="Buscar usuario, tabla o registro"
      count={rows.length} actions={<IconButton label="Filtrar auditoría" className={filters||action?'active':''}
        onClick={()=>setFilters(value=>!value)}><SlidersHorizontal size={18}/></IconButton>}
      below={filters?<div className="compact-filter-panel"><Select aria-label="Filtrar por acción"
        value={action} onChange={event=>{setAction(event.target.value);setPage(1);}}>
        <option value="">Todas las acciones</option>
        {action&&!data?.items.some(item=>item.action===action)&&<option value={action}>
          {humanizeCode(action)}</option>}
        {Array.from(new Set(data?.items.map(item=>item.action)??[])).sort().map(value=>
          <option key={value} value={value}>{humanizeCode(value)}</option>)}
      </Select></div>:undefined}/>
    {data===null&&!error?<LoadingState/>:data===null?<ErrorState message={error}
      onRetry={()=>setRevision(value=>value+1)}/>:rows.length?<div className="table-card">
      <div className="table-responsive"><table className="data-table"><thead><tr>
        <th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Registro</th><th>Origen</th><th>Detalle</th>
      </tr></thead><tbody>{rows.map(item=><tr key={item.id}>
        <td>{formatDateTime(item.occurredAt)}</td><td><strong>{item.actorName||'Sistema'}</strong></td>
        <td><Badge tone={tone(item.action)}>{humanizeCode(item.action)}</Badge></td>
        <td>{humanizeCode(item.entityType)}</td><td><code className="record-id">{item.entityId||'—'}</code></td>
        <td>{item.ipAddress||'—'}<small>{item.userAgent?.slice(0,45)??''}</small></td>
        <td><Button variant="ghost" onClick={()=>setSelected(item)}><Eye size={16}/>Ver</Button></td>
      </tr>)}</tbody></table></div></div>:<EmptyState icon={ClipboardList}
      title="Sin registros de auditoría" description="Las operaciones auditadas aparecerán aquí."/>}
    {data&&<div className="animal-pages"><Button variant="secondary" disabled={page===1}
      onClick={()=>setPage(value=>Math.max(1,value-1))}>Anterior</Button>
      <span>Página {page}</span><Button variant="secondary" disabled={!data.hasMore}
        onClick={()=>setPage(value=>value+1)}>Siguiente</Button></div>}
    {selected&&<Modal title={`Auditoría #${selected.id}`} wide onClose={()=>setSelected(null)}
      footer={<Button variant="ghost" onClick={()=>setSelected(null)}>Cerrar</Button>}>
      <div className="audit-detail-grid"><div className="form-section"><h3>Datos generales</h3>
        <dl className="audit-meta"><div><dt>Fecha</dt><dd>{formatDateTime(selected.occurredAt)}</dd></div>
          <div><dt>Usuario</dt><dd>{selected.actorName||'Sistema'}</dd></div>
          <div><dt>Acción</dt><dd>{humanizeCode(selected.action)}</dd></div>
          <div><dt>Entidad</dt><dd>{selected.entityType}</dd></div>
          <div><dt>ID</dt><dd>{selected.entityId||'—'}</dd></div>
          <div><dt>IP</dt><dd>{selected.ipAddress||'—'}</dd></div>
        </dl></div><div className="json-compare"><div><h3>Datos anteriores</h3>
          <pre>{selected.beforeData==null?'Sin datos':JSON.stringify(selected.beforeData,null,2)}</pre></div>
          <div><h3>Datos nuevos</h3>
            <pre>{selected.afterData==null?'Sin datos':JSON.stringify(selected.afterData,null,2)}</pre></div>
        </div></div>
    </Modal>}
  </div>;
}
