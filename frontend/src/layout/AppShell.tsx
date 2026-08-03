import { useMemo, useState } from 'react';
import {
  ArrowLeftRight, Baby, Beef, Bell, BookOpen, ChevronRight, ClipboardList, Droplets,
  HeartOff, Home, LayoutDashboard, LogOut, MapPin, Menu, Milk, ShieldCheck, Sprout, Syringe,
  UserCircle, UserCog, Users, Warehouse, Weight, X, type LucideIcon,
} from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { IconButton } from '../components/ui';

interface Destination {
  to: string;
  label: string;
  icon: LucideIcon;
  permissions?: string[];
  section: 'principal' | 'operaciones' | 'administracion';
}

const destinations: Destination[] = [
  { to: '/', label: 'Panel', icon: LayoutDashboard, permissions: ['DASHBOARD_CONSULTAR'], section: 'principal' },
  { to: '/animales', label: 'Animales', icon: Beef, permissions: ['ANIMAL_CONSULTAR'], section: 'principal' },
  { to: '/grupos', label: 'Grupos', icon: Users, permissions: ['GRUPO_CONSULTAR'], section: 'principal' },
  { to: '/ubicaciones', label: 'Ubicaciones', icon: MapPin, permissions: ['UBICACION_CONSULTAR'], section: 'principal' },
  { to: '/potreros', label: 'Potreros', icon: Sprout, permissions: ['POTRERO_CONSULTAR'], section: 'principal' },
  { to: '/corrales', label: 'Corrales', icon: Warehouse, permissions: ['CORRAL_CONSULTAR'], section: 'principal' },
  { to: '/movimientos', label: 'Movimientos', icon: ArrowLeftRight, permissions: ['MOVIMIENTO_CONSULTAR'], section: 'operaciones' },
  { to: '/sanidad', label: 'Sanidad', icon: Syringe, permissions: ['SANIDAD_CONSULTAR'], section: 'operaciones' },
  { to: '/limpiezas', label: 'Limpieza de potreros', icon: Droplets, permissions: ['LIMPIEZA_CONSULTAR'], section: 'operaciones' },
  { to: '/partos', label: 'Reproducción', icon: Baby, permissions: ['PARTO_CONSULTAR', 'ABORTO_CONSULTAR'], section: 'operaciones' },
  { to: '/produccion', label: 'Producción', icon: Milk, permissions: ['PRODUCCION_CONSULTAR', 'LACTANCIA_CONSULTAR'], section: 'operaciones' },
  { to: '/pesajes', label: 'Pesajes', icon: Weight, permissions: ['PESAJE_CONSULTAR'], section: 'operaciones' },
  { to: '/muertes', label: 'Muertes y bajas', icon: HeartOff, permissions: ['MUERTE_CONSULTAR'], section: 'operaciones' },
  { to: '/catalogos', label: 'Catálogos', icon: BookOpen, permissions: ['CATALOGO_CONSULTAR'], section: 'administracion' },
  { to: '/usuarios', label: 'Usuarios', icon: UserCog, permissions: ['USUARIO_CONSULTAR'], section: 'administracion' },
  { to: '/roles', label: 'Roles y permisos', icon: ShieldCheck, permissions: ['ROL_CONSULTAR'], section: 'administracion' },
  { to: '/auditoria', label: 'Auditoría', icon: ClipboardList, permissions: ['AUDITORIA_CONSULTAR'], section: 'administracion' },
];

const sectionNames = { principal: 'Gestión principal', operaciones: 'Operaciones', administracion: 'Administración' } as const;

export function AppShell() {
  const { user, hasPermission, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const visible = useMemo(() => destinations.filter((item) => !item.permissions || hasPermission(...item.permissions)), [hasPermission]);
  const current = visible.find((item) => item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to));

  function closeMenu() { setOpen(false); }

  return (
    <div className="app-shell">
      {open ? <button className="mobile-overlay" aria-label="Cerrar menú" onClick={closeMenu} /> : null}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <img src="/logo-mm.png" alt="" />
          <div><strong>M&M</strong><span>Ganadería</span></div>
          <IconButton label="Cerrar menú" className="sidebar-close" onClick={closeMenu}><X size={20} /></IconButton>
        </div>
        <nav className="sidebar-nav">
          {(['principal', 'operaciones', 'administracion'] as const).map((section) => {
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
          <div className="topbar-left"><IconButton label="Abrir menú" className="mobile-menu-button" onClick={() => setOpen(true)}><Menu size={22} /></IconButton><div><span className="breadcrumb">M&M Ganadería</span><h2>{current?.label ?? 'Gestión ganadera'}</h2></div></div>
          <div className="topbar-actions"><IconButton label="Notificaciones"><Bell size={19} /></IconButton><NavLink to="/perfil" className="profile-link"><UserCircle size={21} /><span>Mi perfil</span></NavLink></div>
        </header>
        <main className="page-content"><Outlet /></main>
        <footer className="app-footer"><Home size={14} /><span>M&M Ganadería · Servidor lafortuna</span></footer>
      </div>
    </div>
  );
}
