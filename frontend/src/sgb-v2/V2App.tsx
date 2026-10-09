import {useMemo,useState,type ReactNode} from 'react';
import {Baby,Beef,ChevronRight,Droplets,HeartPulse,Home,Images,LayoutDashboard,LogOut,
  Menu,Moon,Settings2,ShieldCheck,SlidersHorizontal,Sun,Users,Warehouse,ArrowLeftRight,
  Activity,ClipboardList,Sprout,Milk,UserCircle,Weight,HeartCrack,ShoppingCart,ShoppingBag,CalendarDays,WalletCards,
  CloudDownload,X} from 'lucide-react';
import {BrowserRouter,Link,NavLink,Navigate,Outlet,Route,Routes,useLocation,useNavigate,useParams} from 'react-router-dom';
import {AuthLayout} from '../pages/auth/AuthLayout';
import {IconButton,LoadingState} from '../components/ui';
import {ThemeProvider,useTheme} from '../theme/ThemeContext';
import {ActivityPanel} from './ActivityPanel';
import {AnimalPanel} from './AnimalPanel';
import {CatalogPanel} from './CatalogPanel';
import {CleaningPanel} from './CleaningPanel';
import {V2GroupsPage,V2LocationsPage} from './V2GroupsLocations';
import {HealthPanel} from './HealthPanel';
import {HomeSummary} from './HomeSummary';
import {HomeOperations,HomePendingTasks} from './HomeOperations';
import {MediaPanel} from './MediaPanel';
import {MovementPanel} from './MovementPanel';
import {ProductionPanel} from './ProductionPanel';
import {V2SettingsPage} from './V2SettingsPage';
import {RolesPermissionsPage} from './RolesPermissionsPage';
import {loadDashboardPreferences} from './DashboardPreferences';
import {ReproductionPanel} from './ReproductionPanel';
import {SuperadminPanel} from './SuperadminPanel';
import {V2EmailChange,V2Login,V2Recovery,V2Register,V2Verify} from './AuthPages';
import {V2AnimalsPage} from './V2AnimalsPage';
import {V2AnimalAttendancePage} from './V2AnimalAttendancePage';
import {V2AnimalDetail} from './V2AnimalDetail';
import {V2WeighingsPage} from './V2WeighingsPage';
import {V2AuditPage} from './V2AuditPage';
import {V2AnimalStatusPage} from './V2AnimalStatusPage';
import {V2CommercePage} from './V2CommercePage';
import {V2AgendaPage} from './V2AgendaPage';
import {V2FinancesPage} from './V2FinancesPage';
import {V2NotificationCenter} from './V2NotificationCenter';
import {V2SessionProvider,useV2Session} from './V2Session';
import {OfflineStatusButton,SyncProgressBar,V2OfflinePage,V2OfflineProvider} from './offline/V2Offline';
import type {SessionOverview} from './api';

