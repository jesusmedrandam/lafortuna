import {useEffect,useMemo,useState} from 'react';
import {ClipboardList,Eye,SlidersHorizontal} from 'lucide-react';
import {Button,CompactToolbar,EmptyState,ErrorState,IconButton,LoadingState,Modal,Select} from '../components/ui';
import {formatDateTime} from '../utils';
import {getAudit,type AuditPage,type AuditRecord} from './api';
import {auditAction,auditActor,auditChanges,auditEntity,auditRecordName} from './auditPresentation';
import {useV2Session} from './V2Session';

export function V2AuditPage(){
  const {session}=useV2Session();const token=session!.accessToken;const technical=session!.overview.user.isSuperadmin;
  const [data,setData]=useState<AuditPage|null>(null);const [search,setSearch]=useState('');const [page,setPage]=useState(1);
  const [action,setAction]=useState('');const [filters,setFilters]=useState(false);
  const [selected,setSelected]=useState<AuditRecord|null>(null);const [error,setError]=useState('');const [revision,setRevision]=useState(0);
  useEffect(()=>{let active=true;setData(null);setSelected(null);setError('');
    void getAudit(token,page,action).then(result=>{if(active)setData(result);})
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'No se pudo abrir el historial de cambios.');});
    return()=>{active=false;};},[token,page,action,revision]);
  const rows=useMemo(()=>data?.items.filter(item=>{
    const term=search.trim().toLocaleLowerCase();
    return !term||[auditActor(item),auditAction(item.action),auditRecordName(item),auditEntity(item.entityType),item.reason,
      ...(technical?[item.action,item.entityType,item.entityId]:[])].filter(Boolean).join(' ').toLocaleLowerCase().includes(term);
  })??[],[data,search,technical]);
  const choices=Array.from(new Set([...(action?[action]:[]),...(data?.items.map(item=>item.action)??[])]))
    .sort((a,b)=>auditAction(a).localeCompare(auditAction(b),'es'));
  const changes=selected?auditChanges(selected):[];
  return <div className="module-no-header audit-history">
    <p className="audit-intro">Consulta qué cambió, quién lo hizo y cuándo. Abre un cambio para ver los detalles.</p>
    <CompactToolbar search={search} onSearch={setSearch} placeholder="Buscar persona, animal o cambio"
      count={rows.length} actions={<IconButton label="Filtrar historial" className={filters||action?'active':''}
        onClick={()=>setFilters(value=>!value)}><SlidersHorizontal size={18}/></IconButton>}
      below={filters?<div className="compact-filter-panel"><Select aria-label="Tipo de cambio" value={action}
        onChange={event=>{setAction(event.target.value);setPage(1);}}><option value="">Todos los cambios</option>
        {choices.map(value=><option key={value} value={value}>{auditAction(value)}</option>)}
      </Select></div>:undefined}/>
    {data===null&&!error?<LoadingState/>:data===null?<ErrorState message={error} onRetry={()=>setRevision(value=>value+1)}/>
      :rows.length?<div className="audit-event-list">{rows.map(item=><article className="card audit-event" key={item.id}>
        <div><strong>{auditAction(item.action)}</strong><p>{auditRecordName(item)}</p>
          <small>{auditActor(item)} · {formatDateTime(item.occurredAt)}</small></div>
        <Button variant="ghost" onClick={()=>setSelected(item)} aria-label={`Ver cambio: ${auditRecordName(item)}`}>
          <Eye size={16}/>Ver detalle</Button>
      </article>)}</div>:<EmptyState icon={ClipboardList} title={search||action?'No encontramos esos cambios':'Sin cambios registrados'}
        description={search||action?'Prueba otra búsqueda o quita el filtro.':'Los cambios realizados en esta propiedad aparecerán aquí.'}/>}
    {data&&(page>1||data.hasMore)&&<div className="animal-pages"><Button variant="secondary" disabled={page===1}
      onClick={()=>setPage(value=>Math.max(1,value-1))}>Anterior</Button><span>Página {page}</span>
      <Button variant="secondary" disabled={!data.hasMore} onClick={()=>setPage(value=>value+1)}>Siguiente</Button></div>}
    {selected&&<Modal title={auditAction(selected.action)} wide onClose={()=>setSelected(null)}
      footer={<Button variant="ghost" onClick={()=>setSelected(null)}>Cerrar</Button>}>
      <dl className="audit-meta"><div><dt>Registro</dt><dd>{auditRecordName(selected)}</dd></div>
        <div><dt>Responsable</dt><dd>{auditActor(selected)}</dd></div>
        <div><dt>Fecha y hora</dt><dd>{formatDateTime(selected.occurredAt)}</dd></div>
        {selected.reason&&<div><dt>Motivo</dt><dd>{selected.reason}</dd></div>}</dl>
      {changes.length?<div className="audit-readable-changes"><h3>{selected.beforeData==null?'Información registrada':'Qué cambió'}</h3>
        {changes.map((change,index)=><div className="audit-readable-change" key={index}><strong>{change.label}</strong>
          {selected.beforeData!=null&&<p><span>Antes: </span>{change.before}</p>}<p><span>Ahora: </span>{change.after}</p>
          {change.before===change.after&&<small>Se cambió la selección de este dato.</small>}</div>)}</div>
        :<p>Se guardó este cambio. No hay más información disponible en el registro.</p>}
      {technical&&<details className="audit-technical"><summary>Detalles técnicos · Superadministrador</summary>
        <dl className="audit-meta"><div><dt>Acción</dt><dd>{selected.action}</dd></div>
          <div><dt>Entidad</dt><dd>{selected.entityType}</dd></div><div><dt>ID del registro</dt><dd>{selected.entityId||'—'}</dd></div>
          <div><dt>ID del cambio</dt><dd>{selected.id}</dd></div><div><dt>ID del responsable</dt><dd>{selected.actorUserId||'—'}</dd></div>
          <div><dt>IP</dt><dd>{selected.ipAddress||'—'}</dd></div><div><dt>Dispositivo</dt><dd>{selected.userAgent||'—'}</dd></div></dl>
        <div className="json-compare"><div><h3>Datos anteriores</h3><pre>{JSON.stringify(selected.beforeData,null,2)??'Sin datos'}</pre></div>
          <div><h3>Datos nuevos</h3><pre>{JSON.stringify(selected.afterData,null,2)??'Sin datos'}</pre></div></div>
      </details>}
    </Modal>}
  </div>;
}
