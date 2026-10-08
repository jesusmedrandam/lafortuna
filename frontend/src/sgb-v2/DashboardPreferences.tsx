import {useState} from 'react';
import {ArrowDown,ArrowUp} from 'lucide-react';
import {IconButton} from '../components/ui';

export const dashboardOptions={
  sections:[{id:'pending',label:'Actividades pendientes'},{id:'animals',label:'Animales'},
    {id:'operations',label:'Resumen operativo'}],
  animalItems:[{id:'total',label:'Total de animales'},{id:'sex',label:'Hembras y machos'},
    {id:'classification',label:'Clasificación'},{id:'groups',label:'Grupos'}],
  operationItems:[{id:'weighings',label:'Pesajes'},{id:'health',label:'Sanidad'},
    {id:'production',label:'Producción lechera'},{id:'reproduction',label:'Reproducción'},
    {id:'movements',label:'Movimientos'},{id:'status',label:'Bajas y novedades'},
    {id:'catalogs',label:'Catálogos'}],
};
export interface DashboardItem {id:string;visible:boolean}
export type DashboardPreferences=Record<keyof typeof dashboardOptions,DashboardItem[]>;
const preferenceKey=(userId:string)=>`sgb:dashboard:${userId}`;

export function normalizeDashboardPreferences(value:unknown):DashboardPreferences{
  const saved=value&&typeof value==='object'?value as Record<string,unknown>:{};
  return Object.fromEntries(Object.entries(dashboardOptions).map(([key,options])=>{
    const stored=Array.isArray(saved[key])?saved[key]:[];
    const items:DashboardItem[]=[];
    for(const item of stored){
      if(item&&typeof item==='object'&&options.some(option=>option.id===item.id)
        &&!items.some(previous=>previous.id===item.id))
        items.push({id:item.id,visible:item.visible!==false});
    }
    for(const option of options)if(!items.some(item=>item.id===option.id))items.push({id:option.id,visible:true});
    return [key,items];
  })) as DashboardPreferences;
}
export function loadDashboardPreferences(userId:string):DashboardPreferences{
  try{return normalizeDashboardPreferences(JSON.parse(localStorage.getItem(preferenceKey(userId))??'null'));}
  catch{return normalizeDashboardPreferences(null);}
}
export function saveDashboardPreferences(userId:string,value:DashboardPreferences){
  localStorage.setItem(preferenceKey(userId),JSON.stringify(normalizeDashboardPreferences(value)));
}

export function DashboardPreferencesEditor({userId}:{userId:string}){
  const [draft,setDraft]=useState(()=>loadDashboardPreferences(userId));
  const [notice,setNotice]=useState('');const [error,setError]=useState('');
  const labels={sections:'Secciones del panel',animalItems:'Elementos de Animales',operationItems:'Elementos del resumen operativo'};
  function move(key:keyof DashboardPreferences,index:number,offset:number){
    setDraft(current=>{const rows=[...current[key]];const destination=index+offset;
      if(destination<0||destination>=rows.length)return current;
      [rows[index],rows[destination]]=[rows[destination],rows[index]];return {...current,[key]:rows};});
    setNotice('');
  }
  function save(){
    try{saveDashboardPreferences(userId,draft);setError('');setNotice('Tu panel se ha guardado.');}
    catch{setError('No se pudo guardar la configuración en este dispositivo.');}
  }
  return <section className="section-block dashboard-settings" aria-labelledby="dashboard-settings-title">
    <div className="section-heading"><div><h2 id="dashboard-settings-title">Mi panel</h2>
      <p className="muted">Elige qué ver y en qué orden. Esta configuración es tuya y se guarda en este dispositivo.</p></div></div>
    {Object.entries(dashboardOptions).map(([group,options])=>{
      const key=group as keyof DashboardPreferences;
      return <fieldset key={key} className="dashboard-settings-group"><legend>{labels[key]}</legend>
        {draft[key].map((item,index)=>{const label=options.find(option=>option.id===item.id)!.label;
          return <div key={item.id} className="dashboard-settings-row">
            <label><input type="checkbox" checked={item.visible} onChange={event=>{
              setDraft(current=>({...current,[key]:current[key].map(row=>row.id===item.id?
                {...row,visible:event.target.checked}:row)}));setNotice('');}}/>{label}</label>
            <IconButton label={`Subir ${label}`} disabled={index===0} onClick={()=>move(key,index,-1)}><ArrowUp size={18}/></IconButton>
            <IconButton label={`Bajar ${label}`} disabled={index===draft[key].length-1} onClick={()=>move(key,index,1)}><ArrowDown size={18}/></IconButton>
          </div>;})}
      </fieldset>;
    })}
    <div className="inline-actions"><button type="button" className="secondary-button compact"
      onClick={()=>{setDraft(normalizeDashboardPreferences(null));setNotice('');}}>Restablecer orden inicial</button>
      <button type="button" className="primary-button compact" onClick={save}>Guardar mi panel</button></div>
    {notice&&<p role="status" className="form-success">{notice}</p>}
    {error&&<p role="alert" className="form-error">{error}</p>}
  </section>;
}
