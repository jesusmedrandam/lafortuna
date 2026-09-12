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
  type LucideIcon,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { Button, Card, ErrorState, LoadingState, Modal } from '../../components/ui';
import type { DashboardSummary } from '../../types/api';
import { formatNumber } from '../../utils';

type ModuleKey = keyof DashboardSummary;
type DashboardConfiguration = Partial<Record<ModuleKey, string[]>>;

interface MetricDefinition {
  key: string;
  label: string;
  format?: 'money' | 'liters';
  default?: boolean;
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
    { key: 'ventas_animales_mes', label: 'Ventas de animales este mes', default:false }, { key: 'animales_vendidos_mes', label: 'Animales vendidos este mes', default:false }, { key: 'ventas_productos_mes', label: 'Ventas de productos este mes', default:false },
  ] },
  { key: 'produccion', label: 'Producción', description: 'Leche registrada', icon: Droplets, route: '/produccion', permission: 'PRODUCCION_CONSULTAR', tone: 'cyan', metrics: [
    { key: 'hoy', label: 'Hoy', format: 'liters' }, { key: 'semana', label: 'Esta semana', format: 'liters' }, { key: 'mes', label: 'Este mes', format: 'liters' },
    { key: 'ayer', label: 'Ayer', format:'liters', default:false }, { key: 'vacas_hoy', label: 'Vacas ordeñadas hoy', default:false }, { key: 'promedio_vaca_hoy', label: 'Promedio por vaca hoy', format:'liters', default:false }, { key: 'tanque_hoy', label: 'Tanque hoy', format:'liters', default:false },
  ] },
  { key: 'tratamientos', label: 'Tratamientos', description: 'Aplicaciones sanitarias', icon: Syringe, route: '/sanidad', permission: 'SANIDAD_CONSULTAR', tone: 'red', metrics: [
    { key: 'hoy', label: 'Hoy' }, { key: 'semana', label: 'Esta semana' }, { key: 'mes', label: 'Este mes' },
    { key: 'animales_mes', label: 'Animales tratados este mes', default:false }, { key: 'medicamentos_mes', label: 'Medicamentos usados este mes', default:false },
  ] },
  { key: 'traslados', label: 'Traslados', description: 'Movimientos completados', icon: ArrowRightLeft, route: '/movimientos', permission: 'MOVIMIENTO_CONSULTAR', tone: 'blue', metrics: [
    { key: 'semana', label: 'Esta semana' }, { key: 'mes', label: 'Este mes' }, { key: 'anio', label: 'Este año' },
    { key: 'rotaciones_mes', label: 'Rotaciones de potrero este mes', default:false }, { key: 'cambios_grupo_mes', label: 'Cambios de grupo este mes', default:false }, { key: 'propiedades_mes', label: 'Traslados de propiedad este mes', default:false }, { key: 'combinados_mes', label: 'Cambios combinados este mes', default:false }, { key: 'grupos_completos_mes', label: 'Grupos completos este mes', default:false }, { key: 'selecciones_manuales_mes', label: 'Selecciones de animales este mes', default:false }, { key: 'animales_mes', label: 'Animales trasladados este mes', default:false },
  ] },
  { key: 'potreros', label: 'Potreros', description: 'Uso de las áreas', icon: Sprout, route: '/potreros', permission: 'POTRERO_CONSULTAR', tone: 'green', metrics: [
    { key: 'total', label: 'Total' }, { key: 'ocupados', label: 'Ocupados' }, { key: 'descanso', label: 'En descanso' },
  ] },
  { key: 'reproduccion', label: 'Reproducción', description: 'Seguimiento reproductivo', icon: Baby, route: '/partos', permission: 'PARTO_CONSULTAR', tone: 'pink', metrics: [
    { key: 'celos_abiertos', label: 'Celos abiertos' }, { key: 'preneces_confirmadas', label: 'Preñeces confirmadas' }, { key: 'proximos_partos', label: 'Próximos partos' }, { key: 'partos_anio', label: 'Partos este año' },
  ] },
];

