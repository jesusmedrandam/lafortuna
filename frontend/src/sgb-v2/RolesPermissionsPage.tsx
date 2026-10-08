import {useState} from 'react';
import {Link,useNavigate} from 'react-router-dom';
import {Select} from '../components/ui';
import {useV2Session} from './V2Session';
import {PropertyTeamPanel} from './PropertyTeamPanel';

const resources:Record<string,string>={ANIMAL:'animales',GROUP:'grupos',LOCATION:'ubicaciones',
  MEMBERSHIP:'colaboradores',MODULE:'módulos',MEDIA:'multimedia',CATALOG:'catálogos',
  MOVEMENT:'movimientos',WEIGHING:'pesajes',HEALTH:'sanidad',CLEANING:'limpiezas',
  REPRODUCTION:'reproducción',PRODUCTION:'producción',ACTIVITY:'actividades',
  AGENDA_TASK:'tareas de agenda',AGENDA_EVENT:'eventos',COMMERCE:'compras y ventas',
  FINANCE:'finanzas',AUDIT:'auditoría',NOTIFICATION:'notificaciones'};
const actions:Record<string,string>={VIEW:'Consultar',CREATE:'Crear',UPDATE:'Editar',
  MANAGE:'Administrar',CANCEL:'Anular',DELETE:'Eliminar'};
function permissionLabel(permission:string){
  const split=permission.lastIndexOf('_');const resource=permission.slice(0,split);const action=permission.slice(split+1);
  return `${actions[action]??action.toLocaleLowerCase('es')} ${resources[resource]??resource.replaceAll('_',' ').toLocaleLowerCase('es')}`;
}
export function RolesPermissionsPage(){
  const {session,selectContext,hasPermission}=useV2Session();const navigate=useNavigate();
  const overview=session!.overview;
  const properties=overview.memberProperties??overview.properties.filter(item=>item.roles.every(role=>role.code!=='SUPERADMIN'));
  const active=properties.find(item=>item.id===overview.activeContext?.propertyId);
  const [propertyId,setPropertyId]=useState(active?.id??properties[0]?.id??'');
  const property=properties.find(item=>item.id===propertyId);
  const [roleId,setRoleId]=useState(active?.roles.some(item=>item.id===overview.activeContext?.roleId)
    ?overview.activeContext!.roleId:property?.roles[0]?.id??'');
  const role=property?.roles.find(item=>item.id===roleId);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function apply(){if(!property||!role)return;setBusy(true);setError('');
    try{await selectContext(property.id,role.id);navigate('/');}
    catch(failure){setError(failure instanceof Error?failure.message:'No se pudo cambiar de rol.');}
    finally{setBusy(false);}}
  return <div className="roles-permissions-page">
    <section className="section-block"><div className="section-heading"><div><h2>Roles y permisos</h2>
      <p className="muted">Selecciona la propiedad y el rol con el que deseas trabajar.</p></div></div>
      <div className="field-pair"><label><span>Propiedad</span><Select value={propertyId} disabled={busy}
        onChange={event=>{const next=properties.find(item=>item.id===event.target.value);
          setPropertyId(event.target.value);setRoleId(next?.roles[0]?.id??'');}}>
        {!property&&<option value="">Sin propiedades disponibles</option>}
        {properties.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
      </Select></label><label><span>Rol</span><Select value={roleId} disabled={busy||!property}
        onChange={event=>setRoleId(event.target.value)}>
        {!role&&<option value="">Sin roles disponibles</option>}
        {property?.roles.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
      </Select></label></div>
      {role&&<div className="role-permission-list"><h3>Permisos de {role.name}</h3>
        <ul>{role.permissions.map(permission=><li key={permission}>{permissionLabel(permission)}</li>)}</ul>
        {!role.permissions.length&&<p className="muted">Este rol no tiene permisos asignados.</p>}</div>}
      <button type="button" className="primary-button compact" disabled={busy||!role} onClick={()=>void apply()}>
        {busy?'Aplicando…':'Usar este rol'}</button>
      {overview.user.isSuperadmin&&<p>Estos son tus roles de usuario. <Link to="/administracion">Abrir superadministrador</Link></p>}
      {error&&<p className="form-error" role="alert">{error}</p>}
    </section>
    {hasPermission('MEMBERSHIP_VIEW')&&<PropertyTeamPanel accessToken={session!.accessToken}/>}
  </div>;
}
