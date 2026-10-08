import {DateInput} from '../components/ui';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  ApiRequestError, createAnimal, createCatalogItem, getAnimal, getAnimals, listBrands,
  listCatalogItems, updateAnimalBrands, updateAnimalCatalogs,
  listOwners, listAccountUsers, createOwner, updateAnimalOwners,
  updateAnimalDescription, updateAnimalParents,
  listGroups, type LivestockGroup,
  listLocations,type PhysicalLocation,type AnimalFilters,
  getMedia,uploadMedia,deleteMedia,type MediaItem,
  getAnimalClassificationPolicy,type AnimalClassificationPolicy,
  type Animal, type AnimalList, type CatalogItem, type LivestockBrand, type LivestockOwner, type ParentSelection,
} from './api';
import {formatDate} from '../utils';
import {Select} from '../components/ui';
import {ShellIcon} from './ShellIcon';

interface AnimalChoices { BREEDS: CatalogItem[]; COLORS: CatalogItem[] }
const animalStatusLabels:Record<string,string>={
  ACTIVE:'Activo',INACTIVE:'Inactivo',DEAD:'Fallecido',MISSING:'Desaparecido',
};

async function loadAnimalChoices(accessToken: string): Promise<AnimalChoices> {
  const [breeds, colors] = await Promise.all([
    listCatalogItems(accessToken, 'BREEDS'), listCatalogItems(accessToken, 'COLORS'),
  ]);
  return { BREEDS: breeds, COLORS: colors };
}

function CatalogFields({ choices, selected, canManage, onCreate }: {
  choices: AnimalChoices; selected?: Animal | null; canManage: boolean;
  onCreate: (code: keyof AnimalChoices, name: string) => Promise<CatalogItem>;
}) {
  const breeds = selected?.breeds?.length ? selected.breeds : (selected?.breed ? [selected.breed] : []);
  const colors = selected?.colors || [];
  const [selectedBreeds,setSelectedBreeds]=useState<string[]>(()=>breeds.map(item=>item.id));
  const [selectedColors,setSelectedColors]=useState<string[]>(()=>colors.map(item=>item.id));
  const [adding,setAdding]=useState<keyof AnimalChoices|null>(null);
  const [newName,setNewName]=useState('');
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  async function add(code:keyof AnimalChoices){
    const name=newName.trim();if(name.length<2)return;
    setSaving(true);setError('');
    try{const item=await onCreate(code,name);
      (code==='BREEDS'?setSelectedBreeds:setSelectedColors)(current=>[...current,item.id]);
      setAdding(null);setNewName('');
    }catch(failure){setError(message(failure));}
    finally{setSaving(false);}
  }
  const toggle=(id:string,checked:boolean,code:keyof AnimalChoices)=>{
    (code==='BREEDS'?setSelectedBreeds:setSelectedColors)(current=>checked
      ?[...current,id]:current.filter(value=>value!==id));
  };
  const availableBreed = choices.BREEDS.filter((entry) => entry.active &&
    (!entry.speciesCode || entry.speciesCode === 'BOVINE'));
  const availableColors = choices.COLORS.filter((entry) => entry.active &&
    (!entry.speciesCode || entry.speciesCode === 'BOVINE'));
  for (const breed of breeds) {
    if (!availableBreed.some((entry) => entry.id === breed.id))
      availableBreed.push({ id: breed.id, name: breed.name, catalogCode: 'BREEDS',
        speciesCode: 'BOVINE', systemDefined: false, active: false });
  }
  for (const color of colors) {
    if (!availableColors.some((entry) => entry.id === color.id)) {
      availableColors.push({ id: color.id, name: color.name, catalogCode: 'COLORS',
        speciesCode: 'BOVINE', systemDefined: false, active: false });
    }
  }
  return <>
    <fieldset className="animal-colors"><legend>Razas</legend>
      {availableBreed.map((entry) => <label key={entry.id}>
        <input type="checkbox" name="breedIds" value={entry.id}
          checked={selectedBreeds.includes(entry.id)} onChange={event=>toggle(entry.id,event.target.checked,'BREEDS')}/>
        <span>{entry.name}{entry.active ? '' : ' (inactiva)'}</span>
      </label>)}
      {canManage&&<button type="button" className="v2-catalog-add"
        onClick={()=>{setAdding('BREEDS');setNewName('');setError('');}}>+ Añadir raza</button>}
      {adding==='BREEDS'&&<div className="animal-inline-add">
        <input aria-label="Nombre de la nueva raza" value={newName} minLength={2} maxLength={160}
          onChange={event=>setNewName(event.target.value)} disabled={saving} autoFocus
          onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void add('BREEDS');}}}/>
        <button type="button" className="secondary-button compact" disabled={saving||newName.trim().length<2}
          onClick={()=>void add('BREEDS')}>Añadir raza</button>
        <button type="button" className="text-button" onClick={()=>setAdding(null)}>Cancelar</button>
      </div>}
    </fieldset>
    <fieldset className="animal-colors"><legend>Colores</legend>
      {availableColors.length === 0 && <small>No hay colores disponibles.</small>}
      {availableColors.map((entry) => <label key={entry.id}>
        <input type="checkbox" name="colorIds" value={entry.id}
          checked={selectedColors.includes(entry.id)} onChange={event=>toggle(entry.id,event.target.checked,'COLORS')}/>
        <span>{entry.name}{entry.active ? '' : ' (inactivo)'}</span>
      </label>)}
      {canManage&&<button type="button" className="v2-catalog-add"
        onClick={()=>{setAdding('COLORS');setNewName('');setError('');}}>+ Añadir color</button>}
      {adding==='COLORS'&&<div className="animal-inline-add">
        <input aria-label="Nombre del nuevo color" value={newName} minLength={2} maxLength={160}
          onChange={event=>setNewName(event.target.value)} disabled={saving} autoFocus
          onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void add('COLORS');}}}/>
        <button type="button" className="secondary-button compact" disabled={saving||newName.trim().length<2}
          onClick={()=>void add('COLORS')}>Añadir color</button>
        <button type="button" className="text-button" onClick={()=>setAdding(null)}>Cancelar</button>
      </div>}
    </fieldset>
    {error&&<div className="form-error animal-catalog-error" role="alert">{error}</div>}
  </>;
}

