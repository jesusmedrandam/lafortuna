import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Beef, Droplets, Mars, Syringe, Users, Venus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Card, ErrorState, LoadingState, PageHeader } from '../../components/ui';
import type { DashboardSummary } from '../../types/api';
import { formatNumber } from '../../utils';

export function DashboardPage() {
  const navigate = useNavigate();
  const { hasPermission, user } = useAuth();
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => apiRequest<DashboardSummary>('/dashboard/resumen'), staleTime: 60_000 });
  if (query.isLoading) return <LoadingState text="Preparando el resumen de la finca…" />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />;
  const data = query.data!;
  const cards = [
    { label: 'Animales', value: data.animales_total, icon: Beef, route: '/animales', permission: 'ANIMAL_CONSULTAR', tone: 'green' },
    { label: 'Animales activos', value: data.animales_activos, icon: Beef, route: '/animales?estado=ACTIVO', permission: 'ANIMAL_CONSULTAR', tone: 'lime' },
    { label: 'Hembras', value: data.hembras, icon: Venus, route: '/animales?sexo=HEMBRA', permission: 'ANIMAL_CONSULTAR', tone: 'pink' },
    { label: 'Machos', value: data.machos, icon: Mars, route: '/animales?sexo=MACHO', permission: 'ANIMAL_CONSULTAR', tone: 'blue' },
    { label: 'Grupos', value: data.grupos, icon: Users, route: '/grupos', permission: 'GRUPO_CONSULTAR', tone: 'purple' },
    { label: 'Litros hoy', value: `${formatNumber(data.litros_hoy)} L`, icon: Droplets, route: '/produccion', permission: 'PRODUCCION_CONSULTAR', tone: 'cyan' },
    { label: 'Tratamientos hoy', value: data.tratamientos_hoy, icon: Syringe, route: '/sanidad', permission: 'SANIDAD_CONSULTAR', tone: 'red' },
  ];
  return <div><PageHeader title={`Hola, ${user?.nombres ?? 'bienvenido'}`} description="Este es el estado actual de tu sistema ganadero." /><div className="dashboard-grid">{cards.map(({ label, value, icon: Icon, route, permission, tone }) => { const enabled = hasPermission(permission); return <Card key={label} className={`stat-card stat-${tone} ${!enabled ? 'stat-disabled' : ''}`} onClick={enabled ? () => navigate(route) : undefined}><div className="stat-icon"><Icon size={25} /></div><div className="stat-body"><strong>{value}</strong><span>{label}</span></div>{enabled ? <ArrowRight size={19} className="stat-arrow" /> : null}</Card>; })}</div><section className="welcome-panel"><div><span className="eyebrow">M&M Ganadería</span><h2>Base nueva, servidor nuevo y datos organizados.</h2><p>Desde aquí puedes administrar animales, movimientos, sanidad, potreros, reproducción, producción, catálogos y usuarios. Los cambios se actualizan automáticamente cuando la versión de los datos cambia en el servidor.</p></div><img src="/logo-mm.png" alt="" /></section></div>;
}
