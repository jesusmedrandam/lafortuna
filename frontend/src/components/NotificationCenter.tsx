import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeftRight, Baby, Beef, Bell, CheckCheck, Droplets,
  HeartPulse, Milk, ShoppingCart, Sprout, Syringe, Weight, X,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface UserNotification {
  id_notificacion: string;
  tipo: string;
  categoria: string;
  prioridad: 'INFO' | 'IMPORTANTE' | 'URGENTE';
  titulo: string;
  mensaje: string;
  entidad_tipo?: string | null;
  entidad_id?: string | null;
  ruta: string | null;
  datos: Record<string, unknown>;
  created_at: string;
  leida_at: string | null;
  no_leida: boolean;
  push_estado?: 'PENDIENTE' | 'EN_PROCESO' | 'ENVIADA' | 'ERROR' | 'OMITIDA';
  push_intentos?: number;
  push_enviada_at?: string | null;
  push_ultimo_error?: string | null;
  local?: boolean;
}

interface NotificationListResponse {
  items: UserNotification[];
  no_leidas: number;
}

const categoryIcons: Record<string, LucideIcon> = {
  ANIMALES: Beef,
  MOVIMIENTOS: ArrowLeftRight,
  PESAJES: Weight,
  SANIDAD: Syringe,
  PRODUCCION: Milk,
  REPRODUCCION: Baby,
  LIMPIEZA: Droplets,
  MANTENIMIENTO: Droplets,
  ACTIVIDADES: Sprout,
  VENTAS: ShoppingCart,
  COMPRAS: ShoppingCart,
  SISTEMA: AlertTriangle,
};

function relativeTime(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return 'Ahora';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Ayer' : `Hace ${days} días`;
}

function notificationRoute(item: UserNotification) {
  if (item.ruta?.includes('?') || item.ruta?.startsWith('/animales/')) return item.ruta;
  const id=encodeURIComponent(String(item.entidad_id??''));
  const data=item.datos??{};
  const routes:Record<string,string>={
    PARTO:`/partos?parto=${id}&tab=births`,ABORTO:`/partos?aborto=${id}&tab=abortions`,
    CELO:`/partos?celo=${id}&tab=heats`,PRENEZ:`/partos?prenez=${id}&tab=pregnancies`,
    MOVIMIENTO:`/movimientos?movimiento=${id}`,PRODUCCION_LECHE:`/produccion?registro=${id}`,
    PRODUCCION_TANQUE:`/produccion?tanque=${id}`,LACTANCIA:`/produccion?lactancia=${id}&tab=lactations`,
    PESAJE:`/pesajes?registro=${id}`,MUERTE:`/muertes?registro=${id}`,
    VENTA_ANIMAL:`/ventas?venta=${id}&tipo=animales`,VENTA_PRODUCTO:`/ventas?venta_producto=${id}&tipo=productos`,
    COMPRA:`/compras?compra=${id}`,LIMPIEZA_POTRERO:`/limpiezas?limpieza=${id}`,
    POTRERO:`/limpiezas?potrero=${id}`,ACTIVIDAD:`/actividades?actividad=${id}`,
    JORNADA_SANITARIA:`/sanidad?jornada=${id}`,TRATAMIENTO:`/sanidad?tratamiento=${id}`,
    CONDICION_SALUD:`/sanidad?condicion=${id}`,
  };
  if(item.entidad_tipo==='PROXIMO_PARTO'&&data.id_prenez)return `/partos?prenez=${encodeURIComponent(String(data.id_prenez))}&tab=pregnancies`;
  if(item.entidad_tipo==='PRODUCCION_DIARIA'&&data.fecha)return `/produccion?fecha=${encodeURIComponent(String(data.fecha))}`;
  return routes[String(item.entidad_tipo??'')] || item.ruta || '/';
}

