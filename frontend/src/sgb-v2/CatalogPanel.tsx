import {type FormEvent,useEffect,useMemo,useState} from 'react';
import {
  ApiRequestError,createBrand,createCatalogItem,createOwner,getAnimalClassificationPolicy,
  getCatalogReference,listAccountUsers,listBrands,listCatalogItems,listOwners,setBrandActive,
  setCatalogItemActive,updateAnimalClassificationPolicy,updateBrandOwners,
  type AnimalClassificationPolicy,type CatalogItem,type CatalogReference,type EditableCatalogCode,
  type LivestockBrand,type LivestockOwner,
} from './api';
import {Select} from '../components/ui';

const catalogs:Array<{code:EditableCatalogCode;name:string;description:string}>=[
  {code:'BREEDS',name:'Razas',description:'Razas disponibles para los animales'},
  {code:'COLORS',name:'Colores',description:'Colores y rasgos visibles'},
  {code:'GRASS_TYPES',name:'Pastos',description:'Tipos de pasto de las ubicaciones'},
  {code:'HEALTH_CONDITION_TYPES',name:'Problemas de salud',description:'Condiciones usadas en sanidad'},
  {code:'TREATMENT_TYPES',name:'Tipos de tratamiento',description:'Clasificación de medicamentos y tratamientos'},
  {code:'AGROCHEMICAL_CATEGORIES',name:'Categorías de productos',description:'Productos usados en limpiezas y aplicaciones'},
  {code:'MEDIA_TAGS',name:'Etiquetas multimedia',description:'Etiquetas para ordenar fotos y videos'},
  {code:'MOVEMENT_REASONS',name:'Motivos de movimiento',description:'Motivos frecuentes de traslado'},
  {code:'BUYERS',name:'Compradores',description:'Compradores frecuentes de la cuenta'},
  {code:'SALE_PRODUCTS',name:'Productos de venta',description:'Productos distintos de animales'},
];
const classificationCodes=['VACA','VACONA','TERNERA','TORO','TORETE','TERNERO'] as const;
type SpecialTab='CLASSIFICATION'|'OWNERS'|'BRANDS';
type CatalogTab=SpecialTab|EditableCatalogCode;

