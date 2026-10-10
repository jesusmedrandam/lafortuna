import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {AlertTriangle,Check,ChevronDown,CloudDownload,CloudOff,Database,Images,Pencil,RefreshCw,Trash2,Wifi} from 'lucide-react';
import {Button,Card,IconButton,Modal,PageHeader} from '../../components/ui';
import {Link} from 'react-router-dom';
import {useV2Session} from '../V2Session';
import {downloadPaths,getOfflineDetails,isRuntimeOnline,removeDownloadedData,removeDownloadedMedia,
  retryFailedMutations,runtimeState,setAutomaticDownloads,setDownloadPreferences,syncOfflineMutations,
  discardPendingMutation,editPendingMutation,pendingMutationFields,expireLocalDrafts,
  type OfflineDetails,type OfflineRuntimeState} from './runtime';
import {availableDownloadChoices,defaultDownloadPreferences,downloadCategoryLabel,downloadGroups,
  selectedDownloadPaths,type DownloadPreferences,type PhotoMode} from './preferences';
import type {OutboxEntry} from './database';

interface OfflineContextValue extends OfflineRuntimeState {
  downloading:boolean;dataRevision:number;downloadError:string;
  setAutomatic:(enabled:boolean)=>Promise<void>;
  setPreferences:(preferences:DownloadPreferences)=>Promise<void>;
  downloadNow:()=>Promise<void>;synchronize:()=>Promise<void>;retryFailed:()=>Promise<void>;refresh:()=>Promise<void>;
}
const empty:OfflineRuntimeState={online:true,wifi:false,automaticDownloads:false,preferences:defaultDownloadPreferences(),
  pending:0,failed:0,syncing:false,cachedEntries:0,cachedBytes:0,mediaFiles:0,mediaBytes:0,mediaPending:0,mediaFailed:0,lastDownload:null};
const OfflineContext=createContext<OfflineContextValue|null>(null);
const message=(reason:unknown)=>reason instanceof Error?reason.message:'No se pudo completar la operación.';

