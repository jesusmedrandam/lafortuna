import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowRightLeft,
  Baby,
  Beef,
  CircleDollarSign,
  Droplets,
  Settings2,
  ShoppingCart,
  Sprout,
  Syringe,
  Users,
  Venus,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { Button, Card, ErrorState, IconButton, LoadingState, Modal } from '../../components/ui';
import type { DashboardSummary } from '../../types/api';
import { formatNumber } from '../../utils';

type ModuleKey = keyof DashboardSummary;
type DashboardConfiguration = Partial<Record<ModuleKey, string[]>>;

interface MetricDefinition {
  key: string;
  label: string;
  format?: 'money' | 'liters';
}

interface ModuleDefinition {
  key: ModuleKey;
  label: string;
  description: string;
  icon: LucideIcon;
  route: string;
  permission: string;
  tone: string;
  metrics: MetricDefinition[];
}

const modules: ModuleDefinition[] = [
  { key: 'animales', label: 'Animales', description: 'Inventario general', icon: Beef, route: '/animales', permission: 'ANIMAL_CONSULTAR', tone: 'green', metrics: [
    { key: 'en_propiedad', label: 'En propiedad' }, { key: 'fuera_propiedad', label: 'Fuera de propiedad' }, { key: 'activos', label: 'Activos' }, { key: 'inactivos', label: 'No activos' },
  ] },
  { key: 'ingresos', label: 'Ingresos', description: 'Totales facturados', icon: CircleDollarSign, route: '/ventas', permission: 'VENTA_CONSULTAR', tone: 'lime', metrics: [
    { key: 'semana', label: 'Esta semana', format: 'money' }, { key: 'mes', label: 'Este mes', format: 'money' }, { key: 'anio', label: 'Este año', format: 'money' },
  ] },
  { key: 'egresos', label: 'Egresos', description: 'Compras registradas', icon: CircleDollarSign, route: '/compras', permission: 'COMPRA_CONSULTAR', tone: 'red', metrics: [
    { key: 'semana', label: 'Esta semana', format: 'money' }, { key: 'mes', label: 'Este mes', format: 'money' }, { key: 'anio', label: 'Este año', format: 'money' },
  ] },
  { key: 'ventas', label: 'Ventas', description: 'Operaciones completadas', icon: ShoppingCart, route: '/ventas', permission: 'VENTA_CONSULTAR', tone: 'orange', metrics: [
    { key: 'semana', label: 'Esta semana' }, { key: 'mes', label: 'Este mes' }, { key: 'anio', label: 'Este año' },
  ] },
  { key: 'produccion', label: 'Producción', description: 'Leche registrada', icon: Droplets, route: '/produccion', permission: 'PRODUCCION_CONSULTAR', tone: 'cyan', metrics: [
    { key: 'hoy', label: 'Hoy', format: 'liters' }, { key: 'semana', label: 'Esta semana', format: 'liters' }, { key: 'mes', label: 'Este mes', format: 'liters' },
  ] },
  { key: 'tratamientos', label: 'Tratamientos', description: 'Aplicaciones sanitarias', icon: Syringe, route: '/sanidad', permission: 'SANIDAD_CONSULTAR', tone: 'red', metrics: [
    { key: 'hoy', label: 'Hoy' }, { key: 'semana', label: 'Esta semana' }, { key: 'mes', label: 'Este mes' },
  ] },
  { key: 'traslados', label: 'Traslados', description: 'Movimientos completados', icon: ArrowRightLeft, route: '/movimientos', permission: 'MOVIMIENTO_CONSULTAR', tone: 'blue', metrics: [
    { key: 'semana', label: 'Esta semana' }, { key: 'mes', label: 'Este mes' }, { key: 'anio', label: 'Este año' },
  ] },
  { key: 'potreros', label: 'Potreros', description: 'Uso de las áreas', icon: Sprout, route: '/potreros', permission: 'POTRERO_CONSULTAR', tone: 'green', metrics: [
    { key: 'total', label: 'Total' }, { key: 'ocupados', label: 'Ocupados' }, { key: 'descanso', label: 'En descanso' },
  ] },
  { key: 'grupos', label: 'Grupos', description: 'Organización del hato', icon: Users, route: '/grupos', permission: 'GRUPO_CONSULTAR', tone: 'purple', metrics: [
    { key: 'total', label: 'Total' }, { key: 'con_animales', label: 'Con animales' }, { key: 'animales_agrupados', label: 'Animales agrupados' },
  ] },
  { key: 'reproduccion', label: 'Reproducción', description: 'Seguimiento reproductivo', icon: Baby, route: '/partos', permission: 'PARTO_CONSULTAR', tone: 'pink', metrics: [
    { key: 'celos_abiertos', label: 'Celos abiertos' }, { key: 'preneces_confirmadas', label: 'Preñeces confirmadas' }, { key: 'proximos_partos', label: 'Próximos partos' }, { key: 'partos_mes', label: 'Partos este mes' },
  ] },
  { key: 'sexo', label: 'Sexo', description: 'Distribución de animales activos', icon: Venus, route: '/animales', permission: 'ANIMAL_CONSULTAR', tone: 'pink', metrics: [
    { key: 'hembras', label: 'Hembras' }, { key: 'machos', label: 'Machos' },
  ] },
];