export function NotificationCenter({ syncFailures, online }: { syncFailures: number; online: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<UserNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(true);

  const refresh = useCallback(async (showLoading = false) => {
    if (!user) return;
    if (showLoading) setLoading(true);
    try {
      const response = await apiRequest<NotificationListResponse>('/notificaciones?limit=25');
      setItems(response.items ?? []);
      setUnread(response.no_leidas ?? 0);
      setAvailable(true);
    } catch {
      setAvailable(false);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    const pushReceived = () => void refresh();
    window.addEventListener('sgb-push-received',pushReceived);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('sgb-push-received',pushReceived);
    };
  }, [refresh]);

  useEffect(() => {
    if (open) void refresh(true);
  }, [open, refresh]);

  const visibleItems = useMemo(() => {
    if (!syncFailures) return items;
    const local: UserNotification = {
      id_notificacion: 'local-sync-conflict', tipo: 'SINCRONIZACION_RECHAZADA',
      categoria: 'SISTEMA', prioridad: 'URGENTE', titulo: 'Sincronización requiere revisión',
      mensaje: `${syncFailures} cambio(s) fueron rechazados por validación o permisos.`,
      ruta: '/descargas', datos: {}, created_at: new Date().toISOString(),
      leida_at: null, no_leida: true, local: true,
    };
    return [local, ...items];
  }, [items, syncFailures]);
  const totalUnread = unread + (syncFailures ? 1 : 0);

  const markOne = async (item: UserNotification) => {
    if (!item.no_leida) return;
    setItems((current) => current.map((value) => value.id_notificacion === item.id_notificacion ? { ...value, no_leida: false, leida_at: new Date().toISOString() } : value));
    if (!item.local) setUnread((value) => Math.max(0, value - 1));
    if (online && !item.local) {
      try { await apiRequest(`/notificaciones/${item.id_notificacion}/leer`, { method: 'PATCH' }); }
      catch { /* Se volverá a reflejar como no leída al recuperar el servidor. */ }
    }
  };

  const openItem = async (item: UserNotification) => {
    await markOne(item);
    setOpen(false);
    navigate(notificationRoute(item));
  };

  const markAll = async () => {
    setItems((current) => current.map((item) => ({ ...item, no_leida: false, leida_at: item.leida_at ?? new Date().toISOString() })));
    setUnread(0);
    if (online) {
      try { await apiRequest('/notificaciones/leer-todas', { method: 'POST' }); }
      catch { void refresh(); }
    }
  };

  return <div className="notification-center">
    <button type="button" className={`icon-button notification-trigger ${totalUnread ? 'has-unread' : ''}`} aria-label={totalUnread ? `Notificaciones, ${totalUnread} sin leer` : 'Notificaciones'} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Bell size={19}/>{totalUnread ? <b>{totalUnread > 99 ? '99+' : totalUnread}</b> : null}
    </button>
    {open ? <><button type="button" className="notification-overlay" aria-label="Cerrar notificaciones" onClick={() => setOpen(false)}/><section className="notification-panel" aria-label="Buzón de notificaciones">
      <header><div><strong>Notificaciones</strong><small>{totalUnread ? `${totalUnread} sin leer` : 'Todo está revisado'}</small></div><div>{unread ? <button type="button" title="Marcar todas como leídas" onClick={() => void markAll()}><CheckCheck size={18}/></button> : null}<button type="button" title="Cerrar" onClick={() => setOpen(false)}><X size={18}/></button></div></header>
      <div className="notification-list">
        {loading && !visibleItems.length ? <p className="notification-empty">Actualizando…</p> : null}
        {!loading && !visibleItems.length ? <p className="notification-empty"><Bell size={24}/><strong>Sin notificaciones</strong><span>Los avisos dirigidos a tu usuario aparecerán aquí.</span></p> : null}
        {visibleItems.map((item) => {
          const Icon = categoryIcons[item.categoria] ?? HeartPulse;
          const imageUrl=typeof item.datos?.imagen_url==='string'&&item.datos.imagen_url.startsWith('https://')?item.datos.imagen_url:'';
          return <button type="button" key={item.id_notificacion} className={`notification-item ${item.no_leida ? 'unread' : ''} priority-${item.prioridad.toLowerCase()}`} onClick={() => void openItem(item)}>
            <span className={`notification-item-icon ${imageUrl?'has-photo':''}`}><Icon size={18}/>{imageUrl?<img src={imageUrl} alt="" loading="lazy"/>:null}</span><span className="notification-item-copy"><span><strong>{item.titulo}</strong><small>{relativeTime(item.created_at)}</small></span><em>{item.mensaje}</em><i>{item.categoria.toLocaleLowerCase('es')}</i></span>{item.no_leida ? <span className="notification-dot"/> : null}
          </button>;
        })}
      </div>
      <footer><span>{available ? 'Las notificaciones también quedan guardadas en este buzón.' : 'El buzón del servidor no está disponible en este momento.'}</span></footer>
    </section></> : null}
  </div>;
}
