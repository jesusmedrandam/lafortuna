import {useEffect,useState} from 'react';
import {useNavigate,useSearchParams} from 'react-router-dom';
import {Button,Modal} from '../components/ui';
import {createCatalogMedicine,getCatalogMedicines,updateCatalogMedicine,type CatalogItem,type HealthMedicine,type HealthOptions} from './api';
import {MedicineForm,medicineKinds,routeKey,medicineDoseReference,medicineDoseUnits} from './MedicineForm';
export function MedicineCatalog({accessToken,canManage,canEdit=false,units,routes,treatmentTypes,classifications}:{
  accessToken:string;canManage:boolean;canEdit?:boolean;units:HealthOptions['units'];routes:CatalogItem[];treatmentTypes:CatalogItem[];
  classifications?:Array<{code:string;name:string}>}){
  const [medicines,setMedicines]=useState<HealthMedicine[]|null>(null);
  const [params,setParams]=useSearchParams();const navigate=useNavigate();
  const [editing,setEditing]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [search,setSearch]=useState('');const [active,setActive]=useState(true);
  const [editingVersion,setEditingVersion]=useState<number|null>(null);
  const displayUnits=units.length?units:medicineDoseUnits;
  const selected=medicines?.find(item=>item.id===params.get('medicamento'));
  const showForm=params.get('medicamento')==='nuevo';
  const open=(id:string)=>{const next=new URLSearchParams(params);next.set('medicamento',id);setParams(next);setEditing(false);setError('');};
  const close=()=>{if(!busy){setEditing(false);navigate(-1);}};
  useEffect(()=>{let mounted=true;let timer:ReturnType<typeof setTimeout>;
    const load=()=>void getCatalogMedicines(accessToken).then(items=>{if(mounted)setMedicines(items);})
      .catch(failure=>{if(mounted)setError(failure instanceof Error?failure.message:'No se pudieron cargar los medicamentos.');});
    const changed=(event:Event)=>{const path=(event as CustomEvent<{path?:string}>).detail?.path;
      if(path&&!path.startsWith('/health-records/medicines')&&!path.startsWith('/catalogs/medicines'))return;
      clearTimeout(timer);timer=setTimeout(load,120);};
    load();window.addEventListener('sgb-v2-cache-updated',changed);
    return()=>{mounted=false;clearTimeout(timer);window.removeEventListener('sgb-v2-cache-updated',changed);};},[accessToken]);
  async function save(input:Omit<HealthMedicine,'id'|'active'>){setBusy(true);setError('');
    try{
      const saved=editing&&selected?await updateCatalogMedicine(accessToken,selected.id,input,active,editingVersion!):
        await createCatalogMedicine(accessToken,input);
      setMedicines(previous=>[saved,...previous?.filter(item=>item.id!==saved.id)??[]]);setEditing(false);
      if(showForm)navigate(-1);
    }catch(failure){setError(failure instanceof Error?failure.message:'No se pudo guardar el medicamento.');}finally{setBusy(false);}
  }
  const visible=medicines?.filter(item=>[item.name,item.activeIngredient,medicineKinds[item.kind],
    treatmentTypes.find(type=>type.id===item.treatmentCatalogItemId)?.name].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a,b)=>Number(b.active)-Number(a.active)||a.name.localeCompare(b.name,'es'));
  return <><header><div><h3>Medicamentos</h3><p className="muted">Disponibles para todas las propiedades de esta cuenta.</p></div>
    {canManage&&<button type="button" className="primary-button compact" onClick={()=>open('nuevo')}>Nuevo medicamento</button>}</header>
    {!showForm&&!selected&&error&&<div className="form-error" role="alert">{error}</div>}
    <label className="catalog-search"><span className="sr-only">Buscar medicamentos</span><input type="search" value={search}
      placeholder="Buscar por nombre, principio activo o uso…" onChange={event=>setSearch(event.target.value)}/></label>
    {!medicines&&!error&&<p className="muted">Cargando medicamentos…</p>}
    <div className="catalog-list">{visible?.map(item=><button type="button" key={item.id} className="catalog-detail-row" onClick={()=>open(item.id)}>
      <span><strong>{item.name}</strong><small>{medicineKinds[item.kind]} · {item.active?'Activo':'Inactivo'}</small></span><span aria-hidden="true">›</span>
    </button>)}</div>{visible?.length===0&&<p className="muted">{search?'No hay medicamentos con esa búsqueda.':'Sin medicamentos registrados.'}</p>}
    {(showForm&&canManage||selected)&&<Modal title={showForm?'Nuevo medicamento':editing?'Editar medicamento':selected!.name} wide onClose={close}>
      {error&&<div className="form-error" role="alert">{error}</div>}
      {showForm||editing&&canEdit?<>
        {editing&&<><p>Los cambios se usarán en nuevas aplicaciones. Los tratamientos aplicados conservan sus datos.</p>
          <label className="checkbox"><input type="checkbox" checked={active} onChange={event=>setActive(event.target.checked)} disabled={busy}/>Medicamento activo</label></>}
        <MedicineForm key={selected?.id??'nuevo'} initial={editing?selected:undefined} units={units} routes={routes}
          treatmentTypes={treatmentTypes} classifications={classifications} busy={busy} onSave={input=>void save(input)}
          onCancel={()=>{if(editing)setEditing(false);else close();}}/>
      </>:selected&&<><dl className="catalog-detail-grid">
        <div><dt>Uso principal</dt><dd>{medicineKinds[selected.kind]}</dd></div>
        <div><dt>Estado</dt><dd>{selected.active?'Activo':'Inactivo'}</dd></div>
        <div><dt>Clase farmacológica</dt><dd>{treatmentTypes.find(item=>item.id===selected.treatmentCatalogItemId)?.name??'Sin clasificar'}</dd></div>
        <div><dt>Principio activo</dt><dd>{selected.activeIngredient||'Sin registrar'}</dd></div>
        <div><dt>Unidad de dosis</dt><dd>{displayUnits.find(item=>item.code===selected.defaultUnitCode)?.name??'Unidad registrada'}</dd></div>
        <div><dt>Referencia de dosis</dt><dd>{medicineDoseReference(selected,undefined,units,classifications)||'Sin referencia'}</dd></div>
        <div><dt>Vías de administración</dt><dd>{selected.administrationRoutes?.map(code=>routes.find(item=>routeKey(item)===code)?.name??code).join(', ')||'Sin configurar'}</dd></div>
        <div><dt>Indicaciones</dt><dd>{selected.indications||'Sin registrar'}</dd></div>
        <div><dt>Retiro de leche</dt><dd>{selected.withdrawalMilkDays} días</dd></div>
        <div><dt>Retiro de carne</dt><dd>{selected.withdrawalMeatDays} días</dd></div>
      </dl>{canEdit&&selected.version!=null&&<Button onClick={()=>{setActive(selected.active);setEditingVersion(selected.version!);setEditing(true);}}>Editar medicamento</Button>}</>}
    </Modal>}
  </>;
}