export function CatalogPanel({accessToken,canManage,commerceEnabled=false}:{
  accessToken:string;canManage:boolean;commerceEnabled?:boolean}){
  const availableCatalogs=useMemo(()=>catalogs.filter(({code})=>commerceEnabled||
    (code!=='BUYERS'&&code!=='SALE_PRODUCTS')),[commerceEnabled]);
  const [tab,setTab]=useState<CatalogTab>('CLASSIFICATION');
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

  async function saveClassification(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const data=new FormData(event.currentTarget);
    const names=Object.fromEntries(classificationCodes.map(code=>[code,String(data.get(code)).trim()])) as
      AnimalClassificationPolicy['names'];
    const input:AnimalClassificationPolicy={femaleAdultMonths:Number(data.get('femaleAdultMonths')),
      maleAdultMonths:Number(data.get('maleAdultMonths')),names};
    setBusy(true);setError(null);
    try{setClassification(await updateAnimalClassificationPolicy(accessToken,input));}
    catch(failure){setError(message(failure));}finally{setBusy(false);}
  }

  async function createItem(event:FormEvent<HTMLFormElement>,code:EditableCatalogCode){
    event.preventDefault();const form=event.currentTarget;
    const name=String(new FormData(form).get('name')||'').trim();
    setBusy(true);setError(null);
    try{await createCatalogItem(accessToken,code,name);
      const updated=await listCatalogItems(accessToken,code);
      setItems(previous=>({...previous,[code]:updated}));form.reset();
    }catch(failure){setError(message(failure));}finally{setBusy(false);}
  }

  async function changeItem(code:EditableCatalogCode,id:string,active:boolean){
    setBusy(true);setError(null);
    try{await setCatalogItemActive(accessToken,code,id,active);
      setItems(previous=>({...previous,[code]:(previous[code]??[]).map(entry=>
        entry.id===id?{...entry,active}:entry)}));
    }catch(failure){setError(message(failure));}finally{setBusy(false);}
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

  const selectedCatalog=availableCatalogs.find(entry=>entry.code===tab);
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
      <nav className="catalog-tabs" aria-label="Tipos de catálogo">
        <button type="button" className={tab==='CLASSIFICATION'?'active':''} onClick={()=>setTab('CLASSIFICATION')}>
          Clasificación</button>
        <button type="button" className={tab==='OWNERS'?'active':''} onClick={()=>setTab('OWNERS')}>
          Propietarios <small>{owners.length}</small></button>
        <button type="button" className={tab==='BRANDS'?'active':''} onClick={()=>setTab('BRANDS')}>
          Marquillas <small>{brands.length}</small></button>
        {availableCatalogs.map(({code,name})=><button type="button" key={code}
          className={tab===code?'active':''} onClick={()=>setTab(code)}>{name} <small>{items[code]?.length??0}</small></button>)}
      </nav>

      <div className="catalog-workspace-card">
        {tab==='CLASSIFICATION'&&classification&&<><header><div><h3>Clasificación de animales</h3>
          <p>Define las edades y nombres usados automáticamente en el inventario.</p></div></header>
          <p className="catalog-help">Las vacas tienen crías registradas; los toros tienen crías o figuran como padres en una preñez confirmada. Los demás se clasifican por sexo y edad.</p>
          <form className="classification-form" key={JSON.stringify(classification)} onSubmit={saveClassification}>
            <label><span>Hembras adultas desde (meses)</span><input name="femaleAdultMonths" type="number"
              min="1" max="120" required defaultValue={classification.femaleAdultMonths} disabled={!canManage||busy}/></label>
            <label><span>Machos adultos desde (meses)</span><input name="maleAdultMonths" type="number"
              min="1" max="120" required defaultValue={classification.maleAdultMonths} disabled={!canManage||busy}/></label>
            {classificationCodes.map(code=><label key={code}><span>{code}</span><input name={code}
              minLength={2} maxLength={80} required defaultValue={classification.names[code]}
              disabled={!canManage||busy}/></label>)}
            {canManage&&<button className="primary-button compact" disabled={busy}>Guardar cambios</button>}
          </form></>}

        {tab==='OWNERS'&&<><header><div><h3>Propietarios</h3>
          <p>Personas, organizaciones y usuarios que pueden tener participación en los animales.</p></div></header>
          {canManage&&<form className="catalog-create catalog-owner-create" onSubmit={addNamedOwner}>
            <label><span>Tipo</span><Select name="kind"><option value="EXTERNAL_PERSON">Persona externa</option>
              <option value="ORGANIZATION">Organización</option></Select></label>
            <label><span>Nombre</span><input name="name" minLength={2} maxLength={160} required
              placeholder="Nombre del propietario"/></label>
            <button className="primary-button compact" disabled={busy}>Agregar</button>
          </form>}
          <div className="catalog-list">{owners.map(owner=><div className="catalog-list-row" key={owner.id}>
            <span><strong>{owner.name}</strong><small>{ownerKind(owner.kind)} · {owner.active?'Activo':'Inactivo'}</small></span>
          </div>)}{!owners.length&&<p className="muted">Aún no hay propietarios registrados.</p>}</div>
          {canManage&&availableUsers.length>0&&<section className="catalog-user-owners"><h4>Usuarios de la cuenta</h4>
            <p>Agrega aquí los usuarios que también podrán seleccionarse como propietarios.</p><div>
              {availableUsers.map(user=><button type="button" key={user.id} disabled={busy}
                onClick={()=>void addUserOwner(user.id)}><strong>{user.name}</strong><small>+ Agregar como propietario</small></button>)}
            </div></section>}
        </>}

        {tab==='BRANDS'&&<><header><div><h3>Marquillas</h3>
          <p>Relaciona cada marquilla con uno o varios propietarios.</p></div></header>
          {canManage&&<form className="catalog-brand-create" onSubmit={addBrand}><label><span>Nombre de la marquilla</span>
            <input name="name" minLength={2} maxLength={120} required placeholder="Ej. Hacienda La Fortuna"/></label>
            <fieldset><legend>Propietarios</legend>{owners.filter(owner=>owner.active).map(owner=><label key={owner.id}>
              <input type="checkbox" name="ownerIds" value={owner.id}/><span>{owner.name}</span></label>)}</fieldset>
            <button className="primary-button compact" disabled={busy||!owners.some(owner=>owner.active)}>Agregar marquilla</button>
          </form>}
          <div className="catalog-brand-list">{brands.map(brand=><form key={brand.id}
            className="catalog-brand-row" onSubmit={event=>void saveBrandOwners(event,brand.id)}>
            <header><span><strong>{brand.name}</strong><small>{brand.active?'Activa':'Inactiva · conserva su historial'}</small></span>
              {canManage&&<label className="property-module-toggle"><input type="checkbox" checked={brand.active}
                disabled={busy} onChange={()=>void changeBrand(brand)} aria-label={`${brand.name}: marquilla activa`}/></label>}</header>
            <fieldset disabled={!canManage||busy}><legend>Propietarios vinculados</legend>{owners.map(owner=><label key={owner.id}>
              <input type="checkbox" name="ownerIds" value={owner.id} defaultChecked={brand.owner_ids?.includes(owner.id)}/>
              <span>{owner.name}</span></label>)}</fieldset>
            {canManage&&<button className="secondary-button compact" disabled={busy}>Guardar propietarios</button>}
          </form>)}{!brands.length&&<p className="muted">Aún no hay marquillas registradas.</p>}</div>
        </>}

        {selectedCatalog&&<><header><div><h3>{selectedCatalog.name}</h3><p>{selectedCatalog.description}</p></div>
          <span className="catalog-count">{items[selectedCatalog.code]?.length??0} opciones</span></header>
          {canManage&&<form className="catalog-create" onSubmit={event=>void createItem(event,selectedCatalog.code)}>
            <label><span>Nueva opción</span><input name="name" minLength={2} maxLength={160}
              placeholder={`Agregar a ${selectedCatalog.name.toLocaleLowerCase()}`} disabled={busy} required/></label>
            <button type="submit" className="primary-button compact" disabled={busy}>Agregar</button></form>}
          <div className="catalog-list">{(items[selectedCatalog.code]??[]).map(entry=><div className="catalog-list-row" key={entry.id}>
            <span><strong>{entry.name}</strong><small>{entry.systemDefined?'Opción del sistema':entry.active?'Activa':'Inactiva · conserva su historial'}</small></span>
            {canManage&&!entry.systemDefined&&<label className="property-module-toggle"><input type="checkbox"
              checked={entry.active} disabled={busy} onChange={event=>void changeItem(selectedCatalog.code,entry.id,event.target.checked)}
              aria-label={`${entry.name}: opción activa`}/></label>}</div>)}
            {!items[selectedCatalog.code]?.length&&<p className="muted">Aún no hay opciones registradas.</p>}</div>
        </>}
      </div>
    </>}
  </section>;
}

function ownerKind(kind:string){return kind==='USER'?'Usuario de la cuenta':kind==='ORGANIZATION'?'Organización':'Persona externa';}
function message(error:unknown){return error instanceof ApiRequestError?error.message:
  'No fue posible cargar o guardar el catálogo.';}
