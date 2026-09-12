import { useEffect,useState } from 'react';
import { CheckCircle2,Download,RefreshCw,Smartphone } from 'lucide-react';
import { useToast } from './ToastContext';
import { Button,Modal } from './ui';
import { checkForAppUpdate,isAppUpdateDownloaded,startAppUpdate,type AppUpdateInfo } from '../updates/appUpdate';

function updateMessage(info:AppUpdateInfo){
  if(info.reason==='NO_ANDROID')return'La comprobación e instalación se realiza dentro de la aplicación Android.';
  if(info.reason==='NO_RELEASE')return'Aún no existe una Release publicada en GitHub.';
  if(info.reason==='NO_APK')return`GitHub tiene la versión ${info.latestVersion}, pero la Release no contiene un archivo APK.`;
  if(info.updateAvailable)return`Actualización disponible versión ${info.latestVersion}`;
  return`Tienes instalada la última versión de la app (${info.currentVersion}).`;
}

function releaseNoteLines(notes:string|null){
  return (notes??'').split(/\r?\n/).map(line=>line.trim().replace(/^#{1,6}\s*/, '').replace(/^[-*+]\s+/, '')).filter(Boolean).slice(0,20);
}

export function AppUpdatePanel(){
  const toast=useToast();
  const [info,setInfo]=useState<AppUpdateInfo|null>(null);const [loading,setLoading]=useState(true);const [,refreshDownloadedState]=useState(0);
  const check=async(force=false)=>{setLoading(true);try{setInfo(await checkForAppUpdate(force));}catch(error){toast.show((error as Error).message,'error');}finally{setLoading(false);}};
  useEffect(()=>{void check(false);const visible=()=>{if(document.visibilityState==='visible')refreshDownloadedState((value)=>value+1);};document.addEventListener('visibilitychange',visible);return()=>document.removeEventListener('visibilitychange',visible);},[]);
  const downloaded=isAppUpdateDownloaded(info);
  const download=()=>{if(!info)return;try{const result=startAppUpdate(info);toast.show(result==='PERMISSION_REQUIRED'?'Autoriza a SGB para instalar aplicaciones. Al regresar continuará la actualización.':result==='INSTALL_STARTED'?'Se abrió el instalador del APK ya descargado.':'SGB está descargando la actualización y abrirá el instalador al terminar.',result==='PERMISSION_REQUIRED'?'info':'success');}catch(error){toast.show((error as Error).message,'error');}};
  const notes=releaseNoteLines(info?.notes??null);
  return <section className={`app-update-page ${info?.updateAvailable?'has-update':info?.reason?'has-warning':'is-current'}`}>
    <div className="app-update-icon"><Smartphone size={34}/></div>
    <div className="app-update-status">
      <small>Aplicación SGB</small>
      <h2>{info?updateMessage(info):'Comprobando la versión instalada…'}</h2>
      <p>Versión actual <strong>{info?.currentVersion??'…'}</strong>{info?.latestVersion?<> · Última publicada <strong>{info.latestVersion}</strong></>:null}</p>
    </div>
    {info?.updateAvailable?<section className="app-release-notes"><h3>Novedades de esta versión</h3>{notes.length?<ul>{notes.map((line,index)=><li key={`${index}-${line}`}>{line}</li>)}</ul>:<p>El autor no agregó detalles a esta Release de GitHub.</p>}</section>:null}
    <div className="app-update-actions"><Button variant="secondary" loading={loading} onClick={()=>void check(true)}><RefreshCw size={17}/>Comprobar</Button>{info?.updateAvailable?<Button onClick={download}><Download size={17}/>{downloaded?'Instalar actualización':'Descargar e instalar'}</Button>:null}</div>
  </section>;
}

export function AppUpdatePrompt(){
  const toast=useToast();const [info,setInfo]=useState<AppUpdateInfo|null>(null);const [downloading,setDownloading]=useState(false);
  useEffect(()=>{
    if(!window.SGBAndroid)return;
    let active=true;
    let retryTimer=0;
    const check=async(retryOnFailure=true)=>{
      let value:AppUpdateInfo|null=null;
      try{value=await checkForAppUpdate(true);}
      catch{
        try{value=await checkForAppUpdate(false);}catch{/* Sin caché disponible. */}
        if(retryOnFailure&&active)retryTimer=window.setTimeout(()=>void check(false),15_000);
      }
      if(!value)return;
      if(active&&value.updateAvailable&&!sessionStorage.getItem(`sgb-update-dismissed-${value.latestVersion}`))setInfo(value);
    };
    const timer=window.setTimeout(()=>void check(),2500);
    const online=()=>void check();
    const visible=()=>{if(document.visibilityState==='visible')void check(false);};
    window.addEventListener('online',online);
    document.addEventListener('visibilitychange',visible);
    return()=>{active=false;window.clearTimeout(timer);window.clearTimeout(retryTimer);window.removeEventListener('online',online);document.removeEventListener('visibilitychange',visible);};
  },[]);
  if(!info)return null;
  const downloaded=isAppUpdateDownloaded(info);
  const close=()=>{sessionStorage.setItem(`sgb-update-dismissed-${info.latestVersion}`,'1');setInfo(null);};
  const download=()=>{setDownloading(true);try{const result=startAppUpdate(info);toast.show(result==='PERMISSION_REQUIRED'?'Activa el permiso de instalación; al volver continuará la actualización.':result==='INSTALL_STARTED'?'Se abrió el APK que ya estaba descargado.':'SGB descargará la nueva versión y abrirá directamente el instalador.',result==='PERMISSION_REQUIRED'?'info':'success');close();}catch(error){toast.show((error as Error).message,'error');}finally{setDownloading(false);}};
  const notes=releaseNoteLines(info.notes);
  return <Modal title="Nueva versión disponible" onClose={close} footer={<><Button variant="ghost" onClick={close}>Más tarde</Button><Button loading={downloading} onClick={download}><Download size={17}/>{downloaded?'Instalar ahora':'Actualizar ahora'}</Button></>}><div className="update-prompt-copy"><CheckCircle2 size={34}/><div><h3>SGB {info.latestVersion}</h3><p>{downloaded?'La actualización ya está descargada y lista para instalar.':`Tienes instalada la versión ${info.currentVersion}. Se recomienda actualizar para recibir las últimas correcciones y funciones.`}</p>{notes.length?<ul className="update-prompt-notes">{notes.slice(0,4).map((line,index)=><li key={`${index}-${line}`}>{line}</li>)}</ul>:null}</div></div></Modal>;
}
