import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, Baby, Beef, Bell, BookOpen, ChevronRight, ClipboardList, Download,
  Droplets, ExternalLink, LayoutDashboard, Link2, Milk, Moon, Palette, RotateCcw, Save, Settings2,
  ShieldAlert, ShieldCheck, ShoppingCart, Sprout, Sun, Syringe, Tag, UserCircle,
  Trash2, UserCog, Users, Weight,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastContext';
import { AppUpdatePanel } from '../../components/AppUpdatePrompt';
import { useTheme } from '../../theme/ThemeContext';
import { formatDate } from '../../utils';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState,
  PageHeader, Select,
} from '../../components/ui';

type SettingsSection = 'inicio' | 'notificaciones' | 'apariencia' | 'finca' | 'operaciones' | 'enlaces' | 'actualizacion';
type NotificationMode = 'PUSH_BUZON' | 'SOLO_BUZON' | 'DESACTIVADAS';

interface OperationProperty { id_propiedad: string; codigo: string | null; nombre: string; es_principal: boolean }
interface AnimalOperation { codigo: string; nombre: string; grupo: string }
interface OperationSetting { id_propiedad: string; codigo_operacion: string; permitido: boolean }
interface OperationPolicyData { propiedades: OperationProperty[]; operaciones: AnimalOperation[]; configuracion: OperationSetting[] }

interface NotificationPreference {
  categoria: string;
  mostrar_en_buzon: boolean;
  enviar_push: boolean;
}

interface FarmConfiguration {
  id_propiedad: string;
  codigo: string | null;
  nombre: string;
  es_principal: boolean;
  activa: boolean;
  alertas_garrapata: boolean;
  inicio_eclosion_dias: number;
  descanso_minimo_dias: number;
  riesgo_reducido_dias: number;
  dias_posparto_para_celo:number;
  dias_posparto_para_prenez:number;
  dias_posaborto_para_celo:number;
  dias_posaborto_para_prenez:number;
  edad_minima_celo_meses:number;
  edad_minima_padre_meses:number;
  edad_vacona_meses:number;
  edad_torete_meses:number;
  permitir_segundo_celo:boolean;
  permitir_celo_falso_en_prenez:boolean;
  usar_ultimo_celo_valido:boolean;
  dias_maximos_ordeno_posparto:number;
  updated_at: string | null;
}

interface FarmConfigurationResponse { propiedades: FarmConfiguration[] }
interface PublicAnimalLink { id_animal_compartido:string;id_animal:string;animal:string;codigo_arete:string|null;url:string;created_at:string;creado_por:string }

interface SettingsCardDefinition {
  label: string;
  description: string;
  icon: LucideIcon;
  action: () => void;
}

const notificationDefinitions: Array<{
  categoria: string;
  nombre: string;
  descripcion: string;
  icon: LucideIcon;
}> = [
  { categoria: 'ANIMALES', nombre: 'Animales', descripcion: 'Muertes, bajas y novedades generales.', icon: Beef },
  { categoria: 'MOVIMIENTOS', nombre: 'Movimientos', descripcion: 'Cambios de grupo, potrero o propiedad.', icon: Users },
  { categoria: 'PESAJES', nombre: 'Pesajes', descripcion: 'Nuevos controles de peso.', icon: Weight },
  { categoria: 'SANIDAD', nombre: 'Sanidad y garrapatas', descripcion: 'Condiciones, tratamientos y riesgos sanitarios.', icon: Syringe },
  { categoria: 'PRODUCCION', nombre: 'Producción', descripcion: 'Producción de leche y variaciones importantes.', icon: Milk },
  { categoria: 'REPRODUCCION', nombre: 'Reproducción', descripcion: 'Celos, preñeces, partos y abortos.', icon: Baby },
  { categoria: 'MANTENIMIENTO', nombre: 'Potreros y limpieza', descripcion: 'Limpiezas registradas y mantenimientos vencidos.', icon: Droplets },
  { categoria: 'ACTIVIDADES', nombre: 'Otras actividades', descripcion: 'Actividades aplicadas a los animales.', icon: Activity },
  { categoria: 'VENTAS', nombre: 'Ventas', descripcion: 'Ventas de animales y productos.', icon: ShoppingCart },
  { categoria: 'COMPRAS', nombre: 'Compras y egresos', descripcion: 'Compras y gastos registrados.', icon: ShoppingCart },
  { categoria: 'SISTEMA', nombre: 'Sistema', descripcion: 'Pruebas, sincronización y avisos técnicos.', icon: ShieldAlert },
];

function settingKey(propertyId: string, operationCode: string) {
  return `${propertyId}:${operationCode}`;
}

