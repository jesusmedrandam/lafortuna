import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, CloudDownload, Database, FileUp, HardDrive, RefreshCw, Share2, Trash2, Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button, Card, Field, Modal, PageHeader, PasswordInput } from '../../components/ui';
import { useToast } from '../../components/ToastContext';
import {
  clearOfflineCache, createOfflineTransferPackage, getOfflineSetting, getOfflineTransferOptions, importOfflineTransferPackage, inspectOfflineTransferPackage, listOfflineCacheEntries, listOfflineMutations, offlineTransferMediaLabels, removeOfflineMutation, updateOfflineMutation,
  type OfflineCacheEntry, type OfflineMutation, type OfflineTransferMediaCategory,
} from '../../offline/database';
import { availableDownloadModules, downloadSelectedContent, getAutomaticDownloadPreferences, saveAutomaticDownloadPreferences, type AutomaticDownloadPreferences } from '../../offline/downloads';
import { describeOfflineMutation } from '../../offline/descriptions';
import { hasNetworkConnection } from '../../api/client';
import { useOffline } from '../../offline/OfflineContext';
import { DOWNLOAD_NOTIFICATION_ID, showLocalNotification } from '../../offline/native';

type DetailPanel = 'queries' | 'storage' | 'pending' | 'failed';
interface PreparedBackup { name:string;size:number;createdAt:number }
interface BackupProgress { phase:'create'|'import';current:number;total:number;message:string }
interface TransferOptionState { moduleCounts:Record<string,number>;mediaCounts:Partial<Record<OfflineTransferMediaCategory,number>> }
const allMediaCategories=Object.keys(offlineTransferMediaLabels) as OfflineTransferMediaCategory[];