type Section='principal'|'operaciones'|'configuracion';
interface Destination {to:string;label:string;icon:typeof Beef;section:Section;permission?:string;module?:string;admin?:boolean}
const destinations:Destination[]=[
  {to:'/',label:'Panel',icon:LayoutDashboard,section:'principal'},
  {to:'/animales',label:'Animales',icon:Beef,section:'principal',permission:'ANIMAL_VIEW'},
  {to:'/multimedia',label:'Multimedia',icon:Images,section:'principal',permission:'MEDIA_VIEW',module:'MULTIMEDIA'},
  {to:'/grupos',label:'Grupos',icon:Users,section:'principal',permission:'GROUP_VIEW'},
  {to:'/potreros',label:'Potreros',icon:Sprout,section:'principal',permission:'LOCATION_VIEW',module:'PASTURES'},
  {to:'/corrales',label:'Corrales',icon:Warehouse,section:'principal',permission:'LOCATION_VIEW',module:'CORRALS'},
  {to:'/movimientos',label:'Movimientos',icon:ArrowLeftRight,section:'operaciones',permission:'MOVEMENT_VIEW',module:'MOVEMENTS'},
  {to:'/pesajes',label:'Pesajes',icon:Weight,section:'operaciones',permission:'WEIGHING_VIEW',module:'WEIGHING'},
  {to:'/bajas',label:'Bajas y novedades',icon:HeartCrack,section:'operaciones',permission:'ANIMAL_VIEW'},
  {to:'/ventas',label:'Ventas',icon:ShoppingCart,section:'operaciones',permission:'COMMERCE_VIEW',module:'SALES_PURCHASES'},
  {to:'/compras',label:'Compras',icon:ShoppingBag,section:'operaciones',permission:'COMMERCE_VIEW',module:'SALES_PURCHASES'},
  {to:'/agenda',label:'Agenda',icon:CalendarDays,section:'operaciones'},
  {to:'/finanzas',label:'Ingresos y egresos',icon:WalletCards,section:'operaciones',permission:'FINANCE_VIEW',module:'PROPERTY_FINANCE'},
  {to:'/mis-finanzas',label:'Mis finanzas',icon:WalletCards,section:'configuracion'},
  {to:'/sanidad',label:'Sanidad',icon:HeartPulse,section:'operaciones',permission:'HEALTH_VIEW',module:'HEALTH'},
  {to:'/limpiezas',label:'Limpieza potreros',icon:Droplets,section:'operaciones',permission:'CLEANING_VIEW',module:'PASTURE_CLEANING'},
  {to:'/reproduccion',label:'Reproducción',icon:Baby,section:'operaciones',permission:'REPRODUCTION_VIEW',module:'REPRODUCTION'},
  {to:'/produccion',label:'Producción',icon:Milk,section:'operaciones',permission:'PRODUCTION_VIEW',module:'PRODUCTION'},
  {to:'/actividades',label:'Actividades',icon:Activity,section:'operaciones',permission:'ACTIVITY_VIEW',module:'TASKS'},
  {to:'/catalogos',label:'Catálogos',icon:SlidersHorizontal,section:'configuracion',permission:'CATALOG_VIEW'},
  {to:'/sin-conexion',label:'Descargas',icon:CloudDownload,section:'configuracion'},
  {to:'/roles-permisos',label:'Roles y permisos',icon:Users,section:'configuracion'},
  {to:'/auditoria',label:'Historial de cambios',icon:ClipboardList,section:'configuracion',permission:'AUDIT_VIEW'},
  {to:'/configuracion',label:'Configuración',icon:Settings2,section:'configuracion'},
  {to:'/administracion',label:'Superadministrador',icon:ShieldCheck,section:'configuracion',admin:true},
];

function activeProperty(overview:SessionOverview){
  return overview.properties.find(property=>property.id===overview.activeContext?.propertyId);
}

function Protected(){
  const {session,ready,error}=useV2Session();const location=useLocation();
  if(!ready)return <div className="boot-screen"><img src="/branding/logo-sgb-icon.png" alt="SGB"/>
    <LoadingState text="Recuperando sesión…"/></div>;
  if(!session)return <Navigate to="/login" replace state={{from:location.pathname+location.search}}/>;
  return <>{error&&<div className="form-alert form-alert-error" role="alert">{error}</div>}<Outlet/></>;
}

