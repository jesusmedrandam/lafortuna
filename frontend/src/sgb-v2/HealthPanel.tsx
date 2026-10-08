import {DateInput} from '../components/ui';
import {type FormEvent,useEffect,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import {Syringe} from 'lucide-react';
import {ApiRequestError,applyHealthCampaign,cancelHealthCampaign,createHealthCampaign,
  createHealthCondition,updateHealthCondition,resolveHealthCondition,
  getHealthConditions,getHealthCampaigns,getHealthConditionTreatments,getHealthMedicines,getHealthOptions,listCatalogItems,
  updateHealthCampaign,type HealthCampaign,type HealthCampaignInput,
  type HealthMedicine,type HealthOptions,type HealthCondition,type CatalogItem} from './api';
import {SearchableSelect} from './SearchableSelect';
import {formatDate} from '../utils';
import {defaultRoutes,routeKey,suggestedMedicineDose,medicineDoseReference,medicineDoseUnits} from './MedicineForm';

const kinds={VACUNA:'Vacuna',DESPARASITACION:'Desparasitación',
  ENFERMEDAD:'Enfermedad',OTRO:'Otro tratamiento'};
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const message=(error:unknown)=>error instanceof ApiRequestError?error.message:
  error instanceof Error?error.message:'No se pudo guardar el registro sanitario.';
const healthAnimalOption=(animal:HealthOptions['animals'][number])=>({
  value:animal.id,label:animal.name,imageUrl:animal.profilePhotoUrl,
  description:[animal.earTagCode?`Arete ${animal.earTagCode}`:null,animal.groupName,
    animal.locationName].filter(Boolean).join(' · ')||null,
  keywords:[animal.earTagCode,animal.groupName,animal.locationName].filter(Boolean).join(' '),
});
type HealthTab='conditions'|'treatments'|'campaigns';

export function HealthPanel({accessToken,canManage,canViewMedicines=false,initialAnimalId,initialAction,onCompleted}:{
  accessToken:string;canManage:boolean;canViewMedicines?:boolean;initialAnimalId?:string|undefined;
  initialAction?:string;onCompleted?:()=>void}){
  const [medicines,setMedicines]=useState<HealthMedicine[]>([]);
  const [options,setOptions]=useState<HealthOptions|null>(null);
  const [campaigns,setCampaigns]=useState<HealthCampaign[]|null>(null);
  const [conditions,setConditions]=useState<HealthCondition[]>([]);
  const [conditionTypes,setConditionTypes]=useState<CatalogItem[]>([]);
  const [revision,setRevision]=useState(0);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [tab,setTab]=useState<HealthTab>('conditions');
  const [search,setSearch]=useState('');
  const [order,setOrder]=useState<'NEWEST'|'OLDEST'|'AZ'|'ZA'>('NEWEST');
  const [selectedConditionId,setSelectedConditionId]=useState<string|null>(null);
  const [conditionTreatments,setConditionTreatments]=useState<HealthCampaign[]|null>(null);
  const [conditionTreatmentError,setConditionTreatmentError]=useState('');
  const [selectedCampaignId,setSelectedCampaignId]=useState<string|null>(null);
  const [selectedTreatment,setSelectedTreatment]=useState<{campaignId:string;animalId:string}|null>(null);
  const [showCondition,setShowCondition]=useState(false);
  const [editingCondition,setEditingCondition]=useState<HealthCondition|null>(null);
  const [showCampaign,setShowCampaign]=useState(false);
  const [editing,setEditing]=useState<HealthCampaign|null>(null);
  const [medicineId,setMedicineId]=useState('');
  const [mode,setMode]=useState<HealthCampaignInput['selectionMode']>('MANUAL');
  const [groupId,setGroupId]=useState('');
  const [selected,setSelected]=useState<string[]>([]);
  const [doses,setDoses]=useState<Record<string,string>>({});
  const [conditionIds,setConditionIds]=useState<Record<string,string>>({});
  const [conditionAnimalId,setConditionAnimalId]=useState('');
  const [conditionKind,setConditionKind]=useState('');
  const [defaultDose,setDefaultDose]=useState('');
  const [administrationRoute,setAdministrationRoute]=useState<HealthCampaignInput['administrationRoute']>('INTRAMUSCULAR');
  const [prefilledAnimalId,setPrefilledAnimalId]=useState<string|null>(null);
  const requestedAction=initialAction??new URLSearchParams(window.location.search).get('accion');
  const preventiveTreatment=requestedAction==='TRATAMIENTO_PREVENTIVO'&&Boolean(initialAnimalId)&&!editing;
  const conditionTreatment=requestedAction==='TRATAMIENTO_CONDICION'&&Boolean(initialAnimalId)&&!editing;
  const resolutionConditionId=requestedAction?.startsWith('RESOLVER_CONDICION:')
    ?requestedAction.slice('RESOLVER_CONDICION:'.length):null;
  useEffect(()=>{const requested=requestedAction;
    if(!initialAnimalId||initialAnimalId===prefilledAnimalId||!canManage)return;
    if(resolutionConditionId){const target=conditions.find(item=>item.id===resolutionConditionId&&
      item.animalId===initialAnimalId&&item.status!=='RESUELTA');if(!target)return;
      setTab('conditions');setSelectedConditionId(target.id);setPrefilledAnimalId(initialAnimalId);return;}
    if(!['CONDICION','TRATAMIENTO','TRATAMIENTO_PREVENTIVO','TRATAMIENTO_CONDICION'].includes(requested??'')||
      !options?.animals.some(item=>item.id===initialAnimalId))return;
    if(requested!=='CONDICION'){
      const active=conditions.filter(item=>item.animalId===initialAnimalId&&item.status!=='RESUELTA');
      if(requested==='TRATAMIENTO_CONDICION'&&!active.length)return;
      setTab('treatments');setMode('MANUAL');setSelected([initialAnimalId]);
      setConditionIds(requested==='TRATAMIENTO_CONDICION'&&active.length===1
        ?{[initialAnimalId]:active[0]!.id}:{});setShowCampaign(true);
    }else{setTab('conditions');setConditionAnimalId(initialAnimalId);setConditionKind('');setShowCondition(true);}
    setPrefilledAnimalId(initialAnimalId);
  },[initialAnimalId,prefilledAnimalId,options?.animals,conditions,canManage,requestedAction,resolutionConditionId]);
  useEffect(()=>{if(new URLSearchParams(window.location.search).get('vista')==='tratamientos')
    setTab('treatments');},[initialAnimalId]);

  useEffect(()=>{let active=true;
    void Promise.allSettled([getHealthMedicines(accessToken),getHealthOptions(accessToken),
      getHealthCampaigns(accessToken),getHealthConditions(accessToken)]).then(([items,choices,records,events])=>{
      if(!active)return;
      if(items.status==='fulfilled')setMedicines(items.value);
      if(choices.status==='fulfilled')setOptions(choices.value);
      if(records.status==='fulfilled')setCampaigns(records.value);
      if(events.status==='fulfilled')setConditions(events.value);
      setLoading(false);
      const failure=[items,choices,records,events].find(result=>result.status==='rejected');
      if(failure?.status==='rejected')setError(message(failure.reason));
    });
    return ()=>{active=false;};
  },[accessToken,revision]);
  useEffect(()=>{let timer:ReturnType<typeof setTimeout>;
    const changed=(event:Event)=>{const path=(event as CustomEvent<{path?:string}>).detail?.path;
      if(path&&!path.startsWith('/health-records/')&&!path.startsWith('/catalogs/')&&path!=='/animals/classification')return;
      clearTimeout(timer);timer=setTimeout(()=>setRevision(value=>value+1),120);};
    window.addEventListener('sgb-v2-cache-updated',changed);return()=>{clearTimeout(timer);window.removeEventListener('sgb-v2-cache-updated',changed);};
  },[]);
  useEffect(()=>{let active=true;void listCatalogItems(accessToken,'HEALTH_CONDITION_TYPES').then(conditions=>{
    if(active)setConditionTypes(conditions);
  }).catch(failure=>{if(active)setError(message(failure));});return()=>{active=false;};},[accessToken]);
  const medicine=medicines.find((item)=>item.id===medicineId);
  const units=options?.units.length?options.units:medicineDoseUnits;
  const routeOptions=(options?.administrationRoutes?.length?options.administrationRoutes:Object.entries(defaultRoutes).map(([itemCode,name])=>
    ({id:itemCode,itemCode,name,active:true,systemDefined:true,catalogCode:'ADMINISTRATION_ROUTES' as const,speciesCode:null})))
    .filter(item=>item.active);
  const allowedRoutes=medicine?routeOptions.filter(item=>medicine.administrationRoutes?.includes(routeKey(item))):[];
  const unitName=(code:string)=>units.find(item=>item.code===code)?.symbol??medicineDoseUnits.find(item=>item.code===code)?.symbol??code;
  const routeName=(code:string)=>options?.administrationRoutes?.find(item=>routeKey(item)===code)?.name
    ??defaultRoutes[code as keyof typeof defaultRoutes]??'Vía registrada';
  useEffect(()=>{if(!medicine)return;setAdministrationRoute(current=>
    allowedRoutes.some(item=>routeKey(item)===current)?current:allowedRoutes[0]?routeKey(allowedRoutes[0]):'');
  },[medicine,options?.administrationRoutes]);
  const individualTreatment=tab==='treatments'&&!editing;
  const candidates=options?.animals.filter((animal)=>individualTreatment&&initialAnimalId
    ?animal.id===initialAnimalId:mode!=='GRUPO'||animal.groupId===groupId)??[];
  const selectedIds=mode==='MANUAL'?selected:candidates.map((animal)=>animal.id);
  const selectedAnimal=options?.animals.find(animal=>animal.id===selectedIds[0]);
  const selectedAnimalConditions=selectedAnimal?conditions.filter(item=>item.animalId===selectedAnimal.id&&
    item.status!=='RESUELTA'):[];
  const relatedTreatments=useMemo(()=>(campaigns??[]).filter(record=>record.status==='COMPLETADO')
    .flatMap(record=>record.animals.filter(animal=>animal.selected).map(animal=>({record,animal}))),[campaigns]);
  const visible=useMemo(()=>{
    const term=search.trim().toLocaleLowerCase();
    const sorted=<T,>(rows:T[],date:(item:T)=>string,name:(item:T)=>string)=>rows.sort((a,b)=>
      order==='AZ'||order==='ZA'?(order==='AZ'?1:-1)*name(a).localeCompare(name(b),'es'):
        (order==='NEWEST'?-1:1)*date(a).localeCompare(date(b)));
    return {
      conditions:sorted(conditions.filter(item=>(!initialAnimalId||item.animalId===initialAnimalId)&&
        [item.animalName,item.kind,item.description,item.status]
        .join(' ').toLocaleLowerCase().includes(term)),item=>item.detectedOn,item=>item.animalName),
      treatments:sorted(relatedTreatments.filter(({record,animal})=>(!initialAnimalId||
        animal.animalId===initialAnimalId)&&[animal.name,record.medicineName,
        record.responsible,record.groupName,record.kind].join(' ').toLocaleLowerCase().includes(term)),
        item=>item.record.appliedOn,item=>item.animal.name),
      campaigns:sorted((campaigns??[]).filter(item=>(!initialAnimalId||item.animals.some(
        animal=>animal.animalId===initialAnimalId&&animal.selected))&&
        [item.medicineName,item.responsible,item.groupName,
        item.kind,...item.animals.map(animal=>animal.name)].join(' ').toLocaleLowerCase().includes(term)),
        item=>item.appliedOn,item=>item.medicineName),
    };
  },[campaigns,conditions,relatedTreatments,search,order,initialAnimalId]);
  const selectedCondition=conditions.find(item=>item.id===selectedConditionId);
  const allCampaigns=[...campaigns??[],...conditionTreatments??[]];
  const selectedCampaign=allCampaigns.find(item=>item.id===selectedCampaignId);
  const treatmentRecord=allCampaigns.find(item=>item.id===selectedTreatment?.campaignId);
  const treatmentAnimal=treatmentRecord?.animals.find(item=>item.animalId===selectedTreatment?.animalId);
  useEffect(()=>{let active=true;
    if(selectedConditionId){setConditionTreatments(null);setConditionTreatmentError('');
      void getHealthConditionTreatments(accessToken,selectedConditionId)
        .then(value=>{if(active)setConditionTreatments(value);})
        .catch(reason=>{if(active)setConditionTreatmentError(message(reason));});}
    return()=>{active=false;};
  },[accessToken,selectedConditionId,revision]);
  const dialogOpen=showCondition||showCampaign||Boolean(selectedCondition||selectedCampaign||treatmentAnimal);
  useEffect(()=>{if(!dialogOpen)return;
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!busy)closeForm();};
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  },[dialogOpen,busy]);
  function closeForm(){closeDialogs();reset();if(initialAction)onCompleted?.();}
  function closeDialogs(){setShowCondition(false);setShowCampaign(false);
    setEditingCondition(null);setSelectedConditionId(null);setSelectedCampaignId(null);
    setSelectedTreatment(null);setEditing(null);}
  function openNew(){closeDialogs();reset();if(tab==='conditions'){setConditionAnimalId(initialAnimalId??'');
      setConditionKind('');setShowCondition(true);}
    else setShowCampaign(true);}
  function reset(){setEditing(null);setShowCampaign(false);setMedicineId('');setMode('MANUAL');
    setGroupId('');setSelected([]);setDoses({});setDefaultDose('');setConditionIds({});setAdministrationRoute('INTRAMUSCULAR');}
  function edit(record:HealthCampaign){closeDialogs();setEditing(record);setShowCampaign(true);
    setMedicineId(record.medicineId);setMode(record.selectionMode);setGroupId(record.groupId??'');
    setAdministrationRoute(record.administrationRoute);
    setSelected(record.animals.filter((animal)=>animal.selected).map((animal)=>animal.animalId));
    setDoses(Object.fromEntries(record.animals.map((animal)=>[animal.animalId,String(animal.dose)])));
    setDefaultDose('');
    setConditionIds(Object.fromEntries(record.animals.map((animal)=>[animal.animalId,
      animal.conditionId??''])));
  }
  async function run(operation:()=>Promise<unknown>,done?:()=>void){setBusy(true);setError(null);
    try{await operation();done?.();setRevision((value)=>value+1);
      if(initialAction&&done)onCompleted?.();}
    catch(failure){setError(message(failure));window.scrollTo({top:0,behavior:'smooth'});}
    finally{setBusy(false);}
  }
  function saveCondition(event:FormEvent<HTMLFormElement>){event.preventDefault();
    const data=new FormData(event.currentTarget);
    const input={animalId:editingCondition?.animalId??conditionAnimalId,
      kind:conditionKind.trim(),
      detectedOn:String(data.get('date')),description:String(data.get('description')).trim(),
      ...(editingCondition?{expectedVersion:editingCondition.version}:{})};
    void run(()=>editingCondition?updateHealthCondition(accessToken,editingCondition.id,input)
      :createHealthCondition(accessToken,input),()=>{setShowCondition(false);setEditingCondition(null);});
  }
  function saveCampaign(event:FormEvent<HTMLFormElement>){event.preventDefault();
    const data=new FormData(event.currentTarget);
    if(!medicine)return;
    const ids=mode==='MANUAL'?selected:candidates.map((animal)=>animal.id);
    const input:HealthCampaignInput={medicineId,selectionMode:mode,groupId:mode==='GRUPO'?groupId:null,
      administrationRoute,
      appliedOn:String(data.get('date')),responsible:String(data.get('responsible')).trim()||null,
      notes:String(data.get('notes')).trim()||null,
      animals:ids.map((id)=>({animalId:id,selected:true,
        dose:Number(doses[id]?.trim()||defaultDose.trim()||
          suggestedMedicineDose(medicine,options?.animals.find(animal=>animal.id===id))||0),
        unitCode:medicine.defaultUnitCode,
        conditionId:conditionIds[id]||null})),
      ...(editing?{expectedVersion:editing.version}:{})};
    if(!allowedRoutes.some(item=>routeKey(item)===administrationRoute)){
      setError('Selecciona una vía de administración del medicamento.');return;}
    if(input.animals.some(item=>!Number.isFinite(item.dose)||item.dose<0.001||item.dose>1000000)){
      setError('Indica una dosis válida para cada animal. Si falta el peso, ingresa la cantidad manualmente.');return;}
    if(individualTreatment){
      void run(async()=>{
        const draft=await createHealthCampaign(accessToken,input);
        try{await applyHealthCampaign(accessToken,draft.id);}
        catch(failure){reset();setRevision(value=>value+1);setTab('campaigns');
          throw new Error(`El tratamiento quedó como borrador: ${message(failure)}`);}
      },reset);
    }else void run(()=>editing?updateHealthCampaign(accessToken,editing.id,input)
      :createHealthCampaign(accessToken,input),reset);
  }
  return <section className="health-panel">
    <div className="health-toolbar"><label className="health-search"><span className="sr-only">Buscar en sanidad</span>
      <span aria-hidden="true">⌕</span><input type="search" value={search}
        placeholder="Buscar en sanidad…" onChange={event=>setSearch(event.target.value)}/></label>
      <span className="health-count" title="Registros encontrados">{visible[tab].length}</span>
      <button type="button" className="health-sort" aria-label="Cambiar orden"
        title={order==='NEWEST'?'Más recientes':order==='OLDEST'?'Más antiguos':order==='AZ'?'Nombre A–Z':'Nombre Z–A'}
        onClick={()=>setOrder(value=>value==='NEWEST'?'OLDEST':value==='OLDEST'?'AZ':value==='AZ'?'ZA':'NEWEST')}>↕</button>
      {canViewMedicines&&<Link className="secondary-button compact health-medicine-button"
        aria-label="Administrar medicamentos" title="Administrar medicamentos"
        to="/catalogos?catalogo=MEDICINES"><Syringe size={21}/></Link>}
      {canManage&&<>
        <button className="primary-button compact health-add" type="button" onClick={openNew}>
          + {tab==='conditions'?'Condición':tab==='treatments'?'Tratamiento':'Jornada'}</button></>}
    </div>
    <div className="health-tabs" aria-label="Vistas de sanidad">
      <button type="button" className={tab==='conditions'?'active':''} aria-pressed={tab==='conditions'}
        onClick={()=>setTab('conditions')}>Condiciones de salud</button>
      <button type="button" className={tab==='treatments'?'active':''} aria-pressed={tab==='treatments'}
        onClick={()=>setTab('treatments')}>Tratamientos</button>
      <button type="button" className={tab==='campaigns'?'active':''} aria-pressed={tab==='campaigns'}
        onClick={()=>setTab('campaigns')}>Jornadas colectivas</button>
    </div>
    {error&&<div role="alert" className="form-error admin-error">{error}</div>}
    {canManage&&showCondition&&options&&<div className="health-overlay" role="presentation"
      onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)closeForm();}}>
      <div className="health-dialog" role="dialog" aria-modal="true" aria-label={editingCondition?'Editar condición':'Nueva condición de salud'}>
      <div className="health-dialog-heading"><h2>{editingCondition?'Editar condición':'Nueva condición de salud'}</h2>
        <button type="button" aria-label="Cerrar formulario" disabled={busy} onClick={closeForm}>×</button></div>
      {error&&<div className="form-error health-dialog-error" role="alert">{error}</div>}
      <form className="movement-form" onSubmit={saveCondition}
      key={editingCondition?.id??'condition-new'}>
      <label><span>Animal *</span>{editingCondition||initialAnimalId?<div className="health-fixed-animal">
        <strong>{options.animals.find(item=>item.id===(editingCondition?.animalId??initialAnimalId))?.name??'Animal'}</strong>
        <small>{options.animals.find(item=>item.id===(editingCondition?.animalId??initialAnimalId))?.earTagCode
          ?`Arete ${options.animals.find(item=>item.id===(editingCondition?.animalId??initialAnimalId))?.earTagCode}`:
            'Animal seleccionado desde su ficha'}</small></div>:<SearchableSelect value={conditionAnimalId}
          onChange={setConditionAnimalId} title="Seleccionar animal" placeholder="Selecciona un animal"
          searchPlaceholder="Buscar por nombre, arete, grupo o ubicación…"
          options={options.animals.map(healthAnimalOption)}/>}</label>
      <label><span>Tipo de problema *</span><SearchableSelect value={conditionKind}
        onChange={setConditionKind} title="Tipo de problema" placeholder="Selecciona el problema"
        searchPlaceholder="Buscar problema de salud…" options={[
          ...(editingCondition?.kind&&!conditionTypes.some(item=>item.name===editingCondition.kind)
            ?[{value:editingCondition.kind,label:`${editingCondition.kind} (anterior)`}]:[]),
          ...conditionTypes.filter(item=>item.active).map(item=>({value:item.name,label:item.name})),
        ]}/>
        <small>Puedes agregar tipos para todas tus propiedades desde Catálogos.</small></label>
      <label><span>Fecha de detección *</span><DateInput name="date" type="date" required
        max={today()} defaultValue={editingCondition?.detectedOn??today()}/></label>
      <label className="movement-wide"><span>Descripción *</span><textarea name="description"
        required minLength={2} maxLength={2000} defaultValue={editingCondition?.description??''}/></label>
      <div className="reference-dialog-footer movement-wide"><button type="button"
        className="secondary-button compact" onClick={closeForm} disabled={busy}>Cancelar</button>
        <button className="primary-button compact" disabled={busy||!conditionAnimalId||!conditionKind}>
          {busy?'Guardando…':'Guardar condición'}</button></div>
      </form></div></div>}
    {canManage&&showCampaign&&options&&<div className="health-overlay" role="presentation"
      onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)closeForm();}}>
      <div className="health-dialog" role="dialog" aria-modal="true" aria-label={editing?'Editar borrador':
        preventiveTreatment?'Tratamiento preventivo':conditionTreatment?'Tratamiento sobre condición de salud':
          tab==='treatments'?'Nuevo tratamiento':'Nueva jornada sanitaria'}>
      <div className="health-dialog-heading"><h2>{editing?'Editar borrador':preventiveTreatment?'Tratamiento preventivo':
        conditionTreatment?'Tratamiento sobre condición de salud':tab==='treatments'?'Nuevo tratamiento':'Nueva jornada sanitaria'}</h2>
        <button type="button" aria-label="Cerrar formulario" disabled={busy} onClick={closeForm}>×</button></div>
      {error&&<div className="form-error health-dialog-error" role="alert">{error}</div>}
      <form className="movement-form" onSubmit={saveCampaign}
      key={editing?.id??'new'}>
      <label><span>Medicamento *</span><SearchableSelect value={medicineId} onChange={value=>{setMedicineId(value);setDoses({});setDefaultDose('');}}
        title="Seleccionar medicamento" placeholder="Selecciona el medicamento"
        searchPlaceholder="Buscar por nombre o tipo…" options={medicines.filter(item=>item.active).map(item=>({
          value:item.id,label:item.name,description:[kinds[item.kind],item.activeIngredient].filter(Boolean).join(' · ')}))}/></label>
      <label><span>Vía *</span><SearchableSelect disabled={!medicine} value={medicine?administrationRoute:''}
        onChange={value=>setAdministrationRoute(value as HealthCampaignInput['administrationRoute'])}
        title="Vía de administración" options={allowedRoutes.map(item=>({value:routeKey(item),label:item.name}))}/></label>
      <label><span>Unidad de dosis</span><SearchableSelect title="Unidad de dosis" value={medicine?.defaultUnitCode??''}
        disabled={!medicine} onChange={()=>{}} options={medicine?[{value:medicine.defaultUnitCode,
          label:units.find(item=>item.code===medicine.defaultUnitCode)?.name??medicineDoseUnits.find(item=>item.code===medicine.defaultUnitCode)?.name??medicine.defaultUnitCode}]:[]}/></label>
      {medicine&&!allowedRoutes.length&&<p className="form-error movement-wide">Este medicamento no tiene vías disponibles. Solicita al administrador que revise su configuración.</p>}
      {!individualTreatment&&<label><span>Selección</span><SearchableSelect value={mode}
        onChange={value=>{setMode(value as HealthCampaignInput['selectionMode']);setSelected([]);setGroupId('');}}
        title="Forma de seleccionar animales" options={[{value:'MANUAL',label:'Animales seleccionados'},
          {value:'GRUPO',label:'Grupo completo'},{value:'TODOS',label:'Toda la propiedad'}]}/></label>}
      {mode==='GRUPO'&&!individualTreatment&&<label><span>Grupo *</span><SearchableSelect value={groupId}
        onChange={setGroupId} title="Seleccionar grupo" placeholder="Selecciona el grupo"
        searchPlaceholder="Buscar grupo…" options={options.groups.map(group=>({value:group.id,label:group.name}))}/></label>}
      <label><span>Fecha *</span><DateInput name="date" type="date" required max={today()}
        defaultValue={editing?.appliedOn??today()}/></label>
      <label><span>{individualTreatment?'Dosis':'Dosis general opcional'} ({units.find(unit=>unit.code===medicine?.defaultUnitCode)?.symbol??'unidad'})</span>
        <input name="defaultDose" type="number" min="0.001" max="1000000" step="any"
          value={defaultDose||(individualTreatment?String(suggestedMedicineDose(medicine,selectedAnimal)??''):'')}
          onChange={event=>setDefaultDose(event.target.value)}
          placeholder={individualTreatment?String(suggestedMedicineDose(medicine,selectedAnimal)??'Ingresa la dosis'):'Usar referencia por animal'}/>
        {medicineDoseReference(medicine,selectedAnimal,units,options.classifications)&&<small>
          Configuración: {medicineDoseReference(medicine,selectedAnimal,units,options.classifications)}.</small>}
        {individualTreatment&&selectedAnimal&&medicine?.doseWeight!=null&&Boolean(selectedAnimal.weightKg)&&<small>
          {`Peso ${selectedAnimal.weightSource==='INITIAL'?'inicial':'registrado'}: ${Number(selectedAnimal.weightKg!.toFixed(3))} kg${selectedAnimal.weightOn?' · '+formatDate(selectedAnimal.weightOn):''}. `}
          {suggestedMedicineDose(medicine,selectedAnimal)!=null
            ?`Referencia: ${suggestedMedicineDose(medicine,selectedAnimal)} ${units.find(unit=>unit.code===medicine.defaultUnitCode)?.symbol??''}. Puedes modificarla.`:''}</small>}</label>
      <label><span>Responsable</span><input name="responsible" maxLength={200}
        defaultValue={editing?.responsible??''}/></label>
      <label><span>Observaciones</span><textarea name="notes" maxLength={5000}
        defaultValue={editing?.notes??''}/></label>
      {individualTreatment?<div className="movement-selection movement-wide health-single-animal">
        <strong>Animal</strong>
        {initialAnimalId&&selectedAnimal?<div className="health-fixed-animal selected">
          <strong>{selectedAnimal.name}</strong><small>{selectedAnimal.earTagCode
            ?`Arete ${selectedAnimal.earTagCode}`:'Seleccionado desde su ficha'}</small></div>
          :<SearchableSelect value={selectedAnimal?.id??''} onChange={value=>{
            setSelected(value?[value]:[]);setConditionIds({});}} title="Seleccionar animal"
            placeholder="Selecciona un animal" searchPlaceholder="Buscar por nombre, arete, grupo o ubicación…"
            options={candidates.map(healthAnimalOption)}/>}
        {selectedAnimal&&!preventiveTreatment&&selectedAnimalConditions.length>0&&<label>
          <span>Condición relacionada{conditionTreatment?' *':''}</span>
          <SearchableSelect value={conditionIds[selectedAnimal.id]??''}
            onChange={value=>setConditionIds({...conditionIds,[selectedAnimal.id]:value})}
            title="Condición de salud" placeholder="Selecciona la condición"
            emptyOptionLabel={conditionTreatment?undefined:'Sin condición vinculada'}
            searchPlaceholder="Buscar condición…" options={selectedAnimalConditions.map(item=>({
              value:item.id,label:item.kind??'Condición de salud',description:item.description}))}/>
        </label>}
      </div>:<div className="movement-selection movement-wide"><strong>{mode==='MANUAL'?'Elige animales':
        `${candidates.length} animales candidatos`}</strong>
        {mode==='MANUAL'&&<button type="button" className="secondary-button compact"
          onClick={()=>setSelected(selected.length===candidates.length?[]:candidates.map((item)=>item.id))}>
          {selected.length===candidates.length?'Quitar selección':'Seleccionar todos'}</button>}
        <div className="movement-animal-grid">{candidates.map((animal)=><div key={animal.id}
          className="health-animal-row"><label>{mode==='MANUAL'&&<input type="checkbox"
            checked={selected.includes(animal.id)} onChange={(event)=>setSelected(event.target.checked
              ?[...selected,animal.id]:selected.filter((id)=>id!==animal.id))}/>}
            <span>{animal.name}{animal.earTagCode?` · ${animal.earTagCode}`:''}
              {selectedIds.includes(animal.id)&&medicine?.doseWeight!=null&&Boolean(animal.weightKg)&&<small>
                {`${animal.weightSource==='INITIAL'?'Peso inicial':'Peso'}: ${Number(animal.weightKg!.toFixed(3))} kg`}</small>}
              {selectedIds.includes(animal.id)&&medicineDoseReference(medicine,animal,units,options.classifications)&&<small>
                {medicineDoseReference(medicine,animal,units,options.classifications)}</small>}</span></label>
            {selectedIds.includes(animal.id)&&<input type="number" min="0.001" max="1000000"
              step="any" aria-label={`Dosis de ${animal.name}`} placeholder={String(suggestedMedicineDose(medicine,animal)??'Ingresa la dosis')}
              value={doses[animal.id]??(!defaultDose?String(suggestedMedicineDose(medicine,animal)??''):'')}
              onChange={(event)=>setDoses({...doses,
                [animal.id]:event.target.value})}/>}
            {selectedIds.includes(animal.id)&&!preventiveTreatment&&conditions.some((item)=>item.animalId===animal.id
              &&item.status!=='RESUELTA')&&<SearchableSelect ariaLabel={`Condición de ${animal.name}`}
              value={conditionIds[animal.id]??''} onChange={value=>setConditionIds({...conditionIds,
                [animal.id]:value})} title={`Condición de ${animal.name}`}
              placeholder="Selecciona la condición" emptyOptionLabel={conditionTreatment?undefined:'Sin condición vinculada'}
              options={conditions.filter(item=>item.animalId===animal.id&&item.status!=='RESUELTA')
                .map(item=>({value:item.id,label:item.kind??'Condición de salud',description:item.description}))}/>}</div>)}</div>
      </div>}
      <div className="reference-dialog-footer movement-wide"><button type="button"
        className="secondary-button compact" onClick={closeForm} disabled={busy}>Cancelar</button>
        <button className="primary-button compact" disabled={busy||!medicineId||!selectedIds.length
          ||!allowedRoutes.some(item=>routeKey(item)===administrationRoute)||individualTreatment&&selectedIds.length!==1
          ||conditionTreatment&&selectedIds.some(id=>!conditionIds[id])
          ||selectedIds.length>500||mode==='GRUPO'&&!groupId}>
          {busy?'Guardando…':individualTreatment?'Guardar':editing?'Guardar borrador':'Crear borrador'}</button></div>
      </form></div></div>}
    {loading?<p className="muted">Cargando registros sanitarios…</p>:<div className="health-record-list">
      {tab==='conditions'&&visible.conditions.map(condition=><button type="button" className="health-record-row"
        key={condition.id} onClick={()=>setSelectedConditionId(condition.id)}>
        <span className="health-record-avatar" aria-hidden="true">{condition.animalName.slice(0,1).toUpperCase()}</span>
        <span className="health-record-primary"><strong>{condition.animalName}</strong>
          <small>{condition.treatmentCount} {condition.treatmentCount===1?'tratamiento':'tratamientos'}</small></span>
        <span className="health-record-main"><strong>{condition.kind||'Otro problema'}</strong>
          <small>{formatDate(condition.detectedOn)} · {condition.description}</small></span>
        <span className={`health-badge health-${condition.status.toLowerCase()}`}>
          {condition.status==='RESUELTA'?'Resuelta':condition.status==='EN_TRATAMIENTO'?'En tratamiento':'Por resolver'}</span>
        <span className="health-chevron" aria-hidden="true">›</span></button>)}
      {tab==='treatments'&&visible.treatments.map(({record,animal})=><button type="button"
        className="health-record-row" key={`${record.id}:${animal.animalId}`}
        onClick={()=>setSelectedTreatment({campaignId:record.id,animalId:animal.animalId})}>
        <span className="health-record-avatar" aria-hidden="true">{animal.name.slice(0,1).toUpperCase()}</span>
        <span className="health-record-primary"><strong>{animal.name}</strong><small>{formatDate(record.appliedOn)}</small></span>
        <span className="health-record-main"><strong>{kinds[record.kind]} · {record.medicineName}</strong>
          <small>{animal.dose} {unitName(animal.unitCode)} · {routeName(record.administrationRoute)}</small></span>
        <span className="health-record-extra">{record.responsible||'Sin responsable'}</span>
        <span className="health-chevron" aria-hidden="true">›</span></button>)}
      {tab==='campaigns'&&<><div className="health-list-head" aria-hidden="true"><span>Jornada</span>
        <span>Fecha</span><span>Medicamento</span><span>Animales</span><span>Estado</span><span/></div>
        {visible.campaigns.map(record=><button type="button" className="health-campaign-row" key={record.id}
          onClick={()=>setSelectedCampaignId(record.id)}>
          <span><strong>{kinds[record.kind]}</strong><small>{routeName(record.administrationRoute)}</small></span>
          <span>{formatDate(record.appliedOn)}</span><span><strong>{record.medicineName}</strong>
            <small>{record.responsible||'Sin responsable'}</small></span>
          <span>{record.animals.filter(animal=>animal.selected).length} seleccionados</span>
          <span className={`movement-status status-${record.status.toLowerCase()}`}>
            {record.status==='BORRADOR'?'Borrador':record.status==='COMPLETADO'?'Completado':'Cancelado'}</span>
          <span className="health-chevron" aria-hidden="true">›</span></button>)}</>}
      {!visible[tab].length&&<div className="health-empty">{search?'No hay registros con esa búsqueda.':
        tab==='conditions'?'Sin problemas de salud registrados.':tab==='treatments'?
          'Todavía no hay tratamientos aplicados.':'Todavía no hay jornadas sanitarias.'}</div>}
    </div>}
    {selectedCondition&&<div className="health-overlay" role="presentation"
      onMouseDown={event=>{if(event.target===event.currentTarget)setSelectedConditionId(null);}}>
      <div className="health-dialog" role="dialog" aria-modal="true" aria-labelledby="condition-detail-title">
        <div className="health-dialog-heading"><h2 id="condition-detail-title">Detalle de la condición de salud</h2>
          <button type="button" aria-label="Cerrar detalle" onClick={()=>setSelectedConditionId(null)}>×</button></div>
        {error&&<div className="form-error health-dialog-error" role="alert">{error}</div>}
        <div className="health-detail"><div className="health-detail-title"><span className="health-record-avatar">{selectedCondition.animalName.slice(0,1).toUpperCase()}</span>
          <div><h3>{selectedCondition.animalName}</h3><small>{selectedCondition.kind||'Otro problema'}</small></div>
          <span className={`health-badge health-${selectedCondition.status.toLowerCase()}`}>
            {selectedCondition.status==='RESUELTA'?'Resuelta':selectedCondition.status==='EN_TRATAMIENTO'?'En tratamiento':'Por resolver'}</span></div>
          <div className="health-detail-grid"><div><small>Detección</small><strong>{formatDate(selectedCondition.detectedOn)}</strong></div>
            <div><small>Tratamientos relacionados</small><strong>{selectedCondition.treatmentCount}</strong></div>
            {selectedCondition.resolvedOn&&<div><small>Resuelta</small><strong>{formatDate(selectedCondition.resolvedOn)}</strong></div>}</div>
          <p>{selectedCondition.description}</p>
          <h4>Tratamientos aplicados</h4>
          {conditionTreatmentError&&<p className="form-error" role="alert">{conditionTreatmentError}</p>}
          {!conditionTreatments&&!conditionTreatmentError&&<p role="status">Cargando tratamientos…</p>}
          {conditionTreatments?.flatMap(record=>record.animals.filter(animal=>animal.selected&&animal.conditionId===selectedCondition.id)
            .map(animal=><button type="button" className="health-related" key={`${record.id}:${animal.animalId}`}
              onClick={()=>{setSelectedConditionId(null);setSelectedTreatment({campaignId:record.id,animalId:animal.animalId});}}>
              <span><strong>{record.medicineName}</strong><small>{formatDate(record.appliedOn)} · {animal.dose} {unitName(animal.unitCode)} · {routeName(record.administrationRoute)}</small></span>
              <span aria-hidden="true">›</span></button>))}
          {conditionTreatments?.length===0&&<p className="muted">Todavía no se aplicaron tratamientos para esta condición.</p>}

        </div><div className="health-dialog-actions"><button type="button" className="secondary-button compact"
          onClick={()=>setSelectedConditionId(null)}>Cerrar</button>
          {canManage&&selectedCondition.status!=='RESUELTA'&&<>
            <button type="button" className="secondary-button compact" onClick={()=>{
              closeDialogs();setEditingCondition(selectedCondition);setConditionAnimalId(selectedCondition.animalId);
              setConditionKind(selectedCondition.kind??'');setShowCondition(true);}}>Editar</button>
            <button type="button" className="secondary-button compact" onClick={()=>{
              closeDialogs();reset();setTab('treatments');setSelected([selectedCondition.animalId]);
              setConditionIds({[selectedCondition.animalId]:selectedCondition.id});setShowCampaign(true);
            }}>Aplicar tratamiento</button>
            <button type="button" className="primary-button compact" disabled={busy}
              onClick={()=>void run(()=>resolveHealthCondition(accessToken,selectedCondition.id,
                {resolvedOn:today(),expectedVersion:selectedCondition.version}),
                ()=>setSelectedConditionId(null))}>Marcar resuelta</button>
          </>}</div></div></div>}
    {treatmentRecord&&treatmentAnimal&&<div className="health-overlay" role="presentation"
      onMouseDown={event=>{if(event.target===event.currentTarget)setSelectedTreatment(null);}}>
      <div className="health-dialog" role="dialog" aria-modal="true" aria-labelledby="treatment-detail-title">
        <div className="health-dialog-heading"><h2 id="treatment-detail-title">Detalle del tratamiento</h2>
          <button type="button" aria-label="Cerrar detalle" onClick={()=>setSelectedTreatment(null)}>×</button></div>
        <div className="health-detail"><div className="health-detail-title"><span className="health-record-avatar">
          {treatmentAnimal.name.slice(0,1).toUpperCase()}</span><div><h3>{treatmentAnimal.name}</h3>
          <small>{kinds[treatmentRecord.kind]} · {treatmentRecord.medicineName}</small></div></div>
          <div className="health-detail-grid"><div><small>Dosis aplicada</small><strong>{treatmentAnimal.dose} {unitName(treatmentAnimal.unitCode)}</strong></div>
            <div><small>Vía</small><strong>{routeName(treatmentRecord.administrationRoute)}</strong></div>
            <div><small>Fecha</small><strong>{formatDate(treatmentRecord.appliedOn)}</strong></div>
            <div><small>Responsable</small><strong>{treatmentRecord.responsible||'Sin registrar'}</strong></div></div>
          {treatmentRecord.activeIngredient&&<p><strong>Principio activo:</strong> {treatmentRecord.activeIngredient}</p>}
          {treatmentRecord.withdrawalMilkDays!=null&&<p>Retiro de leche: {treatmentRecord.withdrawalMilkDays} días · Retiro de carne: {treatmentRecord.withdrawalMeatDays} días</p>}
          {treatmentAnimal.conditionId&&<p><strong>Condición:</strong> {conditions.find(item=>item.id===treatmentAnimal.conditionId)?.kind??'Condición de salud vinculada'}</p>}
          {treatmentAnimal.notes&&<p><strong>Observaciones del animal:</strong> {treatmentAnimal.notes}</p>}
          {treatmentRecord.notes&&<p><strong>Observaciones:</strong> {treatmentRecord.notes}</p>}
        </div><div className="health-dialog-actions"><button type="button" className="secondary-button compact"
          onClick={()=>setSelectedTreatment(null)}>Cerrar</button>
          <button type="button" className="primary-button compact" onClick={()=>{
            setSelectedTreatment(null);setSelectedCampaignId(treatmentRecord.id);}}>Ver jornada</button>
        </div></div></div>}
    {selectedCampaign&&<div className="health-overlay" role="presentation"
      onMouseDown={event=>{if(event.target===event.currentTarget)setSelectedCampaignId(null);}}>
      <div className="health-dialog" role="dialog" aria-modal="true" aria-labelledby="campaign-detail-title">
        <div className="health-dialog-heading"><h2 id="campaign-detail-title">Detalle de la jornada</h2>
          <button type="button" aria-label="Cerrar detalle" onClick={()=>setSelectedCampaignId(null)}>×</button></div>
        {error&&<div className="form-error health-dialog-error" role="alert">{error}</div>}
        <div className="health-detail"><div className="health-detail-title"><span className="health-detail-icon">✚</span>
          <div><h3>{kinds[selectedCampaign.kind]} · {selectedCampaign.medicineName}</h3>
            <small>{formatDate(selectedCampaign.appliedOn)}</small></div>
          <span className={`movement-status status-${selectedCampaign.status.toLowerCase()}`}>
            {selectedCampaign.status==='BORRADOR'?'Borrador':selectedCampaign.status==='COMPLETADO'?'Completado':'Cancelado'}</span></div>
          <div className="health-detail-grid"><div><small>Vía</small><strong>{routeName(selectedCampaign.administrationRoute)}</strong></div>
            <div><small>Responsable</small><strong>{selectedCampaign.responsible||'Sin registrar'}</strong></div>
            <div><small>Animales</small><strong>{selectedCampaign.animals.filter(animal=>animal.selected).length}</strong></div>
            {selectedCampaign.groupName&&<div><small>Grupo</small><strong>{selectedCampaign.groupName}</strong></div>}</div>
          <details className="health-related-animals"><summary>Animales seleccionados</summary><div>
            {selectedCampaign.animals.filter(animal=>animal.selected).map(animal=><span key={animal.animalId}>
              {animal.name} · {animal.dose} {unitName(animal.unitCode)}</span>)}</div></details>
          {selectedCampaign.notes&&<p>{selectedCampaign.notes}</p>}
        </div><div className="health-dialog-actions"><button type="button" className="secondary-button compact"
          onClick={()=>setSelectedCampaignId(null)}>Cerrar</button>
          {canManage&&selectedCampaign.status==='BORRADOR'&&<>
            <button type="button" className="secondary-button compact" disabled={busy}
              onClick={()=>void run(()=>cancelHealthCampaign(accessToken,selectedCampaign.id))}>Cancelar jornada</button>
            <button type="button" className="secondary-button compact" onClick={()=>edit(selectedCampaign)}>Editar</button>
            <button type="button" className="primary-button compact" disabled={busy}
              onClick={()=>void run(()=>applyHealthCampaign(accessToken,selectedCampaign.id))}>Aplicar</button>
          </>}</div></div></div>}
    {canManage&&<button type="button" className="health-fab" aria-label={`Nuevo ${tab==='conditions'?'problema de salud':tab==='treatments'?'tratamiento':'jornada'}`}
      onClick={openNew}>＋</button>}
  </section>;
}
