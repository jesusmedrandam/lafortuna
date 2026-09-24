import {useMemo,useState,type ReactNode} from 'react';
import {Baby,Beef,ChevronRight,Droplets,HeartPulse,Home,Images,LayoutDashboard,LogOut,
  Menu,Moon,Settings2,ShieldCheck,SlidersHorizontal,Sun,Users,Warehouse,ArrowLeftRight,
  Activity,Sprout,Milk,UserCircle,X} from 'lucide-react';
import {BrowserRouter,Link,NavLink,Navigate,Outlet,Route,Routes,useLocation,useNavigate,useParams} from 'react-router-dom';
import {AuthLayout} from '../pages/auth/AuthLayout';
import {IconButton,LoadingState} from '../components/ui';
import {useTheme} from '../theme/ThemeContext';
import {ActivityPanel} from './ActivityPanel';
import {AnimalPanel} from './AnimalPanel';
import {CatalogPanel} from './CatalogPanel';
import {CleaningPanel} from './CleaningPanel';
import {GroupPanel} from './GroupPanel';
import {HealthPanel} from './HealthPanel';
import {HomeSummary} from './HomeSummary';
import {MediaPanel} from './MediaPanel';
import {MovementPanel} from './MovementPanel';
import {ProductionPanel} from './ProductionPanel';
import {PropertySettingsPanel} from './PropertySettingsPanel';
import {PropertyTeamPanel} from './PropertyTeamPanel';
import {ReproductionPanel} from './ReproductionPanel';
import {SuperadminPanel} from './SuperadminPanel';
import {V2Login,V2Recovery,V2Register,V2Verify} from './AuthPages';
import {V2AnimalsPage} from './V2AnimalsPage';
import {V2AnimalDetail} from './V2AnimalDetail';
import {V2SessionProvider,useV2Session} from './V2Session';
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
  {to:'/sanidad',label:'Sanidad',icon:HeartPulse,section:'operaciones',permission:'HEALTH_VIEW',module:'HEALTH'},
  {to:'/limpiezas',label:'Limpieza potreros',icon:Droplets,section:'operaciones',permission:'CLEANING_VIEW',module:'PASTURE_CLEANING'},
  {to:'/reproduccion',label:'Reproducción',icon:Baby,section:'operaciones',permission:'REPRODUCTION_VIEW',module:'REPRODUCTION'},
  {to:'/produccion',label:'Producción',icon:Milk,section:'operaciones',permission:'PRODUCTION_VIEW',module:'PRODUCTION'},
  {to:'/actividades',label:'Actividades',icon:Activity,section:'operaciones',permission:'ACTIVITY_VIEW',module:'TASKS'},
  {to:'/catalogos',label:'Catálogos',icon:SlidersHorizontal,section:'configuracion',permission:'CATALOG_VIEW'},
  {to:'/equipo',label:'Equipo y roles',icon:Users,section:'configuracion',permission:'MEMBERSHIP_VIEW'},
  {to:'/configuracion',label:'Configuración',icon:Settings2,section:'configuracion',permission:'MODULE_VIEW'},
  {to:'/administracion',label:'Administración',icon:ShieldCheck,section:'configuracion',admin:true},
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
  const {session,signOut,selectContext,hasPermission}=useV2Session();const {theme,toggleTheme}=useTheme();
  const [open,setOpen]=useState(false);const [changing,setChanging]=useState(false);
  const [error,setError]=useState('');const location=useLocation();const navigate=useNavigate();
  const overview=session!.overview;const property=activeProperty(overview);
  const role=property?.roles.find(item=>item.id===overview.activeContext?.roleId);
  const visible=useMemo(()=>destinations.filter(item=>{
    if(item.admin)return overview.user.isSuperadmin;
    if(item.to==='/')return true;
    if(!property||item.permission&&!hasPermission(item.permission))return false;
    if(item.module&&!property.enabledModules.includes(item.module))return false;
    if(item.to==='/grupos'&&!property.enabledModules.some(code=>code==='PASTURES'||code==='CORRALS'))return false;
    if(item.to==='/limpiezas'&&!property.enabledModules.includes('PASTURES'))return false;
    return true;
  }),[overview,property,hasPermission]);
  const current=visible.find(item=>item.to===location.pathname)||visible.find(item=>
    item.to!=='/'&&location.pathname.startsWith(`${item.to}/`));
  async function switchProperty(id:string){
    const next=overview.properties.find(item=>item.id===id);if(!next?.roles[0])return;
    setChanging(true);setError('');try{await selectContext(id,next.roles[0].id);navigate('/');}
    catch(reason){setError(reason instanceof Error?reason.message:'No se pudo cambiar de propiedad.');}
    finally{setChanging(false);}
  }
  async function switchRole(id:string){
    if(!property)return;setChanging(true);setError('');
    try{await selectContext(property.id,id);navigate('/');}
    catch(reason){setError(reason instanceof Error?reason.message:'No se pudo cambiar de rol.');}
    finally{setChanging(false);}
  }
  return <div className="app-shell sgb-v2-shell">
    {open&&<button className="mobile-overlay" aria-label="Cerrar menú" onClick={()=>setOpen(false)}/>}
    <aside className={`sidebar ${open?'sidebar-open':''}`}>
      <div className="sidebar-brand"><img src="/branding/logo-sgb-icon.png" alt="SGB"/>
        <div><strong>SGB</strong><span>Gestión Bovina</span></div>
        <IconButton label="Cerrar menú" className="sidebar-close" onClick={()=>setOpen(false)}><X size={20}/></IconButton></div>
      <div className="v2-property-picker"><label htmlFor="active-property">Propiedad activa</label>
        <select id="active-property" value={property?.id??''} disabled={changing||!overview.properties.length}
          onChange={event=>void switchProperty(event.target.value)}>
          {!property&&<option value="">Selecciona una propiedad</option>}
          {overview.properties.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
        </select>{property&&property.roles.length>1?<select aria-label="Rol activo" value={role?.id??''}
          disabled={changing} onChange={event=>void switchRole(event.target.value)}>
          {property.roles.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
        </select>:<small>{role?.name??'Sin rol activo'}</small>}</div>
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
      <div className="sidebar-user"><div className="user-avatar"><span>{overview.user.displayName.slice(0,1)}</span></div>
        <div><strong>{overview.user.displayName}</strong><span>{overview.user.isSuperadmin?'Superadministrador':role?.name??'Usuario'}</span></div>
        <IconButton label="Cerrar sesión" onClick={()=>void signOut()}><LogOut size={18}/></IconButton>
      </div>
    </aside>
    <div className="shell-main"><header className="topbar"><div className="topbar-left">
      <IconButton label="Abrir menú" className="mobile-menu-button" onClick={()=>setOpen(true)}><Menu size={22}/></IconButton>
      <div><span className="breadcrumb">Sistema de Gestión Bovina</span><h2>{current?.label??'Gestión ganadera'}</h2></div>
    </div><div className="topbar-actions"><span className="v2-current-property">{property?.name??'Sin propiedad'}</span>
      <IconButton label={theme==='dark'?'Usar tema claro':'Usar tema oscuro'} onClick={toggleTheme}>
        {theme==='dark'?<Sun size={19}/>:<Moon size={19}/>}</IconButton>
      <span className="profile-link"><UserCircle size={21}/><span>{overview.user.displayName}</span></span>
    </div></header><main className="page-content">{error&&<div className="form-alert form-alert-error" role="alert">{error}</div>}
      <Outlet key={`${overview.activeContext?.propertyId??'none'}:${overview.activeContext?.roleId??'none'}`}/></main>
      <footer className="app-footer"><Home size={14}/><span>SGB · Sistema de Gestión Bovina</span></footer>
    </div>
  </div>;
}

function Feature({permission,module,children}:{permission?:string;module?:string;children:ReactNode}){
  const {session,hasPermission}=useV2Session();const property=activeProperty(session!.overview);
  if(!property||permission&&!hasPermission(permission)||module&&!property.enabledModules.includes(module))
    return <Navigate to="/" replace/>;
  return <>{children}</>;
}

function Panel({kind}:{kind:'animals'|'groups'|'movements'|'reproduction'|'production'|'health'|
  'cleanings'|'activities'|'media'|'catalogs'|'team'|'settings'|'admin'}){
  const {session,hasPermission,reloadOverview,selectContext}=useV2Session();const navigate=useNavigate();
  const {id}=useParams();
  const overview=session!.overview;const property=activeProperty(overview);const token=session!.accessToken;
  const modules=property?.enabledModules??[];
  const goAnimal=(section:'movements'|'health'|'reproduction'|'production',animal:{id:string})=>
    navigate(`/${{movements:'movimientos',health:'sanidad',reproduction:'reproduccion',production:'produccion'}[section]}?animal=${encodeURIComponent(animal.id)}`);
  const initialAnimalId=new URLSearchParams(window.location.search).get('animal')??undefined;
  switch(kind){
    case 'animals':return <AnimalPanel accessToken={token} canCreate={hasPermission('ANIMAL_CREATE')}
      canUpdate={hasPermission('ANIMAL_UPDATE')} canViewCatalogs={hasPermission('CATALOG_VIEW')}
      canManageBrands={hasPermission('CATALOG_MANAGE')}
      canViewMedia={hasPermission('MEDIA_VIEW')} canManageMedia={hasPermission('MEDIA_MANAGE')}
      canViewLocations={hasPermission('LOCATION_VIEW')} modules={modules} onNavigate={goAnimal}
      initialAnimalId={id??new URLSearchParams(window.location.search).get('animal')??undefined}
      initialCreate={new URLSearchParams(window.location.search).get('create')==='1'}
      onBack={()=>navigate('/animales')}/>;
    case 'groups':return <GroupPanel accessToken={token} modules={modules}
      canManage={hasPermission('GROUP_MANAGE')} canViewLocations={hasPermission('LOCATION_VIEW')}
      canManageLocations={hasPermission('LOCATION_MANAGE')}/>;
    case 'movements':return <MovementPanel accessToken={token} propertyId={property!.id}
      canManage={hasPermission('MOVEMENT_MANAGE')} canCancel={hasPermission('MOVEMENT_CANCEL')}
      canChangeLocation={hasPermission('LOCATION_MANAGE')} initialAnimalId={initialAnimalId}/>;
    case 'reproduction':return <ReproductionPanel accessToken={token}
      canManage={hasPermission('REPRODUCTION_MANAGE')} initialAnimalId={initialAnimalId}/>;
    case 'production':return <ProductionPanel accessToken={token}
      canManage={hasPermission('PRODUCTION_MANAGE')} initialAnimalId={initialAnimalId}/>;
    case 'health':return <HealthPanel accessToken={token}
      canManage={hasPermission('HEALTH_MANAGE')} initialAnimalId={initialAnimalId}/>;
    case 'cleanings':return <CleaningPanel accessToken={token}
      canManage={hasPermission('CLEANING_MANAGE')} canViewMedia={hasPermission('MEDIA_VIEW')}
      canManageMedia={hasPermission('MEDIA_MANAGE')}/>;
    case 'activities':return <ActivityPanel accessToken={token} canManage={hasPermission('ACTIVITY_MANAGE')}/>;
    case 'media':return <MediaPanel accessToken={token}
      permissions={property?.roles.find(role=>role.id===overview.activeContext?.roleId)?.permissions??[]}/>;
    case 'catalogs':return <CatalogPanel accessToken={token} canManage={hasPermission('CATALOG_MANAGE')}/>;
    case 'team':return <PropertyTeamPanel accessToken={token}/>;
    case 'settings':return <PropertySettingsPanel accessToken={token}
      onPropertyCreated={async(propertyId,roleId)=>{await selectContext(propertyId,roleId);navigate('/');}}
      onSettingsChanged={reloadOverview}/>;
    case 'admin':return <SuperadminPanel accessToken={token} onSettingsChanged={reloadOverview}/>;
  }
}

function HomePage(){
  const {session,hasPermission}=useV2Session();const navigate=useNavigate();
  const property=activeProperty(session!.overview);
  return <div className="module-no-header"><div className="welcome-card"><div><span className="eyebrow">Panel principal</span>
    <h1>Hola, {session!.overview.user.displayName.split(' ')[0]}</h1>
    <p>{property?`Trabajando en ${property.name}.`:'Selecciona una propiedad para gestionar tu ganado.'}</p></div>
    <div className="access-badge"><span>✓</span><div><strong>Acceso verificado</strong>
      <small>{session!.overview.user.email}</small></div></div></div>
    {property&&hasPermission('ANIMAL_VIEW')&&<HomeSummary accessToken={session!.accessToken}
      onAnimals={()=>navigate('/animales')} onGroups={hasPermission('GROUP_VIEW')
        ?()=>navigate('/grupos'):undefined}
      onClassification={code=>navigate(`/animales?clasificacion=${encodeURIComponent(code)}`)}/>}
    {!property&&session!.overview.user.isSuperadmin&&<p><Link to="/administracion">Administrar cuentas</Link></p>}
  </div>;
}

function V2Routes(){
  const {session}=useV2Session();
  return <BrowserRouter><Routes>
    <Route element={<AuthLayout/>}>
      <Route path="/login" element={session?<Navigate to="/" replace/>:<V2Login/>}/>
      <Route path="/registro" element={<V2Register/>}/>
      <Route path="/activar" element={<V2Verify/>}/>
      <Route path="/recuperar" element={<V2Recovery/>}/>
    </Route>
    <Route element={<Protected/>}><Route element={<V2Shell/>}>
      <Route index element={<HomePage/>}/>
      <Route path="animales" element={<Feature permission="ANIMAL_VIEW"><V2AnimalsPage/></Feature>}/>
      <Route path="animales/:id" element={<Feature permission="ANIMAL_VIEW"><V2AnimalDetail/></Feature>}/>
      <Route path="animales/gestionar" element={<Feature permission="ANIMAL_VIEW"><Panel kind="animals"/></Feature>}/>
      <Route path="grupos" element={<Feature permission="GROUP_VIEW"><Panel kind="groups"/></Feature>}/>
      <Route path="potreros" element={<Feature permission="LOCATION_VIEW" module="PASTURES"><Panel kind="groups"/></Feature>}/>
      <Route path="corrales" element={<Feature permission="LOCATION_VIEW" module="CORRALS"><Panel kind="groups"/></Feature>}/>
      <Route path="movimientos" element={<Feature permission="MOVEMENT_VIEW" module="MOVEMENTS"><Panel kind="movements"/></Feature>}/>
      <Route path="reproduccion" element={<Feature permission="REPRODUCTION_VIEW" module="REPRODUCTION"><Panel kind="reproduction"/></Feature>}/>
      <Route path="produccion" element={<Feature permission="PRODUCTION_VIEW" module="PRODUCTION"><Panel kind="production"/></Feature>}/>
      <Route path="sanidad" element={<Feature permission="HEALTH_VIEW" module="HEALTH"><Panel kind="health"/></Feature>}/>
      <Route path="limpiezas" element={<Feature permission="CLEANING_VIEW" module="PASTURE_CLEANING"><Panel kind="cleanings"/></Feature>}/>
      <Route path="actividades" element={<Feature permission="ACTIVITY_VIEW" module="TASKS"><Panel kind="activities"/></Feature>}/>
      <Route path="multimedia" element={<Feature permission="MEDIA_VIEW" module="MULTIMEDIA"><Panel kind="media"/></Feature>}/>
      <Route path="catalogos" element={<Feature permission="CATALOG_VIEW"><Panel kind="catalogs"/></Feature>}/>
      <Route path="equipo" element={<Feature permission="MEMBERSHIP_VIEW"><Panel kind="team"/></Feature>}/>
      <Route path="configuracion" element={<Feature permission="MODULE_VIEW"><Panel kind="settings"/></Feature>}/>
      <Route path="administracion" element={session?.overview.user.isSuperadmin?<Panel kind="admin"/>:<Navigate to="/" replace/>}/>
      <Route path="*" element={<Navigate to="/" replace/>}/>
    </Route></Route>
  </Routes></BrowserRouter>;
}

export function V2App(){
  const url=new URL(window.location.href);
  const verification=url.searchParams.get('verify-email');
  const reset=url.searchParams.get('reset-password');
  if(verification&&url.pathname!=='/activar')window.history.replaceState({},'',`/activar${url.search}`);
  else if(reset&&url.pathname!=='/recuperar')window.history.replaceState({},'',`/recuperar${url.search}`);
  return <V2SessionProvider><V2Routes/></V2SessionProvider>;
}