function V2Shell(){
  const {session,signOut,hasPermission,endSupport}=useV2Session();const {theme,toggleTheme}=useTheme();
  const navigate=useNavigate();const [supportBusy,setSupportBusy]=useState(false);const [supportError,setSupportError]=useState('');
  const [open,setOpen]=useState(false);const location=useLocation();
  const overview=session!.overview;const property=activeProperty(overview);
  const platformMode=overview.user.isSuperadmin&&location.pathname.startsWith('/administracion');
  const visible=useMemo(()=>destinations.filter(item=>{
    if(platformMode)return Boolean(item.admin);
    if(item.to==='/roles-permisos'||item.to==='/configuracion')return true;
    if(item.admin)return false;
    if(item.to==='/')return true;
    if(item.to==='/mis-finanzas')return overview.enabledUserModules.includes('PERSONAL_FINANCE');
    if(!property||item.permission&&!hasPermission(item.permission))return false;
    if(item.to==='/agenda'&&!((hasPermission('AGENDA_TASK_VIEW')&&property.enabledModules.includes('TASKS'))||
      (hasPermission('AGENDA_EVENT_VIEW')&&property.enabledModules.includes('EVENTS'))))return false;
    if(item.module&&!property.enabledModules.includes(item.module))return false;
    if(item.to==='/grupos'&&!property.enabledModules.some(code=>code==='PASTURES'||code==='CORRALS'))return false;
    if(item.to==='/limpiezas'&&!property.enabledModules.includes('PASTURES'))return false;
    return true;
  }),[overview,property,hasPermission,platformMode]);
  const current=visible.find(item=>item.to===location.pathname)||visible.find(item=>
    item.to!=='/'&&location.pathname.startsWith(`${item.to}/`));
  return <div className="app-shell sgb-v2-shell">
    {open&&<button className="mobile-overlay" aria-label="Cerrar menú" onClick={()=>setOpen(false)}/>}
    <aside className={`sidebar ${open?'sidebar-open':''}`}>
      <div className="sidebar-brand"><img src="/branding/logo-sgb-icon.png" alt="SGB"/>
        <div><strong>SGB</strong><span>Gestión Bovina</span></div>
        <IconButton label="Cerrar menú" className="sidebar-close" onClick={()=>setOpen(false)}><X size={20}/></IconButton></div>
      {overview.user.isSuperadmin&&<div className="session-mode-switch" role="group" aria-label="Modo de trabajo">
        <button className={!platformMode&&!overview.supportMode?'selected':''} disabled={supportBusy}
          onClick={()=>{setSupportError('');setOpen(false);if(!overview.supportMode){navigate('/roles-permisos');return;}
            setSupportBusy(true);void endSupport().then(()=>navigate('/')).catch(failure=>setSupportError(failure instanceof Error?failure.message:'No se pudo volver al usuario.'))
              .finally(()=>setSupportBusy(false));}}><UserCircle size={18}/><span>Usuario</span></button>
        <button className={platformMode?'selected':''} onClick={()=>{setOpen(false);navigate('/administracion');}}>
          <ShieldCheck size={18}/><span>Superadministrador</span></button>
      </div>}
      <nav className="sidebar-nav" aria-label="Secciones">
        {(['principal','operaciones','configuracion'] as const).map(section=>{
          const items=visible.filter(item=>item.section===section);
          return items.length?<div className="nav-section" key={section}>
            <span>{section==='principal'?'Gestión principal':section==='operaciones'?'Operaciones':'Cuenta y administración'}</span>
            {items.map(({to,label,icon:Icon})=><NavLink key={to} to={to} end={to==='/'}
              onClick={()=>setOpen(false)} className={({isActive})=>`nav-item ${isActive?'active':''}`}>
              <Icon size={19}/><span>{label}</span><ChevronRight className="nav-chevron" size={16}/></NavLink>)}
          </div>:null;
        })}
      </nav>
      <div className="sidebar-user"><div className="user-avatar">{overview.user.profilePhoto?
        <img src={overview.user.profilePhoto} alt="Tu foto de perfil"/>:<span>{overview.user.displayName.slice(0,1)}</span>}</div>
        <div><strong>{overview.user.displayName}</strong><span>{overview.user.email}</span></div>
        <IconButton label="Cerrar sesión" onClick={()=>void signOut()}><LogOut size={18}/></IconButton>
      </div>
    </aside>
    <div className="shell-main"><header className="topbar"><div className="topbar-left">
      <IconButton label="Abrir menú" className="mobile-menu-button" onClick={()=>setOpen(true)}><Menu size={22}/></IconButton>
      <div><span className="breadcrumb">Sistema de Gestión Bovina</span><h2>{current?.label??'Gestión ganadera'}</h2></div>
    </div><div className="topbar-actions"><span className="v2-current-property">{platformMode?'Administración global':`${overview.supportMode?'Soporte · ':''}${property?.name??'Sin propiedad'}`}</span>
      <OfflineStatusButton/>
      <V2NotificationCenter/>
      <IconButton label={theme==='dark'?'Usar tema claro':'Usar tema oscuro'} onClick={toggleTheme}>
        {theme==='dark'?<Sun size={19}/>:<Moon size={19}/>}</IconButton>
      <Link className="profile-link" to="/configuracion?seccion=cuenta" aria-label="Mi cuenta">
        {overview.user.profilePhoto?<img src={overview.user.profilePhoto} alt=""/>:<UserCircle size={21}/>}
        <span>{overview.user.displayName}</span></Link>
    </div></header><SyncProgressBar/>
      {overview.user.isSuperadmin&&overview.supportOwner&&property&&<div className="support-context-banner" role="status">
        <div><strong>Soporte de sistema</strong><span>{overview.supportOwner.name} · {property.name}</span></div>
        <Link to="/administracion">Cambiar propietario</Link><button type="button" className="secondary-button compact"
          disabled={supportBusy} onClick={()=>{setSupportBusy(true);setSupportError('');void endSupport()
            .then(()=>navigate('/')).catch(failure=>setSupportError(failure instanceof Error?failure.message:'No se pudo finalizar el soporte.'))
            .finally(()=>setSupportBusy(false));}}>Finalizar soporte</button>
      </div>}
      {supportError&&<p role="alert" className="form-error">{supportError}</p>}
      <main className="page-content">
      <Outlet key={`${overview.user.id}:${overview.activeContext?.propertyId??'none'}:${overview.activeContext?.roleId??'none'}:${Boolean(overview.supportMode)}`}/></main>
      <footer className="app-footer"><Home size={14}/><span>SGB · Sistema de Gestión Bovina</span></footer>
    </div>
  </div>;
}

