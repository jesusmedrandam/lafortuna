import {useEffect,useState} from 'react';
import {Bell,CalendarDays,CheckCheck} from 'lucide-react';
import {useNavigate} from 'react-router-dom';
import {formatDateTime} from '../utils';
import {getNotifications,readAllNotifications,readNotification,type AppNotification} from './api';
import {useV2Session} from './V2Session';
export function V2NotificationCenter(){
  const {session,selectContext}=useV2Session();const token=session!.accessToken;
  const [items,setItems]=useState<AppNotification[]>([]);const [open,setOpen]=useState(false);
  const [error,setError]=useState('');const navigate=useNavigate();
  useEffect(()=>{let active=true;const refresh=()=>{void getNotifications(token).then(rows=>{
    if(active){setItems(rows);setError('');}}).catch(()=>{if(active)setError('No se pudieron cargar los avisos.');});};
    refresh();const timer=window.setInterval(refresh,60000);
    return()=>{active=false;window.clearInterval(timer);};},[token]);
  const unread=items.filter(item=>!item.readAt).length;
  async function openItem(item:AppNotification){
    try{if(!item.readAt){await readNotification(token,item.id);
      setItems(rows=>rows.map(row=>row.id===item.id?{...row,readAt:new Date().toISOString()}:row));}
      const property=session!.overview.properties.find(row=>row.id===item.propertyId);
      if(!property||!item.agendaItemId)return;
      const canOpen=(role:{permissions:string[]})=>role.permissions.includes('AGENDA_TASK_VIEW')||
        role.permissions.includes('AGENDA_EVENT_VIEW');
      const role=property.roles.find(canOpen);
      if(!role)return;
      if(item.propertyId!==session!.overview.activeContext?.propertyId||
        role.id!==session!.overview.activeContext?.roleId)await selectContext(property.id,role.id);
      navigate(`/agenda?item=${encodeURIComponent(item.agendaItemId)}`);setOpen(false);
    }catch(cause){setError(cause instanceof Error?cause.message:'No se pudo abrir la notificación.');}
  }
  async function readAll(){try{await readAllNotifications(token);setItems(rows=>rows.map(item=>
    ({...item,readAt:item.readAt??new Date().toISOString()})));}
    catch(cause){setError(cause instanceof Error?cause.message:'No se pudieron marcar los avisos.');}}
  return <div className="notification-center">
    <button type="button" className={`icon-button notification-trigger ${unread?'has-unread':''}`}
      aria-label={unread?`Notificaciones, ${unread} sin leer`:'Notificaciones'}
      aria-expanded={open} onClick={()=>setOpen(value=>!value)}><Bell size={20}/>
      {unread>0&&<span className="notification-dot"/>}</button>
    {open&&<><button className="notification-overlay" type="button" aria-label="Cerrar notificaciones"
      onClick={()=>setOpen(false)}/><section className="notification-panel" aria-label="Buzón de notificaciones">
      <header><strong>Notificaciones</strong>{unread>0&&<button type="button" onClick={()=>void readAll()}>
        <CheckCheck size={16}/>Marcar todas como leídas</button>}</header>
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="notification-list">{!items.length?<p className="notification-empty">
        <Bell size={24}/><strong>Sin notificaciones</strong><span>Los avisos de la agenda aparecerán aquí.</span></p>:
        items.map(item=><button type="button" key={item.id}
          className={`notification-item ${item.readAt?'':'unread'}`} onClick={()=>void openItem(item)}>
          <span className="notification-item-icon"><CalendarDays size={18}/></span>
          <span className="notification-item-copy"><span><strong>{item.title}</strong>
            <small>{formatDateTime(item.createdAt)}</small></span><em>{item.message}</em>
            <i>{item.propertyName}</i></span>{!item.readAt&&<span className="notification-dot"/>}
        </button>)}</div><footer>Los avisos permanecen en este buzón.</footer>
      </section></>}
  </div>;
}