function equalShares(ids:string[],fixed?:{id:string;value:number;raw:string}):Record<string,string>{
  const result:Record<string,string>={};if(!ids.length)return result;
  const fixedCents=fixed?Math.round(fixed.value*100):0;
  const remaining=ids.filter(id=>id!==fixed?.id);
  if(fixed)result[fixed.id]=fixed.raw;
  const cents=10000-fixedCents;
  remaining.forEach((id,index)=>{result[id]=String((Math.floor(cents/remaining.length)+
    (index<cents%remaining.length?1:0))/100);});
  return result;
}

function OwnerFields({ owners, accountUsers, selected, canManage, onCreate, onCreateUser }: {
  owners: LivestockOwner[]; accountUsers: Array<{id:string;name:string}>;
  selected?: Animal | null; canManage: boolean;
  onCreate: (kind:'EXTERNAL_PERSON'|'ORGANIZATION',name:string)=>Promise<LivestockOwner>;
  onCreateUser: (userId:string)=>Promise<LivestockOwner>;
}) {
  const [ids,setIds]=useState<string[]>(()=>selected?.owners?.map(owner=>owner.id)??[]);
  const [percentages,setPercentages]=useState<Record<string,string>>(()=>Object.fromEntries(
    selected?.owners?.map(owner=>[owner.id,String(owner.percent)])??[]));
  const [primary,setPrimary]=useState(()=>selected?.owners?.find(owner=>owner.isPrimary)?.id??'');
  const [adding,setAdding]=useState(false);const [name,setName]=useState('');
  const [kind,setKind]=useState<'EXTERNAL_PERSON'|'ORGANIZATION'>('EXTERNAL_PERSON');
  const [saving,setSaving]=useState(false);const [addingUserId,setAddingUserId]=useState('');
  const [error,setError]=useState('');
  function toggle(id:string,checked:boolean){
    const next=checked?[...ids,id]:ids.filter(value=>value!==id);
    setIds(next);setPercentages(equalShares(next));
    if(!next.includes(primary))setPrimary(next[0]??'');
  }
  function changePercent(id:string,value:string){
    const amount=Number(value);
    if(value===''||!Number.isFinite(amount)||amount<0.01||amount>100-(ids.length-1)*0.01){
      setPercentages(current=>({...current,[id]:value}));return;
    }
    setPercentages(equalShares(ids,{id,value:amount,raw:value}));
  }
  async function add(){if(name.trim().length<2)return;setSaving(true);setError('');
    try{const owner=await onCreate(kind,name.trim());const next=[...ids,owner.id];
      setIds(next);setPercentages(equalShares(next));
      if(!primary)setPrimary(owner.id);
      setName('');setAdding(false);
    }catch(failure){setError(message(failure));}
    finally{setSaving(false);}
  }
  async function addUser(userId:string){setAddingUserId(userId);setError('');
    try{const owner=await onCreateUser(userId);const next=[...ids,owner.id];
      setIds(next);setPercentages(equalShares(next));if(!primary)setPrimary(owner.id);
    }catch(failure){setError(message(failure));}finally{setAddingUserId('');}
  }
  const available = owners.filter((owner) => owner.active || selected?.owners?.some((entry) => entry.id === owner.id));
  for (const owner of selected?.owners ?? []) {
    if (!available.some(entry => entry.id === owner.id))
      available.push({ id: owner.id, name: owner.name, kind: '', active: false });
  }
  const availableUsers=accountUsers.filter(user=>!owners.some(owner=>owner.kind==='USER'&&
    owner.name.trim().toLocaleLowerCase()===user.name.trim().toLocaleLowerCase()));
  return <fieldset className="animal-colors animal-owner-fieldset"><legend>Propietarios (total 100%)</legend>
    {!available.length&&<small>No hay propietarios creados. Puedes agregar una persona, organización o usuario de la cuenta aquí mismo.</small>}
    {available.map((owner) => <div key={owner.id} className="group-inline-form animal-owner-row">
      <label><input type="checkbox" name="ownerIds" value={owner.id}
        checked={ids.includes(owner.id)} onChange={event=>toggle(owner.id,event.target.checked)}/>
        {owner.name}</label>
      {ids.includes(owner.id)&&<><label><span>Porcentaje</span><input type="number"
        name={`percent:${owner.id}`} min="0.01" max="100" step="0.01"
        value={percentages[owner.id]??''} readOnly={ids.length===1}
        onChange={event=>changePercent(owner.id,event.target.value)} /></label>
      {ids.length>1&&<label><input type="radio" name="primary" value={owner.id}
        checked={primary===owner.id} onChange={()=>setPrimary(owner.id)}/> Principal</label>}</>}
    </div>)}
    {ids.length===1&&<input type="hidden" name="primary" value={ids[0]}/>}
    {canManage&&<button type="button" className="v2-catalog-add"
      onClick={()=>setAdding(true)}>+ Añadir propietario</button>}
    {adding&&<div className="animal-inline-add">
      <Select aria-label="Tipo de propietario" value={kind}
        onChange={event=>setKind(event.target.value as typeof kind)}>
        <option value="EXTERNAL_PERSON">Persona externa</option><option value="ORGANIZATION">Organización</option>
      </Select>
      <input aria-label="Nombre del nuevo propietario" value={name} maxLength={160} minLength={2}
        onChange={event=>setName(event.target.value)} disabled={saving} autoFocus
        onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void add();}}}/>
      <button type="button" className="secondary-button compact" disabled={saving||name.trim().length<2}
        onClick={()=>void add()}>Añadir propietario</button>
      <button type="button" className="text-button" onClick={()=>setAdding(false)}>Cancelar</button>
    </div>}
    {canManage&&availableUsers.length>0&&<div className="animal-owner-users">
      <div><strong>Usuarios de la cuenta</strong><small>También pueden elegirse como propietarios del animal.</small></div>
      {availableUsers.map(user=><button key={user.id} type="button" disabled={Boolean(addingUserId)}
        onClick={()=>void addUser(user.id)}><span>{user.name}</span>
        <small>{addingUserId===user.id?'Agregando…':'+ Agregar como propietario'}</small></button>)}
    </div>}
    {error&&<small className="form-error" role="alert">{error}</small>}
    <small>Los porcentajes se distribuyen automáticamente. Con varios propietarios puedes cambiarlos.</small>
  </fieldset>;
}
function ownerInput(data: FormData) {
  const ids = data.getAll('ownerIds').map(String);
  if (!ids.length) throw new Error('Selecciona al menos un propietario.');
  const owners = ids.map((partyId) => ({ partyId,
    percent: Number(data.get(`percent:${partyId}`)), isPrimary: data.get('primary') === partyId }));
  if (owners.some(owner=>!Number.isFinite(owner.percent)||owner.percent<=0||owner.percent>100)||
    owners.filter((owner) => owner.isPrimary).length !== 1 ||
    Math.abs(owners.reduce((sum, owner) => sum + owner.percent, 0) - 100) > 0.001)
    throw new Error('Indica un propietario principal y porcentajes que sumen 100%.');
  return owners;
}