const defaultConfiguration: DashboardConfiguration = Object.fromEntries(
  modules.map((module) => [module.key, module.metrics.map((metric) => metric.key)]),
) as DashboardConfiguration;

function money(value: unknown) {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function renderValue(value: unknown, format?: MetricDefinition['format']) {
  if (format === 'money') return money(value);
  if (format === 'liters') return `${formatNumber(Number(value ?? 0))} L`;
  return formatNumber(Number(value ?? 0));
}

function DashboardModuleHeading({ module }: { module: ModuleDefinition }) {
  const Icon = module.icon;
  return <div className="dashboard-module-heading">
    <span className="stat-icon"><Icon size={22} /></span>
    <span><strong>{module.label}</strong><small>{module.description}</small></span>
    <ArrowRight size={17} />
  </div>;
}

function AnimalsDashboardCard({ module, values, onOpen }: {
  module: ModuleDefinition;
  values: DashboardSummary['animales'];
  onOpen: () => void;
}) {
  const groups = values?.grupos ?? [];
  return <Card className="dashboard-module-card dashboard-animals-card stat-green" onClick={onOpen}>
    <DashboardModuleHeading module={module} />
    <div className="dashboard-feature-summary">
      <span><strong>{formatNumber(values?.activos ?? 0)}</strong><small>Animales activos</small></span>
      <span><strong>{formatNumber(values?.principal_total ?? 0)}</strong><small>Propiedad principal</small></span>
      <span><strong>{formatNumber(values?.fuera_propiedad ?? 0)}</strong><small>Fuera de propiedad</small></span>
      <span><strong>{formatNumber(values?.inactivos ?? 0)}</strong><small>No activos</small></span>
    </div>
    <div className="dashboard-animal-sections">
      <section>
        <h3>Grupos · propiedad principal</h3>
        <div className="dashboard-flat-counts">
          {groups.length ? groups.map((group) => <span key={group.id_grupo}><small>{group.nombre}</small><strong>{formatNumber(group.total)}</strong></span>) : <small className="muted">No hay grupos registrados.</small>}
        </div>
      </section>
      <section>
        <h3>Clasificación</h3>
        <div className="dashboard-flat-counts">
          <span><small>Vacas</small><strong>{formatNumber(values?.vacas ?? 0)}</strong></span>
          <span><small>Vaconas</small><strong>{formatNumber(values?.vaconas ?? 0)}</strong></span>
          <span><small>Terneros</small><strong>{formatNumber(values?.terneros ?? 0)}</strong></span>
        </div>
      </section>
      <section>
        <h3>Sexo</h3>
        <div className="dashboard-flat-counts">
          <span><small>Hembras</small><strong>{formatNumber(values?.hembras ?? 0)}</strong></span>
          <span><small>Machos</small><strong>{formatNumber(values?.machos ?? 0)}</strong></span>
        </div>
      </section>
    </div>
  </Card>;
}

function IncomeDashboardCard({ module, values, onOpen }: {
  module: ModuleDefinition;
  values: DashboardSummary['ingresos'];
  onOpen: () => void;
}) {
  const concepts = (values?.conceptos ?? []).filter((concept) => Number(concept.total) > 0);
  return <Card className="dashboard-module-card dashboard-income-card stat-lime" onClick={onOpen}>
    <DashboardModuleHeading module={module} />
    <div className="dashboard-income-total"><small>Total del año</small><strong>{money(values?.anio)}</strong></div>
    <div className="dashboard-income-concepts">
      {concepts.length ? concepts.map((concept) => <span key={concept.codigo}><small>{concept.nombre}</small><strong>{money(concept.total)}</strong></span>) : <small className="muted">Aún no hay ingresos registrados este año.</small>}
    </div>
  </Card>;
}

function sanitizeConfiguration(value: DashboardConfiguration): DashboardConfiguration {
  return Object.fromEntries(modules.flatMap((module)=>{
    const allowed=new Set(module.metrics.map((metric)=>metric.key));
    const selected=(value[module.key]??[]).filter((key)=>allowed.has(key));
    return selected.length?[[module.key,[...new Set(selected)]]]:[];
  })) as DashboardConfiguration;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { hasPermission, user } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<DashboardConfiguration>({});
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => apiRequest<DashboardSummary>('/dashboard/resumen'), staleTime: 60_000 });
  const preferences = useQuery({ queryKey: ['dashboard', 'preferences'], queryFn: () => apiRequest<{ configuracion: DashboardConfiguration | null }>('/dashboard/preferencias') });
  const allowedModules = useMemo(() => modules.filter((module) => hasPermission(module.permission)), [hasPermission]);
  const savedConfiguration = preferences.data?.configuracion;
  const currentConfiguration = savedConfiguration ?? defaultConfiguration;
  const visibleModules = allowedModules.filter((module) => (currentConfiguration[module.key]?.length ?? 0) > 0);

  useEffect(() => {
    if (settingsOpen) setDraft(structuredClone(currentConfiguration));
  // currentConfiguration es derivada y solo se copia al abrir el modal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen]);

  const save = useMutation({
    mutationFn: () => apiRequest('/dashboard/preferencias', { method: 'PATCH', body: { configuracion: sanitizeConfiguration(draft) } }),
    onSuccess: () => {
      toast.show('Panel personalizado.');
      setSettingsOpen(false);
      void client.invalidateQueries({ queryKey: ['dashboard', 'preferences'] });
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const toggleModule = (module: ModuleDefinition) => setDraft((current) => {
    const next = { ...current };
    if ((next[module.key]?.length ?? 0) > 0) delete next[module.key];
    else next[module.key] = module.metrics.map((metric) => metric.key);
    return next;
  });

  const toggleMetric = (module: ModuleDefinition, metricKey: string) => setDraft((current) => {
    const selected = current[module.key] ?? [];
    return {
      ...current,
      [module.key]: selected.includes(metricKey) ? selected.filter((key) => key !== metricKey) : [...selected, metricKey],
    };
  });

  if (query.isLoading) return <LoadingState text="Preparando el resumen de la finca…" />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />;

  return <div>
    <div className="dashboard-home-header">
      <div><span className="eyebrow">Panel principal</span><h1>Hola, {user?.nombres ?? 'bienvenido'}</h1><p>Resumen operativo y financiero de la finca.</p></div>
      <img src="/branding/logo-sgb-full.png" alt="Sistema de Gestión Bovina" />
      <IconButton label="Personalizar panel" onClick={() => setSettingsOpen(true)}><Settings2 size={20} /></IconButton>
    </div>

    {visibleModules.length ? <div className="dashboard-module-grid">
      {visibleModules.map((module) => {
        const values = query.data?.[module.key] as unknown as Record<string, unknown>;
        const selectedMetrics = module.metrics.filter((metric) => currentConfiguration[module.key]?.includes(metric.key));
        if (module.key === 'animales') return <AnimalsDashboardCard key={module.key} module={module} values={query.data!.animales} onOpen={() => navigate(module.route)} />;
        if (module.key === 'ingresos') return <IncomeDashboardCard key={module.key} module={module} values={query.data!.ingresos} onOpen={() => navigate(module.route)} />;
        return <Card key={module.key} className={`dashboard-module-card stat-${module.tone}`} onClick={() => navigate(module.route)}>
          <DashboardModuleHeading module={module} />
          <div className={`dashboard-module-metrics metrics-${Math.min(selectedMetrics.length, 4)}`}>
            {selectedMetrics.map((metric) => <span key={metric.key}><strong>{renderValue(values?.[metric.key], metric.format)}</strong><small>{metric.label}</small></span>)}
          </div>
        </Card>;
      })}
    </div> : <Card className="dashboard-empty-custom"><Settings2 size={26} /><strong>Tu panel no tiene tarjetas visibles.</strong><Button variant="secondary" onClick={() => setSettingsOpen(true)}>Elegir tarjetas</Button></Card>}

    {settingsOpen ? <Modal
      wide
      title="Personalizar panel"
      onClose={() => setSettingsOpen(false)}
      footer={<><Button variant="ghost" onClick={() => setSettingsOpen(false)}>Cancelar</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}
    >
      <p className="muted">Elige las tarjetas y, dentro de cada una, los datos que deseas ver al iniciar sesión.</p>
      <div className="dashboard-config-list">
        {allowedModules.map((module) => {
          const Icon = module.icon;
          const enabled = (draft[module.key]?.length ?? 0) > 0;
          return <section key={module.key} className={enabled ? 'enabled' : ''}>
            <label className="dashboard-config-module">
              <input type="checkbox" checked={enabled} onChange={() => toggleModule(module)} />
              <span className="stat-icon"><Icon size={19} /></span>
              <span><strong>{module.label}</strong><small>{module.description}</small></span>
            </label>
            <div className="dashboard-config-metrics">
              {module.metrics.map((metric) => <label key={metric.key}><input type="checkbox" disabled={!enabled} checked={draft[module.key]?.includes(metric.key) ?? false} onChange={() => toggleMetric(module, metric.key)} /><span>{metric.label}</span></label>)}
            </div>
          </section>;
        })}
      </div>
    </Modal> : null}
  </div>;
}