function Feature({permission,module,children}:{permission?:string;module?:string;children:ReactNode}){
  const {session,hasPermission}=useV2Session();const property=activeProperty(session!.overview);
  if(!property||permission&&!hasPermission(permission)||module&&!property.enabledModules.includes(module))
    return <Navigate to="/" replace/>;
  if(permission==='GROUP_VIEW'&&!property.enabledModules.some(code=>code==='PASTURES'||code==='CORRALS'))
    return <Navigate to="/" replace/>;
  if(!permission&&!module&&!property.enabledModules.some(code=>
    code==='TASKS'&&hasPermission('AGENDA_TASK_VIEW')||
    code==='EVENTS'&&hasPermission('AGENDA_EVENT_VIEW')))return <Navigate to="/" replace/>;
  return <>{children}</>;
}

function Panel({kind}:{kind:'animals'|'movements'|'reproduction'|'production'|'health'|
  'cleanings'|'activities'|'media'|'catalogs'|'settings'|'admin'}){
  const {session,hasPermission,reloadOverview,beginSupport}=useV2Session();const navigate=useNavigate();
  const {id}=useParams();
  const overview=session!.overview;const property=activeProperty(overview);const token=session!.accessToken;
  const modules=property?.enabledModules??[];
  const goAnimal=(section:'movements'|'health'|'reproduction'|'production',animal:{id:string})=>
    navigate(`/${{movements:'movimientos',health:'sanidad',reproduction:'reproduccion',production:'produccion'}[section]}?animal=${encodeURIComponent(animal.id)}&accion=${
      {movements:'GRUPO',health:'CONDICION',reproduction:'CELO',production:'LECHE'}[section]}`);
  const initialAnimalId=new URLSearchParams(window.location.search).get('animal')??undefined;
  switch(kind){
    case 'animals':return <AnimalPanel accessToken={token} canCreate={hasPermission('ANIMAL_CREATE')}
      canUpdate={hasPermission('ANIMAL_UPDATE')} canViewCatalogs={hasPermission('CATALOG_VIEW')}
      canManageBrands={hasPermission('CATALOG_MANAGE')}
      canViewMedia={hasPermission('MEDIA_VIEW')} canManageMedia={hasPermission('MEDIA_MANAGE')}
      canViewLocations={hasPermission('LOCATION_VIEW')} modules={modules} onNavigate={goAnimal}
      initialAnimalId={id??new URLSearchParams(window.location.search).get('animal')??undefined}
      initialCreate={new URLSearchParams(window.location.search).get('create')==='1'}
      initialEdit={new URLSearchParams(window.location.search).get('accion')==='EDITAR'}
      onBack={()=>navigate('/animales')}/>;
    case 'movements':return <MovementPanel accessToken={token} propertyId={property!.id}
      canManage={hasPermission('MOVEMENT_MANAGE')} canCancel={hasPermission('MOVEMENT_CANCEL')}
      canChangeLocation={hasPermission('LOCATION_MANAGE')} initialAnimalId={initialAnimalId}/>;
    case 'reproduction':return <ReproductionPanel accessToken={token}
      canManage={hasPermission('REPRODUCTION_MANAGE')} initialAnimalId={initialAnimalId}/>;
    case 'production':return <ProductionPanel accessToken={token}
      canManage={hasPermission('PRODUCTION_MANAGE')} initialAnimalId={initialAnimalId}/>;
    case 'health':return <HealthPanel accessToken={token}
      canManage={hasPermission('HEALTH_MANAGE')} canViewMedicines={hasPermission('CATALOG_VIEW')} initialAnimalId={initialAnimalId}/>;
    case 'cleanings':return <CleaningPanel accessToken={token}
      canManage={hasPermission('CLEANING_MANAGE')} canViewMedia={hasPermission('MEDIA_VIEW')}
      canEditProducts={Boolean(hasPermission('CATALOG_MANAGE')&&(overview.supportMode||['OWNER','ADMINISTRATOR'].includes(property?.roles.find(role=>role.id===overview.activeContext?.roleId)?.code??'')))}
      canManageMedia={hasPermission('MEDIA_MANAGE')}/>;
    case 'activities':return <ActivityPanel accessToken={token} canManage={hasPermission('ACTIVITY_MANAGE')}
      canViewMedia={hasPermission('MEDIA_VIEW')&&modules.includes('MULTIMEDIA')}
      canManageMedia={hasPermission('MEDIA_MANAGE')&&modules.includes('MULTIMEDIA')}/>;
    case 'media':return <MediaPanel accessToken={token}
      permissions={property?.roles.find(role=>role.id===overview.activeContext?.roleId)?.permissions??[]}/>;
    case 'catalogs':return <CatalogPanel accessToken={token} canManage={hasPermission('CATALOG_MANAGE')}
      commerceEnabled={modules.includes('SALES_PURCHASES')}
      canEditMedicines={Boolean(hasPermission('CATALOG_MANAGE')&&(overview.supportMode||['OWNER','ADMINISTRATOR'].includes(property?.roles.find(role=>role.id===overview.activeContext?.roleId)?.code??'')))}/>;
    case 'settings':return <V2SettingsPage/>;
    case 'admin':return <SuperadminPanel accessToken={token} onSettingsChanged={reloadOverview}
      onStartSupport={async(accountId,propertyId)=>{await beginSupport(accountId,propertyId);navigate('/');}}/>;
  }
}

