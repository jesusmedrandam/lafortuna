import { useMemo, useState } from 'react';
import {
  ArrowLeftRight, Baby, Beef, ChevronRight, Droplets,
  HeartOff, Home, Images, LayoutDashboard, LogOut, MapPinned, Menu, Milk, Moon, ShoppingCart, Sprout, Sun, Syringe,
  Settings2, UserCircle, Users, Warehouse, Weight, X, Activity, AlertTriangle, PackagePlus, CloudDownload, RefreshCw, Wifi, WifiOff, type LucideIcon,
} from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { IconButton } from '../components/ui';
import { useTheme } from '../theme/ThemeContext';
import { useOffline } from '../offline/OfflineContext';
import { NotificationCenter } from '../components/NotificationCenter';

interface Destination {
  to: string;
  label: string;
  icon: LucideIcon;
  permissions?: string[];
  section: 'principal' | 'operaciones' | 'configuracion';
}

interface OperationVisibilityResponse { operaciones: Record<string, boolean> }

const destinationOperations: Partial<Record<string, string[]>> = {
  '/movimientos': ['MOVIMIENTO_UBICACION', 'MOVIMIENTO_GRUPO', 'MOVIMIENTO_PROPIEDAD'],
  '/sanidad': ['TRATAMIENTO'],
  '/partos': ['CELO', 'INSEMINACION_ARTIFICIAL', 'TRANSFERENCIA_EMBRIONES', 'PRENEZ', 'PARTO', 'ABORTO'],
  '/produccion': ['LACTANCIA', 'PRODUCCION_LECHE'],
  '/pesajes': ['PESAJE'],
  '/muertes': ['MUERTE'],
  '/ventas': ['VENTA'],
};

const destinations: Destination[] = [
  { to: '/', label: 'Panel', icon: LayoutDashboard, permissions: ['DASHBOARD_CONSULTAR'], section: 'principal' },
  { to: '/animales', label: 'Animales', icon: Beef, permissions: ['ANIMAL_CONSULTAR'], section: 'principal' },
  { to: '/multimedia', label: 'Multimedia', icon: Images, permissions: ['IMAGEN_CONSULTAR'], section: 'principal' },
  { to: '/descargas', label: 'Descargas', icon: CloudDownload, section: 'principal' },
  { to: '/grupos', label: 'Grupos', icon: Users, permissions: ['GRUPO_CONSULTAR'], section: 'principal' },
  { to: '/potreros', label: 'Potreros', icon: Sprout, permissions: ['POTRERO_CONSULTAR'], section: 'principal' },
  { to: '/corrales', label: 'Corrales', icon: Warehouse, permissions: ['CORRAL_CONSULTAR'], section: 'principal' },
  { to: '/ubicaciones', label: 'Otras propiedades', icon: MapPinned, permissions: ['UBICACION_CONSULTAR'], section: 'principal' },
  { to: '/movimientos', label: 'Movimientos', icon: ArrowLeftRight, permissions: ['MOVIMIENTO_CONSULTAR'], section: 'operaciones' },
  { to: '/sanidad', label: 'Sanidad', icon: Syringe, permissions: ['SANIDAD_CONSULTAR'], section: 'operaciones' },
  { to: '/limpiezas', label: 'Limpieza potreros', icon: Droplets, permissions: ['LIMPIEZA_CONSULTAR'], section: 'operaciones' },
  { to: '/partos', label: 'Reproducción', icon: Baby, permissions: ['PARTO_CONSULTAR', 'ABORTO_CONSULTAR'], section: 'operaciones' },
  { to: '/produccion', label: 'Producción', icon: Milk, permissions: ['PRODUCCION_CONSULTAR', 'LACTANCIA_CONSULTAR'], section: 'operaciones' },
  { to: '/pesajes', label: 'Pesajes', icon: Weight, permissions: ['PESAJE_CONSULTAR'], section: 'operaciones' },
  { to: '/muertes', label: 'Novedades y bajas', icon: HeartOff, permissions: ['MUERTE_CONSULTAR'], section: 'operaciones' },
  { to: '/ventas', label: 'Ventas', icon: ShoppingCart, permissions: ['VENTA_CONSULTAR'], section: 'operaciones' },
  { to: '/compras', label: 'Compras y egresos', icon: PackagePlus, permissions: ['COMPRA_CONSULTAR'], section: 'operaciones' },
  { to: '/actividades', label: 'Otras actividades', icon: Activity, permissions: ['ACTIVIDAD_CONSULTAR'], section: 'operaciones' },
  { to: '/configuracion', label: 'Configuración', icon: Settings2, section: 'configuracion' },
];

