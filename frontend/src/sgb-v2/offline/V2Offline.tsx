import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {AlertTriangle,Check,CloudDownload,CloudOff,Database,Images,RefreshCw,Wifi} from 'lucide-react';
import {Button,Card,PageHeader} from '../../components/ui';
import {useV2Session} from '../V2Session';
import {downloadPaths,isRuntimeOnline,retryFailedMutations,runtimeState,setAutomaticDownloads,
  syncOfflineMutations,type OfflineRuntimeState} from './runtime';

interface OfflineContextValue extends OfflineRuntimeState {
  downloading:boolean;
  dataRevision:number;
  setAutomatic:(enabled:boolean)=>Promise<void>;
  downloadNow:()=>Promise<void>;
  synchronize:()=>Promise<void>;
  retryFailed:()=>Promise<void>;
}

const empty:OfflineRuntimeState={online:true,automaticDownloads:false,pending:0,failed:0,syncing:false,
  cachedEntries:0,cachedBytes:0,mediaFiles:0,mediaBytes:0,mediaPending:0,mediaFailed:0,lastDownload:null};
const OfflineContext=createContext<OfflineContextValue|null>(null);

function propertyDownloadPaths(modules:string[],permissions:string[],personalFinance:boolean){
  const can=(permission:string)=>permissions.includes(permission);
  const paths:string[]=['/catalogs/reference'];
  if(can('ANIMAL_VIEW'))paths.push('/animals?page=1&search=','/animals/summary','/animals/classification',
    '/animal-status','/animal-status/options');
  if(can('GROUP_VIEW'))paths.push('/groups');
  if(can('LOCATION_VIEW'))paths.push('/locations');
  if(can('CATALOG_VIEW'))paths.push('/owners','/owners/users','/animal-brands',
    '/catalogs/BREEDS/items','/catalogs/COLORS/items','/catalogs/MOVEMENT_REASONS/items',
    '/catalogs/HEALTH_CONDITION_TYPES/items','/catalogs/TREATMENT_TYPES/items',
    '/catalogs/GRASS_TYPES/items');
  if(modules.includes('MULTIMEDIA')&&can('MEDIA_VIEW'))paths.push('/media','/media/usage');
  if(modules.includes('MOVEMENTS')&&can('MOVEMENT_VIEW'))paths.push('/movements','/movements/options');
  if(modules.includes('WEIGHING')&&can('WEIGHING_VIEW'))paths.push('/weighings','/weighings/options');
  if(modules.includes('HEALTH')&&can('HEALTH_VIEW'))paths.push('/health-records/conditions',
    '/health-records/medicines','/health-records/options','/health-records/campaigns');
  if(modules.includes('REPRODUCTION')&&can('REPRODUCTION_VIEW'))paths.push('/reproduction',
    '/reproduction/candidates','/reproduction/settings');
  if(modules.includes('PRODUCTION')&&can('PRODUCTION_VIEW'))paths.push('/production');
  if(modules.includes('PASTURE_CLEANING')&&can('CLEANING_VIEW'))paths.push('/cleanings',
    '/cleanings/options','/cleanings/products','/catalogs/AGROCHEMICAL_CATEGORIES/items');
  if(modules.includes('TASKS')&&can('ACTIVITY_VIEW'))paths.push('/activities','/activities/options');
  if(modules.includes('SALES_PURCHASES')&&can('COMMERCE_VIEW'))paths.push('/commerce','/commerce/animals',
    '/catalogs/BUYERS/items','/catalogs/SALE_PRODUCTS/items');
  if(modules.includes('PROPERTY_FINANCE')&&can('FINANCE_VIEW'))paths.push('/finances/property/accounts',
    '/finances/property/movements');
  if(personalFinance)paths.push('/finances/personal/accounts','/finances/personal/movements');
  if((modules.includes('TASKS')&&can('AGENDA_TASK_VIEW'))||(modules.includes('EVENTS')&&can('AGENDA_EVENT_VIEW')))
    paths.push('/agenda','/agenda/options');
  return [...new Set(paths)];
}

