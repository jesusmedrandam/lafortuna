import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {
  ApiRequestError,changeContext,getSessionOverview,login,logout,refreshSession,
  beginPropertySupport,endPropertySupport,
  updateUserProfile,type UserProfileInput,type SessionOverview,type SessionPayload,
} from './api';
import {clearSessionSnapshot,getSessionSnapshot,putSessionSnapshot,type OfflineScope} from './offline/database';
import {configureOfflineRuntime,isRuntimeOnline,isSynchronizing,syncOfflineMutations} from './offline/runtime';

interface ActiveSession extends SessionPayload { overview:SessionOverview }
interface SessionContextValue {
  session:ActiveSession|null;
  ready:boolean;
  error:string|null;
  signIn:(email:string,password:string)=>Promise<void>;
  signOut:()=>Promise<void>;
  selectContext:(propertyId:string,roleId:string)=>Promise<void>;
  beginSupport:(accountId:string,propertyId:string)=>Promise<void>;
  endSupport:()=>Promise<void>;
  hasPermission:(permission:string)=>boolean;
  reloadOverview:()=>Promise<void>;
  saveProfile:(input:UserProfileInput)=>Promise<void>;
}
const SessionContext=createContext<SessionContextValue|null>(null);
const deviceKey='sgb.device-id';
function sessionScope(overview:SessionOverview):OfflineScope{return {userId:overview.user.id,
  propertyId:overview.activeContext?.propertyId??null,roleId:overview.activeContext?.roleId??null,
  ...(overview.user.isSuperadmin?{supportMode:Boolean(overview.supportMode),supportAccountId:overview.supportAccountId??null}:{})};}

function deviceId(){
  let id=localStorage.getItem(deviceKey);
  if(!id){id=`web-${crypto.randomUUID()}`;localStorage.setItem(deviceKey,id);}
  return id;
}

