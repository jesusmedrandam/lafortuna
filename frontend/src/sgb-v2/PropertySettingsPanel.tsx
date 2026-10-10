import {type FormEvent,useEffect,useState} from 'react';
import {Plus,SlidersHorizontal,Pencil} from 'lucide-react';
import {useLocation,useNavigate,useSearchParams} from 'react-router-dom';
import {Button,IconButton} from '../components/ui';
import {createAccountProperty,getPropertySettings,updatePropertyInformation,updatePropertyModule,type PropertySettings} from './api';
import {PropertyInformationFields,propertyInformationFrom} from './PropertyInformationFields';
import {useV2Session} from './V2Session';

export function PropertySettingsPanel({accessToken,onPropertyCreated,onSettingsChanged}:{accessToken:string;
 onPropertyCreated:(propertyId:string,roleId:string)=>Promise<void>;onSettingsChanged:()=>Promise<void>}){
 const {session,selectContext}=useV2Session();const overview=session!.overview;const selected=overview.activeContext?.propertyId;
 const [params,setParams]=useSearchParams();const screen=params.get('accion');const navigate=useNavigate();const location=useLocation();
 const [settings,setSettings]=useState<PropertySettings|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{let active=true;setSettings(null);setError('');void getPropertySettings(accessToken).then(value=>{if(active)setSettings(value);})
  .catch(reason=>{if(active)setError(message(reason));});return()=>{active=false;};},[accessToken,selected]);
 function open(value:string){const next=new URLSearchParams(params);next.set('accion',value);setParams(next,{state:{propertyOption:true}});}
 async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();if(busy)return;
  const input=propertyInformationFrom(event.currentTarget);setBusy(true);setError('');
  try{if(screen==='crear'){const result=await createAccountProperty(accessToken,input);await onPropertyCreated(result.propertyId,result.roleId);}
   else{await updatePropertyInformation(accessToken,input);setSettings(await getPropertySettings(accessToken));await onSettingsChanged();}
   if(location.state?.propertyOption)navigate(-1);else setParams({seccion:'propiedad'},{replace:true});
  }catch(reason){setError(message(reason));}finally{setBusy(false);}
 }
 async function changeModule(code:string,enabled:boolean){setBusy(true);setError('');
  try{await updatePropertyModule(accessToken,code,enabled);setSettings(await getPropertySettings(accessToken));await onSettingsChanged();}
  catch(reason){setError(message(reason));}finally{setBusy(false);}
 }
 const groups=[{title:'Mis propiedades',items:overview.properties.filter(item=>item.isOwner)},
  {title:'Colaboro en',items:overview.properties.filter(item=>!item.isOwner)}];
 return <section className="property-settings-panel">
  {error&&<p className="form-error" role="alert">{error}</p>}
  {!screen&&<>{groups.map(group=><section className="property-selector-group" key={group.title}><h2>{group.title}</h2>
   {group.items.length?<div className="property-circle-list">{group.items.map(item=><button key={item.id} type="button"
    aria-pressed={item.id===selected} disabled={busy} onClick={()=>{setBusy(true);setError('');
     const role=item.roles.find(value=>value.id===overview.activeContext?.roleId)??item.roles[0];if(!role){setBusy(false);return;}
     void selectContext(item.id,role.id).catch(reason=>setError(message(reason))).finally(()=>setBusy(false));}}>
    <span className="property-circle">{item.name.trim().split(/\s+/).slice(0,2).map(word=>word[0]).join('').toLocaleUpperCase()}</span><span>{item.name}</span>
   </button>)}</div>:<p className="muted">{group.title==='Mis propiedades'?'Todavía no tienes propiedades propias.':'No tienes colaboraciones activas.'}</p>}
  </section>)}
  {settings&&<><div className="property-info-heading"><h2>{settings.property.name}</h2>{settings.canManageModules&&
   <IconButton label="Editar información de la propiedad" onClick={()=>open('editar')}><Pencil size={18}/></IconButton>}</div>
   <dl className="property-information"><div><dt>Propietario</dt><dd>{settings.property.ownerName||'Sin registrar'}</dd></div>
    <div><dt>Extensión</dt><dd>{settings.property.areaValue==null?'Sin registrar':`${settings.property.areaValue.toLocaleString('es-EC')} ${settings.property.areaUnitCode==='HECTARE'?'ha':'m²'}`}</dd></div>
    <div><dt>Ubicación</dt><dd>{settings.property.address||'Sin registrar'}</dd></div><div><dt>Cuenta</dt><dd>{settings.account.name}</dd></div></dl>
   <div className="inline-actions">{settings.canViewModules&&<Button variant="secondary" onClick={()=>open('politicas')}><SlidersHorizontal size={18}/>Políticas de operación</Button>}
    {settings.canCreate&&settings.account.usedProperties<settings.account.maxProperties&&<Button onClick={()=>open('crear')}><Plus size={18}/>Crear propiedad</Button>}</div>
  </>}
  </>}
  {!settings&&!error&&<p role="status">Cargando propiedad…</p>}
  {settings&&(screen==='crear'&&settings.canCreate||screen==='editar'&&settings.canManageModules)&&<form onSubmit={save}>
   <h2>{screen==='crear'?'Crear propiedad':'Información de la propiedad'}</h2><fieldset disabled={busy}>
    <PropertyInformationFields key={`${screen}-${selected}`} value={screen==='editar'?settings.property:undefined} ownerName={overview.user.displayName}/>
    <Button type="submit" loading={busy}>{screen==='crear'?'Crear propiedad':'Guardar información'}</Button></fieldset></form>}
  {settings&&screen==='politicas'&&settings.canViewModules&&<><h2>Políticas de operación</h2><p className="muted">{settings.property.name}</p>
   <div className="property-module-grid">{settings.modules.map(module=><div className="property-module-row" key={module.code}>
    <div><strong>{module.name}</strong><small>{module.isCore?'Siempre activo':!module.accountEnabled?'Deshabilitado para la cuenta':module.enabled?'Activo':'Inactivo'}</small></div>
    <label className="property-module-toggle"><input type="checkbox" checked={module.enabled}
     disabled={busy||!settings.canManageModules||module.isCore||!module.accountEnabled}
     onChange={event=>void changeModule(module.code,event.target.checked)} aria-label={`${module.name} en esta propiedad`}/></label>
   </div>)}</div></>}
 </section>;
}
function message(reason:unknown){return reason instanceof Error?reason.message:'No fue posible completar la operación.';}