export function V2OfflineProvider({children}:{children:ReactNode}){
  const {session}=useV2Session();const [state,setState]=useState(empty);
  const [downloading,setDownloading]=useState(false);const [dataRevision,setDataRevision]=useState(0);
  const [downloadError,setDownloadError]=useState('');
  const refresh=useCallback(async()=>setState(await runtimeState()),[]);
  const refreshTimer=useRef<number|null>(null);const automaticScope=useRef('');const busy=useRef(false);
  const property=session?.overview.properties.find(item=>item.id===session.overview.activeContext?.propertyId);
  const role=property?.roles.find(item=>item.id===session?.overview.activeContext?.roleId);
  const available=useMemo(()=>availableDownloadChoices(property?.enabledModules??[],role?.permissions??[],
    Boolean(session?.overview.enabledUserModules.includes('PERSONAL_FINANCE'))),
    [property?.enabledModules,role?.permissions,session?.overview.enabledUserModules]);
  const paths=useMemo(()=>selectedDownloadPaths(state.preferences,available),[state.preferences,available]);
  const automaticKey=session?JSON.stringify([session.overview.user.id,session.overview.activeContext,paths,state.preferences]):'';
  useEffect(()=>{void refresh();const update=(event:Event)=>{
    const detail=(event as CustomEvent<OfflineRuntimeState>).detail;if(detail)setState(detail);else void refresh();};
    const connectivity=()=>void refresh();const changed=()=>{
      if(refreshTimer.current)window.clearTimeout(refreshTimer.current);
      refreshTimer.current=window.setTimeout(()=>{setDataRevision(value=>value+1);void refresh();},120);
    };
    const connection=(navigator as Navigator&{connection?:EventTarget}).connection;
    window.addEventListener('sgb-v2-offline-state',update);window.addEventListener('sgb-v2-cache-updated',changed);
    window.addEventListener('online',connectivity);window.addEventListener('offline',connectivity);
    connection?.addEventListener('change',connectivity);
    return()=>{window.removeEventListener('sgb-v2-offline-state',update);
      window.removeEventListener('sgb-v2-cache-updated',changed);window.removeEventListener('online',connectivity);
      window.removeEventListener('offline',connectivity);connection?.removeEventListener('change',connectivity);
      if(refreshTimer.current)window.clearTimeout(refreshTimer.current);};
  },[refresh]);
  useEffect(()=>{if(!session)return;const expire=()=>{void expireLocalDrafts().catch(reason=>setDownloadError(message(reason)));};
    expire();const timer=window.setInterval(expire,60000);window.addEventListener('focus',expire);
    return()=>{window.clearInterval(timer);window.removeEventListener('focus',expire);};},[session?.overview.user.id]);
  useEffect(()=>{if(session&&isRuntimeOnline())void syncOfflineMutations();},
    [session?.overview.activeContext?.propertyId,session?.overview.activeContext?.roleId,state.online]);
  useEffect(()=>{if(!session||!state.online||!state.pending)return;
    const timer=window.setInterval(()=>void syncOfflineMutations(),30000);return()=>window.clearInterval(timer);
  },[session,state.online,state.pending]);
  useEffect(()=>{if(!state.retryAt)return;
    const timer=window.setTimeout(()=>{automaticScope.current='';void syncOfflineMutations();void refresh();},Math.max(0,state.retryAt-Date.now())+100);
    return()=>window.clearTimeout(timer);
  },[state.retryAt,refresh]);
  useEffect(()=>{
    if(state.retryAt&&state.retryAt>Date.now())return;
    if(!state.automaticDownloads||!state.online||!state.wifi){automaticScope.current='';return;}
    if(!automaticKey||!paths.length||busy.current||automaticScope.current===automaticKey)return;
    automaticScope.current=automaticKey;busy.current=true;setDownloading(true);setDownloadError('');
    void downloadPaths(paths,{automatic:true}).then(result=>{
      if(result.failed)setDownloadError(result.errors.slice(0,3).join(' '));
    }).catch(reason=>setDownloadError(message(reason))).finally(()=>{busy.current=false;setDownloading(false);void refresh();});
  },[automaticKey,state.automaticDownloads,state.online,state.wifi,paths,refresh,downloading,state.retryAt]);
  const setAutomatic=useCallback(async(enabled:boolean)=>{await setAutomaticDownloads(enabled);await refresh();},[refresh]);
  const setPreferences=useCallback(async(value:DownloadPreferences)=>{await setDownloadPreferences(value);await refresh();},[refresh]);
  const downloadNow=useCallback(async()=>{if(busy.current)return;busy.current=true;setDownloading(true);setDownloadError('');
    try{const result=await downloadPaths(paths);if(result.failed)throw new Error(result.errors.slice(0,3).join(' '));}
    finally{busy.current=false;setDownloading(false);await refresh();}},[paths,refresh]);
  const synchronize=useCallback(async()=>{await syncOfflineMutations();await refresh();},[refresh]);
  const retryFailed=useCallback(async()=>{await retryFailedMutations();await refresh();},[refresh]);
  const value=useMemo(()=>({...state,downloading,dataRevision,downloadError,setAutomatic,setPreferences,downloadNow,synchronize,retryFailed,refresh}),
    [state,downloading,dataRevision,downloadError,setAutomatic,setPreferences,downloadNow,synchronize,retryFailed,refresh]);
  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}
export function useV2Offline(){const value=useContext(OfflineContext);
  if(!value)throw new Error('Falta el proveedor de datos sin conexión.');return value;}
function formatBytes(value:number){if(value<1024)return `${value} B`;if(value<1024*1024)return `${(value/1024).toFixed(1)} KB`;
  return `${(value/1024/1024).toFixed(1)} MB`;}