export function V2SessionProvider({children}:{children:ReactNode}){
  const [session,setSession]=useState<ActiveSession|null>(null);
  const [ready,setReady]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const current=useRef<ActiveSession|null>(null);const generation=useRef(0);
  const latestPayload=useRef<SessionPayload|null>(null);const renewing=useRef<Promise<void>|null>(null);

  const complete=useCallback(async(payload:SessionPayload)=>{
    const started=generation.current;
    if(latestPayload.current?.user.id!==payload.user.id||payload.accessExpiresAt>=latestPayload.current.accessExpiresAt)latestPayload.current=payload;
    const overview=await getSessionOverview(payload.accessToken);
    if(started!==generation.current)return;
    const credentials=latestPayload.current?.user.id===payload.user.id?latestPayload.current:payload;
    const active={...credentials,user:overview.user,activeContext:overview.activeContext,overview};
    await configureOfflineRuntime(sessionScope(overview),credentials.accessToken);
    if(started!==generation.current)return;
    await putSessionSnapshot(overview.user.id,active);
    if(started!==generation.current)return;current.current=active;setSession(active);
    try{window.SGBAndroid?.setAuthenticatedSession?.(true);}catch{/* Solo Android. */}
    setError(null);
  },[]);

  useEffect(()=>{
    let active=true;const started=generation.current;
    void (async()=>{
      const saved=await getSessionSnapshot<ActiveSession>();
      // Older administrator snapshots inferred elevated roles; refresh them before using their permissions.
      const snapshot=saved&&(!saved.payload.overview.user.isSuperadmin
        ||typeof saved.payload.overview.supportMode==='boolean')?saved:null;
      if(!active||started!==generation.current)return;
      if(snapshot){
        await configureOfflineRuntime(sessionScope(snapshot.payload.overview),snapshot.payload.accessToken);
        if(!active||started!==generation.current)return;
        current.current=snapshot.payload;setSession(snapshot.payload);setError(null);
        try{window.SGBAndroid?.setAuthenticatedSession?.(true);}catch{/* Solo Android. */}
        setReady(true);
      }
      if(!isRuntimeOnline()){
        if(!snapshot)setError('Conéctate al menos una vez para iniciar sesión en este dispositivo.');
        return;
      }
      try{const payload=await refreshSession();if(active&&started===generation.current)await complete(payload);}
      catch(reason){
        if(!active||started!==generation.current)return;
        if(reason instanceof ApiRequestError&&reason.status===401){
          await clearSessionSnapshot();await configureOfflineRuntime(null,null);current.current=null;setSession(null);
          try{window.SGBAndroid?.setAuthenticatedSession?.(false);}catch{/* Solo Android. */}
        }else if(!snapshot)setError('No se pudo restablecer la sesión. Conéctate al menos una vez en este dispositivo.');
      }
    })().finally(()=>{if(active)setReady(true);});
    return()=>{active=false;};
  },[complete]);

  const renew=useCallback(()=>{
    if(!isRuntimeOnline()||!current.current)return Promise.resolve();
    if(renewing.current)return renewing.current;
    const started=generation.current;const userId=current.current.overview.user.id;
    renewing.current=refreshSession().then(async payload=>{
      if(started!==generation.current||current.current?.overview.user.id!==userId)return;
      if(payload.user.id!==userId)throw new ApiRequestError('La sesión cambió.',401,'SESSION_CHANGED');
      await complete(payload);await syncOfflineMutations();
    }).catch(async reason=>{
      if(started===generation.current&&reason instanceof ApiRequestError&&reason.status===401){
        generation.current++;current.current=null;latestPayload.current=null;await clearSessionSnapshot();
        await configureOfflineRuntime(null,null);setSession(null);
        try{window.SGBAndroid?.setAuthenticatedSession?.(false);}catch{/* Solo Android. */}
      }
    }).finally(()=>{renewing.current=null;});return renewing.current;
  },[complete]);

  useEffect(()=>{
    if(!session)return;
    const delay=Math.max(10_000,new Date(session.accessExpiresAt).getTime()-Date.now()-60_000);
    const timer=window.setTimeout(()=>void renew(),delay);
    return()=>window.clearTimeout(timer);
  },[session?.accessExpiresAt,renew]);

  useEffect(()=>{
    const reconnect=()=>{if(document.visibilityState!=='hidden')void renew();};
    const renewed=(event:Event)=>{const payload=(event as CustomEvent<SessionPayload>).detail;
      if(payload?.user.id===current.current?.overview.user.id)void complete(payload).catch(()=>undefined);};
    window.addEventListener('online',reconnect);
    window.addEventListener('focus',reconnect);window.addEventListener('sgb-app-resumed',reconnect);
    document.addEventListener('visibilitychange',reconnect);window.addEventListener('sgb-v2-session-renewed',renewed);
    return()=>{window.removeEventListener('online',reconnect);window.removeEventListener('focus',reconnect);
      window.removeEventListener('sgb-app-resumed',reconnect);document.removeEventListener('visibilitychange',reconnect);
      window.removeEventListener('sgb-v2-session-renewed',renewed);};
  },[renew,complete]);

  const signIn=useCallback(async(email:string,password:string)=>{
    const started=++generation.current;latestPayload.current=null;
    const payload=await login(email,password,deviceId());
    if(started===generation.current)await complete(payload);
  },[complete]);
  const signOut=useCallback(async()=>{
    generation.current++;current.current=null;latestPayload.current=null;
    try{await logout(session?.accessToken??null);}catch{/* El cierre local también funciona sin conexión. */}
    finally{await clearSessionSnapshot();await configureOfflineRuntime(null,null);setSession(null);setError(null);
      try{window.SGBAndroid?.setAuthenticatedSession?.(false);}catch{/* Solo Android. */}}
  },[session?.accessToken]);
  const selectContext=useCallback(async(propertyId:string,roleId:string)=>{
    if(!session)return;
    if(isSynchronizing())throw new Error('Espera a que termine la sincronización antes de cambiar de propiedad o rol.');
    const started=++generation.current;
    const members=session.overview.memberProperties??session.overview.properties.filter(item=>item.roles.every(role=>role.code!=='SUPERADMIN'));
    if(!members.some(property=>property.id===propertyId&&property.roles.some(role=>role.id===roleId)))
      throw new Error('Elige un rol de una propiedad de la que formes parte.');
    if(session.overview.supportMode&&!isRuntimeOnline())throw new Error('Conéctate para volver a tu rol de usuario.');
    let overview:SessionOverview={...session.overview,activeContext:{propertyId,roleId},properties:members,
      supportMode:false,supportOwner:null,supportAccountId:null};
    if(isRuntimeOnline()){
      try{await changeContext(session.accessToken,propertyId,roleId);
        overview=await getSessionOverview(session.accessToken);}
      catch(reason){if(!(reason instanceof ApiRequestError&&reason.status===0))throw reason;}
    }
    if(started!==generation.current)return;
    generation.current++;
    const credentials=latestPayload.current?.user.id===session.user.id?latestPayload.current:session;
    const next={...session,...credentials,activeContext:{propertyId,roleId},overview};
    await configureOfflineRuntime(sessionScope(overview),credentials.accessToken);
    await putSessionSnapshot(overview.user.id,next);current.current=next;setSession(next);
  },[session]);
  const reloadOverview=useCallback(async()=>{
    if(session)await complete(session);
  },[session,complete]);
  const saveProfile=useCallback(async(input:UserProfileInput)=>{
    const previous=current.current;if(!previous)throw new Error('Inicia sesión para editar tu perfil.');
    const started=generation.current;
    const user=await updateUserProfile(previous.accessToken,input);
    const latest=current.current;
    if(started!==generation.current||latest?.user.id!==user.id)return;
    const next={...latest,user,overview:{...latest.overview,user}};
    current.current=next;setSession(next);
    if(latestPayload.current?.user.id===user.id)latestPayload.current={...latestPayload.current,user};
    await putSessionSnapshot(user.id,next);
  },[]);
  const beginSupport=useCallback(async(accountId:string,propertyId:string)=>{
    if(!session?.overview.user.isSuperadmin)throw new Error('Se requiere acceso de superadministrador.');
    if(!isRuntimeOnline())throw new Error('Conéctate para iniciar soporte en otra propiedad.');
    if(isSynchronizing())throw new Error('Espera a que termine la sincronización antes de iniciar soporte.');
    const started=++generation.current;
    const context=await beginPropertySupport(session.accessToken,accountId,propertyId);
    if(started!==generation.current)return;
    generation.current++;
    await complete({...session,activeContext:context});
  },[session,complete]);
  const endSupport=useCallback(async()=>{
    if(!session?.overview.user.isSuperadmin)throw new Error('Se requiere acceso de superadministrador.');
    if(!isRuntimeOnline())throw new Error('Conéctate para finalizar el soporte.');
    if(isSynchronizing())throw new Error('Espera a que termine la sincronización antes de finalizar el soporte.');
    const started=++generation.current;await endPropertySupport(session.accessToken);
    if(started!==generation.current)return;
    generation.current++;await complete({...session,activeContext:null});
  },[session,complete]);
  const hasPermission=useCallback((permission:string)=>{
    if(!session?.overview.activeContext)return false;
    const {propertyId,roleId}=session.overview.activeContext;
    return Boolean(session.overview.properties.find(property=>property.id===propertyId)
      ?.roles.find(role=>role.id===roleId)?.permissions.includes(permission));
  },[session]);
  const value=useMemo(()=>({session,ready,error,signIn,signOut,selectContext,beginSupport,endSupport,hasPermission,reloadOverview,saveProfile}),
    [session,ready,error,signIn,signOut,selectContext,beginSupport,endSupport,hasPermission,reloadOverview,saveProfile]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useV2Session(){
  const context=useContext(SessionContext);
  if(!context)throw new Error('Falta el proveedor de sesión SGB 2.');
  return context;
}
