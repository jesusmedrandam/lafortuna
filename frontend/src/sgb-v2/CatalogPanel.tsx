import {type FormEvent,useEffect,useMemo,useState} from 'react';
import {
  ApiRequestError,createBrand,createCatalogItem,createOwner,getAnimalClassificationPolicy,
  getCatalogReference,listAccountUsers,listBrands,listCatalogItems,listOwners,setBrandActive,
  updateCatalogItem,updateBrandOwners,
  type AnimalClassificationPolicy,type CatalogItem,type CatalogReference,type EditableCatalogCode,
  type LivestockBrand,type LivestockOwner,
} from './api';
import {Modal,Select} from '../components/ui';
import {useNavigate,useSearchParams} from 'react-router-dom';
import {MedicineCatalog} from './MedicineCatalog';
import {CleaningProductCatalog} from './CleaningProductCatalog';
import {medicineDoseUnits} from './MedicineForm';

const catalogs:Array<{code:EditableCatalogCode;name:string;description:string}>=[
  {code:'BREEDS',name:'Razas',description:'Razas disponibles para los animales'},
  {code:'COLORS',name:'Colores',description:'Colores y rasgos visibles'},
  {code:'GRASS_TYPES',name:'Pastos',description:'Tipos de pasto de las ubicaciones'},
  {code:'HEALTH_CONDITION_TYPES',name:'Problemas de salud',description:'Condiciones usadas en sanidad'},
  {code:'TREATMENT_TYPES',name:'Tipos de tratamiento',description:'Clasificación de medicamentos y tratamientos'},
  {code:'ADMINISTRATION_ROUTES',name:'Vías de administración',description:'Vías compartidas para aplicar medicamentos'},
  {code:'AGROCHEMICAL_CATEGORIES',name:'Categorías de productos',description:'Productos usados en limpiezas y aplicaciones'},
  {code:'MEDIA_TAGS',name:'Etiquetas multimedia',description:'Etiquetas para ordenar fotos y videos'},
  {code:'MOVEMENT_REASONS',name:'Motivos de movimiento',description:'Motivos frecuentes de traslado'},
  {code:'BUYERS',name:'Compradores',description:'Compradores frecuentes de la cuenta'},
  {code:'SALE_PRODUCTS',name:'Productos de venta',description:'Productos distintos de animales'},
];
const classificationCodes=['VACA','VACONA','TERNERA','TORO','TORETE','TERNERO'] as const;
type SpecialTab='CLASSIFICATION'|'OWNERS'|'BRANDS'|'MEDICINES'|'PRODUCTS'|'DOSE_UNITS';
type CatalogTab=SpecialTab|EditableCatalogCode;

