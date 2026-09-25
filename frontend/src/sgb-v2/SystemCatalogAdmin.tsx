import {useEffect,useState,type FormEvent} from 'react';
import {createSystemCatalogItem,getSystemCatalog,updateSystemCatalogItem,
  type SystemCatalogCode,type SystemCatalogItem} from './api';

const catalogNames:Record<SystemCatalogCode,string>={
  BREEDS:'Razas',COLORS:'Colores',GRASS_TYPES:'Pastos',
  HEALTH_CONDITION_TYPES:'Problemas de salud',AGROCHEMICAL_CATEGORIES:'Categorías de productos',
  MEDIA_TAGS:'Etiquetas multimedia',MOVEMENT_REASONS:'Motivos de movimiento',
  TREATMENT_TYPES:'Tipos de tratamiento',
};
const codes=Object.keys(catalogNames) as SystemCatalogCode[];

export function SystemCatalogAdmin({token}:{token:string}){
  const [code,setCode]=useState<SystemCatalogCode>('BREEDS');
  const [items,setItems]=useState<SystemCatalogItem[]|null>(null);
  const [name,setName]=useState('');const [editing,setEditing]=useState<string|null>(null);
  const [editName,setEditName]=useState('');const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{let active=true;setItems(null);setError('');setEditing(null);
    void getSystemCatalog(token,code).then(rows=>{if(active)setItems(rows);})
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'No se pudo cargar el catálogo.');});
    return()=>{active=false;};},[token,code]);
  async function create(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');
    try{const item=await createSystemCatalogItem(token,code,name.trim());
      setItems(rows=>[...(rows??[]),item].sort((a,b)=>a.name.localeCompare(b.name,'es')));
      setName('');}catch(reason){setError(reason instanceof Error?reason.message:'No se pudo agregar.');}
    finally{setBusy(false);}
  }
  async function update(item:SystemCatalogItem,input:{name?:string;active?:boolean}){
    setBusy(true);setError('');try{const saved=await updateSystemCatalogItem(token,code,item.id,input);
      setItems(rows=>rows?.map(row=>row.id===item.id?saved:row)
        .sort((a,b)=>a.name.localeCompare(b.name,'es'))??[]);
      setEditing(null);
    }catch(reason){setError(reason instanceof Error?reason.message:'No se pudo guardar.');}
    finally{setBusy(false);}
  }
  return <section className="system-catalog-admin">
    <p className="muted">Estas opciones son compartidas por todas las cuentas. Las opciones creadas por cada usuario siguen siendo privadas de su cuenta.</p>
    <div className="system-catalog-tabs" role="group" aria-label="Catálogo global">
      {codes.map(value=><button type="button" key={value} className={code===value?'active':''}
        onClick={()=>setCode(value)}>{catalogNames[value]}</button>)}
    </div>
    <div className="system-catalog-body"><h3>{catalogNames[code]}</h3>
      {error&&<div className="form-error" role="alert">{error}</div>}
      <form className="system-catalog-create" onSubmit={event=>void create(event)}>
        <label><span>Nueva opción global</span><input required minLength={2} maxLength={160}
          value={name} onChange={event=>setName(event.target.value)} disabled={busy}/></label>
        <button type="submit" className="primary-button compact" disabled={busy}>Agregar</button>
      </form>
      {items===null&&!error&&<p className="muted">Cargando opciones…</p>}
      {items?.map(item=><div className="system-catalog-row" key={item.id}>
        {editing===item.id?<form onSubmit={event=>{event.preventDefault();void update(item,{name:editName.trim()});}}>
          <input required minLength={2} maxLength={160} value={editName}
            onChange={event=>setEditName(event.target.value)} disabled={busy}/>
          <button type="submit" className="primary-button compact" disabled={busy}>Guardar</button>
          <button type="button" className="secondary-button compact" onClick={()=>setEditing(null)}>Cancelar</button>
        </form>:<><span><strong>{item.name}</strong><small>{item.active?'Disponible':'Oculta para nuevos registros'}</small></span>
          <button type="button" className="secondary-button compact" disabled={busy}
            onClick={()=>{setEditing(item.id);setEditName(item.name);}}>Editar</button>
          <label className="module-switch system-catalog-switch"><span className="sr-only">{item.name}</span>
            <input type="checkbox" checked={item.active} disabled={busy}
              onChange={event=>void update(item,{active:event.target.checked})}
              aria-label={`${item.name}: disponible en el sistema`}/></label></>}
      </div>)}
    </div>
  </section>;
}
