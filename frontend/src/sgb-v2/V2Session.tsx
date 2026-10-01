import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import {
  ApiRequestError,changeContext,getSessionOverview,login,logout,refreshSession,
  type SessionOverview,type SessionPayload,
} from './api';
import {clearSessionSnapshot,getSessionSnapshot,putSessionSnapshot} from './offline/database';
import {configureOfflineRuntime,isRuntimeOnline,syncOfflineMutations} from './offline/runtime';

interface ActiveSession extends SessionPayload { overview:SessionOverview }
interface SessionContextValue {
  session:ActiveSession|null;
  ready:boolean;
  error:string|null;
  signIn:(email:string,password:string)=>Promise<void>;
  signOut:()=>Promise<void>;
  selectContext:(propertyId:string,roleId:string)=>Promise<void>;
  hasPermission:(permission:string)=>boolean;
  reloadOverview:()=>Promise<void>;
}
const SessionContext=createContext<SessionContextValue|null>(null);
const deviceKey='sgb.device-id';

function deviceId(){
  let id=localStorage.getItem(deviceKey);
  if(!id){id=`web-${crypto.randomUUID()}`;localStorage.setItem(deviceKey,id);}
  return id;
}

export function V2SessionProvider({children}:{children:ReactNode}){
  const [session,setSession]=useState<ActiveSession|null>(null);
  const [ready,setReady]=useState(false);
  const [error,setError]=useState<string|null>(null);

  const complete=useCallback(async(payload:SessionPayload)=>{
    const overview=await getSessionOverview(payload.accessToken);
    const active={...payload,overview};
    await configureOfflineRuntime({userId:overview.user.id,
      propertyId:overview.activeContext?.propertyId??null,roleId:overview.activeContext?.roleId??null},
      payload.accessToken);
    await putSessionSnapshot(overview.user.id,active);
    setSession(active);
    try{window.SGBAndroid?.setAuthenticatedSession?.(true);}catch{/* Solo Android. */}
    setError(null);
  },[]);

  useEffect(()=>{
    let active=true;
    void (async()=>{
      const snapshot=await getSessionSnapshot<ActiveSession>();
      if(!active)return;
      if(snapshot){
        await configureOfflineRuntime({userId:snapshot.payload.overview.user.id,
          propertyId:snapshot.payload.overview.activeContext?.propertyId??null,
          roleId:snapshot.payload.overview.activeContext?.roleId??null},snapshot.payload.accessToken);
        setSession(snapshot.payload);setError(null);
        try{window.SGBAndroid?.setAuthenticatedSession?.(true);}catch{/* Solo Android. */}
        setReady(true);
      }
      if(!isRuntimeOnline()){
        if(!snapshot)setError('Conéctate al menos una vez para iniciar sesión en este dispositivo.');
        return;
      }
      try{const payload=await refreshSession();if(active)await complete(payload);}
      catch(reason){
        if(!active)return;
        if(reason instanceof ApiRequestError&&reason.status===401){
          await clearSessionSnapshot();await configureOfflineRuntime(null,null);setSession(null);
          try{window.SGBAndroid?.setAuthenticatedSession?.(false);}catch{/* Solo Android. */}
        }else if(!snapshot)setError('No se pudo restablecer la sesión. Conéctate al menos una vez en este dispositivo.');
      }
    })().finally(()=>{if(active)setReady(true);});
    return()=>{active=false;};
  },[complete]);

  useEffect(()=>{
    if(!session)return;
    const delay=Math.max(10_000,new Date(session.accessExpiresAt).getTime()-Date.now()-60_000);
    const timer=window.setTimeout(()=>void refreshSession().then(complete).catch(reason=>{
      if(reason instanceof ApiRequestError&&reason.status===401){setSession(null);void clearSessionSnapshot();}
    }),delay);
    return()=>window.clearTimeout(timer);
  },[session?.accessExpiresAt,complete]);

  useEffect(()=>{
    const reconnect=()=>{if(session)void refreshSession().then(async payload=>{
      await complete(payload);await syncOfflineMutations();
    }).catch(()=>undefined);};
    window.addEventListener('online',reconnect);
    return()=>window.removeEventListener('online',reconnect);
  },[session,complete]);

  const signIn=useCallback(async(email:string,password:string)=>{
    await complete(await login(email,password,deviceId()));
  },[complete]);
  const signOut=useCallback(async()=>{
    try{await logout(session?.accessToken??null);}catch{/* El cierre local también funciona sin conexión. */}
    finally{await clearSessionSnapshot();await configureOfflineRuntime(null,null);setSession(null);setError(null);
      try{window.SGBAndroid?.setAuthenticatedSession?.(false);}catch{/* Solo Android. */}}
  },[session?.accessToken]);
  const selectContext=useCallback(async(propertyId:string,roleId:string)=>{
    if(!session)return;
    let overview:SessionOverview={...session.overview,activeContext:{propertyId,roleId}};
    if(isRuntimeOnline()){
      try{await changeContext(session.accessToken,propertyId,roleId);
        overview=await getSessionOverview(session.accessToken);}
      catch(reason){if(!(reason instanceof ApiRequestError&&reason.status===0))throw reason;}
    }
    const next={...session,activeContext:{propertyId,roleId},overview};
    await configureOfflineRuntime({userId:overview.user.id,propertyId,roleId},session.accessToken);
    await putSessionSnapshot(overview.user.id,next);setSession(next);
  },[session]);
  const reloadOverview=useCallback(async()=>{
    if(session)await complete(session);
  },[session,complete]);
  const hasPermission=useCallback((permission:string)=>{
    if(!session?.overview.activeContext)return false;
    const {propertyId,roleId}=session.overview.activeContext;
    return Boolean(session.overview.properties.find(property=>property.id===propertyId)
      ?.roles.find(role=>role.id===roleId)?.permissions.includes(permission));
  },[session]);
  const value=useMemo(()=>({session,ready,error,signIn,signOut,selectContext,hasPermission,reloadOverview}),
    [session,ready,error,signIn,signOut,selectContext,hasPermission,reloadOverview]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useV2Session(){
  const context=useContext(SessionContext);
  if(!context)throw new Error('Falta el proveedor de sesión SGB 2.');
  return context;
}
