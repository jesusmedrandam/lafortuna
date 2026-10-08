import {useEffect,useState} from 'react';
import {Button,ConfirmDialog} from '../components/ui';
import {formatDateTime} from '../utils';
import {closeOtherUserSessions,closeUserSession,getUserSessions,type UserSession} from './api';
import {useV2Session} from './V2Session';

export function AccountSessions(){
  const {session,signOut}=useV2Session();const token=session!.accessToken;
  const [sessions,setSessions]=useState<UserSession[]|null>(null);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const [pending,setPending]=useState<UserSession|'others'|null>(null);
  const [revision,setRevision]=useState(0);
  useEffect(()=>{let active=true;setError('');
    void getUserSessions(token).then(value=>{if(active)setSessions(value);})
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'No se pudieron cargar tus sesiones.');});
    return()=>{active=false;};
  },[token,revision]);
  async function close(){if(!pending)return;setBusy(true);setError('');
    try{
      const result=pending==='others'?await closeOtherUserSessions(token):await closeUserSession(token,pending.id);
      setPending(null);
      if(result.currentSessionClosed)await signOut();else setRevision(value=>value+1);
    }catch(reason){setPending(null);setError(reason instanceof Error?reason.message:'No se pudo cerrar la sesión.');}
    finally{setBusy(false);}
  }
  return <div className="account-sessions"><p>Estos dispositivos pueden acceder a tu cuenta. Cierra las sesiones que ya no uses o no reconozcas.</p>
    {error&&<div role="alert" className="form-error">{error}<Button variant="ghost" onClick={()=>setRevision(value=>value+1)}>Reintentar</Button></div>}
    {!sessions&&!error&&<p role="status">Cargando sesiones…</p>}
    {sessions?.map(item=><article key={item.id}><div><strong>{item.deviceName}</strong>
      {item.current&&<span className="account-current-session">Este dispositivo</span>}
      <small>Última actividad: {formatDateTime(item.lastSeenAt)}</small>
      <small>Inicio de sesión: {formatDateTime(item.createdAt)}</small></div>
      <Button variant="secondary" disabled={busy} onClick={()=>setPending(item)}>Cerrar sesión</Button></article>)}
    {sessions&&sessions.length===0&&<p>No hay sesiones activas.</p>}
    {(sessions?.some(item=>!item.current))&&<Button variant="secondary" disabled={busy}
      onClick={()=>setPending('others')}>Cerrar las otras sesiones</Button>}
    {pending&&<ConfirmDialog title="Cerrar sesión" loading={busy} onClose={()=>{if(!busy)setPending(null);}}
      message={pending==='others'?'Se cerrarán las sesiones de los demás dispositivos. Este dispositivo seguirá conectado.':
        pending.current?'Se cerrará la sesión de este dispositivo. Tendrás que iniciar sesión otra vez.':`Se cerrará la sesión de ${pending.deviceName}.`}
      onConfirm={()=>void close()}/>}
  </div>;
}