function BrandFields({ brands, selected }: { brands: LivestockBrand[]; selected?: Animal | null }) {
  const chosen = selected?.brands ?? [];
  const available = brands.filter((brand) => brand.active || chosen.some((entry) => entry.id === brand.id));
  for (const brand of chosen) {
    if (!available.some(entry => entry.id === brand.id))
      available.push({ id: brand.id, name: brand.name, active: false });
  }
  return <fieldset className="animal-colors"><legend>Marquillas de la cuenta</legend>
    {available.length === 0 && <small>Registra primero una marquilla en la sección Marquillas.</small>}
    {available.map((brand) => <label key={brand.id}>
      <input type="checkbox" name="brandIds" value={brand.id}
        defaultChecked={chosen.some((entry) => entry.id === brand.id)} />
      <span>{brand.name}{brand.active ? '' : ' (inactiva)'}</span>
    </label>)}
  </fieldset>;
}

function ParentField({ accessToken, child, role }: {
  accessToken: string; child?: Animal; role: 'mother' | 'father';
}) {
  const current = child?.[role];
  const [mode, setMode] = useState<'none' | 'animal' | 'reported'>(
    current ? current.animalId ? 'animal' : 'reported' : 'none',
  );
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<Animal[]>([]);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (mode !== 'animal') return;
    let active = true;
    const timer = window.setTimeout(() => {
      void getAnimals(accessToken, 1, search).then((page) => {
        if (active) { setCandidates(page.items); setLoadError(false); }
      }).catch(() => { if (active) setLoadError(true); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [accessToken, mode, search]);
  const label = role === 'mother' ? 'Madre' : 'Padre';
  const eligible = candidates.filter((entry) => entry.id !== child?.id
    && entry.sex === (role === 'mother' ? 'FEMALE' : 'MALE')
    && (!child?.birthDate || !entry.birthDate || entry.birthDate < child.birthDate));
  return <fieldset className="animal-parent-field"><legend>{label}</legend>
    <label><span>Tipo de registro</span><Select name={`${role}Mode`} value={mode}
      onChange={(event) => setMode(event.target.value as typeof mode)}>
      <option value="none">Sin registrar</option>
      <option value="animal">Animal registrado en esta propiedad</option>
      <option value="reported">Nombre informado (externo)</option>
    </Select></label>
    {mode === 'animal' && <>
      <label><span>Buscar {label.toLowerCase()}</span><input value={search}
        onChange={(event) => setSearch(event.target.value)} maxLength={80} /></label>
      <label><span>Animal</span><Select name={`${role}AnimalId`} defaultValue={current?.animalId || ''} required>
        <option value="">Selecciona un animal</option>
        {current?.animalId && !eligible.some((entry) => entry.id === current.animalId)
          && <option value={current.animalId}>{current.name} (actual)</option>}
        {eligible.map((entry) => <option key={entry.id} value={entry.id}>
          {entry.name}{entry.earTagCode ? ` · ${entry.earTagCode}` : ''}
        </option>)}
      </Select></label>
      {loadError && <small>No se pudieron cargar los animales; intenta buscar de nuevo.</small>}
    </>}
    {mode === 'reported' && <label><span>Nombre informado</span>
      <input name={`${role}ReportedName`} defaultValue={current?.animalId === null ? current.name : ''}
        minLength={1} maxLength={160} required /></label>}
  </fieldset>;
}

export function AnimalPanel({ accessToken, canCreate, canUpdate, canViewCatalogs, canManageBrands,
  canViewMedia,canManageMedia,initialClassification,canViewLocations,modules,onNavigate,
  initialAnimalId,initialCreate,initialEdit,onBack }: {
  accessToken: string; canCreate: boolean; canUpdate: boolean;
  canViewCatalogs: boolean; canManageBrands: boolean;
  canViewMedia:boolean;canManageMedia:boolean;initialClassification?:string;
  canViewLocations:boolean;modules:string[];
  initialAnimalId?:string;initialCreate?:boolean;initialEdit?:boolean;onBack?:()=>void;
  onNavigate:(section:'movements'|'health'|'reproduction'|'production',animal:Animal)=>void;
}) {
  const [result, setResult] = useState<AnimalList | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [classification,setClassification]=useState(initialClassification??'');
  const [classificationNames,setClassificationNames]=useState<AnimalClassificationPolicy['names']|null>(null);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Animal | null>(null);
  const [showCreate, setShowCreate] = useState(Boolean(initialCreate));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<AnimalChoices | null>(null);
  const [brands, setBrands] = useState<LivestockBrand[] | null>(null);
  const [owners, setOwners] = useState<LivestockOwner[]>([]);
  const [groups,setGroups]=useState<LivestockGroup[]>([]);
  const [locations,setLocations]=useState<PhysicalLocation[]>([]);
  const [filters,setFilters]=useState<AnimalFilters>({});
  const [advancedOpen,setAdvancedOpen]=useState(false);
  const [accountUsers, setAccountUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [animalMedia,setAnimalMedia]=useState<MediaItem[]>([]);
  const [mediaRevision,setMediaRevision]=useState(0);
  const [editRevision,setEditRevision]=useState(0);
  const openedEdit=useRef<string|null>(null);
  useEffect(()=>{
    if(!initialAnimalId)return;
    let active=true;
    void getAnimal(accessToken,initialAnimalId)
      .then(animal=>{if(active)setSelected(animal);})
      .catch(reason=>{if(active)setError(message(reason));});
    return()=>{active=false;};
  },[accessToken,initialAnimalId]);
  useEffect(()=>{if(!initialEdit||!canUpdate||!selected||selected.id!==initialAnimalId||
    openedEdit.current===selected.id)return;
    const panel=document.getElementById('animal-edit-panel') as HTMLDetailsElement|null;
    if(panel){openedEdit.current=selected.id;panel.open=true;
      panel.scrollIntoView({behavior:'smooth',block:'start'});}
  },[initialEdit,canUpdate,selected?.id,initialAnimalId]);
  useEffect(()=>{setClassification(initialClassification??'');setPage(1);setSelected(null);},
    [initialClassification]);
  useEffect(()=>{let active=true;void getAnimalClassificationPolicy(accessToken)
    .then(value=>{if(active)setClassificationNames(value.names);})
    .catch(()=>{});return()=>{active=false;};},[accessToken]);

  useEffect(() => {
    let active = true;
    void getAnimals(accessToken, page, search,classification,filters).then((list) => {
      if (active) { setResult(list); setError(null); }
    }).catch((failure) => { if (active) setError(message(failure)); });
    return () => { active = false; };
  }, [accessToken, page, search, classification,filters,revision]);

  useEffect(() => {
    if (!canViewCatalogs) return;
    let active = true;
    void loadAnimalChoices(accessToken)
      .then((value) => { if (active) setChoices(value); })
      .catch(() => { if (active) setChoices(null); });
    return () => { active = false; };
  }, [accessToken, canViewCatalogs]);

  useEffect(() => {
    let active = true;
    void listOwners(accessToken).then((value) => { if (active) setOwners(value); })
      .catch((failure) => { if (active) setError(message(failure)); });
    if (canManageBrands) void listAccountUsers(accessToken).then((value) => {
      if (active) setAccountUsers(value);
    }).catch((failure) => { if (active) setError(message(failure)); });
    void listBrands(accessToken).then((value) => { if (active) setBrands(value); })
      .catch((failure) => { if (active) setError(message(failure)); });
    void listGroups(accessToken).then(value=>{if(active)setGroups(value);})
      .catch((failure)=>{if(active)setError(message(failure));});
    if(canViewLocations)void listLocations(accessToken).then(value=>{if(active)setLocations(value);})
      .catch((failure)=>{if(active)setError(message(failure));});
    return () => { active = false; };
  }, [accessToken,canManageBrands,canViewLocations]);

  function setFilter(key:keyof AnimalFilters,value:string){
    setFilters(current=>({...current,[key]:value||undefined}));setPage(1);
  }

  useEffect(()=>{if(!selected||!canViewMedia){setAnimalMedia([]);return;}
    let active=true;void getMedia(accessToken,'ANIMAL',selected.id).then(items=>{
      if(active)setAnimalMedia(items);
    }).catch(failure=>{if(active)setError(message(failure));});return()=>{active=false;};
  },[accessToken,selected?.id,mediaRevision,canViewMedia]);

  function find(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1); setSearch(searchInput.trim()); setSelected(null);
  }

  async function open(id: string) {
    setBusy(true); setError(null);
    try {
      setSelected(await getAnimal(accessToken, id));
      void listBrands(accessToken).then(setBrands).catch((failure) => setError(message(failure)));
      if (canViewCatalogs) void loadAnimalChoices(accessToken).then(setChoices).catch(() => setChoices(null));
    }
    catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const optional = (key: string) => String(data.get(key) || '').trim() || undefined;
    const weight = optional('initialWeight');
    const earTagCode = optional('earTagCode');
    const birthDate = optional('birthDate');
    const entryDate = optional('entryDate');
    const breedIds = data.getAll('breedIds').map(String);
    const colorIds = data.getAll('colorIds').map(String);
    const brandIds = data.getAll('brandIds').map(String);
    const parent=(role:'mother'|'father'):ParentSelection=>{
      const mode=data.get(`${role}Mode`);
      return mode==='animal'?{animalId:String(data.get(`${role}AnimalId`))}
        :mode==='reported'?{reportedName:String(data.get(`${role}ReportedName`)).trim()}:null;
    };
    let animalOwners: ReturnType<typeof ownerInput>;
    try { animalOwners = ownerInput(data); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Propietarios inválidos.'); return; }
    setBusy(true); setError(null);
    try {
      const created = await createAnimal(accessToken, {
        name: String(data.get('name') || '').trim(),
        description: String(data.get('description') || '').trim() || null,
        sex: String(data.get('sex')) as Animal['sex'],
        speciesCode: 'BOVINE',
        groupId:String(data.get('groupId')),mother:parent('mother'),father:parent('father'),
        ...(earTagCode ? { earTagCode } : {}),
        ...(birthDate ? { birthDate } : {}),
        ...(entryDate ? { entryDate } : {}),
        ...(weight ? { initialWeight: Number(weight), initialWeightUnitCode: String(data.get('weightUnit')) } : {}),
        ...(choices ? { breedIds, colorIds } : {}),
        brandIds, owners: animalOwners,
      });
      setSelected(created); setShowCreate(false); setSearchInput(''); setSearch(''); setPage(1);
      setRevision((value) => value + 1);
      if(canManageMedia){
        const photo=data.get('profilePhoto');const cover=data.get('coverPhoto');
        try{
          if(photo instanceof File&&photo.size)await uploadMedia(accessToken,{file:photo,
            animalIds:[created.id],relationCode:'PROFILE'});
          if(cover instanceof File&&cover.size)await uploadMedia(accessToken,{file:cover,
            animalIds:[created.id],relationCode:'COVER'});
          setMediaRevision(value=>value+1);
        }catch(failure){setError(`El animal se registró, pero no se pudo subir una foto: ${message(failure)}`);}
      }
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }

  async function addOwnerInline(kind:'EXTERNAL_PERSON'|'ORGANIZATION',name:string){
    const created=await createOwner(accessToken,{kind,name});
    setOwners(current=>[...current,created].sort((left,right)=>left.name.localeCompare(right.name,'es')));
    return created;
  }
  async function addUserOwnerInline(userId:string){
    const created=await createOwner(accessToken,{kind:'USER',userId});
    setOwners(current=>[...current,created].sort((left,right)=>left.name.localeCompare(right.name,'es')));
    return created;
  }
  async function addCatalogInline(code:keyof AnimalChoices,name:string){
    const created=await createCatalogItem(accessToken,code,name);
    setChoices(current=>current?{...current,[code]:[...current[code],created]
      .sort((left,right)=>left.name.localeCompare(right.name,'es'))}:current);
    return created;
  }
  async function changeAnimal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || busy) return;
    const data = new FormData(event.currentTarget);
    let ownersInput: ReturnType<typeof ownerInput>;
    try { ownersInput = ownerInput(data); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Propietarios inválidos.'); return; }
    const description = String(data.get('description') || '').trim() || null;
    const breedIds = data.getAll('breedIds').map(String);
    const colorIds = data.getAll('colorIds').map(String);
    const brandIds = data.getAll('brandIds').map(String);
    const sameIds = (left: string[], right: string[]) => left.length === right.length
      && left.every(id => right.includes(id));
    const parent = (role: 'mother' | 'father'): ParentSelection => {
      const mode = data.get(`${role}Mode`);
      if (mode === 'animal') return { animalId: String(data.get(`${role}AnimalId`)) };
      if (mode === 'reported') return { reportedName: String(data.get(`${role}ReportedName`)).trim() };
      return null;
    };
    const currentParent = (role: 'mother' | 'father'): ParentSelection => {
      const entry = selected[role];
      return entry ? entry.animalId ? { animalId: entry.animalId } : { reportedName: entry.name } : null;
    };
    const mother = parent('mother');
    const father = parent('father');
    let updated = selected;
    setBusy(true); setError(null);
    try {
      // These endpoints share a version: save in order and keep the draft if a later section fails.
      if (description !== selected.description)
        updated = await updateAnimalDescription(accessToken, selected.id,
          { description, expectedVersion: updated.version });
      if (ownersInput.length !== selected.owners.length || ownersInput.some(owner => {
        const current = selected.owners.find(entry => entry.id === owner.partyId);
        return !current || current.percent !== owner.percent || current.isPrimary !== owner.isPrimary;
      })) updated = await updateAnimalOwners(accessToken, selected.id,
        { owners: ownersInput, expectedVersion: updated.version });
      const breeds = selected.breeds?.length ? selected.breeds : (selected.breed ? [selected.breed] : []);
      if (choices && (!sameIds(breedIds, breeds.map(entry => entry.id))
        || !sameIds(colorIds, (selected.colors ?? []).map(entry => entry.id))))
        updated = await updateAnimalCatalogs(accessToken, selected.id,
          { breedIds, colorIds, expectedVersion: updated.version });
      if (brands && !sameIds(brandIds, selected.brands.map(entry => entry.id)))
        updated = await updateAnimalBrands(accessToken, selected.id,
          { brandIds, expectedVersion: updated.version });
      if (JSON.stringify(mother) !== JSON.stringify(currentParent('mother'))
        || JSON.stringify(father) !== JSON.stringify(currentParent('father')))
        updated = await updateAnimalParents(accessToken, selected.id,
          { mother, father, expectedVersion: updated.version });
      setEditRevision(value => value + 1);
      const panel = document.getElementById('animal-edit-panel') as HTMLDetailsElement | null;
      if (panel) panel.open = false;
      if (initialEdit) onBack?.();
    } catch (failure) {
      setError(`${updated.version !== selected.version ? 'Se guardó parte de los cambios. ' : ''}${message(failure)}`);
    } finally {
      setSelected(updated);
      if (updated.version !== selected.version) setResult(current => current ? { ...current,
        items: current.items.map(entry => entry.id === updated.id ? updated : entry) } : current);
      setBusy(false);
    }
  }

  return <section className="section-block animal-panel">
    <div className="section-heading"><div><span className="eyebrow">Núcleo ganadero</span><h2>Animales</h2>
      <p className="muted">Registros de la propiedad activa.</p></div>
      {canCreate&&!selected && <button className="primary-button compact" type="button" disabled={busy}
        onClick={() => {
          setShowCreate((value) => !value);
          if (canViewCatalogs) void loadAnimalChoices(accessToken).then(setChoices).catch(() => setChoices(null));
        }}>{showCreate ? 'Cerrar' : '+ Animal'}</button>}
    </div>
    {error && <div className="form-error admin-error" role="alert">{error}</div>}
    {!selected&&<>{showCreate && <form className="animal-create animal-registration-form"
      onSubmit={(event) => void create(event)}>
      <div className="animal-form-intro"><div><h3>Registrar animal</h3>
        <p>Completa primero la identificación y después las relaciones del animal.</p></div>
        <small>* Campos obligatorios</small></div>
      <section className="animal-form-section"><header><span>1</span><div><h4>Identificación</h4>
        <p>Datos principales y ubicación inicial.</p></div></header><div className="animal-form-grid">
        <label><span>Nombre *</span><input name="name" maxLength={160} required disabled={busy} /></label>
        <label><span>Sexo *</span><Select name="sex" required disabled={busy} defaultValue="">
          <option value="" disabled>Selecciona</option><option value="FEMALE">Hembra</option>
          <option value="MALE">Macho</option></Select></label>
        <label><span>Grupo *</span><Select name="groupId" required disabled={busy} defaultValue="">
          <option value="">Selecciona un grupo</option>{groups.filter(group=>group.active).map(group=><option
            key={group.id} value={group.id}>{group.name}{group.location?` · ${group.location.name}`:''}</option>)}
        </Select><small>La ubicación se hereda del grupo.</small></label>
        <label><span>Arete individual</span><input name="earTagCode" maxLength={80} disabled={busy} /></label>
        <label><span>Fecha de nacimiento</span><DateInput type="date" name="birthDate" disabled={busy} /></label>
        <label><span>Fecha de ingreso</span><DateInput type="date" name="entryDate" disabled={busy} />
          <small>Vacía: se usa la fecha actual de la finca.</small></label>
        <label><span>Peso inicial</span><input type="number" name="initialWeight" min="0.001"
          max="999999999" step="0.001" disabled={busy} /></label>
        <label><span>Unidad de peso</span><Select name="weightUnit" disabled={busy} defaultValue="KILOGRAM">
          <option value="KILOGRAM">kg</option><option value="POUND">lb</option></Select></label>
        <label className="animal-form-wide"><span>Descripción</span>
          <textarea name="description" maxLength={5000} rows={3} disabled={busy} /></label>
      </div></section>
      {choices&&<section className="animal-form-section"><header><span>2</span><div><h4>Raza y apariencia</h4>
        <p>Selecciona una o varias opciones.</p></div></header><div className="animal-form-choice-grid">
        <CatalogFields choices={choices} canManage={canManageBrands} onCreate={addCatalogInline}/>
      </div></section>}
      <section className="animal-form-section"><header><span>3</span><div><h4>Propiedad y marquillas</h4>
        <p>Los porcentajes se distribuyen automáticamente.</p></div></header><div className="animal-form-stack">
        <OwnerFields owners={owners} accountUsers={accountUsers} canManage={canManageBrands}
          onCreate={addOwnerInline} onCreateUser={addUserOwnerInline}/>
        {brands&&<BrandFields brands={brands}/>}
        <small className="animal-form-note">Las opciones compartidas también se administran desde Catálogos.</small>
      </div></section>
      <section className="animal-form-section"><header><span>4</span><div><h4>Parentesco</h4>
        <p>Relaciona los padres registrados o escribe un nombre externo.</p></div></header>
        <div className="animal-parent-grid"><ParentField accessToken={accessToken} role="mother"/>
          <ParentField accessToken={accessToken} role="father"/></div></section>
      {canManageMedia&&<section className="animal-form-section"><header><span>5</span><div><h4>Fotografías</h4>
        <p>Puedes agregarlas ahora o posteriormente desde la ficha.</p></div></header><div className="animal-form-grid">
        <label><span>Foto de perfil</span><input name="profilePhoto" type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"/></label>
        <label><span>Foto de portada</span><input name="coverPhoto" type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"/></label></div></section>}
      <div className="animal-form-actions"><button className="primary-button compact" type="submit"
        disabled={busy||brands===null}>{busy?'Guardando…':'Registrar animal'}</button></div>
    </form>}
    <form className="animal-search" onSubmit={find} role="search">
      <label><span className="sr-only">Buscar por nombre, arete o marquilla</span><input value={searchInput}
        placeholder="Buscar nombre, arete o marquilla…" maxLength={80}
        onChange={(event) => setSearchInput(event.target.value)} /></label>
      <button className="secondary-button compact animal-toolbar-button" type="submit"
        aria-label="Buscar" title="Buscar"><ShellIcon name="search"/></button>
      <Select className="animal-sex-select" aria-label="Filtrar por sexo"
        value={filters.sex??''} onChange={event=>setFilter('sex',event.target.value)}>
        <option value="">Todos los sexos</option><option value="FEMALE">Hembras</option>
        <option value="MALE">Machos</option>
      </Select>
      <button type="button" className={`secondary-button compact animal-toolbar-button${advancedOpen?' active':''}`}
        aria-label="Filtros avanzados" title="Filtros avanzados" aria-expanded={advancedOpen}
        onClick={()=>setAdvancedOpen(open=>!open)}><ShellIcon name="filter"/>
        {Object.values(filters).filter(Boolean).length>0&&<span className="animal-filter-count">
          {Object.values(filters).filter(Boolean).length}</span>}</button>
      <span className="animal-total" aria-live="polite">{result?.total??0} animales</span>
    </form>
    <div className="animal-quick-filters">
      <label><span className="sr-only">Grupo</span><Select value={filters.groupId??''}
        onChange={event=>setFilter('groupId',event.target.value)}><option value="">Todos los grupos</option>
        {groups.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
      <label><span className="sr-only">Clasificación</span><Select value={classification} onChange={event=>{
        setClassification(event.target.value);setPage(1);}}><option value="">Todas</option>
        {(['VACA','VACONA','TERNERA','TORO','TORETE','TERNERO'] as const)
          .map(code=><option key={code} value={code}>{classificationNames?.[code]
            ??code.charAt(0)+code.slice(1).toLowerCase()}</option>)}
      </Select></label>
    </div>
    {advancedOpen&&<div className="animal-advanced-filters">
      <div className="animal-filter-grid">
        <label><span>Estado</span><Select value={filters.status??''} onChange={event=>setFilter('status',event.target.value)}>
          <option value="">Todos</option><option value="ACTIVE">Activo</option><option value="INACTIVE">Inactivo</option>
          <option value="DEAD">Fallecido</option><option value="MISSING">Desaparecido</option>
        </Select></label>
        {canViewLocations&&modules.includes('MOVEMENTS')&&<label><span>Potrero o corral</span>
          <Select value={filters.locationId??''} onChange={event=>setFilter('locationId',event.target.value)}>
            <option value="">Todos</option>{locations.map(item=><option key={item.id} value={item.id}>
              {item.kind==='PASTURE'?'Potrero':'Corral'}: {item.name}</option>)}
          </Select></label>}
        <label><span>Propietario</span><Select value={filters.ownerId??''} onChange={event=>setFilter('ownerId',event.target.value)}>
          <option value="">Todos</option>{owners.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
        </Select></label>
        {canViewCatalogs&&(['breedId','colorId'] as const).map(key=><label key={key}><span>{key==='breedId'?'Raza':'Color'}</span>
          <Select value={filters[key]??''} onChange={event=>setFilter(key,event.target.value)}><option value="">Todos</option>
            {choices?.[key==='breedId'?'BREEDS':'COLORS'].map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
          </Select></label>)}
        <label><span>Marquilla</span><Select value={filters.brandId??''} onChange={event=>setFilter('brandId',event.target.value)}>
          <option value="">Todas</option>{brands?.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
        </Select></label>
        <label><span>Nacimiento desde</span><DateInput type="date" value={filters.birthFrom??''}
          max={filters.birthTo||undefined} onChange={event=>setFilter('birthFrom',event.target.value)}/></label>
        <label><span>Nacimiento hasta</span><DateInput type="date" value={filters.birthTo??''}
          min={filters.birthFrom||undefined} onChange={event=>setFilter('birthTo',event.target.value)}/></label>
      </div><button type="button" className="text-button" onClick={()=>{setFilters({});setClassification('');setPage(1);}}>
        Limpiar filtros</button>
    </div>}
    {!result && !error && <p className="muted">Cargando animales…</p>}
    {result && <>
      {result.items.length === 0 && <p className="muted">No hay animales con ese criterio en esta propiedad.</p>}
      <div className="animal-list">{result.items.map((entry) => <button type="button" key={entry.id}
        className="animal-row" onClick={() => void open(entry.id)} disabled={busy}>
        <span className="animal-row-avatar">{entry.profilePhotoUrl?<img src={entry.profilePhotoUrl} alt=""/>
          :<ShellIcon name="animals" size={24}/>}</span>
        <span className="animal-row-content"><strong>{entry.name}</strong>
          {entry.description&&<small className="animal-row-description">{entry.description}</small>}
          <small className="animal-row-facts">{entry.classification?.name??'Animal'} · {entry.sex==='FEMALE'?'Hembra':'Macho'}
            {' · '}{entry.group?.name||'Sin grupo'}{entry.location?` · ${entry.location.name}`:''}</small>
          <span className="animal-row-footer"><small>{entry.earTagCode?`Arete ${entry.earTagCode} · `:''}
            {entry.birthDate?`Nacimiento ${formatDate(entry.birthDate)}`:'Sin fecha de nacimiento'}</small>
            {entry.primaryOwnerName&&<small>Propietario: {entry.primaryOwnerName}</small>}</span>
        </span>
        <span className={`animal-row-status ${entry.availabilityStatusCode.toLowerCase()}`}>
          {animalStatusLabels[entry.availabilityStatusCode]??entry.availabilityStatusCode}</span>
      </button>)}</div>
      {(page > 1 || result.hasMore) && <div className="animal-pages">
        <button className="secondary-button compact" type="button" disabled={page === 1}
          onClick={() => { setPage(page - 1); setSelected(null); }}>Anterior</button>
        <span>Página {page}</span>
        <button className="secondary-button compact" type="button" disabled={!result.hasMore}
          onClick={() => { setPage(page + 1); setSelected(null); }}>Siguiente</button>
      </div>}
    </>}</>}
    {selected && <div className="animal-detail">
      <div className="animal-social-cover">
        {canViewMedia&&animalMedia.find(item=>item.relation_code==='COVER'&&item.kind==='IMAGE')&&<img
          className="animal-cover" src={animalMedia.find(item=>item.relation_code==='COVER')!.url}
          alt={`Portada de ${selected.name}`}/>}
        <div className="animal-cover-shade"/><div className="animal-cover-name"><h3>{selected.name}</h3>
          <p>{selected.description||'Sin descripción'}</p></div>
        <div className="animal-profile">
        {canViewMedia&&animalMedia.find(item=>item.relation_code==='PROFILE'&&item.kind==='IMAGE')?<img
          className="animal-profile-photo" src={animalMedia.find(item=>item.relation_code==='PROFILE')!.thumbnailUrl??''}
          alt={`Perfil de ${selected.name}`}/>:<ShellIcon name="animals" size={46}/>}</div>
      </div>
      <div className="animal-profile-action-strip">
        <span className="animal-classification-badge">{selected.classification?.name||'Animal'}</span>
        <span>{selected.sex==='FEMALE'?'Hembra':'Macho'} · {selected.group?.name||'Sin grupo'}</span>
        <div className="animal-profile-buttons">
        {canManageMedia&&<input id="animal-profile-photo-input" type="file" hidden
          accept="image/jpeg,image/png,image/webp,image/heic" onChange={event=>{
            const file=event.currentTarget.files?.[0];if(!file)return;
            event.currentTarget.value='';setBusy(true);
            void uploadMedia(accessToken,{file,animalIds:[selected.id],relationCode:'PROFILE'})
              .then(()=>setMediaRevision(value=>value+1)).catch(failure=>setError(message(failure)))
              .finally(()=>setBusy(false));
          }}/>}
        {canManageMedia&&<button type="button" className="secondary-button compact" aria-label="Cambiar foto"
          title="Cambiar foto" onClick={()=>{
          document.getElementById('animal-profile-photo-input')?.click();}}><ShellIcon name="camera"/></button>}
        {canUpdate&&<button type="button" className="secondary-button compact" aria-label="Editar ficha"
          title="Editar ficha" onClick={()=>{
          const panel=document.getElementById('animal-edit-panel') as HTMLDetailsElement|null;
          if(panel){panel.open=true;panel.scrollIntoView({behavior:'smooth',block:'start'});}
        }}><ShellIcon name="edit"/></button>}
        {selected.availabilityStatusCode==='ACTIVE'&&modules.includes('MOVEMENTS')&&<button type="button"
          className="secondary-button compact" aria-label="Registrar movimiento" title="Registrar movimiento"
          onClick={()=>onNavigate('movements',selected)}><ShellIcon name="movements"/></button>}
        {selected.availabilityStatusCode==='ACTIVE'&&modules.includes('HEALTH')&&<button type="button"
          className="secondary-button compact" aria-label="Registrar sanidad" title="Registrar sanidad"
          onClick={()=>onNavigate('health',selected)}><ShellIcon name="health"/></button>}
        {selected.sex==='FEMALE'&&selected.availabilityStatusCode==='ACTIVE'&&modules.includes('PRODUCTION')&&<button
          type="button" className="secondary-button compact" aria-label="Registrar producción"
          title="Registrar producción" onClick={()=>onNavigate('production',selected)}><ShellIcon name="production"/></button>}
        {selected.sex==='FEMALE'&&selected.availabilityStatusCode==='ACTIVE'&&modules.includes('REPRODUCTION')&&<button
          type="button" className="secondary-button compact" aria-label="Registrar reproducción"
          title="Registrar reproducción" onClick={()=>onNavigate('reproduction',selected)}><ShellIcon name="reproduction"/></button>}
        </div>
      </div>
      <div className="animal-data-card"><h4>Información</h4>
      <dl><div><dt>Arete individual</dt><dd>{selected.earTagCode || 'No registrado'}</dd></div>
        <div><dt>Grupo</dt><dd>{selected.group?.name || 'Sin grupo'}</dd></div>
        <div><dt>Ubicación</dt><dd>{selected.location
          ? `${selected.location.kind === 'PASTURE' ? 'Potrero' : 'Corral'}: ${selected.location.name}`
          : 'Sin ubicación'}</dd></div>
        <div><dt>Propietarios</dt><dd>{selected.owners?.map((owner) => `${owner.name} (${owner.percent}%)`).join(', ') || 'No registrados'}</dd></div>
        <div><dt>Marquillas</dt><dd>{selected.brands.map((brand) => brand.name).join(', ') || 'No registradas'}</dd></div>
        <div><dt>Clasificación</dt><dd>{selected.classification?.name||'Sin clasificar'}</dd></div>
        <div><dt>Sexo</dt><dd>{selected.sex === 'FEMALE' ? 'Hembra' : 'Macho'}</dd></div>
        <div><dt>Nacimiento</dt><dd>{selected.birthDate || 'No registrado'}</dd></div>
        <div><dt>Ingreso</dt><dd>{selected.entryDate}</dd></div>
        <div><dt>Peso inicial</dt><dd>{selected.initialWeight === null ? 'No registrado'
          : `${selected.initialWeight} ${selected.initialWeightUnitCode === 'POUND' ? 'lb'
            : selected.initialWeightUnitCode === 'GRAM' ? 'g' : 'kg'}`}</dd></div>
        <div><dt>Razas</dt><dd>{selected.breeds?.map((breed) => breed.name).join(', ') || 'No registradas'}</dd></div>
        <div><dt>Colores</dt><dd>{selected.colors?.map((color) => color.name).join(', ') || 'No registrados'}</dd></div></dl>
      <dl className="animal-parent-summary"><div><dt>Madre</dt><dd>{selected.mother?.name || 'No registrada'}</dd></div>
        <div><dt>Padre</dt><dd>{selected.father?.name || 'No registrado'}</dd></div></dl></div>
      {canViewMedia&&<div className="animal-photos"><h4>Fotos y videos</h4>
        <div className="media-grid">{animalMedia.map(item=><article className="media-card" key={item.id}>
          {item.kind==='IMAGE'?<a href={item.url} target="_blank" rel="noreferrer"><img
            src={item.thumbnailUrl??item.url} alt={item.description??selected.name}/></a>:
            <video src={item.url} controls preload="metadata"/>}
          <div><small>{item.relation_code==='PROFILE'?'Perfil':item.relation_code==='COVER'?'Portada':
            item.captured_on??'Galería'}</small>
            {canManageMedia&&<button type="button" disabled={busy} onClick={()=>{
              if(!window.confirm('¿Quitar esta foto de la ficha?'))return;
              setBusy(true);void deleteMedia(accessToken,item.id).then(()=>setMediaRevision(n=>n+1))
                .catch(failure=>setError(message(failure))).finally(()=>setBusy(false));
            }}>Quitar</button>}</div></article>)}</div>
        {canManageMedia&&<form className="animal-media-upload" onSubmit={event=>{
          event.preventDefault();const form=event.currentTarget;const data=new FormData(form);
          const file=data.get('file');if(!(file instanceof File)||!file.size)return;
          setBusy(true);void uploadMedia(accessToken,{file,animalIds:[selected.id],
            relationCode:String(data.get('role')) as 'GENERAL'|'PROFILE'|'COVER'})
            .then(()=>{form.reset();setMediaRevision(n=>n+1);}).catch(failure=>setError(message(failure)))
            .finally(()=>setBusy(false));
        }}><Select name="role" aria-label="Uso de la foto"><option value="GENERAL">Galería</option>
          <option value="PROFILE">Perfil</option><option value="COVER">Portada</option></Select>
          <input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/heic" required/>
          <button className="secondary-button compact" disabled={busy}>Agregar foto</button></form>}
      </div>}
      {canUpdate&&<details id="animal-edit-panel" className="animal-edit-section"><summary>Editar ficha del animal</summary>
      <form key={`${selected.id}:${editRevision}`} onSubmit={(event) => void changeAnimal(event)}>
      <fieldset disabled={busy} style={{border:0,padding:0,margin:0,minWidth:0}}>
      <section className="animal-catalog-edit">
        <h4>Descripción</h4>
        <label><span>Notas del animal</span><textarea name="description" maxLength={5000}
          rows={4} defaultValue={selected.description || ''} disabled={busy} /></label>
      </section>
      <section className="animal-catalog-edit">
        <h4>Propietarios y participación</h4>
        <OwnerFields owners={owners} accountUsers={accountUsers} selected={selected}
          canManage={canManageBrands} onCreate={addOwnerInline} onCreateUser={addUserOwnerInline}/>
      </section>
      {choices && <section className="animal-catalog-edit">
        <h4>Raza y colores</h4><CatalogFields choices={choices} selected={selected}
          canManage={canManageBrands} onCreate={addCatalogInline}/>
      </section>}
      {brands && <section className="animal-catalog-edit">
        <h4>Marquillas</h4><BrandFields brands={brands} selected={selected} />
      </section>}
      <section className="animal-catalog-edit">
        <h4>Parentesco</h4>
        <div className="animal-parent-grid">
          <ParentField accessToken={accessToken} child={selected} role="mother" />
          <ParentField accessToken={accessToken} child={selected} role="father" />
        </div>
      </section>
      </fieldset>
      <div className="animal-form-actions"><button className="primary-button compact" type="submit" disabled={busy}>
        {busy ? 'Guardando…' : 'Guardar'}</button></div>
      </form>
      </details>}
    </div>}
  </section>;
}

function message(error: unknown) {
  return error instanceof ApiRequestError ? error.message : 'No fue posible completar la operación.';
}