function notificationMode(preference: NotificationPreference): NotificationMode {
  if (!preference.mostrar_en_buzon && !preference.enviar_push) return 'DESACTIVADAS';
  if (!preference.enviar_push) return 'SOLO_BUZON';
  return 'PUSH_BUZON';
}

function notificationValues(categoria: string, mode: NotificationMode): NotificationPreference {
  return {
    categoria,
    mostrar_en_buzon: mode !== 'DESACTIVADAS',
    enviar_push: mode === 'PUSH_BUZON',
  };
}

function sectionFrom(value: string | null): SettingsSection {
  return value === 'notificaciones' || value === 'apariencia' || value === 'finca' || value === 'operaciones' || value === 'enlaces' || value === 'actualizacion' ? value : 'inicio';
}

export function SettingsPage() {
  const { hasPermission,user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const {theme,setTheme,appearance,setAppearance,resetAppearance}=useTheme();
  const client = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = sectionFrom(searchParams.get('seccion'));
  const canViewAdministration = hasPermission('CATALOGO_CONSULTAR');
  const canEditAdministration = hasPermission('CATALOGO_ADMINISTRAR');
  const isAdministrator=Boolean(user?.roles.includes('ADMINISTRADOR'));

  const publicLinks=useQuery({queryKey:['public-animal-links'],queryFn:()=>apiRequest<PublicAnimalLink[]>('/animales/enlaces-publicos'),enabled:section==='enlaces'&&isAdministrator});
  const revokePublicLink=useMutation({mutationFn:(id:string)=>apiRequest(`/animales/enlaces-publicos/${id}`,{method:'DELETE'}),onSuccess:async()=>{toast.show('Enlace público desactivado.');await client.invalidateQueries({queryKey:['public-animal-links']});},onError:(error)=>toast.show((error as ApiError).message,'error')});

  const [notificationDraft, setNotificationDraft] = useState<NotificationPreference[]>([]);
  const notificationQuery = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => apiRequest<NotificationPreference[]>('/notificaciones/preferencias'),
    enabled: section === 'notificaciones',
  });
  useEffect(() => {
    if (notificationQuery.data) setNotificationDraft(notificationQuery.data);
  }, [notificationQuery.data]);
  const saveNotifications = useMutation({
    mutationFn: () => apiRequest('/notificaciones/preferencias', {
      method: 'PUT', body: { preferencias: notificationDraft },
    }),
    onSuccess: async () => {
      toast.show('Preferencias de notificaciones actualizadas.');
      await client.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const farmQuery = useQuery({
    queryKey: ['farm-configuration'],
    queryFn: () => apiRequest<FarmConfigurationResponse>('/configuracion/finca'),
    enabled: section === 'finca' && canViewAdministration,
  });
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [farmDraft, setFarmDraft] = useState<FarmConfiguration | null>(null);
  useEffect(() => {
    if (!farmQuery.data?.propiedades.length) return;
    const selected = farmQuery.data.propiedades.find(item => item.id_propiedad === selectedPropertyId)
      ?? farmQuery.data.propiedades[0];
    if (selectedPropertyId !== selected.id_propiedad) setSelectedPropertyId(selected.id_propiedad);
    setFarmDraft({ ...selected,edad_vacona_meses:selected.edad_vacona_meses??12,edad_torete_meses:selected.edad_torete_meses??12 });
  }, [farmQuery.data, selectedPropertyId]);
  const saveFarm = useMutation({
    mutationFn: async () => {
      if (!farmDraft) throw new Error('Selecciona una propiedad.');
      await Promise.all([apiRequest(`/configuracion/finca/${farmDraft.id_propiedad}/alertas-garrapata`, {
        method: 'PUT',
        body: {
          alertas_garrapata: farmDraft.alertas_garrapata,
          inicio_eclosion_dias: farmDraft.inicio_eclosion_dias,
          descanso_minimo_dias: farmDraft.descanso_minimo_dias,
          riesgo_reducido_dias: farmDraft.riesgo_reducido_dias,
        },
      }),apiRequest(`/configuracion/finca/${farmDraft.id_propiedad}/reglas-reproduccion`,{method:'PUT',body:{
        dias_posparto_para_celo:farmDraft.dias_posparto_para_celo,
        dias_posparto_para_prenez:farmDraft.dias_posparto_para_prenez,
        dias_posaborto_para_celo:farmDraft.dias_posaborto_para_celo,
        dias_posaborto_para_prenez:farmDraft.dias_posaborto_para_prenez,
        edad_minima_celo_meses:farmDraft.edad_minima_celo_meses,
        edad_minima_padre_meses:farmDraft.edad_minima_padre_meses,
        edad_vacona_meses:farmDraft.edad_vacona_meses,
        edad_torete_meses:farmDraft.edad_torete_meses,
        permitir_segundo_celo:farmDraft.permitir_segundo_celo,
        permitir_celo_falso_en_prenez:farmDraft.permitir_celo_falso_en_prenez,
        usar_ultimo_celo_valido:farmDraft.usar_ultimo_celo_valido,
        dias_maximos_ordeno_posparto:farmDraft.dias_maximos_ordeno_posparto,
      }}),]);
    },
    onSuccess: async () => {
      toast.show('Reglas sanitarias y reproductivas actualizadas.');
      await client.invalidateQueries({ queryKey: ['farm-configuration'] });
    },
    onError: (error) => toast.show((error as Error).message, 'error'),
  });
  const farmValuesValid = Boolean(farmDraft
    && farmDraft.inicio_eclosion_dias < farmDraft.descanso_minimo_dias
    && farmDraft.descanso_minimo_dias < farmDraft.riesgo_reducido_dias);

  const [operationDraft, setOperationDraft] = useState<Record<string, boolean>>({});
  const [selectedOperationPropertyId,setSelectedOperationPropertyId]=useState('');
  const operationQuery = useQuery({
    queryKey: ['animal-operation-policy'],
    queryFn: () => apiRequest<OperationPolicyData>('/configuracion/operaciones-animales'),
    enabled: section === 'operaciones' && canViewAdministration,
  });
  useEffect(() => {
    if (!operationQuery.data) return;
    const next: Record<string, boolean> = {};
    setSelectedOperationPropertyId(current=>operationQuery.data!.propiedades.some(item=>item.id_propiedad===current)?current:operationQuery.data!.propiedades[0]?.id_propiedad??'');
    for (const property of operationQuery.data.propiedades) {
      for (const operation of operationQuery.data.operaciones) {
        const current = operationQuery.data.configuracion.find(item => item.id_propiedad === property.id_propiedad && item.codigo_operacion === operation.codigo);
        next[settingKey(property.id_propiedad, operation.codigo)] = current?.permitido ?? true;
      }
    }
    setOperationDraft(next);
  }, [operationQuery.data]);
  const groupedOperations = useMemo(() => {
    const groups = new Map<string, AnimalOperation[]>();
    for (const operation of operationQuery.data?.operaciones ?? []) {
      groups.set(operation.grupo, [...(groups.get(operation.grupo) ?? []), operation]);
    }
    return [...groups.entries()];
  }, [operationQuery.data]);
  const saveOperations = useMutation({
    mutationFn: () => apiRequest('/configuracion/operaciones-animales', {
      method: 'PUT',
      body: {
        configuracion: (operationQuery.data?.propiedades ?? []).flatMap(property => (operationQuery.data?.operaciones ?? []).map(operation => ({
          id_propiedad: property.id_propiedad,
          codigo_operacion: operation.codigo,
          permitido: operationDraft[settingKey(property.id_propiedad, operation.codigo)] ?? true,
        }))),
      },
    }),
    onSuccess: async () => {
      toast.show('Configuración de operaciones actualizada.');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['animal-operation-policy'] }),
        client.invalidateQueries({ queryKey: ['visible-operation-policy'] }),
        client.invalidateQueries({ queryKey: ['animal'] }),
      ]);
    },
    onError: (error) => toast.show((error as ApiError).message, 'error'),
  });

  const openSection = (next: SettingsSection) => {
    if (next === 'inicio') setSearchParams({});
    else setSearchParams({ seccion: next });
  };
  const sectionHeader = (title: string, description: string, action?: ReactNode) => <PageHeader
    title={title}
    description={description}
    action={action ? <div className="settings-header-actions">{action}</div> : undefined}
  />;

  if (section === 'notificaciones') return <div className="settings-page settings-content">
    {sectionHeader('Notificaciones', 'Decide qué avisos recibes y si deben aparecer como push.', <Button loading={saveNotifications.isPending} disabled={!notificationDraft.length} onClick={() => saveNotifications.mutate()}><Save size={18} />Guardar</Button>)}
    {notificationQuery.isLoading ? <LoadingState /> : notificationQuery.isError ? <ErrorState message={(notificationQuery.error as Error).message} onRetry={() => void notificationQuery.refetch()} /> : <>
      <div className="settings-info"><Bell size={19} /><span><strong>Push + buzón</strong> muestra el aviso en Android y lo conserva en la campana. <strong>Solo buzón</strong> evita el aviso emergente.</span></div>
      <div className="notification-preference-list">{notificationDefinitions.map(definition => {
        const preference = notificationDraft.find(item => item.categoria === definition.categoria)
          ?? notificationValues(definition.categoria, 'PUSH_BUZON');
        const mode = notificationMode(preference);
        const Icon = definition.icon;
        return <Card key={definition.categoria} className="notification-preference-card">
          <span className="settings-card-icon"><Icon size={20} /></span>
          <span className="notification-preference-copy"><strong>{definition.nombre}</strong><small>{definition.descripcion}</small></span>
          <div className="notification-mode-options" role="group" aria-label={`Preferencia para ${definition.nombre}`}>
            {([
              ['PUSH_BUZON', 'Push + buzón'],
              ['SOLO_BUZON', 'Solo buzón'],
              ['DESACTIVADAS', 'Desactivadas'],
            ] as Array<[NotificationMode,string]>).map(([value,label]) => <button key={value} type="button" className={mode === value ? 'selected' : ''} onClick={() => setNotificationDraft(current => [
              ...current.filter(item => item.categoria !== definition.categoria),
              notificationValues(definition.categoria,value),
            ])}>{label}</button>)}
          </div>
        </Card>;
      })}</div>
    </>}
  </div>;

  if(section==='apariencia'){
    const background=theme==='dark'?appearance.darkBackground:appearance.lightBackground;
    const setBackground=(value:string)=>setAppearance(theme==='dark'?{...appearance,darkBackground:value}:{...appearance,lightBackground:value});
    const surface=theme==='dark'?appearance.darkSurface:appearance.lightSurface;
    const sidebar=theme==='dark'?appearance.darkSidebar:appearance.lightSidebar;
    const setModeColor=(lightKey:'lightSurface'|'lightSidebar',darkKey:'darkSurface'|'darkSidebar',value:string)=>setAppearance({...appearance,[theme==='dark'?darkKey:lightKey]:value});
    const primaryPresets=['#16834f','#2563eb','#7c3aed','#c2410c','#be123c','#0f766e'];
    const backgroundPresets=theme==='dark'?['#0c1210','#101827','#18181b','#1c1917','#111827']:['#f4f7f5','#f2f6ff','#faf5ff','#fff7ed','#fff1f2','#f0fdfa'];
    const ColorSetting=({title,description,value,onChange}:{title:string;description:string;value:string;onChange:(value:string)=>void})=><div className="appearance-setting-group"><div><strong>{title}</strong><small>{description}</small></div><div className="appearance-color-row"><label className="appearance-color-input"><input type="color" value={value} onChange={event=>onChange(event.target.value)}/><span>{value.toUpperCase()}</span></label></div></div>;
    return <div className="settings-page settings-content">
      {sectionHeader('Apariencia','Personaliza el aspecto de SGB en este dispositivo.')}
      <div className="appearance-settings-layout">
        <section className="appearance-intro"><span><Palette size={30}/></span><div><h2>Tu diseño</h2><p>Los cambios se aplican al instante y no afectan a los demás usuarios.</p></div></section>
        <Card className="appearance-settings-card">
          <div className="appearance-setting-group"><div><strong>Modo de pantalla</strong><small>Elige una interfaz clara u oscura.</small></div><div className="appearance-mode-options"><button type="button" className={theme==='light'?'selected':''} onClick={()=>setTheme('light')}><Sun size={18}/>Claro</button><button type="button" className={theme==='dark'?'selected':''} onClick={()=>setTheme('dark')}><Moon size={18}/>Oscuro</button></div></div>
          <div className="appearance-setting-group"><div><strong>Color principal</strong><small>Se aplica a botones, indicadores y elementos seleccionados.</small></div><div className="appearance-color-row"><label className="appearance-color-input"><input type="color" value={appearance.primaryColor} onChange={event=>setAppearance({...appearance,primaryColor:event.target.value})}/><span>{appearance.primaryColor.toUpperCase()}</span></label><div className="appearance-swatches">{primaryPresets.map(color=><button key={color} type="button" className={appearance.primaryColor.toLowerCase()===color?'selected':''} style={{backgroundColor:color}} aria-label={`Usar color ${color}`} onClick={()=>setAppearance({...appearance,primaryColor:color})}/>)}</div></div></div>
          <div className="appearance-setting-group"><div><strong>Color de fondo y barra superior</strong><small>También se aplica a la barra de estado y navegación de Android; se guarda por separado para el modo {theme==='dark'?'oscuro':'claro'}.</small></div><div className="appearance-color-row"><label className="appearance-color-input"><input type="color" value={background} onChange={event=>setBackground(event.target.value)}/><span>{background.toUpperCase()}</span></label><div className="appearance-swatches">{backgroundPresets.map(color=><button key={color} type="button" className={background.toLowerCase()===color?'selected':''} style={{backgroundColor:color}} aria-label={`Usar fondo ${color}`} onClick={()=>setBackground(color)}/>)}</div></div></div>
          <ColorSetting title="Color de los contenedores" description={`Tarjetas, formularios y ventanas del modo ${theme==='dark'?'oscuro':'claro'}.`} value={surface} onChange={value=>setModeColor('lightSurface','darkSurface',value)}/>
          <ColorSetting title="Color de la barra lateral" description="Fondo del menú principal." value={sidebar} onChange={value=>setModeColor('lightSidebar','darkSidebar',value)}/>
          <div className="appearance-setting-group"><div><strong>Color del texto</strong><small>Automático calcula el mejor contraste para cada fondo.</small></div><Select value={appearance.textMode} onChange={event=>setAppearance({...appearance,textMode:event.target.value as typeof appearance.textMode})}><option value="auto">Automático</option><option value="dark">Texto oscuro</option><option value="light">Texto claro</option></Select></div>
          <div className="appearance-preview" style={{backgroundColor:background}}><div style={{backgroundColor:surface,color:appearance.textMode==='light'?'#f5faf7':appearance.textMode==='dark'?'#17231d':undefined}}><span style={{backgroundColor:appearance.primaryColor}}><Beef size={22}/></span><section><strong>Vista previa</strong><small>Fondo, contenedor, barras y texto se combinan al instante.</small><button type="button" style={{backgroundColor:appearance.primaryColor}}>Botón principal</button></section></div></div>
          <div className="appearance-reset"><Button variant="ghost" onClick={resetAppearance}><RotateCcw size={17}/>Restablecer diseño</Button></div>
        </Card>
      </div>
    </div>;
  }

  if (section === 'finca') return <div className="settings-page settings-content">
    {sectionHeader('Configuración de la finca', 'Define por propiedad las reglas sanitarias, reproductivas y de ordeño.', canEditAdministration ? <Button loading={saveFarm.isPending} disabled={!farmValuesValid} onClick={() => saveFarm.mutate()}><Save size={18} />Guardar</Button> : undefined)}
    {!canViewAdministration ? <ErrorState message="No tienes permiso para consultar la configuración administrativa." /> : farmQuery.isLoading ? <LoadingState /> : farmQuery.isError ? <ErrorState message={(farmQuery.error as Error).message} onRetry={() => void farmQuery.refetch()} /> : !farmDraft ? <EmptyState icon={Sprout} title="Sin propiedades" description="Registra una propiedad antes de configurar las alertas." /> : <div className="farm-settings-layout">
      <Card className="farm-settings-form">
        <Field label="Propiedad">
          <Select value={selectedPropertyId} onChange={event => setSelectedPropertyId(event.target.value)}>
            {farmQuery.data?.propiedades.map(property => <option key={property.id_propiedad} value={property.id_propiedad}>{property.nombre}{property.es_principal ? ' · Principal' : ''}</option>)}
          </Select>
        </Field>
        <label className="settings-switch-row"><span><strong>Alertas de garrapatas</strong><small>Solo se calculan al aplicar un movimiento de tipo cambio de potrero.</small></span><span className="switch"><input type="checkbox" checked={farmDraft.alertas_garrapata} disabled={!canEditAdministration} onChange={event => setFarmDraft(current => current ? { ...current, alertas_garrapata: event.target.checked } : current)} /><i /></span></label>
        <div className="form-grid tick-threshold-grid">
          <Field label="Inicio posible de eclosión" hint="Días desde la desocupación."><Input type="number" min={1} max={120} disabled={!canEditAdministration} value={farmDraft.inicio_eclosion_dias} onChange={event => setFarmDraft(current => current ? { ...current, inicio_eclosion_dias: Number(event.target.value) } : current)} /></Field>
          <Field label="Descanso mínimo recomendado" hint="Debe ser mayor al inicio de eclosión."><Input type="number" min={2} max={180} disabled={!canEditAdministration} value={farmDraft.descanso_minimo_dias} onChange={event => setFarmDraft(current => current ? { ...current, descanso_minimo_dias: Number(event.target.value) } : current)} /></Field>
          <Field label="Riesgo reducido desde" hint="No significa que el potrero esté libre."><Input type="number" min={3} max={365} disabled={!canEditAdministration} value={farmDraft.riesgo_reducido_dias} onChange={event => setFarmDraft(current => current ? { ...current, riesgo_reducido_dias: Number(event.target.value) } : current)} /></Field>
        </div>
        {!farmValuesValid ? <p className="field-error">Los valores deben mantener este orden: eclosión &lt; descanso mínimo &lt; riesgo reducido.</p> : null}
      </Card>
      <Card className="tick-stage-card">
        <h3>Cómo se interpretarán los días</h3>
        <div><span>0–{Math.max(0,farmDraft.inicio_eclosion_dias - 1)}</span><strong>Pre-eclosión</strong><small>No se afirma que ya existan larvas.</small></div>
        <div><span>{farmDraft.inicio_eclosion_dias}–{Math.max(farmDraft.inicio_eclosion_dias,farmDraft.descanso_minimo_dias - 1)}</span><strong>Posible emergencia</strong><small>Los animales podrían infestarse.</small></div>
        <div><span>{farmDraft.descanso_minimo_dias}–{Math.max(farmDraft.descanso_minimo_dias,farmDraft.riesgo_reducido_dias - 1)}</span><strong>Riesgo persistente</strong><small>El descanso ayuda, pero aún puede haber larvas.</small></div>
        <div><span>{farmDraft.riesgo_reducido_dias}+</span><strong>Riesgo reducido</strong><small>Nunca se declara el potrero libre sin inspección.</small></div>
      </Card>
      <Card className="farm-settings-form">
        <h3>Clasificación por edad</h3>
        <p className="muted">La descendencia y las preñeces confirmadas tienen prioridad. Si el animal no tiene fecha de nacimiento, la edad no limita su clasificación.</p>
        <div className="form-grid tick-threshold-grid">
          <Field label="Edad para vacona" hint="Meses cumplidos sin parto ni cría."><Input type="number" min={0} max={120} disabled={!canEditAdministration} value={farmDraft.edad_vacona_meses} onChange={event=>setFarmDraft(current=>current?{...current,edad_vacona_meses:Number(event.target.value)}:current)}/></Field>
          <Field label="Edad para torete" hint="Meses cumplidos sin descendencia ni preñez confirmada."><Input type="number" min={0} max={120} disabled={!canEditAdministration} value={farmDraft.edad_torete_meses} onChange={event=>setFarmDraft(current=>current?{...current,edad_torete_meses:Number(event.target.value)}:current)}/></Field>
        </div>
      </Card>
      <Card className="farm-settings-form">
        <h3>Reproducción y ordeño</h3>
        <p className="muted">Los controles se aplican según la propiedad actual del animal. Si no tiene fecha de nacimiento, la edad no lo bloquea.</p>
        <div className="form-grid tick-threshold-grid">
          <Field label="Celo después del parto" hint="Días mínimos."><Input type="number" min={0} max={365} disabled={!canEditAdministration} value={farmDraft.dias_posparto_para_celo} onChange={event=>setFarmDraft(current=>current?{...current,dias_posparto_para_celo:Number(event.target.value)}:current)}/></Field>
          <Field label="Preñez después del parto" hint="Días mínimos."><Input type="number" min={0} max={365} disabled={!canEditAdministration} value={farmDraft.dias_posparto_para_prenez} onChange={event=>setFarmDraft(current=>current?{...current,dias_posparto_para_prenez:Number(event.target.value)}:current)}/></Field>
          <Field label="Celo después del aborto" hint="Días mínimos."><Input type="number" min={0} max={365} disabled={!canEditAdministration} value={farmDraft.dias_posaborto_para_celo} onChange={event=>setFarmDraft(current=>current?{...current,dias_posaborto_para_celo:Number(event.target.value)}:current)}/></Field>
          <Field label="Preñez después del aborto" hint="Días mínimos."><Input type="number" min={0} max={365} disabled={!canEditAdministration} value={farmDraft.dias_posaborto_para_prenez} onChange={event=>setFarmDraft(current=>current?{...current,dias_posaborto_para_prenez:Number(event.target.value)}:current)}/></Field>
          <Field label="Edad mínima para celo" hint="Meses."><Input type="number" min={0} max={120} disabled={!canEditAdministration} value={farmDraft.edad_minima_celo_meses} onChange={event=>setFarmDraft(current=>current?{...current,edad_minima_celo_meses:Number(event.target.value)}:current)}/></Field>
          <Field label="Edad mínima como padre" hint="Meses."><Input type="number" min={0} max={120} disabled={!canEditAdministration} value={farmDraft.edad_minima_padre_meses} onChange={event=>setFarmDraft(current=>current?{...current,edad_minima_padre_meses:Number(event.target.value)}:current)}/></Field>
          <Field label="Máximo en ordeño" hint="Días después del parto."><Input type="number" min={1} max={730} disabled={!canEditAdministration} value={farmDraft.dias_maximos_ordeno_posparto} onChange={event=>setFarmDraft(current=>current?{...current,dias_maximos_ordeno_posparto:Number(event.target.value)}:current)}/></Field>
        </div>
        <label className="settings-switch-row"><span><strong>Permitir más de un celo</strong><small>Admite un segundo celo dentro del mismo ciclo reproductivo.</small></span><span className="switch"><input type="checkbox" checked={farmDraft.permitir_segundo_celo} disabled={!canEditAdministration} onChange={event=>setFarmDraft(current=>current?{...current,permitir_segundo_celo:event.target.checked}:current)}/><i/></span></label>
        <label className="settings-switch-row"><span><strong>Permitir celo falso durante la preñez</strong><small>Se registra como aparente y no modifica el cálculo del parto.</small></span><span className="switch"><input type="checkbox" checked={farmDraft.permitir_celo_falso_en_prenez} disabled={!canEditAdministration} onChange={event=>setFarmDraft(current=>current?{...current,permitir_celo_falso_en_prenez:event.target.checked}:current)}/><i/></span></label>
        <label className="settings-switch-row"><span><strong>Usar el último día del último celo válido</strong><small>Calcula el parto desde el fin del celo; ignora los marcados como falsos.</small></span><span className="switch"><input type="checkbox" checked={farmDraft.usar_ultimo_celo_valido} disabled={!canEditAdministration} onChange={event=>setFarmDraft(current=>current?{...current,usar_ultimo_celo_valido:event.target.checked}:current)}/><i/></span></label>
      </Card>
    </div>}
  </div>;

  if (section === 'operaciones') return <div className="settings-page settings-content">
    {sectionHeader('Políticas de operaciones', 'Activa o desactiva las operaciones para cada propiedad.', canEditAdministration ? <Button loading={saveOperations.isPending} onClick={() => saveOperations.mutate()}><Save size={18} />Guardar</Button> : undefined)}
    {!canViewAdministration ? <ErrorState message="No tienes permiso para consultar la configuración administrativa." /> : operationQuery.isLoading ? <LoadingState /> : operationQuery.isError ? <ErrorState message={(operationQuery.error as Error).message} onRetry={() => void operationQuery.refetch()} /> : !operationQuery.data?.propiedades.length ? <EmptyState icon={Settings2} title="Sin propiedades" description="Registra primero una propiedad." /> : <div className="operation-policy-layout">
      <Card className="operation-property-selector">
        <Field label="Propiedad"><Select value={selectedOperationPropertyId} onChange={event=>setSelectedOperationPropertyId(event.target.value)}>{operationQuery.data.propiedades.map(property=><option key={property.id_propiedad} value={property.id_propiedad}>{property.nombre}{property.es_principal?' · Principal':''}</option>)}</Select></Field>
        <div className="form-alert"><ShieldCheck size={18}/><span>Estas opciones controlan las operaciones de animales y finca relacionadas con la propiedad seleccionada.</span></div>
      </Card>
      <div className="operation-policy-groups">{groupedOperations.map(([group,operations])=><Card className="operation-policy-group" key={group}>
        <h3><Badge tone="info">{group}</Badge></h3>
        <div>{operations.map(operation=>{const key=settingKey(selectedOperationPropertyId,operation.codigo);const allowed=operationDraft[key]??true;return <label className="settings-switch-row" key={operation.codigo}><span><strong>{operation.nombre}</strong><small>{allowed?'Permitido en esta propiedad':'Bloqueado en esta propiedad'}</small></span><span className="switch"><input type="checkbox" checked={allowed} disabled={!canEditAdministration} onChange={event=>setOperationDraft(current=>({...current,[key]:event.target.checked}))}/><i/></span></label>;})}</div>
      </Card>)}</div>
    </div>}
  </div>;

  if (section === 'actualizacion') return <div className="settings-page settings-content">
    {sectionHeader('Actualizar aplicación', 'Comprueba si existe un APK más reciente publicado en GitHub.')}
    <AppUpdatePanel/>
  </div>;

  if(section==='enlaces')return <div className="settings-page settings-content">
    {sectionHeader('Enlaces públicos','Revisa quién compartió cada ficha y desactiva los enlaces que ya no deban funcionar.')}
    {!isAdministrator?<ErrorState message="Solo un administrador puede gestionar todos los enlaces públicos."/>:publicLinks.isLoading?<LoadingState/>:publicLinks.isError?<ErrorState message={(publicLinks.error as Error).message} onRetry={()=>void publicLinks.refetch()}/>:publicLinks.data?.length?<Card className="public-link-settings-list">{publicLinks.data.map((item)=><article key={item.id_animal_compartido}><span className="settings-card-icon"><Link2 size={19}/></span><span><strong>{item.animal}</strong><small>{[item.codigo_arete?`Arete ${item.codigo_arete}`:null,`Creado por ${item.creado_por}`,formatDate(item.created_at)].filter(Boolean).join(' · ')}</small></span><div><Button variant="ghost" onClick={()=>window.open(item.url,'_blank','noopener,noreferrer')}><ExternalLink size={16}/>Abrir</Button><Button variant="danger" loading={revokePublicLink.isPending&&revokePublicLink.variables===item.id_animal_compartido} onClick={()=>revokePublicLink.mutate(item.id_animal_compartido)}><Trash2 size={16}/>Desactivar</Button></div></article>)}</Card>:<EmptyState icon={Link2} title="Sin enlaces activos" description="No hay fichas públicas compartidas en este momento."/>}
  </div>;

  const personalCards: SettingsCardDefinition[] = [
    { label: 'Mi cuenta', description: 'Perfil, fotografía y contraseña.', icon: UserCircle, action: () => navigate('/perfil') },
    ...(hasPermission('DASHBOARD_CONSULTAR') ? [{ label: 'Panel', description: 'Elige las tarjetas que ves al iniciar.', icon: LayoutDashboard, action: () => navigate('/?ajustes_panel=1') }] : []),
    { label: 'Notificaciones', description: 'Configura push, buzón o avisos desactivados.', icon: Bell, action: () => openSection('notificaciones') },
    { label: 'Apariencia', description: 'Tema, color principal y fondo de la aplicación.', icon: Palette, action: () => openSection('apariencia') },
  ];
  const administrationCards: SettingsCardDefinition[] = [
    ...(canViewAdministration ? [
      { label: 'Configuración de la finca', description: 'Reglas sanitarias, reproductivas y de ordeño.', icon: Sprout, action: () => openSection('finca') },
      { label: 'Políticas de operaciones', description: 'Acciones permitidas dentro y fuera de la finca.', icon: ShieldCheck, action: () => openSection('operaciones') },
      { label: 'Catálogos', description: 'Motivos, productos, etiquetas y unidades.', icon: BookOpen, action: () => navigate('/catalogos') },
      { label: 'Fierros y marquillas', description: 'Identificación visual de los animales.', icon: Tag, action: () => navigate('/marquillas') },
    ] : []),
    ...(hasPermission('USUARIO_CONSULTAR') ? [{ label: 'Usuarios', description: 'Cuentas y estado de acceso.', icon: UserCog, action: () => navigate('/usuarios') }] : []),
    ...(hasPermission('ROL_CONSULTAR') ? [{ label: 'Roles y permisos', description: 'Controla qué puede hacer cada rol.', icon: Users, action: () => navigate('/roles') }] : []),
    ...(hasPermission('AUDITORIA_CONSULTAR') ? [{ label: 'Auditoría', description: 'Historial de cambios en el sistema.', icon: ClipboardList, action: () => navigate('/auditoria') }] : []),
    ...(isAdministrator ? [{ label: 'Enlaces públicos', description: 'Consulta y desactiva fichas compartidas.', icon: Link2, action: () => openSection('enlaces') }] : []),
  ];
  const systemCards: SettingsCardDefinition[] = [
    { label: 'Actualizar aplicación', description: 'Comprueba, descarga e instala la última versión.', icon: Download, action: () => openSection('actualizacion') },
  ];

  const renderCards = (cards: SettingsCardDefinition[]) => <div className="settings-hub-grid">{cards.map(item => {
    const Icon = item.icon;
    return <Card key={item.label} className="settings-hub-card" onClick={item.action}><span className="settings-card-icon"><Icon size={23} /></span><span><strong>{item.label}</strong><small>{item.description}</small></span><ChevronRight size={18} /></Card>;
  })}</div>;

  return <div className="settings-page settings-content">
    <PageHeader title="Configuración" description="Personaliza tu experiencia y administra las reglas de la finca desde un solo lugar." />
    <section className="settings-hub-section"><h2>Personal</h2>{renderCards(personalCards)}</section>
    {administrationCards.length ? <section className="settings-hub-section"><h2>Finca y administración</h2>{renderCards(administrationCards)}</section> : null}
    <section className="settings-hub-section"><h2>Sistema</h2>{renderCards(systemCards)}</section>
  </div>;
}
