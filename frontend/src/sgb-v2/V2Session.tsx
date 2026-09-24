import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import {
  ApiRequestError,changeContext,getSessionOverview,login,logout,refreshSession,
  type SessionOverview,type SessionPayload,
} from './api';

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
    setSession({...payload,overview});
    setError(null);
  },[]);

  useEffect(()=>{
    let active=true;
    void refreshSession().then(async payload=>{
      const overview=await getSessionOverview(payload.accessToken);
      if(active)setSession({...payload,overview});
    }).catch(reason=>{
      if(active&&!(reason instanceof ApiRequestError&&reason.status===401))
        setError('No se pudo restablecer la sesión. Comprueba la conexión.');
    }).finally(()=>{if(active)setReady(true);});
    return()=>{active=false;};
  },[]);

  useEffect(()=>{
    if(!session)return;
    const delay=Math.max(10_000,new Date(session.accessExpiresAt).getTime()-Date.now()-60_000);
    const timer=window.setTimeout(()=>void refreshSession().then(complete).catch(()=>setSession(null)),delay);
    return()=>window.clearTimeout(timer);
  },[session?.accessExpiresAt,complete]);

  const signIn=useCallback(async(email:string,password:string)=>{
    await complete(await login(email,password,deviceId()));
  },[complete]);
  const signOut=useCallback(async()=>{
    try{await logout(session?.accessToken??null);}finally{setSession(null);setError(null);}
  },[session?.accessToken]);
  const selectContext=useCallback(async(propertyId:string,roleId:string)=>{
    if(!session)return;
    await changeContext(session.accessToken,propertyId,roleId);
    const overview=await getSessionOverview(session.accessToken);
    setSession({...session,activeContext:{propertyId,roleId},overview});
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