export function CatalogPanel({accessToken,canManage,canEditMedicines=false,commerceEnabled=false}:{
  accessToken:string;canManage:boolean;canEditMedicines?:boolean;commerceEnabled?:boolean}){
  const availableCatalogs=useMemo(()=>catalogs.filter(({code})=>commerceEnabled||
    (code!=='BUYERS'&&code!=='SALE_PRODUCTS')),[commerceEnabled]);
  const [params,setParams]=useSearchParams();const navigate=useNavigate();
  const requested=params.get('catalogo');
  const tab=requested&&['CLASSIFICATION','OWNERS','BRANDS','MEDICINES','PRODUCTS','DOSE_UNITS',...availableCatalogs.map(item=>item.code)].includes(requested)?requested as CatalogTab:null;
  const setTab=(value:CatalogTab)=>{const next=new URLSearchParams(params);next.set('catalogo',value);next.delete('elemento');next.delete('medicamento');next.delete('producto');setParams(next);};
  const openItem=(id:string)=>{const next=new URLSearchParams(params);next.set('elemento',id);setParams(next);};
  const [search,setSearch]=useState('');
  useEffect(()=>setSearch(''),[tab]);
  const [reference,setReference]=useState<CatalogReference|null>(null);
  const [items,setItems]=useState<Partial<Record<EditableCatalogCode,CatalogItem[]>>>({});
  const [classification,setClassification]=useState<AnimalClassificationPolicy|null>(null);
  const [owners,setOwners]=useState<LivestockOwner[]>([]);
  const [accountUsers,setAccountUsers]=useState<Array<{id:string;name:string}>>([]);
  const [brands,setBrands]=useState<LivestockBrand[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);

  useEffect(()=>{let active=true;setError(null);
    void Promise.all([getCatalogReference(accessToken),getAnimalClassificationPolicy(accessToken),
      listOwners(accessToken),listBrands(accessToken),
      ...availableCatalogs.map(({code})=>listCatalogItems(accessToken,code))])
      .then(([catalogReference,policy,ownerList,brandList,...lists])=>{if(!active)return;
        setReference(catalogReference as CatalogReference);
        setClassification(policy as AnimalClassificationPolicy);
        setOwners(ownerList as LivestockOwner[]);setBrands(brandList as LivestockBrand[]);
        setItems(Object.fromEntries(availableCatalogs.map(({code},index)=>[code,lists[index]])) as
          Record<EditableCatalogCode,CatalogItem[]>);
      }).catch(failure=>{if(active)setError(message(failure));});
    if(canManage)void listAccountUsers(accessToken).then(value=>{if(active)setAccountUsers(value);})
      .catch(failure=>{if(active)setError(message(failure));});
    return()=>{active=false;};
  },[accessToken,availableCatalogs,canManage]);

  async function createItem(event:FormEvent<HTMLFormElement>,code:EditableCatalogCode){
    event.preventDefault();const form=event.currentTarget;
    const name=String(new FormData(form).get('name')||'').trim();
    setBusy(true);setError(null);
    try{await createCatalogItem(accessToken,code,name);
      const updated=await listCatalogItems(accessToken,code);
      setItems(previous=>({...previous,[code]:updated}));form.reset();
    }catch(failure){setError(message(failure));}finally{setBusy(false);}
  }

  async function editItem(event:FormEvent<HTMLFormElement>,code:EditableCatalogCode,item:CatalogItem){
    event.preventDefault();if(busy||item.version==null)return;const data=new FormData(event.currentTarget);
    setBusy(true);setError(null);
    try{const saved=await updateCatalogItem(accessToken,code,item.id,{name:String(data.get('name')).trim(),
      active:data.get('active')==='on',expectedVersion:item.version});
      setItems(previous=>({...previous,[code]:(previous[code]??[]).map(row=>row.id===saved.id?saved:row)}));
    }catch(reason){setError(message(reason));}finally{setBusy(false);}
  }

  async function addNamedOwner(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=event.currentTarget;const data=new FormData(form);
    setBusy(true);setError(null);
    try{await createOwner(accessToken,{kind:String(data.get('kind')) as 'EXTERNAL_PERSON'|'ORGANIZATION',
      name:String(data.get('name')).trim()});setOwners(await listOwners(accessToken));form.reset();}
    catch(failure){setError(message(failure));}finally{setBusy(false);}
  }

  async function addUserOwner(userId:string){
    setBusy(true);setError(null);
    try{await createOwner(accessToken,{kind:'USER',userId});setOwners(await listOwners(accessToken));}
    catch(failure){setError(message(failure));}finally{setBusy(false);}
  }

  async function addBrand(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=event.currentTarget;const data=new FormData(form);
    const ownerIds=data.getAll('ownerIds').map(String);
    if(!ownerIds.length){setError('Selecciona al menos un propietario para la marquilla.');return;}
    setBusy(true);setError(null);
    try{await createBrand(accessToken,String(data.get('name')).trim(),ownerIds);
      setBrands(await listBrands(accessToken));form.reset();}
    catch(failure){setError(message(failure));}finally{setBusy(false);}
  }

  async function saveBrandOwners(event:FormEvent<HTMLFormElement>,id:string){
    event.preventDefault();const ownerIds=new FormData(event.currentTarget).getAll('ownerIds').map(String);
    if(!ownerIds.length){setError('Cada marquilla debe conservar al menos un propietario.');return;}
    setBusy(true);setError(null);
    try{await updateBrandOwners(accessToken,id,ownerIds);setBrands(await listBrands(accessToken));}
    catch(failure){setError(message(failure));}finally{setBusy(false);}
  }

  async function changeBrand(brand:LivestockBrand){
    setBusy(true);setError(null);
    try{await setBrandActive(accessToken,brand.id,!brand.active);setBrands(await listBrands(accessToken));}
    catch(failure){setError(message(failure));}finally{setBusy(false);}
  }

  const list=<T extends {name:string;active?:boolean},>(rows:T[])=>rows.filter(row=>row.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a,b)=>Number(b.active??true)-Number(a.active??true)||a.name.localeCompare(b.name,'es'));
  const selectedCatalog=availableCatalogs.find(entry=>entry.code===tab);
  const element=params.get('elemento');
  const selectedOwner=tab==='OWNERS'?owners.find(item=>item.id===element):undefined;
  const selectedBrand=tab==='BRANDS'?brands.find(item=>item.id===element):undefined;
  const selectedItem=selectedCatalog?items[selectedCatalog.code]?.find(item=>item.id===element):undefined;
  const selectedUnit=tab==='DOSE_UNITS'?medicineDoseUnits.find(item=>item.code===element):undefined;
  const availableUsers=accountUsers.filter(user=>!owners.some(owner=>owner.kind==='USER'&&
    owner.name.trim().toLocaleLowerCase()===user.name.trim().toLocaleLowerCase()));

  return <section className="section-block catalog-panel catalog-workspace">
    <div className="section-heading"><div><span className="eyebrow">Configuración compartida</span>
      <h2>Catálogos</h2><p className="muted">Administra desde un solo lugar las opciones utilizadas en toda la cuenta.</p>
    </div></div>
    {error&&<div className="form-error admin-error" role="alert">{error}</div>}
    {!reference&&!error&&<p className="muted">Cargando catálogos…</p>}
    {reference&&<>
      <div className="catalog-reference-bar"><span><strong>{reference.species.length}</strong> especies</span>
        <span><strong>{reference.units.filter(unit=>unit.contextCode==='ANIMAL_WEIGHT').length}</strong> unidades de peso</span>
        <small>Las opciones se comparten entre las propiedades de esta cuenta.</small></div>
      {!tab&&<nav className="catalog-hub" aria-label="Tipos de catálogo">
        <button type="button" className={tab==='MEDICINES'?'active':''} onClick={()=>setTab('MEDICINES')}>Medicamentos</button>
        <button type="button" onClick={()=>setTab('PRODUCTS')}>Productos de limpieza</button>
        <button type="button" className={tab==='DOSE_UNITS'?'active':''} onClick={()=>setTab('DOSE_UNITS')}>Unidades de dosis</button>
        <button type="button" className={tab==='CLASSIFICATION'?'active':''} onClick={()=>setTab('CLASSIFICATION')}>
          Clasificación</button>
        <button type="button" className={tab==='OWNERS'?'active':''} onClick={()=>setTab('OWNERS')}>
          Propietarios <small>{owners.length}</small></button>
        <button type="button" className={tab==='BRANDS'?'active':''} onClick={()=>setTab('BRANDS')}>
          Marquillas <small>{brands.length}</small></button>
        {availableCatalogs.map(({code,name})=><button type="button" key={code}
          className={tab===code?'active':''} onClick={()=>setTab(code)}>{name} <small>{items[code]?.length??0}</small></button>)}
      </nav>}

      {tab&&<div className="catalog-workspace-card">
        {tab!=='MEDICINES'&&tab!=='PRODUCTS'&&tab!=='CLASSIFICATION'&&<label className="catalog-search"><span className="sr-only">Buscar opciones</span>
          <input type="search" placeholder="Buscar por nombre…" value={search} onChange={event=>setSearch(event.target.value)}/></label>}
        {tab==='MEDICINES'&&<MedicineCatalog accessToken={accessToken} canManage={canManage} canEdit={canEditMedicines}
          units={reference.units.filter(unit=>unit.contextCode==='MEDICINE_DOSE')}
          routes={items.ADMINISTRATION_ROUTES??[]} treatmentTypes={items.TREATMENT_TYPES??[]}
          classifications={classification?Object.entries(classification.names).map(([code,name])=>({code,name})):undefined}/>}
        {tab==='PRODUCTS'&&<CleaningProductCatalog accessToken={accessToken} catalog canManage={canManage}
          canEdit={canEditMedicines} categories={items.AGROCHEMICAL_CATEGORIES??[]}/>}
        {tab==='DOSE_UNITS'&&<><header><div><h3>Unidades de dosis</h3><p>Selecciona una de estas unidades al registrar el medicamento.</p></div></header>
          <div className="catalog-item-list">{list(medicineDoseUnits).map(unit=><button type="button" className="catalog-detail-row" key={unit.code} onClick={()=>openItem(unit.code)}>
            <span><strong>{unit.name}</strong><small>{unit.symbol}</small></span><span aria-hidden="true">›</span></button>)}</div></>}
        {tab==='CLASSIFICATION'&&classification&&<><header><div><h3>Clasificación de animales</h3>
          <p>Estas edades y nombres se aplican a todas las propiedades del dueño de la cuenta.</p></div></header>
          <p className="catalog-help">Las vacas tienen crías registradas; los toros tienen crías o figuran como padres en una preñez confirmada. Los demás se clasifican por sexo y edad.</p>
          <dl className="catalog-detail-grid"><div><dt>Hembras adultas desde</dt><dd>{classification.femaleAdultMonths} meses</dd></div>
            <div><dt>Machos adultos desde</dt><dd>{classification.maleAdultMonths} meses</dd></div>
            {classificationCodes.map(code=><div key={code}><dt>{classification.names[code]}</dt><dd>{code==='VACA'?'Hembra con crías registradas':code==='TORO'?'Macho con descendencia':
              `${['VACONA','TERNERA'].includes(code)?'Hembra':'Macho'} ${['TERNERA','TERNERO'].includes(code)?'joven':'adulto'}`}</dd></div>)}</dl>
          {canManage&&classification.canManageRules&&<button type="button" className="secondary-button compact"
            onClick={()=>navigate('/configuracion?seccion=reglas&opcion=clasificacion')}>Editar reglas de clasificación</button>}</>}


        {tab==='OWNERS'&&<><header><div><h3>Propietarios</h3>
          <p>Personas, organizaciones y usuarios que pueden tener participación en los animales.</p></div></header>
          {canManage&&<details className="catalog-add"><summary>Agregar propietario</summary><form className="catalog-create catalog-owner-create" onSubmit={addNamedOwner}>
            <label><span>Tipo</span><Select name="kind"><option value="EXTERNAL_PERSON">Persona externa</option>
              <option value="ORGANIZATION">Organización</option></Select></label>
            <label><span>Nombre</span><input name="name" minLength={2} maxLength={160} required
              placeholder="Nombre del propietario"/></label>
            <button className="primary-button compact" disabled={busy}>Agregar</button>
          </form></details>}
          <div className="catalog-list">{list(owners).map(owner=><button type="button" className="catalog-detail-row" key={owner.id} onClick={()=>openItem(owner.id)}>
            <span><strong>{owner.name}</strong><small>{ownerKind(owner.kind)} · {owner.active?'Activo':'Inactivo'}</small></span><span aria-hidden="true">›</span>
          </button>)}{!owners.length&&<p className="muted">Aún no hay propietarios registrados.</p>}</div>
          {canManage&&availableUsers.length>0&&<section className="catalog-user-owners"><h4>Usuarios de la cuenta</h4>
            <p>Agrega aquí los usuarios que también podrán seleccionarse como propietarios.</p><div>
              {availableUsers.map(user=><button type="button" key={user.id} disabled={busy}
                onClick={()=>void addUserOwner(user.id)}><strong>{user.name}</strong><small>+ Agregar como propietario</small></button>)}
            </div></section>}
        </>}

        {tab==='BRANDS'&&<><header><div><h3>Marquillas</h3>
          <p>Relaciona cada marquilla con uno o varios propietarios.</p></div></header>
          {canManage&&<details className="catalog-add"><summary>Agregar marquilla</summary><form className="catalog-brand-create" onSubmit={addBrand}><label><span>Nombre de la marquilla</span>
            <input name="name" minLength={2} maxLength={120} required placeholder="Ej. Hacienda La Fortuna"/></label>
            <fieldset><legend>Propietarios</legend>{owners.filter(owner=>owner.active).map(owner=><label key={owner.id}>
              <input type="checkbox" name="ownerIds" value={owner.id}/><span>{owner.name}</span></label>)}</fieldset>
            <button className="primary-button compact" disabled={busy||!owners.some(owner=>owner.active)}>Agregar marquilla</button>
          </form></details>}
          <div className="catalog-list">{list(brands).map(brand=><button type="button" className="catalog-detail-row" key={brand.id} onClick={()=>openItem(brand.id)}>
            <span><strong>{brand.name}</strong><small>{brand.active?'Activa':'Inactiva'} · {brand.owner_ids?.length??0} propietarios</small></span><span aria-hidden="true">›</span>
          </button>)}{!brands.length&&<p className="muted">Aún no hay marquillas registradas.</p>}</div>
        </>}

        {selectedCatalog&&<><header><div><h3>{selectedCatalog.name}</h3><p>{selectedCatalog.description}</p></div>
          <span className="catalog-count">{items[selectedCatalog.code]?.length??0} opciones</span></header>
          {canManage&&<details className="catalog-add"><summary>Agregar opción</summary><form className="catalog-create" onSubmit={event=>void createItem(event,selectedCatalog.code)}>
            <label><span>Nueva opción</span><input name="name" minLength={2} maxLength={160}
              placeholder={`Agregar a ${selectedCatalog.name.toLocaleLowerCase()}`} disabled={busy} required/></label>
            <button type="submit" className="primary-button compact" disabled={busy}>Agregar</button></form></details>}
          <div className="catalog-list">{list(items[selectedCatalog.code]??[]).map(entry=><button type="button" className="catalog-detail-row" key={entry.id} onClick={()=>openItem(entry.id)}>
            <span><strong>{entry.name}</strong><small>{entry.active?'Activa':'Inactiva'}</small></span><span aria-hidden="true">›</span></button>)}
            {!items[selectedCatalog.code]?.length&&<p className="muted">Aún no hay opciones registradas.</p>}</div>
        </>}
        {(selectedOwner||selectedBrand||selectedItem||selectedUnit)&&<Modal title={(selectedOwner||selectedBrand||selectedItem||selectedUnit)!.name} onClose={()=>{if(!busy)navigate(-1);}}>
          {error&&<p className="form-error" role="alert">{error}</p>}
          {selectedOwner&&<dl className="catalog-detail-grid"><div><dt>Tipo de propietario</dt><dd>{ownerKind(selectedOwner.kind)}</dd></div>
            <div><dt>Estado</dt><dd>{selectedOwner.active?'Activo':'Inactivo'}</dd></div>
            <div><dt>Marquillas vinculadas</dt><dd>{brands.filter(item=>item.owner_ids?.includes(selectedOwner.id)).map(item=>item.name).join(', ')||'Sin marquillas'}</dd></div></dl>}
          {selectedBrand&&<form key={selectedBrand.id}
            className="catalog-brand-row" onSubmit={event=>void saveBrandOwners(event,selectedBrand.id)}>
            <header><span><strong>{selectedBrand.name}</strong><small>{selectedBrand.active?'Activa':'Inactiva · conserva su historial'}</small></span>
              {canManage&&<label className="property-module-toggle"><input type="checkbox" checked={selectedBrand.active}
                disabled={busy} onChange={()=>void changeBrand(selectedBrand)} aria-label={`${selectedBrand.name}: marquilla activa`}/></label>}</header>
            <section><h4>Propietarios vinculados</h4><ul>{owners.filter(owner=>selectedBrand.owner_ids?.includes(owner.id))
              .sort((a,b)=>a.name.localeCompare(b.name,'es')).map(owner=><li key={owner.id}>{owner.name}</li>)}</ul></section>
            {canManage&&<details className="catalog-add"><summary>Editar propietarios</summary>
            <fieldset disabled={busy}><legend>Propietarios de la marquilla</legend>{owners.map(owner=><label key={owner.id}>
              <input type="checkbox" name="ownerIds" value={owner.id} defaultChecked={selectedBrand.owner_ids?.includes(owner.id)}/>
              <span>{owner.name}</span></label>)}</fieldset>
            <button className="secondary-button compact" disabled={busy}>Guardar propietarios</button></details>}
          </form>}
          {selectedItem&&selectedCatalog&&<><dl className="catalog-detail-grid"><div><dt>Catálogo</dt><dd>{selectedCatalog.name}</dd></div>
            <div><dt>Estado</dt><dd>{selectedItem.active?'Activa':'Inactiva · conserva su historial'}</dd></div>
            <div><dt>Origen</dt><dd>{selectedItem.systemDefined?'Opción del sistema':'Opción de esta cuenta'}</dd></div>
            {selectedItem.speciesCode&&<div><dt>Especie</dt><dd>{reference.species.find(item=>item.code===selectedItem.speciesCode)?.name??selectedItem.speciesCode}</dd></div>}</dl>
            {canEditMedicines&&!selectedItem.systemDefined&&selectedItem.version!=null&&<details className="catalog-add">
              <summary>Editar opción</summary><form className="movement-form" key={`${selectedItem.id}:${selectedItem.version}`}
                onSubmit={event=>void editItem(event,selectedCatalog.code,selectedItem)}>
                <label><span>Nombre</span><input name="name" required minLength={2} maxLength={160} defaultValue={selectedItem.name} disabled={busy}/></label>
                <label className="checkbox"><input name="active" type="checkbox" defaultChecked={selectedItem.active} disabled={busy}/>Opción activa</label>
                <button className="primary-button compact" disabled={busy}>Guardar cambios</button></form></details>}
</>}
          {selectedUnit&&<dl className="catalog-detail-grid"><div><dt>Símbolo</dt><dd>{selectedUnit.symbol}</dd></div>
            <div><dt>Uso</dt><dd>Dosis de medicamentos</dd></div></dl>}
        </Modal>}
      </div>}
    </>}
  </section>;
}

function ownerKind(kind:string){return kind==='USER'?'Usuario de la cuenta':kind==='ORGANIZATION'?'Organización':'Persona externa';}
function message(error:unknown){return error instanceof ApiRequestError?error.message:
  'No fue posible cargar o guardar el catálogo.';}
