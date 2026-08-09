import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Baby, Beef, CircleDollarSign, Droplets, Mars, Settings2, ShoppingCart, Sprout, Syringe, Users, Venus, WalletCards } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { Button, Card, ErrorState, IconButton, LoadingState, Modal, PageHeader } from '../../components/ui';
import type { DashboardSummary } from '../../types/api';
import { formatNumber } from '../../utils';

function money(value: string | number) {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value));
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { hasPermission, user } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => apiRequest<DashboardSummary>('/dashboard/resumen'), staleTime: 60_000 });
  const preferences = useQuery({ queryKey: ['dashboard', 'preferences'], queryFn: () => apiRequest<{ tarjetas: string[] | null }>('/dashboard/preferencias') });
  const data = query.data;
  const cards = data ? [
    { key: 'ingresos_hoy', label: 'Ingresos hoy', value: money(data.ingresos_hoy), icon: CircleDollarSign, route: '/ventas', permission: 'VENTA_CONSULTAR', tone: 'green' },
    { key: 'ingresos_mes', label: 'Ingresos del mes', value: money(data.ingresos_mes), icon: WalletCards, route: '/ventas', permission: 'VENTA_CONSULTAR', tone: 'lime' },
    { key: 'ventas_mes', label: 'Ventas del mes', value: data.ventas_mes, icon: ShoppingCart, route: '/ventas', permission: 'VENTA_CONSULTAR', tone: 'orange' },
    { key: 'proximos_partos', label: 'Próximos partos', value: data.proximos_partos, icon: Baby, route: '/partos', permission: 'PARTO_CONSULTAR', tone: 'pink' },
    { key: 'potreros_ocupados', label: 'Potreros ocupados', value: data.potreros_ocupados, icon: Sprout, route: '/potreros', permission: 'POTRERO_CONSULTAR', tone: 'cyan' },
    { key: 'animales_total', label: 'Animales', value: data.animales_total, icon: Beef, route: '/animales', permission: 'ANIMAL_CONSULTAR', tone: 'green' },
    { key: 'animales_activos', label: 'Animales activos', value: data.animales_activos, icon: Beef, route: '/animales?estado=ACTIVO', permission: 'ANIMAL_CONSULTAR', tone: 'lime' },
    { key: 'hembras', label: 'Hembras', value: data.hembras, icon: Venus, route: '/animales?sexo=HEMBRA', permission: 'ANIMAL_CONSULTAR', tone: 'pink' },
    { key: 'machos', label: 'Machos', value: data.machos, icon: Mars, route: '/animales?sexo=MACHO', permission: 'ANIMAL_CONSULTAR', tone: 'blue' },
    { key: 'grupos', label: 'Grupos', value: data.grupos, icon: Users, route: '/grupos', permission: 'GRUPO_CONSULTAR', tone: 'purple' },
    { key: 'litros_hoy', label: 'Litros hoy', value: `${formatNumber(data.litros_hoy)} L`, icon: Droplets, route: '/produccion', permission: 'PRODUCCION_CONSULTAR', tone: 'cyan' },
    { key: 'tratamientos_hoy', label: 'Tratamientos hoy', value: data.tratamientos_hoy, icon: Syringe, route: '/sanidad', permission: 'SANIDAD_CONSULTAR', tone: 'red' },
  ] : [];
  const allowedCards = cards.filter((card) => hasPermission(card.permission));
  const saved = preferences.data?.tarjetas;
  const visibleKeys = saved === null || saved === undefined ? allowedCards.map((card) => card.key) : saved;
  const visibleCards = allowedCards.filter((card) => visibleKeys.includes(card.key));

  useEffect(() => {
    if (settingsOpen) setDraft(visibleKeys);
  // visibleKeys se deriva de consultas y solo debe copiarse al abrir el modal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen]);

  const save = useMutation({
    mutationFn: () => apiRequest('/dashboard/preferencias', { method: 'PATCH', body: { tarjetas: draft } }),
    onSuccess: () => { toast.show('Panel personalizado.'); setSettingsOpen(false); void client.invalidateQueries({ queryKey: ['dashboard', 'preferences'] }); },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  if (query.isLoading) return <LoadingState text="Preparando el resumen de la finca…" />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />;

  return <div>
    <PageHeader title={`Hola, ${user?.nombres ?? 'bienvenido'}`} description="Resumen operativo y financiero de la finca." action={<IconButton label="Personalizar panel" onClick={() => setSettingsOpen(true)}><Settings2 size={20} /></IconButton>} />
    {visibleCards.length ? <div className="dashboard-grid">{visibleCards.map(({ key, label, value, icon: Icon, route, tone }) => <Card key={key} className={`stat-card stat-${tone}`} onClick={() => navigate(route)}><div className="stat-icon"><Icon size={23} /></div><div className="stat-body"><strong>{value}</strong><span>{label}</span></div><ArrowRight size={17} className="stat-arrow" /></Card>)}</div> : <Card className="dashboard-empty-custom"><Settings2 size={26} /><strong>Tu panel no tiene tarjetas visibles.</strong><Button variant="secondary" onClick={() => setSettingsOpen(true)}>Elegir tarjetas</Button></Card>}
    {settingsOpen ? <Modal title="Personalizar panel" onClose={() => setSettingsOpen(false)} footer={<><Button variant="ghost" onClick={() => setSettingsOpen(false)}>Cancelar</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}><p className="muted">Selecciona únicamente la información que deseas ver al iniciar sesión.</p><div className="dashboard-choice-list">{allowedCards.map((card) => <label key={card.key}><input type="checkbox" checked={draft.includes(card.key)} onChange={() => setDraft((current) => current.includes(card.key) ? current.filter((key) => key !== card.key) : [...current, card.key])} /><card.icon size={18} /><span>{card.label}</span></label>)}</div></Modal> : null}
  </div>;
}
