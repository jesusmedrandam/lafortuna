import {useState} from 'react';
import {ChevronRight,ClipboardList,CloudDownload,LayoutDashboard,LogOut,Moon,Palette,
  SlidersHorizontal,Sun,UserCircle,Users,Warehouse} from 'lucide-react';
import {Link,useNavigate,useSearchParams} from 'react-router-dom';
import {Button,Card,PageHeader} from '../components/ui';
import {useTheme,type AppearanceSettings} from '../theme/ThemeContext';
import {DashboardPreferencesEditor} from './DashboardPreferences';
import {PropertySettingsPanel} from './PropertySettingsPanel';
import {useV2Session} from './V2Session';
import {UserProfileEditor} from './UserProfileEditor';

const sections={cuenta:'Mi cuenta',apariencia:'Apariencia',panel:'Mi panel',propiedad:'Propiedades'};
type SettingsSection=keyof typeof sections;

function ColorSetting({title,description,value,onChange,presets=[]}:{title:string;description:string;
  value:string;onChange:(color:string)=>void;presets?:string[]}){
  return <div className="appearance-setting-group"><div><strong>{title}</strong><small>{description}</small></div>
    <div className="appearance-color-row"><label className="appearance-color-input">
      <input type="color" aria-label={title} value={value} onChange={event=>onChange(event.target.value)}/>
      <span>{value.toUpperCase()}</span></label>
      {presets.length>0&&<div className="appearance-swatches">{presets.map(color=><button type="button" key={color}
        aria-label={`${title}: ${color}`} aria-pressed={value.toLowerCase()===color} style={{backgroundColor:color}}
        className={value.toLowerCase()===color?'selected':''} onClick={()=>onChange(color)}/>)}</div>}
    </div></div>;
}

function AppearanceSection(){
  const {theme,setTheme,appearance,setAppearance,resetAppearance}=useTheme();
  const dark=theme==='dark';
  const update=(key:keyof AppearanceSettings,value:string)=>setAppearance({...appearance,[key]:value});
  return <div className="appearance-settings-layout">
    <div className="appearance-intro"><span><Palette size={28}/></span><div><h2>Tu diseño</h2>
      <p>Los cambios se aplican al instante y se guardan para tu usuario en este dispositivo.</p></div></div>
    <Card className="appearance-settings-card">
      <div className="appearance-setting-group"><div><strong>Modo de pantalla</strong><small>Colores independientes para el modo claro y oscuro.</small></div>
        <div className="appearance-mode-options"><button type="button" className={!dark?'selected':''} aria-pressed={!dark}
          onClick={()=>setTheme('light')}><Sun size={18}/>Claro</button><button type="button" className={dark?'selected':''}
          aria-pressed={dark} onClick={()=>setTheme('dark')}><Moon size={18}/>Oscuro</button></div></div>
      <ColorSetting title="Color principal" description="Botones, indicadores y elementos seleccionados." value={appearance.primaryColor}
        onChange={color=>update('primaryColor',color)} presets={['#16834f','#2563eb','#7c3aed','#c2410c','#be123c','#0f766e']}/>
      <ColorSetting title="Fondo y barra superior" description="Incluye las barras de estado y navegación de Android."
        value={dark?appearance.darkBackground:appearance.lightBackground}
        onChange={color=>update(dark?'darkBackground':'lightBackground',color)}
        presets={dark?['#0c1210','#101827','#18181b','#1c1917']:['#f4f7f5','#f2f6ff','#faf5ff','#fff7ed']}/>
      <ColorSetting title="Contenedores" description="Tarjetas, formularios y ventanas."
        value={dark?appearance.darkSurface:appearance.lightSurface} onChange={color=>update(dark?'darkSurface':'lightSurface',color)}/>
      <ColorSetting title="Menú lateral" description="Fondo del menú de la aplicación."
        value={dark?appearance.darkSidebar:appearance.lightSidebar} onChange={color=>update(dark?'darkSidebar':'lightSidebar',color)}/>
      <div className="appearance-setting-group"><div><strong>Color del texto</strong><small>Automático adapta el contraste al fondo.</small></div>
        <select aria-label="Color del texto" value={appearance.textMode} onChange={event=>update('textMode',event.target.value)}>
          <option value="auto">Automático</option><option value="dark">Oscuro</option><option value="light">Claro</option></select></div>
      <div className="v2-appearance-preview"><div><strong>Vista previa</strong><small>Así se verán tus tarjetas y botones.</small>
        <Button>Botón principal</Button></div></div>
      <div className="inline-actions"><Button variant="secondary" onClick={resetAppearance}>Restablecer colores</Button></div>
    </Card>
  </div>;
}