export function OfflineStatusButton(){const {online,pending,failed,syncing,mediaPending,mediaFailed}=useV2Offline();
  const count=pending+failed+mediaPending+mediaFailed;
  const label=`${online?'Con conexión':'Sin conexión'}${syncing?' · Sincronizando':''}. ${count} contenidos pendientes. Abrir descargas`;
  return <Link to="/sin-conexion" className={`offline-status ${online?'online':'offline'}`} title={label} aria-label={label}>
    {online?<Wifi size={17} aria-hidden="true"/>:<CloudOff size={17} aria-hidden="true"/>}
    {count>0&&<b className="offline-pending-count" aria-hidden="true">{count}</b>}</Link>;
}
type DetailKind='data'|'media'|'connection'|'changes';
export function SyncProgressBar(){
  const {syncing,syncProgress}=useV2Offline();if(!syncing||!syncProgress?.total)return null;
  const progress=Math.min(100,Math.round(100*(syncProgress.completed+(syncProgress.bytes?Math.min(1,syncProgress.loaded/syncProgress.bytes):0))/syncProgress.total));
  return <div className="sync-progress" role="status"><div><strong>Subiendo datos · {progress}%</strong>
    <small>{syncProgress.completed} de {syncProgress.total} completados</small></div>
    <progress aria-label="Progreso de subida de datos" max={100} value={progress}/><small>{syncProgress.current}</small></div>;
}
const pendingFieldLabels:Record<string,string>={name:'Nombre',title:'Título',description:'Descripción',notes:'Notas',instructions:'Instrucciones',
  capturedOn:'Fecha de captura',weighedOn:'Fecha del pesaje',occurredOn:'Fecha',birthDate:'Fecha de nacimiento',entryDate:'Fecha de ingreso',
  earTagCode:'Arete',weight:'Peso',initialWeight:'Peso inicial',amount:'Importe',quantity:'Cantidad',percent:'Porcentaje',reason:'Motivo',
  reportedName:'Nombre informado',isPrimary:'Titular principal',active:'Activo',relationCode:'Relación de la foto',sex:'Sexo',
  owners:'Titulares',mother:'Madre',father:'Padre'};