function HomePage(){
  const {session,hasPermission}=useV2Session();const navigate=useNavigate();
  const property=activeProperty(session!.overview);
  const permissions=property?.roles.find(role=>role.id===session!.overview.activeContext?.roleId)?.permissions??[];
  const preferences=loadDashboardPreferences(session!.overview.user.id);
  const sections:Record<string,ReactNode>={
    pending:property&&<HomePendingTasks accessToken={session!.accessToken} userId={session!.overview.user.id}
      userName={session!.overview.user.displayName} propertyName={property.name}
      enabled={hasPermission('AGENDA_TASK_VIEW')&&property.enabledModules.includes('TASKS')}
      onNavigate={path=>navigate(path)}/>,
    animals:property&&hasPermission('ANIMAL_VIEW')&&<HomeSummary accessToken={session!.accessToken}
      items={preferences.animalItems} onAnimals={()=>navigate('/animales')}
      onGroups={hasPermission('GROUP_VIEW')?()=>navigate('/grupos'):undefined}
      onClassification={code=>navigate(`/animales?clasificacion=${encodeURIComponent(code)}`)}/>,
    operations:property&&<HomeOperations accessToken={session!.accessToken} userId={session!.overview.user.id}
      items={preferences.operationItems} userName={session!.overview.user.displayName} propertyName={property.name}
      modules={property.enabledModules} permissions={permissions} onNavigate={path=>navigate(path)}/>,
  };
  return <div className="module-no-header home-dashboard">
    {preferences.sections.filter(item=>item.visible).map(item=><div key={item.id}>{sections[item.id]}</div>)}
    {!property&&!session!.overview.user.isSuperadmin&&<p className="muted"><Link to="/roles-permisos">Selecciona una propiedad y un rol</Link> para gestionar tu ganado.</p>}
    {!property&&session!.overview.user.isSuperadmin&&<p><Link to="/administracion">Administrar cuentas</Link></p>}
  </div>;
}