export function V2OfflineProvider({children}:{children:ReactNode}){
  const {session}=useV2Session();const [state,setState]=useState(empty);
  const [downloading,setDownloading]=useState(false);const [dataRevision,setDataRevision]=useState(0);
  const refresh=useCallback(async()=>setState(await runtimeState()),[]);
  const refreshTimer=useRef<number|null>(null);
  const automaticScope=useRef('');
  const property=session?.overview.properties.find(item=>item.id===session.overview.activeContext?.propertyId);
  const role=property?.roles.find(item=>item.id===session?.overview.activeContext?.roleId);
  const automaticKey=session?`${session.overview.user.id}:${session.overview.activeContext?.propertyId??''}:
    ${session.overview.activeContext?.roleId??''}`:'';
  const paths=useMemo(()=>propertyDownloadPaths(property?.enabledModules??[],role?.permissions??[],
    Boolean(session?.overview.enabledUserModules.includes('PERSONAL_FINANCE'))),
    [property?.enabledModules,role?.permissions,session?.overview.enabledUserModules]);

  useEffect(()=>{void refresh();const update=(event:Event)=>{
    const detail=(event as CustomEvent<OfflineRuntimeState>).detail;if(detail)setState(detail);else void refresh();};
    const connectivity=()=>void refresh();const changed=()=>{
      if(refreshTimer.current)window.clearTimeout(refreshTimer.current);
      refreshTimer.current=window.setTimeout(()=>{setDataRevision(value=>value+1);void refresh();},120);
    };
    window.addEventListener('sgb-v2-offline-state',update);window.addEventListener('sgb-v2-cache-updated',changed);
    window.addEventListener('online',connectivity);window.addEventListener('offline',connectivity);
    return()=>{window.removeEventListener('sgb-v2-offline-state',update);
      window.removeEventListener('sgb-v2-cache-updated',changed);window.removeEventListener('online',connectivity);
      window.removeEventListener('offline',connectivity);if(refreshTimer.current)window.clearTimeout(refreshTimer.current);};
  },[refresh]);

  useEffect(()=>{if(session&&isRuntimeOnline())void syncOfflineMutations();},
    [session?.overview.activeContext?.propertyId,session?.overview.activeContext?.roleId]);

  useEffect(()=>{
    if(!automaticKey||!state.automaticDownloads||!state.online||automaticScope.current===automaticKey)return;
    automaticScope.current=automaticKey;setDownloading(true);
    void downloadPaths(paths).catch(()=>{automaticScope.current='';}).finally(()=>{
      setDownloading(false);void refresh();
    });
  },[automaticKey,state.automaticDownloads,state.online,paths,refresh]);

  const setAutomatic=useCallback(async(enabled:boolean)=>{await setAutomaticDownloads(enabled);await refresh();
    if(!enabled){automaticScope.current='';return;}
    if(isRuntimeOnline()){automaticScope.current=automaticKey;setDownloading(true);
      try{await downloadPaths(paths);}catch(reason){automaticScope.current='';throw reason;}
      finally{setDownloading(false);await refresh();}}
  },[automaticKey,paths,refresh]);
  const downloadNow=useCallback(async()=>{setDownloading(true);try{await downloadPaths(paths);}
    finally{setDownloading(false);await refresh();}},[paths,refresh]);
  const synchronize=useCallback(async()=>{await syncOfflineMutations();await refresh();},[refresh]);
  const retryFailed=useCallback(async()=>{await retryFailedMutations();await refresh();},[refresh]);
  const value=useMemo(()=>({...state,downloading,dataRevision,setAutomatic,downloadNow,synchronize,retryFailed}),
    [state,downloading,dataRevision,setAutomatic,downloadNow,synchronize,retryFailed]);
  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useV2Offline(){
  const value=useContext(OfflineContext);if(!value)throw new Error('Falta el proveedor de datos sin conexión.');return value;
}

function formatBytes(value:number){if(value<1024)return `${value} B`;if(value<1024*1024)return `${(value/1024).toFixed(1)} KB`;
  return `${(value/1024/1024).toFixed(1)} MB`;}

export function OfflineStatusButton(){
  const {online,pending,failed,syncing}=useV2Offline();
  return <span className={`offline-status ${online?'online':'offline'} ${failed?'failed':''}`}
    title={online?'Con conexión':'Trabajando sin conexión'}>{online?<Wifi size={17}/>:<CloudOff size={17}/>}<span>
      {syncing?'Sincronizando…':failed?`${failed} con error`:pending?`${pending} pendiente${pending===1?'':'s'}`:online?'En línea':'Sin conexión'}
    </span></span>;
}

export function V2OfflinePage(){
  const state=useV2Offline();const [error,setError]=useState('');
  const run=(action:()=>Promise<void>)=>{setError('');void action().catch(reason=>setError(reason instanceof Error
    ?reason.message:'No se pudo completar la operación.'));};
  return <div className="offline-page"><PageHeader title="Datos sin conexión"
    description="Descarga la propiedad activa y continúa trabajando aunque no tengas señal."/>
    {error&&<div className="form-alert form-alert-error" role="alert">{error}</div>}
    <div className="offline-summary-grid">
      <Card><Database size={22}/><div><span>Datos guardados</span><strong>{state.cachedEntries}</strong>
        <small>{formatBytes(state.cachedBytes)}</small></div></Card>
      <Card><Images size={22}/><div><span>Fotos y videos</span><strong>{state.mediaFiles}</strong>
        <small>{state.mediaPending?`${state.mediaPending} descargando…`:formatBytes(state.mediaBytes)}</small></div></Card>
      <Card>{state.online?<Wifi size={22}/>:<CloudOff size={22}/>}<div><span>Conexión</span>
        <strong>{state.online?'Disponible':'Sin conexión'}</strong><small>La lectura local continúa disponible</small></div></Card>
      <Card>{state.failed?<AlertTriangle size={22}/>:<Check size={22}/>}<div><span>Cambios locales</span>
        <strong>{state.pending} pendientes</strong><small>{state.failed?`${state.failed} requieren revisión`:'Sin errores de sincronización'}</small></div></Card>
    </div>
    <Card className="offline-settings-card"><div><h3>Descargas automáticas</h3>
      <p>Al consultar información con internet, se conservará y actualizará para la próxima visita sin conexión.</p></div>
      <label className="offline-switch"><input type="checkbox" checked={state.automaticDownloads}
        onChange={event=>run(()=>state.setAutomatic(event.target.checked))}/><span aria-hidden="true"/></label></Card>
    <Card className="offline-actions-card"><div><h3>Propiedad activa</h3><p>Incluye animales, catálogos y los módulos habilitados para tu rol.</p>
      <small>{state.lastDownload?`Última actualización: ${new Date(state.lastDownload).toLocaleString('es-EC')}`:
        'Aún no se han descargado datos en este dispositivo.'}</small></div><div className="offline-buttons">
      <Button onClick={()=>run(state.downloadNow)} loading={state.downloading} disabled={!state.online}>
        <CloudDownload size={18}/> Descargar ahora</Button>
      <Button variant="secondary" onClick={()=>run(state.synchronize)} loading={state.syncing} disabled={!state.online}>
        <RefreshCw size={18}/> Sincronizar</Button>
      {state.failed>0&&<Button variant="secondary" onClick={()=>run(state.retryFailed)} disabled={!state.online}>
        Reintentar con errores</Button>}
    </div></Card>
    <p className="offline-note">Los cambios se guardan primero en este dispositivo. Se envían uno por uno y nunca se eliminan de la cola por una pérdida de señal.</p>
  </div>;
}