const defaultConfiguration: DashboardConfiguration = Object.fromEntries(
  modules.map((module) => [module.key, module.metrics.filter((metric)=>metric.default!==false).map((metric) => metric.key)]),
) as DashboardConfiguration;

function money(value: unknown) {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function renderValue(value: unknown, format?: MetricDefinition['format']) {
  if (format === 'money') return money(value);
  if (format === 'liters') return `${formatNumber(Number(value ?? 0))} L`;
  return formatNumber(Number(value ?? 0));
}

function DashboardModuleHeading({ module, onClick }: { module: ModuleDefinition; onClick?: () => void }) {
  const Icon = module.icon;
  const content = <>
    <span className="stat-icon"><Icon size={22} /></span>
    <span><strong>{module.label}</strong><small>{module.description}</small></span>
    <ArrowRight size={17} />
  </>;
  return onClick
    ? <button type="button" className="dashboard-module-heading dashboard-module-heading-link" onClick={onClick}>{content}</button>
    : <div className="dashboard-module-heading">{content}</div>;
}

function animalListRoute(filters: Record<string, string>) {
  return `/animales?${new URLSearchParams(filters).toString()}`;
}

function periodRoute(route: string, period: 'semana'|'mes'|'anio') {
  return `${route}?periodo=${period}`;
}

function metricRoute(module: ModuleDefinition, metricKey: string) {
  if (module.key === 'ventas' && (metricKey === 'semana' || metricKey === 'mes' || metricKey === 'anio')) return periodRoute(module.route, metricKey);
  if (module.key === 'ventas' && metricKey.includes('productos')) return '/ventas?tipo=productos&periodo=mes';
  if (module.key === 'ventas' && (metricKey.includes('animales') || metricKey === 'animales_vendidos_mes')) return '/ventas?tipo=animales&periodo=mes';
  if (module.key === 'reproduccion') {
    const tab = metricKey === 'celos_abiertos' ? 'heats' : metricKey === 'preneces_confirmadas' ? 'pregnancies' : 'births';
    return `/partos?tab=${tab}`;
  }
  return module.route;
}

function AnimalsDashboardCard({ module, values, onOpen }: {
  module: ModuleDefinition;
  values: DashboardSummary['animales'];
  onOpen: (route?: string) => void;
}) {
  const groups = values?.grupos ?? [];
  const metric = (label: string, value: unknown, route: string, highlighted = false) => <button
    type="button"
    className={`dashboard-animal-metric${highlighted ? ' highlighted' : ''}`}
    onClick={() => onOpen(route)}
    title={`Mostrar ${label.toLocaleLowerCase('es')}`}
  ><strong>{formatNumber(Number(value ?? 0))}</strong><small>{label}</small></button>;
  return <Card className="dashboard-module-card dashboard-animals-card stat-green">
    <DashboardModuleHeading module={module} onClick={() => onOpen('/animales')} />
    <div className="dashboard-feature-summary">
      {metric('Activos', values?.activos, animalListRoute({ categoria_codigo: 'TODAS', estado: 'ACTIVO' }))}
      {metric('En propiedad', values?.en_propiedad, animalListRoute({ categoria_codigo: 'EN_PROPIEDAD' }), true)}
      {metric('Fuera de p.', values?.fuera_propiedad, animalListRoute({ categoria_codigo: 'FUERA_PROPIEDAD' }))}
    </div>
    <div className="dashboard-animal-sections">
      <section>
        <h3>Grupos · propiedad principal</h3>
        <div className="dashboard-animal-metric-grid">
          {groups.length ? groups.map((group) => <span key={group.id_grupo}>{metric(group.nombre, group.total, animalListRoute({ categoria_codigo: 'EN_PROPIEDAD', id_grupo: group.id_grupo }))}</span>) : <small className="muted">No hay grupos registrados.</small>}
        </div>
      </section>
      <section>
        <h3>Clasificación</h3>
        <div className="dashboard-animal-metric-grid">
          {metric('Vacas', values?.vacas, animalListRoute({ categoria_codigo: 'EN_PROPIEDAD', clasificacion: 'VACA', propiedad_principal: 'true', estado: 'ACTIVO' }))}
          {metric('Vaconas', values?.vaconas, animalListRoute({ categoria_codigo: 'EN_PROPIEDAD', clasificacion: 'VACONA', propiedad_principal: 'true', estado: 'ACTIVO' }))}
          {metric('Terneras', values?.terneras, animalListRoute({ categoria_codigo: 'EN_PROPIEDAD', clasificacion: 'TERNERA', propiedad_principal: 'true', estado: 'ACTIVO' }))}
          {metric('Toros', values?.toros, animalListRoute({ categoria_codigo: 'EN_PROPIEDAD', clasificacion: 'TORO', propiedad_principal: 'true', estado: 'ACTIVO' }))}
          {metric('Toretes', values?.toretes, animalListRoute({ categoria_codigo: 'EN_PROPIEDAD', clasificacion: 'TORETE', propiedad_principal: 'true', estado: 'ACTIVO' }))}
          {metric('Terneros', values?.terneros, animalListRoute({ categoria_codigo: 'EN_PROPIEDAD', clasificacion: 'TERNERO', propiedad_principal: 'true', estado: 'ACTIVO' }))}
        </div>
      </section>
      <section>
        <h3>Sexo</h3>
        <div className="dashboard-animal-metric-grid">
          {metric('Hembras', values?.hembras, animalListRoute({ categoria_codigo: 'EN_PROPIEDAD', sexo: 'HEMBRA', propiedad_principal: 'true', estado: 'ACTIVO' }))}
          {metric('Machos', values?.machos, animalListRoute({ categoria_codigo: 'EN_PROPIEDAD', sexo: 'MACHO', propiedad_principal: 'true', estado: 'ACTIVO' }))}
        </div>
      </section>
    </div>
  </Card>;
}

function IncomeDashboardCard({ module, values, onOpen }: {
  module: ModuleDefinition;
  values: DashboardSummary['ingresos'];
  onOpen: (route?: string) => void;
}) {
  const concepts = (values?.conceptos ?? []).filter((concept) => Number(concept.semana) > 0 || Number(concept.mes) > 0 || Number(concept.anio ?? concept.total) > 0);
  const conceptRoute = (code: string, period: 'semana'|'mes'|'anio') => {
    const normalized = code.toLocaleUpperCase('es');
    const type = normalized.includes('PRODUCT') || normalized.includes('LECHE') || normalized.includes('QUESO') ? 'productos' : 'animales';
    return `/ventas?tipo=${type}&periodo=${period}`;
  };
  return <Card className="dashboard-module-card dashboard-income-card stat-lime" onClick={() => onOpen()}>
    <DashboardModuleHeading module={module} onClick={() => onOpen()} />
    <div className="dashboard-income-periods">
      <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(periodRoute(module.route, 'semana')); }}><strong>{money(values?.semana)}</strong><small>Esta semana</small></button>
      <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(periodRoute(module.route, 'mes')); }}><strong>{money(values?.mes)}</strong><small>Este mes</small></button>
      <button type="button" className="highlighted" onClick={(event) => { event.stopPropagation(); onOpen(periodRoute(module.route, 'anio')); }}><strong>{money(values?.anio)}</strong><small>Este año</small></button>
    </div>
    <h3 className="dashboard-income-caption">Por concepto</h3>
    <div className="dashboard-income-concepts">
      {concepts.length ? concepts.map((concept) => <section key={concept.codigo} className="dashboard-income-concept"><strong>{concept.nombre}</strong><div><button type="button" onClick={(event) => { event.stopPropagation(); onOpen(conceptRoute(concept.codigo, 'semana')); }}><small>Semana</small><span>{money(concept.semana)}</span></button><button type="button" onClick={(event) => { event.stopPropagation(); onOpen(conceptRoute(concept.codigo, 'mes')); }}><small>Mes</small><span>{money(concept.mes)}</span></button><button type="button" onClick={(event) => { event.stopPropagation(); onOpen(conceptRoute(concept.codigo, 'anio')); }}><small>Año</small><span>{money(concept.anio ?? concept.total)}</span></button></div></section>) : <small className="muted">Aún no hay ingresos registrados.</small>}
    </div>
  </Card>;
}