function PendingFields({value,path=[],change}:{value:unknown;path?:(string|number)[];change:(path:(string|number)[],value:unknown)=>void}):ReactNode{
  if(value&&typeof value==='object')return <>{Object.entries(value).filter(([key])=>key!=='id'&&!/Ids?$/.test(key)
    &&key!=='expectedVersion'&&!/Code$/.test(key)&&!key.startsWith('__')||key==='relationCode'||key==='earTagCode').map(([key,item])=>
    <div key={key} className="pending-field"><PendingFields value={item} path={[...path,Array.isArray(value)?Number(key):key]} change={change}/></div>)}</>;
  const key=String(path.at(-1));const title=pendingFieldLabels[key]??key.replace(/([a-z])([A-Z])/g,'$1 $2');
  if(typeof value==='boolean')return <label><input type="checkbox" checked={value} onChange={event=>change(path,event.target.checked)}/>{title}</label>;
  if(key==='relationCode'||key==='sex')return <label><span>{title}</span><select value={String(value??'')} onChange={event=>change(path,event.target.value)}>
    {Object.entries(key==='sex'?{FEMALE:'Hembra',MALE:'Macho'}:{GENERAL:'Galería',PROFILE:'Perfil',COVER:'Portada'}).map(([code,label])=>
      <option key={code} value={code}>{label}</option>)}</select></label>;
  const date=/On$|Date$/.test(key);
  return <label><span>{title}</span>{['description','notes','instructions'].includes(key)?
    <textarea value={String(value??'')} onChange={event=>change(path,event.target.value)}/>:
    <input type={typeof value==='number'?'number':date?'date':'text'} step={typeof value==='number'?'any':undefined}
      value={String(value??'')} onChange={event=>change(path,typeof value==='number'?Number(event.target.value):event.target.value||null)}/>}</label>;
}
const titles:Record<DetailKind,string>={data:'Datos guardados',media:'Fotos y videos',connection:'Conexión',changes:'Cambios locales'};
export function V2OfflinePage(){
  const state=useV2Offline();const paused=Boolean(state.retryAt&&state.retryAt>Date.now());const {session}=useV2Session();const [error,setError]=useState('');
  const [detail,setDetail]=useState<DetailKind|null>(null);const [details,setDetails]=useState<OfflineDetails|null>(null);
  const [deleting,setDeleting]=useState(false);
  const [confirmation,setConfirmation]=useState<{label:string;action:()=>Promise<void>;discard?:boolean}|null>(null);
  const [editing,setEditing]=useState<OutboxEntry|null>(null);const [draft,setDraft]=useState<Record<string,unknown>>({});
  const property=session?.overview.properties.find(item=>item.id===session.overview.activeContext?.propertyId);
  const role=property?.roles.find(item=>item.id===session?.overview.activeContext?.roleId);
  const available=availableDownloadChoices(property?.enabledModules??[],role?.permissions??[],
    Boolean(session?.overview.enabledUserModules.includes('PERSONAL_FINANCE')));
  const paths=selectedDownloadPaths(state.preferences,available);
  const blocked=deleting||state.downloading||state.syncing||state.mediaPending>0;
  const confirmBlocked=confirmation?.discard?deleting||state.syncing:blocked;
  const run=(action:()=>Promise<void>)=>{setError('');void action().catch(reason=>setError(message(reason)));};
  const loadDetails=async()=>setDetails(await getOfflineDetails());
  useEffect(()=>{if(detail)run(loadDetails);},[detail,state.dataRevision,state.pending,state.failed,state.mediaFiles,state.mediaBytes]);
  const open=(kind:DetailKind)=>{setError('');setDetails(null);setDetail(kind);};
  const remove=async()=>{if(!confirmation||confirmBlocked)return;setDeleting(true);setError('');
    try{await confirmation.action();setConfirmation(null);await state.refresh();await loadDetails();}
    catch(reason){setError(message(reason));}finally{setDeleting(false);}};
  const edit=async()=>{if(!editing||state.syncing||deleting)return;setDeleting(true);setError('');
    try{await editPendingMutation(editing.id,draft);setEditing(null);await state.refresh();await loadDetails();}
    catch(reason){setError(message(reason));}finally{setDeleting(false);}};
  const chooseData=(id:string,checked:boolean)=>run(()=>state.setPreferences({...state.preferences,data:{...state.preferences.data,[id]:checked}}));
  const choosePhoto=(id:string,mode:PhotoMode)=>run(()=>state.setPreferences({...state.preferences,photos:{...state.preferences.photos,[id]:mode}}));
  const mediaGroups=new Map<string,NonNullable<typeof details>['media']>();
  for(const file of details?.media??[]){const category=file.categories[0]??'other';
    mediaGroups.set(category,[...(mediaGroups.get(category)??[]),file]);}
  const errorBox=(error||state.downloadError)&&<div className="form-alert form-alert-error" role="alert">{error||state.downloadError}</div>;
  return <div className="offline-page"><PageHeader title="Descargas"
    description="Elige lo que guardarás en este dispositivo para usarlo sin internet."/>
    {!detail&&errorBox}<div className="offline-summary-grid">
      <button className="card offline-summary-button" onClick={()=>open('data')}><Database size={22}/><div><span>Datos guardados</span>
        <strong>{state.cachedEntries}</strong><small>{formatBytes(state.cachedBytes)}</small></div></button>
      <button className="card offline-summary-button" onClick={()=>open('media')}><Images size={22}/><div><span>Fotos y videos</span>
        <strong>{state.mediaFiles}</strong><small>{state.mediaPending?`${state.mediaPending} descargando…`:formatBytes(state.mediaBytes)}</small></div></button>
      <button className="card offline-summary-button" onClick={()=>open('connection')}>{state.online?<Wifi size={22}/>:<CloudOff size={22}/>}<div>
        <span>Conexión</span><strong>{state.online?'Disponible':'Sin conexión'}</strong><small>{state.wifi?'Wi-Fi':state.online?'Otra red':'Lectura local disponible'}</small></div></button>
      <button className="card offline-summary-button" onClick={()=>open('changes')}>{state.failed?<AlertTriangle size={22}/>:<Check size={22}/>}<div>
        <span>Cambios locales</span><strong>{state.pending} pendientes</strong><small>{state.failed?`${state.failed} requieren revisión`:paused?'Esperando para sincronizar':'Sin errores de sincronización'}</small></div></button>
    </div>
    {paused&&<p role="status" className="offline-note">El servidor pidió una pausa. Tus cambios siguen guardados y se reintentarán automáticamente cuando termine.</p>}
    <Card className="offline-settings-card"><div><h3>Descargas automáticas con Wi-Fi</h3>
      <p>Actualiza las categorías elegidas al conectarte a una red Wi-Fi.</p></div>
      <label className="offline-switch"><input type="checkbox" aria-label="Descargas automáticas con Wi-Fi" checked={state.automaticDownloads}
        disabled={deleting} onChange={event=>run(()=>state.setAutomatic(event.target.checked))}/><span aria-hidden="true"/></label></Card>
    <Card className="offline-choices"><h3>Qué descargar</h3>
      {Object.entries(downloadGroups).map(([group,label])=>{
        const data=available.data.filter(item=>item.group===group);const photos=available.photos.filter(item=>item.group===group);
        if(!data.length&&!photos.length)return null;
        const selected=data.filter(item=>state.preferences.data[item.id]).length+photos.filter(item=>state.preferences.photos[item.id]!=='none').length;
        return <details className="offline-group" key={group}><summary><span>{label}</span><small>{selected} elegidas</small><ChevronDown size={18}/></summary>
          <div className="offline-choice-list">{data.map(item=><label className="offline-choice" key={item.id}><span>{item.label}</span>
            <input type="checkbox" aria-label={item.label} checked={state.preferences.data[item.id]??false} disabled={state.downloading||deleting}
              onChange={event=>chooseData(item.id,event.target.checked)}/></label>)}
          {photos.map(item=><label className="offline-choice" key={item.id}><span>{item.label}</span>{item.history?
            <select className="input" aria-label={item.label} value={state.preferences.photos[item.id]} disabled={state.downloading||deleting}
              onChange={event=>choosePhoto(item.id,event.target.value as PhotoMode)}><option value="none">No descargar</option>
              <option value="latest">Solo la última</option><option value="all">Todas las disponibles</option></select>:
            <input type="checkbox" aria-label={item.label} checked={state.preferences.photos[item.id]!=='none'} disabled={state.downloading||deleting}
              onChange={event=>choosePhoto(item.id,event.target.checked?'all':'none')}/>}</label>)}</div></details>;
      })}
      {available.photos.length>0&&<label className="offline-choice offline-video-choice"><span>Videos de las categorías elegidas</span>
        <input type="checkbox" aria-label="Videos de las categorías elegidas" checked={state.preferences.videos} disabled={state.downloading||deleting}
          onChange={event=>run(()=>state.setPreferences({...state.preferences,videos:event.target.checked}))}/></label>}
    </Card>
    <Card className="offline-actions-card"><div><h3>{property?.name??'Mis datos'}</h3><p>Descarga únicamente las opciones elegidas.</p>
      <small>{state.lastDownload?`Última actualización: ${new Date(state.lastDownload).toLocaleString('es-EC')}`:'Aún no has descargado datos.'}</small></div>
      <div className="offline-buttons"><Button onClick={()=>run(state.downloadNow)} loading={state.downloading} disabled={!state.online||paused||!paths.length||deleting}>
        <CloudDownload size={18}/> Descargar ahora</Button><Button variant="secondary" onClick={()=>run(state.synchronize)} loading={state.syncing} disabled={!state.online||paused}>
        <RefreshCw size={18}/> Sincronizar</Button>{state.failed>0&&<Button variant="secondary" onClick={()=>run(state.retryFailed)} disabled={!state.online||paused}>Reintentar con errores</Button>}</div></Card>
    <p className="offline-note">Tus opciones se guardan por usuario. Los cambios pendientes se conservan hasta enviarse al servidor.</p>
    {detail&&<Modal title={editing?'Corregir cambio pendiente':titles[detail]} onClose={()=>{if(!deleting){setDetail(null);setConfirmation(null);setEditing(null);}}} wide>
      {errorBox}{editing?<div className="pending-edit"><h3>{editing.summary}</h3>
        {editing.lastError&&<p className="form-error">{editing.lastError}</p>}
        {editing.errorCode?.endsWith('VERSION_CONFLICT')&&<p>Se comprobará la versión actual del animal antes de guardar tu corrección.</p>}
        <PendingFields value={draft} change={(path,value)=>{const next=structuredClone(draft);let node=next as Record<string,unknown>;
          for(const key of path.slice(0,-1))node=node[key] as Record<string,unknown>;node[path.at(-1)!]=value;setDraft(next);}}/>
        <div className="offline-buttons"><Button variant="secondary" disabled={deleting} onClick={()=>setEditing(null)}>Cancelar</Button>
          <Button loading={deleting} disabled={state.syncing} onClick={()=>void edit()}>Guardar corrección</Button></div></div>:
      confirmation?<div className="offline-confirmation"><p>¿{confirmation.discard?'Descartar el cambio':'Eliminar del dispositivo'} {confirmation.label}?</p>
        <p>{confirmation.discard?'Este cambio se quitará de la cola de envío y se recuperarán los datos locales anteriores cuando estén disponibles. El descarte no revierte datos ya recibidos por el servidor.':'Los archivos del servidor se conservan.'}</p>
        <div className="offline-buttons"><Button variant="secondary" disabled={deleting} onClick={()=>setConfirmation(null)}>Cancelar</Button>
          <Button variant="danger" loading={deleting} disabled={confirmBlocked&&!deleting} onClick={()=>void remove()}>{confirmation.discard?'Descartar cambio':'Eliminar del dispositivo'}</Button></div></div>:
      detail==='connection'?<div className="offline-detail-list"><p>{state.online?'Hay conexión a internet.':'No hay conexión a internet.'}</p>
        <p>{state.wifi?'Red Wi-Fi confirmada.':state.online?'La red actual no está confirmada como Wi-Fi. Puedes descargar manualmente.':'Puedes consultar lo que ya descargaste.'}</p>
        <p>Descargas automáticas con Wi-Fi: {state.automaticDownloads?'activadas':'desactivadas'}.</p>
        {state.mediaPending>0&&<p>{state.mediaPending} archivos descargándose.</p>}{state.mediaFailed>0&&<p>{state.mediaFailed} archivos no pudieron descargarse. Reintenta Descargar ahora.</p>}
        <p>{state.pending} cambios pendientes y {state.failed} con error de sincronización. Los errores de envío no indican que falte conexión.</p></div>:
      !details?<p>Cargando detalle…</p>:detail==='data'?<div className="offline-detail-list"><p>Datos de {property?.name??'tu contexto actual'}. {formatBytes(state.cachedBytes)} en total.</p>
        {!details.data.length&&<p>No hay datos descargados.</p>}{details.data.map(item=><div className="offline-detail-row" key={item.category}><div><strong>{item.label}</strong>
          <small>{item.entries} consultas · {formatBytes(item.bytes)}{item.protected?' · Cambios pendientes de enviar':''}</small></div>
          <IconButton label={`Eliminar datos de ${item.label}`} disabled={blocked||item.protected} onClick={()=>setConfirmation({label:`los datos de ${item.label}`,action:()=>removeDownloadedData(item.category)})}><Trash2 size={18}/></IconButton></div>)}</div>:
      detail==='media'?<div className="offline-detail-list"><p>Archivos de tu usuario en este dispositivo. {formatBytes(state.mediaBytes)} en total.</p>
        {!details.media.length&&<p>No hay archivos guardados.</p>}{[...mediaGroups].map(([category,files])=>{
          const label=category==='local'?'Fotos subidas desde este dispositivo':downloadCategoryLabel(category);
          const removable=files.filter(file=>!file.protected);return <details className="offline-group" key={category}><summary><span>{label}</span>
            <small>{files.length} · {formatBytes(files.reduce((sum,file)=>sum+file.bytes,0))}</small><ChevronDown size={18}/></summary>
            <div className="offline-choice-list"><Button variant="secondary" disabled={blocked||!removable.length} onClick={()=>setConfirmation({label:`${removable.length} archivos de ${label}`,
              action:()=>removeDownloadedMedia(removable.map(file=>file.id))})}><Trash2 size={17}/> Liberar espacio de esta categoría</Button>
              {files.map(file=><div className="offline-detail-row" key={file.id}><div><strong>{file.name}</strong><small>{formatBytes(file.bytes)}
                {file.protected?' · Pendiente de enviar':''}</small></div><IconButton label={`Eliminar ${file.name}`} disabled={blocked||file.protected}
                  onClick={()=>setConfirmation({label:file.name,action:()=>removeDownloadedMedia([file.id])})}><Trash2 size={18}/></IconButton></div>)}</div></details>;})}</div>:
      <div className="offline-detail-list">{!details.changes.length&&<p>No hay cambios pendientes.</p>}{details.changes.map(item=><div className="offline-detail-row" key={item.id}><div>
        <strong>{item.summary??'Cambio pendiente'}</strong>
        {item.formParts.some(part=>part.filename)&&<small>{item.formParts.find(part=>part.filename)?.filename}</small>}
        {item.binarySize!==undefined&&<small>{formatBytes(item.binarySize)}</small>}
        {item.serverResult!==undefined&&<small>Archivo recibido; falta confirmar su sincronización.</small>}
        <small>{new Date(item.createdAt).toLocaleString('es-EC')} · {item.state==='FAILED'?'Con error':'Pendiente'}
          {item.scope.propertyId&&` · ${session?.overview.properties.find(p=>p.id===item.scope.propertyId)?.name??'Otra propiedad'}`}</small>
        {item.lastError&&<small>{item.lastError}</small>}</div><div className="pending-actions">
          <IconButton label={`Corregir ${item.summary??'cambio pendiente'}`} disabled={state.syncing||deleting||item.serverResult!==undefined||item.bodyType==='none'||item.bodyType==='form'}
            onClick={()=>{setError('');setEditing(item);setDraft(pendingMutationFields(item));}}><Pencil size={18}/></IconButton>
          <IconButton label={`Descartar ${item.summary??'cambio pendiente'}`} disabled={state.syncing||deleting||item.serverResult!==undefined}
            onClick={()=>setConfirmation({label:item.summary??'pendiente',discard:true,action:()=>discardPendingMutation(item.id)})}><Trash2 size={18}/></IconButton>
        </div></div>)}<SyncProgressBar/><div className="offline-buttons"><Button loading={state.syncing} disabled={!state.online||paused} onClick={()=>run(state.synchronize)}>Sincronizar</Button>
          {state.failed>0&&<Button variant="secondary" disabled={!state.online||paused} onClick={()=>run(state.retryFailed)}>Reintentar con errores</Button>}</div></div>}
    </Modal>}
  </div>;
}