function V2Routes(){
  const {session}=useV2Session();
  return <BrowserRouter><Routes>
    <Route element={<AuthLayout/>}>
      <Route path="/login" element={session?<Navigate to="/" replace/>:<V2Login/>}/>
      <Route path="/registro" element={<V2Register/>}/>
      <Route path="/cambiar-correo" element={<V2EmailChange/>}/>
      <Route path="/activar" element={<V2Verify/>}/>
      <Route path="/recuperar" element={<V2Recovery/>}/>
    </Route>
    <Route element={<Protected/>}><Route element={<V2Shell/>}>
      <Route index element={<HomePage/>}/>
      <Route path="animales" element={<Feature permission="ANIMAL_VIEW"><V2AnimalsPage/></Feature>}/>
      <Route path="animales/asistencia" element={<Feature permission="ANIMAL_VIEW"><V2AnimalAttendancePage/></Feature>}/>
      <Route path="animales/:id" element={<Feature permission="ANIMAL_VIEW"><V2AnimalDetail/></Feature>}/>
      <Route path="animales/gestionar" element={<Feature permission="ANIMAL_VIEW"><Panel kind="animals"/></Feature>}/>
      <Route path="grupos" element={<Feature permission="GROUP_VIEW"><V2GroupsPage/></Feature>}/>
      <Route path="potreros" element={<Feature permission="LOCATION_VIEW" module="PASTURES"><V2LocationsPage kind="PASTURE"/></Feature>}/>
      <Route path="corrales" element={<Feature permission="LOCATION_VIEW" module="CORRALS"><V2LocationsPage kind="CORRAL"/></Feature>}/>
      <Route path="movimientos" element={<Feature permission="MOVEMENT_VIEW" module="MOVEMENTS"><Panel kind="movements"/></Feature>}/>
      <Route path="pesajes" element={<Feature permission="WEIGHING_VIEW" module="WEIGHING"><V2WeighingsPage/></Feature>}/>
      <Route path="bajas" element={<Feature permission="ANIMAL_VIEW"><V2AnimalStatusPage/></Feature>}/>
      <Route path="ventas" element={<Feature permission="COMMERCE_VIEW" module="SALES_PURCHASES"><V2CommercePage kind="SALE"/></Feature>}/>
      <Route path="compras" element={<Feature permission="COMMERCE_VIEW" module="SALES_PURCHASES"><V2CommercePage kind="PURCHASE"/></Feature>}/>
      <Route path="agenda" element={<Feature><V2AgendaPage/></Feature>}/>
      <Route path="finanzas" element={<Feature permission="FINANCE_VIEW" module="PROPERTY_FINANCE"><V2FinancesPage scope="property"/></Feature>}/>
      <Route path="mis-finanzas" element={session?.overview.enabledUserModules.includes('PERSONAL_FINANCE')
        ?<V2FinancesPage scope="personal"/>:<Navigate to="/" replace/>}/>
      <Route path="reproduccion" element={<Feature permission="REPRODUCTION_VIEW" module="REPRODUCTION"><Panel kind="reproduction"/></Feature>}/>
      <Route path="produccion" element={<Feature permission="PRODUCTION_VIEW" module="PRODUCTION"><Panel kind="production"/></Feature>}/>
      <Route path="sanidad" element={<Feature permission="HEALTH_VIEW" module="HEALTH"><Panel kind="health"/></Feature>}/>
      <Route path="limpiezas" element={<Feature permission="CLEANING_VIEW" module="PASTURE_CLEANING"><Panel kind="cleanings"/></Feature>}/>
      <Route path="actividades" element={<Feature permission="ACTIVITY_VIEW" module="TASKS"><Panel kind="activities"/></Feature>}/>
      <Route path="multimedia" element={<Feature permission="MEDIA_VIEW" module="MULTIMEDIA"><Panel kind="media"/></Feature>}/>
      <Route path="catalogos" element={<Feature permission="CATALOG_VIEW"><Panel kind="catalogs"/></Feature>}/>
      <Route path="sin-conexion" element={<V2OfflinePage/>}/>
      <Route path="equipo" element={<Navigate to="/roles-permisos" replace/>}/>
      <Route path="roles-permisos" element={<RolesPermissionsPage/>}/>
      <Route path="auditoria" element={<Feature permission="AUDIT_VIEW"><V2AuditPage/></Feature>}/>
      <Route path="configuracion" element={<Panel kind="settings"/>}/>
      <Route path="administracion" element={session?.overview.user.isSuperadmin?<Panel kind="admin"/>:<Navigate to="/" replace/>}/>
      <Route path="*" element={<Navigate to="/" replace/>}/>
    </Route></Route>
  </Routes></BrowserRouter>;
}

function V2Appearance({children}:{children:ReactNode}){
  const {session}=useV2Session();const userId=session?.overview.user.id;
  return <ThemeProvider key={userId??'guest'} userId={userId}>{children}</ThemeProvider>;
}

export function V2App(){
  const url=new URL(window.location.href);
  const verification=url.searchParams.get('verify-email');
  const reset=url.searchParams.get('reset-password');
  const emailChange=url.searchParams.get('change-email');
  if(emailChange&&url.pathname!=='/cambiar-correo')window.history.replaceState({},'',`/cambiar-correo${url.search}`);
  else if(verification&&url.pathname!=='/activar')window.history.replaceState({},'',`/activar${url.search}`);
  else if(reset&&url.pathname!=='/recuperar')window.history.replaceState({},'',`/recuperar${url.search}`);
  return <V2SessionProvider><V2Appearance><V2OfflineProvider><V2Routes/></V2OfflineProvider></V2Appearance></V2SessionProvider>;
}