function sanitizeConfiguration(value: DashboardConfiguration): DashboardConfiguration {
  return Object.fromEntries(modules.flatMap((module)=>{
    const allowed=new Set(module.metrics.map((metric)=>metric.key));
    const selected=(value[module.key]??[]).map((key)=>module.key==='reproduccion'&&key==='partos_mes'?'partos_anio':key).filter((key)=>allowed.has(key));
    return selected.length?[[module.key,[...new Set(selected)]]]:[];
  })) as DashboardConfiguration;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const client = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<DashboardConfiguration>({});
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => apiRequest<DashboardSummary>('/dashboard/resumen'), staleTime: 60_000 });
  const preferences = useQuery({ queryKey: ['dashboard', 'preferences'], queryFn: () => apiRequest<{ configuracion: DashboardConfiguration | null }>('/dashboard/preferencias') });
  const allowedModules = useMemo(() => modules.filter((module) => hasPermission(module.permission)), [hasPermission]);
  const savedConfiguration = preferences.data?.configuracion;
  const currentConfiguration = useMemo(() => savedConfiguration ? sanitizeConfiguration(savedConfiguration) : defaultConfiguration, [savedConfiguration]);
  const visibleModules = allowedModules.filter((module) => (currentConfiguration[module.key]?.length ?? 0) > 0);

  useEffect(() => {
    if (settingsOpen) setDraft(structuredClone(currentConfiguration));
  // currentConfiguration es derivada y solo se copia al abrir el modal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen]);

  useEffect(() => {
    if (searchParams.get('ajustes_panel') !== '1') return;
    setSettingsOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('ajustes_panel');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

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
    else next[module.key] = module.metrics.filter((metric)=>metric.default!==false).map((metric) => metric.key);
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

  return <div className="module-no-header">
    {visibleModules.length ? <div className="dashboard-module-grid">
      {visibleModules.map((module) => {
        const values = query.data?.[module.key] as unknown as Record<string, unknown>;
        const selectedMetrics = module.metrics.filter((metric) => currentConfiguration[module.key]?.includes(metric.key));
        if (module.key === 'animales') return <AnimalsDashboardCard key={module.key} module={module} values={query.data!.animales} onOpen={(route) => navigate(route ?? module.route)} />;
        if (module.key === 'ingresos') return <IncomeDashboardCard key={module.key} module={module} values={query.data!.ingresos} onOpen={(route) => navigate(route ?? module.route)} />;
        return <Card key={module.key} className={`dashboard-module-card stat-${module.tone}`} onClick={() => navigate(module.route)}>
          <DashboardModuleHeading module={module} onClick={() => navigate(module.route)} />
          <div className={`dashboard-module-metrics metrics-${Math.min(selectedMetrics.length, 4)}`}>
            {selectedMetrics.map((metric) => { const value=metric.key==='partos_anio'?(values?.partos_anio??values?.partos_mes):values?.[metric.key]; return <button type="button" key={metric.key} onClick={(event) => { event.stopPropagation(); navigate(metricRoute(module, metric.key)); }}><strong>{renderValue(value, metric.format)}</strong><small>{metric.label}</small></button>; })}
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