function formatDate(value: number | null) {
  return value ? new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Nunca';
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toLocaleString('es-EC', { maximumFractionDigits: size >= 100 ? 0 : 1 })} ${units[unit]}`;
}

function errorLines(details: unknown) {
  if (!details || typeof details !== 'object') return [];
  const record = details as { formErrors?: unknown; fieldErrors?: Record<string, unknown> };
  const result = Array.isArray(record.formErrors) ? record.formErrors.map(String) : [];
  for (const [field, messages] of Object.entries(record.fieldErrors ?? {})) {
    if (Array.isArray(messages)) messages.forEach((message) => result.push(`${field.replaceAll('_', ' ')}: ${String(message)}`));
    else if (messages) result.push(`${field.replaceAll('_', ' ')}: ${String(messages)}`);
  }
  return [...new Set(result)];
}

function queuedBody(item: OfflineMutation) {
  if (item.jsonBody && typeof item.jsonBody === 'object') return item.jsonBody;
  const value: Record<string, unknown> = {};
  for (const entry of item.formEntries ?? []) {
    if (typeof entry.value !== 'string') continue;
    try { value[entry.key] = JSON.parse(entry.value) as unknown; }
    catch { value[entry.key] = entry.value; }
  }
  return value;
}

export function DownloadsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const offline = useOffline();
  const modules = useMemo(() => user ? availableDownloadModules(user) : [], [user]);
  const [selected, setSelected] = useState<string[]>([]);
  const [downloadMedia,setDownloadMedia]=useState<OfflineTransferMediaCategory[]>(allMediaCategories);
  const [queue, setQueue] = useState<OfflineMutation[]>([]);
  const [cacheEntries, setCacheEntries] = useState<OfflineCacheEntry[]>([]);
  const [queueLabels, setQueueLabels] = useState<Record<string, string>>({});
  const [activePanel, setActivePanel] = useState<DetailPanel | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [sharing,setSharing]=useState(false);
  const [importing,setImporting]=useState(false);
  const [createTransferOpen,setCreateTransferOpen]=useState(false);
  const [importTransferOpen,setImportTransferOpen]=useState(false);
  const [importReviewOpen,setImportReviewOpen]=useState(false);
  const [pendingTransfer,setPendingTransfer]=useState<unknown>(null);
  const [transferOptions,setTransferOptions]=useState<TransferOptionState>({moduleCounts:{},mediaCounts:{}});
  const [transferModules,setTransferModules]=useState<string[]>([]);
  const [transferMedia,setTransferMedia]=useState<OfflineTransferMediaCategory[]>([]);
  const [transferPassword,setTransferPassword]=useState('');
  const [transferPasswordConfirmation,setTransferPasswordConfirmation]=useState('');
  const [preparedBackup,setPreparedBackup]=useState<PreparedBackup|null>(null);
  const [backupProgress,setBackupProgress]=useState<BackupProgress|null>(null);
  const [automatic, setAutomatic] = useState<AutomaticDownloadPreferences>({ enabled: false, wifiOnly: true });
  const [progress, setProgress] = useState({ current: 0, total: 0, label: '' });

  const refreshQueue = async () => {
    if (!user) { setQueue([]); setCacheEntries([]); return; }
    const [items, entries] = await Promise.all([listOfflineMutations(user.id), listOfflineCacheEntries(user.id)]);
    setQueue(items);
    setCacheEntries(entries.sort((left, right) => right.savedAt - left.savedAt));
    const labels = await Promise.all(items.map(async (item) => [item.id, item.description ?? await describeOfflineMutation(user.id, item.path, item.method, queuedBody(item))] as const));
    setQueueLabels(Object.fromEntries(labels));
    await offline.refresh();
  };

  useEffect(() => {
    if (!user) return;
    void getOfflineSetting<string[]>(`downloadModules:${user.id}`).then((saved) => setSelected(saved?.filter((id) => modules.some((module) => module.id === id)) ?? modules.map((module) => module.id)));
    void getOfflineSetting<OfflineTransferMediaCategory[]>(`downloadMediaCategories:${user.id}`).then((saved)=>setDownloadMedia(saved?.filter((id)=>allMediaCategories.includes(id))??allMediaCategories));
    void getAutomaticDownloadPreferences(user.id).then(setAutomatic);
    void refreshQueue();
    const update = () => void refreshQueue();
    window.addEventListener('sgb-offline-change', update);
    return () => window.removeEventListener('sgb-offline-change', update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, modules]);

  useEffect(()=>{
    const prepared=window.SGBAndroid?.getPreparedOfflineBackupInfo?.();
    if(prepared){try{setPreparedBackup(JSON.parse(prepared) as PreparedBackup);}catch{setPreparedBackup(null);}}
    const progress=(event:Event)=>setBackupProgress((event as CustomEvent<BackupProgress>).detail);
    const created=(event:Event)=>{setPreparedBackup((event as CustomEvent<PreparedBackup>).detail);setSharing(false);setBackupProgress(null);setCreateTransferOpen(false);setTransferPassword('');setTransferPasswordConfirmation('');toast.show('La copia quedó lista. Puedes compartirla ahora o más tarde.','success');};
    const failed=(event:Event)=>{setSharing(false);setImporting(false);setBackupProgress(null);toast.show((event as CustomEvent<{message?:string}>).detail?.message??'No se pudo procesar la copia.','error');};
    const imported=()=>{setImporting(false);setBackupProgress(null);void refreshQueue();toast.show('Datos y fotografías importados.','success');};
    const cancelled=()=>{setImporting(false);setBackupProgress(null);setPendingTransfer(null);setImportReviewOpen(false);};
    window.addEventListener('sgb-offline-backup-progress',progress);
    window.addEventListener('sgb-offline-backup-created',created);
    window.addEventListener('sgb-offline-backup-error',failed);
    window.addEventListener('sgb-offline-backup-imported',imported);
    window.addEventListener('sgb-offline-backup-cancelled',cancelled);
    return()=>{window.removeEventListener('sgb-offline-backup-progress',progress);window.removeEventListener('sgb-offline-backup-created',created);window.removeEventListener('sgb-offline-backup-error',failed);window.removeEventListener('sgb-offline-backup-imported',imported);window.removeEventListener('sgb-offline-backup-cancelled',cancelled);};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[user]);

  useEffect(()=>{
    const receive=()=>{
      if(!user)return;
      try{
        const raw=window.SGBAndroid?.getPendingOfflineBackup?.();
        if(!raw)throw new Error('Android no entregó los datos del respaldo.');
        const value=JSON.parse(raw) as unknown;const inspected=inspectOfflineTransferPackage(value);
        setPendingTransfer(value);setTransferOptions({moduleCounts:Object.fromEntries(inspected.moduleCounts),mediaCounts:Object.fromEntries(inspected.mediaCounts)});
        setTransferModules([...inspected.moduleCounts.keys()]);setTransferMedia([...inspected.mediaCounts.keys()]);
        setImporting(false);setBackupProgress(null);setImportReviewOpen(true);
      }catch(error){
        window.SGBAndroid?.discardOfflineBackupImport?.();
        toast.show(error instanceof Error?error.message:'No se pudo importar el respaldo.','error');
      }
    };
    window.addEventListener('sgb-offline-backup-ready',receive);
    return()=>window.removeEventListener('sgb-offline-backup-ready',receive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[user]);

  const download = async () => {
    if (!user || !selected.length) return;
    setDownloading(true);
    try {
      const result = await downloadSelectedContent(user, selected, (current, total, label) => setProgress({ current, total, label }),downloadMedia);
      toast.show(result.failedMedia||result.failedDetails
        ? `${result.requests} consultas y ${result.media} archivos preparados; quedan ${result.failedMedia} fotografías y ${result.failedDetails} perfiles por reintentar.`
        : `${result.requests} consultas actualizadas, ${result.reusedDetails} detalles ya vigentes y ${result.media} archivos disponibles sin conexión.`, result.failedMedia||result.failedDetails ? 'info' : 'success');
      await refreshQueue();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo descargar el contenido.';
      showLocalNotification('downloads', 'No se pudo actualizar SGB', message, DOWNLOAD_NOTIFICATION_ID);
      toast.show(message, 'error');
    } finally { setDownloading(false); }
  };

  const updateAutomatic = async (next: AutomaticDownloadPreferences) => {
    if (!user) return;
    setAutomatic(next);
    await saveAutomaticDownloadPreferences(user.id, next);
    toast.show(next.enabled ? 'Descargas automáticas activadas.' : 'Descargas automáticas desactivadas.');
  };

  const synchronize = async () => {
    const result = await offline.sync();
    toast.show(result.synced ? `${result.synced} cambio(s) sincronizado(s).` : result.failed ? 'Hay cambios que requieren revisión.' : 'No hay cambios pendientes.', result.failed ? 'info' : 'success');
    await refreshQueue();
  };

  const retry = async (item: OfflineMutation) => {
    await updateOfflineMutation({ ...item, state: 'PENDING', lastError: undefined, errorStatus: undefined, errorCode: undefined, errorDetails: undefined, requestId: undefined, failedAt: undefined });
    await refreshQueue();
    if (hasNetworkConnection()) await synchronize();
  };

  const discard = async (item: OfflineMutation) => {
    if (!window.confirm('¿Descartar definitivamente este cambio pendiente?')) return;
    await removeOfflineMutation(item.id);
    await refreshQueue();
  };

  const clearDownloads = async () => {
    if (!user || !window.confirm('Se eliminará el contenido descargado. Los cambios pendientes se conservarán.')) return;
    await clearOfflineCache(user.id);
    window.SGBAndroid?.clearMediaCache?.();
    await refreshQueue();
    toast.show('Contenido descargado eliminado.');
  };

  const shareDownloads=async()=>{
    if(!user)return;
    if(!cacheEntries.length){toast.show('Primero descarga contenido para usarlo sin conexión.','info');return;}
    if(transferPassword.length<8){toast.show('La contraseña debe tener al menos 8 caracteres.','info');return;}
    if(transferPassword!==transferPasswordConfirmation){toast.show('Las contraseñas no coinciden.','info');return;}
    if(!window.SGBAndroid?.shareOfflineBackupSelected&&!window.SGBAndroid?.shareOfflineBackup){toast.show('Esta función está disponible dentro de la aplicación Android.','info');return;}
    if(!transferModules.length){toast.show('Selecciona al menos una categoría de datos.','info');return;}
    setSharing(true);
    try{
      const transfer=await createOfflineTransferPackage(user.id,{moduleIds:transferModules,mediaCategories:transferMedia});
      const date=new Date().toISOString().slice(0,10).replaceAll('-','');
      setBackupProgress({phase:'create',current:0,total:100,message:'Preparando datos y fotografías'});
      const accepted=window.SGBAndroid.shareOfflineBackupSelected
        ?window.SGBAndroid.shareOfflineBackupSelected(JSON.stringify(transfer),`SGB-datos-${date}.sgbdata`,transferPassword,JSON.stringify(transfer.media.map((item)=>item.url)))
        :window.SGBAndroid.shareOfflineBackup!(JSON.stringify(transfer),`SGB-datos-${date}.sgbdata`,transferPassword);
      if(!accepted)throw new Error('Android no pudo preparar el archivo.');
    }catch(error){setSharing(false);toast.show(error instanceof Error?error.message:'No se pudieron preparar los datos.','error');}
  };

  const requestImport=()=>{
    if(transferPassword.length<8){toast.show('Escribe la contraseña de la copia.','info');return;}
    if(!window.SGBAndroid?.requestOfflineBackupImport?.(transferPassword)){toast.show('Esta función está disponible dentro de la aplicación Android.','info');return;}
    setImporting(true);setImportTransferOpen(false);setBackupProgress({phase:'import',current:0,total:100,message:'Selecciona la copia de SGB'});setTransferPassword('');
  };

  const openCreateTransfer=async()=>{
    if(!user)return;
    const options=await getOfflineTransferOptions(user.id);
    setTransferOptions({moduleCounts:Object.fromEntries(options.moduleCounts),mediaCounts:Object.fromEntries(options.mediaCounts)});
    setTransferModules([...options.moduleCounts.keys()]);setTransferMedia([...options.mediaCounts.keys()]);
    setTransferPassword('');setTransferPasswordConfirmation('');setCreateTransferOpen(true);
  };

  const applyImport=async()=>{
    if(!user||!pendingTransfer)return;
    if(!transferModules.length){toast.show('Selecciona al menos una categoría de datos.','info');return;}
    setImporting(true);setImportReviewOpen(false);setBackupProgress({phase:'import',current:45,total:100,message:'Importando datos seleccionados'});
    try{
      const result=await importOfflineTransferPackage(user.id,pendingTransfer,{moduleIds:transferModules,mediaCategories:transferMedia},(current,total)=>setBackupProgress({phase:'import',current:45+Math.round(current*5/Math.max(1,total)),total:100,message:'Importando datos descargados'}));
      if(window.SGBAndroid?.confirmOfflineBackupImportSelected)window.SGBAndroid.confirmOfflineBackupImportSelected(JSON.stringify(result.mediaUrls));
      else window.SGBAndroid?.confirmOfflineBackupImport?.();
      setPendingTransfer(null);await refreshQueue();
      toast.show(`${result.imported} consultas preparadas${result.preserved?`; ${result.preserved} locales más recientes se conservaron`:''}. Recuperando multimedia seleccionada…`,'info');
    }catch(error){window.SGBAndroid?.discardOfflineBackupImport?.();setImporting(false);setBackupProgress(null);toast.show(error instanceof Error?error.message:'No se pudo importar el respaldo.','error');}
  };

  const closeImportReview=()=>{window.SGBAndroid?.discardOfflineBackupImport?.();setPendingTransfer(null);setImportReviewOpen(false);};

  const sharePrepared=()=>{if(!window.SGBAndroid?.sharePreparedOfflineBackup?.())toast.show('No se encontró una copia preparada.','error');};
  const removePrepared=()=>{window.SGBAndroid?.deletePreparedOfflineBackup?.();setPreparedBackup(null);toast.show('Copia preparada eliminada.');};

  const togglePanel = (panel: DetailPanel) => setActivePanel((current) => current === panel ? null : panel);
  const percent = progress.total ? Math.round(progress.current * 100 / progress.total) : 0;
  const pendingQueue = queue.filter((item) => item.state === 'PENDING');
  const failedQueue = queue.filter((item) => item.state === 'FAILED');

  const renderQueue = (items: OfflineMutation[]) => !items.length
    ? <div className="offline-empty"><CheckCircle2 size={24} /><span>No hay cambios en esta categoría.</span></div>
    : <div className="offline-queue">{items.map((item) => {
      const absoluteIndex = queue.findIndex((queued) => queued.id === item.id);
      const lines = errorLines(item.errorDetails);
      const blocked = queue.slice(0, absoluteIndex).some((previous) => previous.state === 'FAILED');
      return <article key={item.id} className={item.state === 'FAILED' ? 'sync-conflict' : ''}>
        <div><strong>{absoluteIndex + 1}. {queueLabels[item.id] ?? 'Cambio pendiente'}</strong><span>{formatDate(item.createdAt)} · permiso {item.permission}</span>{blocked ? <small>Espera la resolución del cambio anterior.</small> : item.lastError ? <small>{item.lastError}</small> : null}{!blocked && lines.length ? <ul className="sync-error-details">{lines.map((line) => <li key={line}>{line}</li>)}</ul> : null}{!blocked && (item.errorCode || item.requestId) ? <span className="sync-error-reference">{item.errorStatus ? `HTTP ${item.errorStatus} · ` : ''}{item.errorCode ?? ''}{item.requestId ? ` · referencia ${item.requestId}` : ''}</span> : null}<details className="sync-technical"><summary>Detalles técnicos</summary><code>{item.method} {item.path}</code></details></div>
        <Badge tone={item.state === 'FAILED' ? 'danger' : 'warning'}>{blocked ? 'En espera' : item.state === 'FAILED' ? 'Revisar' : 'Pendiente'}</Badge>
        <div className="inline-actions">{item.state === 'FAILED' ? <Button variant="ghost" disabled={blocked} onClick={() => void retry(item)}>Reintentar</Button> : null}<Button variant="ghost" onClick={() => void discard(item)}><Trash2 size={16} /></Button></div>
      </article>;
    })}</div>;

  return <div>
    <PageHeader title="Descargas" description="Administra el contenido disponible sin conexión y la sincronización de este dispositivo." action={<Badge tone={offline.quality === 'stable' ? 'success' : offline.quality === 'unstable' ? 'warning' : 'danger'}>{offline.quality === 'stable' ? <><Wifi size={14} />Conexión estable</> : offline.quality === 'unstable' ? <><Wifi size={14} />Conexión inestable</> : <><WifiOff size={14} />Sin conexión</>}</Badge>} />

    {!window.SGBAndroid ? <div className="offline-note"><AlertTriangle size={20} /><div><strong>Modo de prueba web</strong><span>La descarga completa de fotografías se activa dentro de la aplicación Android SGB.</span></div></div> : null}

    <div className="offline-stats">
      <Card className={activePanel === 'queries' ? 'active' : ''} onClick={() => togglePanel('queries')}><Database size={22} /><strong>{offline.cachedRequests}</strong><span>consultas descargadas</span><ChevronRight size={16} className="stat-chevron" /></Card>
      <Card className={activePanel === 'storage' ? 'active' : ''} onClick={() => togglePanel('storage')}><CloudDownload size={22} /><strong>{formatBytes(offline.downloadedBytes)}</strong><span>última descarga · {formatDate(offline.lastDownload)}</span><ChevronRight size={16} className="stat-chevron" /></Card>
      <Card className={activePanel === 'pending' ? 'active' : ''} onClick={() => togglePanel('pending')}><RefreshCw size={22} /><strong>{offline.pending}</strong><span>cambios pendientes</span><ChevronRight size={16} className="stat-chevron" /></Card>
      <Card className={activePanel === 'failed' ? 'active' : ''} onClick={() => togglePanel('failed')}><AlertTriangle size={22} /><strong>{offline.failed}</strong><span>requieren revisión</span><ChevronRight size={16} className="stat-chevron" /></Card>
    </div>

    {activePanel ? <section className="offline-detail-panel">
      {activePanel === 'queries' ? <><div className="section-heading-inline"><div><h2>Consultas descargadas</h2><p className="muted">Datos estructurados disponibles en este dispositivo.</p></div></div><div className="downloaded-query-list">{cacheEntries.length ? cacheEntries.map((entry) => <div key={entry.key}><span>{entry.path}</span><small>{formatDate(entry.savedAt)}</small></div>) : <div className="offline-empty">Aún no hay consultas descargadas.</div>}</div></> : null}
      {activePanel === 'storage' ? <><div className="section-heading-inline"><div><h2>Espacio utilizado</h2><p className="muted">Última descarga: {formatDate(offline.lastDownload)}</p></div></div><div className="storage-breakdown"><div><Database size={18} /><span>Datos</span><strong>{formatBytes(offline.structuredBytes)}</strong></div><div><HardDrive size={18} /><span>Fotos y videos descargados</span><strong>{formatBytes(offline.nativeMediaBytes)}</strong></div><div><CloudDownload size={18} /><span>Archivos creados sin conexión</span><strong>{formatBytes(offline.localMediaBytes)}</strong></div></div></> : null}
      {activePanel === 'pending' || activePanel === 'failed' ? <><div className="section-heading-inline"><div><h2>{activePanel === 'pending' ? 'Cambios pendientes' : 'Cambios que requieren revisión'}</h2><p className="muted">Última sincronización: {formatDate(offline.lastSync)}</p></div><Button variant="secondary" onClick={() => void synchronize()} loading={offline.syncing} disabled={!offline.online || !queue.length}><RefreshCw size={17} />Sincronizar</Button></div>{offline.syncProgress ? <div className="sync-live-progress"><div><strong>Enviando {offline.syncProgress.current} de {offline.syncProgress.total}</strong><span>{offline.syncProgress.description ?? 'Cambio pendiente'} · quedan {offline.syncProgress.remaining}</span></div><progress max={Math.max(1, offline.syncProgress.total)} value={offline.syncProgress.completed} /></div> : null}{renderQueue(activePanel === 'pending' ? pendingQueue : failedQueue)}</> : null}
    </section> : null}

    <section className="offline-section compact-offline-section">
      <div className="section-heading-inline"><div><h2>Actualización automática</h2><p className="muted">Mantiene el contenido al día cuando el servidor tiene una conexión estable.</p></div></div>
      <div className="offline-setting-list">
        <label className="offline-setting-row"><div><strong>Descargas automáticas</strong><span>Actualiza en segundo plano mientras SGB está abierta.</span></div><span className="switch"><input type="checkbox" checked={automatic.enabled} onChange={(event) => void updateAutomatic({ ...automatic, enabled: event.target.checked })} /><i /></span></label>
        <label className={`offline-setting-row ${!automatic.enabled ? 'disabled' : ''}`}><div><strong>Solo con Wi‑Fi</strong><span>Evita descargar fotografías y videos con datos móviles.</span></div><span className="switch"><input type="checkbox" disabled={!automatic.enabled} checked={automatic.wifiOnly} onChange={(event) => void updateAutomatic({ ...automatic, wifiOnly: event.target.checked })} /><i /></span></label>
      </div>
    </section>

    <section className="offline-section compact-offline-section">
      <div className="section-heading-inline"><div><h2>Contenido disponible sin conexión</h2></div></div>
      <div className="offline-setting-list module-settings">{modules.map((module) => <label key={module.id} className="offline-setting-row"><div><strong>{module.label}</strong><span>{module.description}</span></div><span className="switch"><input type="checkbox" checked={selected.includes(module.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, module.id])] : current.filter((id) => id !== module.id))} /><i /></span></label>)}</div>
      <label className="offline-select-all"><span>Seleccionar todo</span><span className="switch"><input type="checkbox" checked={modules.length > 0 && selected.length === modules.length} onChange={(event) => setSelected(event.target.checked ? modules.map((module) => module.id) : [])} /><i /></span></label>
      {selected.includes('multimedia')||selected.includes('animales')?<div className="offline-media-category-settings"><div><strong>Fotos y videos a descargar</strong><small>Elige las categorías que ocuparán espacio en este dispositivo.</small></div><div className="offline-setting-list">{allMediaCategories.map((category)=><label key={category} className="offline-setting-row"><span><strong>{offlineTransferMediaLabels[category]}</strong></span><span className="switch"><input type="checkbox" checked={downloadMedia.includes(category)} onChange={(event)=>setDownloadMedia((current)=>event.target.checked?[...new Set([...current,category])]:current.filter((item)=>item!==category))}/><i/></span></label>)}</div></div>:null}
      {downloading ? <div className="download-progress"><div><span>{progress.label}</span><strong>{percent}%</strong></div><progress max={100} value={percent} /></div> : null}
      <div className="offline-actions"><Button onClick={() => void download()} loading={downloading} disabled={!offline.online || !selected.length}><CloudDownload size={18} />Descargar o actualizar</Button><Button variant="ghost" onClick={() => void clearDownloads()}><Trash2 size={17} />Borrar descargas</Button></div>
    </section>

    <section className="offline-section compact-offline-section offline-transfer-section">
      <div className="section-heading-inline"><div><h2>Transferir datos descargados</h2><p className="muted">Envía las consultas y fotografías guardadas a otro dispositivo que tenga SGB.</p></div><Share2 size={22}/></div>
      <div className="offline-transfer-note"><strong>Protección de la información</strong><span>La copia se cifra con una contraseña y puede importarla cualquier usuario autorizado de SGB que la conozca. No incluye cambios pendientes ni permisos de la cuenta de origen.</span></div>
      {backupProgress?<div className="download-progress"><div><span>{backupProgress.message}</span><strong>{Math.round(backupProgress.current*100/Math.max(1,backupProgress.total))}%</strong></div><progress max={backupProgress.total} value={backupProgress.current}/></div>:null}
      {preparedBackup?<div className="offline-transfer-prepared"><div><CheckCircle2 size={21}/><span><strong>Copia lista para compartir</strong><small>{preparedBackup.name} · {formatBytes(preparedBackup.size)} · {formatDate(preparedBackup.createdAt)}</small></span></div><div className="offline-actions"><Button onClick={sharePrepared}><Share2 size={18}/>Compartir copia</Button><Button variant="ghost" onClick={removePrepared}><Trash2 size={17}/>Eliminar</Button></div></div>:null}
      <div className="offline-actions"><Button onClick={()=>void openCreateTransfer()} loading={sharing} disabled={!cacheEntries.length||sharing}><Database size={18}/>Crear nueva copia</Button><Button variant="secondary" onClick={()=>{setTransferPassword('');setImportTransferOpen(true);}} loading={importing}><FileUp size={18}/>Importar datos</Button></div>
    </section>
    {createTransferOpen?<Modal title="Crear copia de datos" onClose={()=>!sharing&&setCreateTransferOpen(false)} footer={<><Button variant="ghost" disabled={sharing} onClick={()=>setCreateTransferOpen(false)}>Cancelar</Button><Button onClick={()=>void shareDownloads()} loading={sharing}>Crear copia</Button></>}><div className="form-stack"><p className="muted">Elige qué se incluirá. La copia se protege con una contraseña y queda guardada hasta que decidas compartirla o eliminarla.</p><TransferChoices modules={modules} options={transferOptions} selectedModules={transferModules} selectedMedia={transferMedia} onModules={setTransferModules} onMedia={setTransferMedia}/><Field label="Contraseña" required><PasswordInput autoComplete="new-password" value={transferPassword} onChange={(event)=>setTransferPassword(event.target.value)}/></Field><Field label="Repetir contraseña" required><PasswordInput autoComplete="new-password" value={transferPasswordConfirmation} onChange={(event)=>setTransferPasswordConfirmation(event.target.value)}/></Field>{sharing&&backupProgress?<BackupProgressView progress={backupProgress}/>:null}</div></Modal>:null}
    {importTransferOpen?<Modal title="Importar copia de datos" onClose={()=>setImportTransferOpen(false)} footer={<><Button variant="ghost" onClick={()=>setImportTransferOpen(false)}>Cancelar</Button><Button onClick={requestImport}>Seleccionar archivo</Button></>}><div className="form-stack"><p className="muted">Escribe la contraseña utilizada al crear la copia.</p><Field label="Contraseña" required><PasswordInput autoComplete="current-password" value={transferPassword} onChange={(event)=>setTransferPassword(event.target.value)}/></Field></div></Modal>:null}
    {importReviewOpen?<Modal title="Elegir datos para importar" onClose={closeImportReview} footer={<><Button variant="ghost" onClick={closeImportReview}>Cancelar</Button><Button onClick={()=>void applyImport()}>Importar selección</Button></>}><div className="form-stack"><p className="muted">Solo aparecen las categorías contenidas en esta copia. Los datos locales más recientes no se reemplazarán.</p><TransferChoices modules={modules} options={transferOptions} selectedModules={transferModules} selectedMedia={transferMedia} onModules={setTransferModules} onMedia={setTransferMedia}/></div></Modal>:null}
  </div>;
}

function BackupProgressView({progress}:{progress:BackupProgress}){const percent=Math.round(progress.current*100/Math.max(1,progress.total));return <div className="download-progress"><div><span>{progress.message}</span><strong>{percent}%</strong></div><progress max={100} value={percent}/></div>;}

function TransferChoices({modules,options,selectedModules,selectedMedia,onModules,onMedia}:{modules:ReturnType<typeof availableDownloadModules>;options:TransferOptionState;selectedModules:string[];selectedMedia:OfflineTransferMediaCategory[];onModules:(value:string[])=>void;onMedia:(value:OfflineTransferMediaCategory[])=>void}){
  const visibleModules=Object.keys(options.moduleCounts);const categories=Object.keys(options.mediaCounts) as OfflineTransferMediaCategory[];
  const moduleLabel=(id:string)=>modules.find((item)=>item.id===id)?.label??(id==='otros'?'Otros datos':id);
  return <div className="transfer-choice-groups"><div><strong>Datos</strong><div className="offline-setting-list">{visibleModules.map((id)=><label key={id} className="offline-setting-row"><span><strong>{moduleLabel(id)}</strong><small>{options.moduleCounts[id]} consulta(s)</small></span><span className="switch"><input type="checkbox" checked={selectedModules.includes(id)} onChange={(event)=>onModules(event.target.checked?[...new Set([...selectedModules,id])]:selectedModules.filter((item)=>item!==id))}/><i/></span></label>)}</div></div>{categories.length?<div><strong>Fotos y videos</strong><div className="offline-setting-list">{categories.map((id)=><label key={id} className="offline-setting-row"><span><strong>{offlineTransferMediaLabels[id]}</strong><small>{options.mediaCounts[id]} archivo(s)</small></span><span className="switch"><input type="checkbox" checked={selectedMedia.includes(id)} onChange={(event)=>onMedia(event.target.checked?[...new Set([...selectedMedia,id])]:selectedMedia.filter((item)=>item!==id))}/><i/></span></label>)}</div></div>:<p className="muted">Esta selección no contiene fotografías ni videos descargados.</p>}</div>;
}