export function V2SettingsPage(){
  const {session,hasPermission,signOut,reloadOverview,selectContext}=useV2Session();
  const navigate=useNavigate();const [params,setParams]=useSearchParams();
  const [error,setError]=useState('');const [signingOut,setSigningOut]=useState(false);
  const overview=session!.overview;const property=overview.properties.find(item=>item.id===overview.activeContext?.propertyId);
  const role=property?.roles.find(item=>item.id===overview.activeContext?.roleId);
  const canViewProperty=Boolean(property);
  const requested=params.get('seccion');
  const section=requested&&Object.hasOwn(sections,requested)&&(requested!=='propiedad'||canViewProperty)?requested as SettingsSection:null;
  const open=(next:SettingsSection)=>{setError('');setParams({seccion:next});};
  const cards=(items:{label:string;description:string;icon:typeof UserCircle;action:()=>void}[])=><div className="settings-hub-grid">
    {items.map(({label,description,icon:Icon,action})=><button type="button" className="card settings-hub-card" key={label} onClick={action}>
      <span className="settings-card-icon"><Icon size={23}/></span><span><strong>{label}</strong><small>{description}</small></span>
      <ChevronRight size={18}/></button>)}</div>;
  const administration=[
    ...(canViewProperty?[{label:'Propiedades',description:'Tus propiedades, colaboraciones y políticas de operación.',icon:Warehouse,action:()=>open('propiedad')}]:[]),
    {label:'Roles y permisos',description:'Elige tu propiedad y rol; administra los accesos permitidos.',icon:Users,action:()=>navigate('/roles-permisos')},
    ...(property&&hasPermission('CATALOG_VIEW')?[{label:'Catálogos',description:'Clasificaciones, etiquetas y opciones de los registros.',icon:SlidersHorizontal,action:()=>navigate('/catalogos')}]:[]),
    ...(property&&hasPermission('AUDIT_VIEW')?[{label:'Historial de cambios',description:'Consulta qué cambió, quién lo hizo y cuándo.',icon:ClipboardList,action:()=>navigate('/auditoria')}]:[]),
  ];
  return <div className="settings-page settings-content v2-settings-page">
    {section&&<PageHeader title={section==='cuenta'?({perfil:'Editar perfil',clave:'Cambiar contraseña',correo:'Cambiar correo electrónico',sesiones:'Sesiones activas'}[params.get('opcion')??'']??sections[section]):sections[section]}/>}
    {!section&&<>
      <section className="settings-hub-section"><h2>Cuenta</h2>{cards([
        {label:'Mi cuenta',description:'Tu perfil, foto, contraseña y sesión actual.',icon:UserCircle,action:()=>open('cuenta')},
      ])}</section>
      <section className="settings-hub-section"><h2>Personalización</h2>{cards([
        {label:'Apariencia',description:'Tema, colores de la app, contenedores y menú lateral.',icon:Palette,action:()=>open('apariencia')},
        {label:'Mi panel',description:'Elige los elementos y secciones que ves, y su orden.',icon:LayoutDashboard,action:()=>open('panel')},
      ])}</section>
      <section className="settings-hub-section"><h2>Propiedad y administración</h2>{cards(administration)}</section>
      <section className="settings-hub-section"><h2>Datos y conexión</h2>{cards([
        {label:'Descargas',description:'Contenido sin conexión, descargas con Wi-Fi y espacio del dispositivo.',icon:CloudDownload,action:()=>navigate('/sin-conexion')},
      ])}</section>
    </>}
    {section==='cuenta'&&<div className="v2-account-settings"><UserProfileEditor footer={<>
      <dl><div><dt>Propiedad actual</dt><dd>{property?.name??'Sin propiedad seleccionada'}</dd></div>
        <div><dt>Rol actual</dt><dd>{overview.supportMode?'Soporte de sistema':role?.name??'Sin rol seleccionado'}</dd></div></dl>
      <div className="inline-actions"><Link className="secondary-button compact" to="/roles-permisos">Roles y permisos</Link>
        <Button variant="secondary" loading={signingOut} onClick={()=>{setSigningOut(true);setError('');void signOut()
          .catch(reason=>setError(reason instanceof Error?reason.message:'No se pudo cerrar la sesión.')).finally(()=>setSigningOut(false));}}>
          <LogOut size={17}/>Cerrar sesión</Button></div></>}/></div>}
    {section==='apariencia'&&<AppearanceSection/>}
    {section==='panel'&&<DashboardPreferencesEditor userId={overview.user.id}/>}
    {section==='propiedad'&&<PropertySettingsPanel accessToken={session!.accessToken} onSettingsChanged={reloadOverview}
      onPropertyCreated={async(propertyId,roleId)=>{await selectContext(propertyId,roleId);}}/>}
    {error&&<p className="form-error" role="alert">{error}</p>}
  </div>;
}