const sectionNames = { principal: 'Gestión principal', operaciones: 'Operaciones', configuracion: 'Cuenta y administración' } as const;

export function AppShell() {
  const { user, hasPermission, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const offline = useOffline();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const operationVisibility = useQuery({
    queryKey: ['visible-operation-policy'],
    queryFn: () => apiRequest<OperationVisibilityResponse>('/configuracion/operaciones-visibles'),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const visible = useMemo(() => destinations.filter((item) => {
    if (item.permissions && !hasPermission(...item.permissions)) return false;
    const operations = destinationOperations[item.to];
    if (!operations || !operationVisibility.data) return true;
    return operations.some((operation) => operationVisibility.data?.operaciones?.[operation] !== false);
  }), [hasPermission, operationVisibility.data]);
  const current = visible.find((item) => item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to));

  function closeMenu() { setOpen(false); }

  return (
    <div className="app-shell">
      {open ? <button className="mobile-overlay" aria-label="Cerrar menú" onClick={closeMenu} /> : null}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <img src="/branding/logo-sgb-icon.png" alt="SGB" />
          <div><strong>SGB</strong><span>Gestión Bovina</span></div>
          <IconButton label="Cerrar menú" className="sidebar-close" onClick={closeMenu}><X size={20} /></IconButton>
        </div>
        <nav className="sidebar-nav">
          {(['principal', 'operaciones', 'configuracion'] as const).map((section) => {
            const items = visible.filter((item) => item.section === section);
            if (!items.length) return null;
            return <div className="nav-section" key={section}><span>{sectionNames[section]}</span>{items.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} onClick={closeMenu} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon size={19} /><span>{label}</span><ChevronRight className="nav-chevron" size={16} /></NavLink>)}</div>;
          })}
        </nav>
        <div className="sidebar-user">
          <div className="user-avatar">{user?.fotoPerfilUrl ? <img src={user.fotoPerfilUrl} alt="" /> : <span>{user?.nombres?.[0]}{user?.apellidos?.[0]}</span>}</div>
          <div><strong>{user?.nombres} {user?.apellidos}</strong><span>{user?.roles?.[0] ?? 'Sin rol asignado'}</span></div>
          <IconButton label="Cerrar sesión" onClick={() => void logout()}><LogOut size={18} /></IconButton>
        </div>
      </aside>
      <div className="shell-main">
        <header className="topbar">
          <div className="topbar-left"><IconButton label="Abrir menú" className="mobile-menu-button" onClick={() => setOpen(true)}><Menu size={22} /></IconButton><div><span className="breadcrumb">Sistema de Gestión Bovina</span><h2>{current?.label ?? 'Gestión ganadera'}</h2></div></div>
          <div className="topbar-actions"><NavLink to="/descargas" title={offline.failed ? 'Hay cambios que requieren revisión' : undefined} className={`connectivity-pill ${offline.quality} ${offline.failed ? 'has-conflict' : ''}`}>{offline.quality === 'offline' ? <WifiOff size={16} /> : offline.waking || offline.syncing ? <RefreshCw className="spin" size={16} /> : <Wifi size={16} />}<span>{offline.quality === 'stable' ? offline.syncing ? 'Sincronizando' : 'Conexión estable' : offline.quality === 'unstable' ? offline.waking ? 'Activando servidor' : 'Conexión inestable' : 'Sin conexión'}</span>{offline.pending + offline.failed ? <b>{offline.pending + offline.failed}</b> : null}{offline.failed ? <AlertTriangle className="connectivity-warning" size={14} /> : null}</NavLink><IconButton label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro'} onClick={toggleTheme}>{theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}</IconButton><NotificationCenter syncFailures={offline.failed} online={offline.quality === 'stable'}/><NavLink to="/perfil" className="profile-link">{user?.fotoPerfilUrl?<img src={user.fotoPerfilUrl} alt=""/>:<UserCircle size={21}/>}<span>Mi perfil</span></NavLink></div>
        </header>
        <main className="page-content"><Outlet /></main>
        <footer className="app-footer"><Home size={14} /><span>SGB · Sistema de Gestión Bovina</span></footer>
      </div>
    </div>
  );
}
