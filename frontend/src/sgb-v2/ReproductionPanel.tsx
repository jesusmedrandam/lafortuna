import {DateInput} from '../components/ui';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {ArrowUpDown,Baby,ChevronRight,Plus,Settings2,Heart,Stethoscope,CalendarClock,TriangleAlert,Syringe} from 'lucide-react';
import {Badge,Button,Card,CompactToolbar,EmptyState,ErrorState,FloatingActionDock,
  IconButton,LoadingState,Modal,Select} from '../components/ui';
import {reachedReproductionAge} from './reproductionAge';
import {formatDate} from '../utils';
import {useNavigate} from 'react-router-dom';
import {useV2Session} from './V2Session';
import {RecordMedia} from './RecordMedia';
import {
  ApiRequestError, cancelHeat, cancelPregnancy, cancelService, createHeat, createPregnancy, createService,
  getReproduction, getReproductionCandidates, getReproductionSettings,
  recordBirth, recordLoss, updateReproductionSettings,uploadMedia,listGroups,listCatalogItems,listOwners,
  type LivestockGroup,type CatalogItem,type LivestockOwner,type BirthCalfInput,type ReproductionBirth,
  type ReproductionCandidate, type ReproductionRecords, type ReproductionSettings,
} from './api';

function localDate() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}
const errorMessage = (error: unknown) => error instanceof ApiRequestError
  ? error.message : error instanceof Error ? error.message : 'No fue posible guardar el evento.';
const optional = (form: FormData, name: string) => String(form.get(name) || '').trim() || null;
type ReproductionKind='HEAT'|'SERVICE'|'PREGNANCY'|'BIRTH'|'LOSS';
const categories:Record<ReproductionKind,string>={HEAT:'Celos',SERVICE:'Servicios',
  PREGNANCY:'Preñeces',BIRTH:'Partos',LOSS:'Pérdidas'};
interface ReproductionRow {id:string;kind:ReproductionKind;name:string;date:string;
  summary:string;notes:string|null;status:string;canCancel:boolean;}

export function ReproductionPanel({ accessToken, canManage, initialAnimalId,
  initialAction,onCompleted }: {
  accessToken: string; canManage: boolean; initialAnimalId?:string|undefined;
  initialAction?:string;onCompleted?:()=>void;
}) {
  const navigate=useNavigate();const {hasPermission,session}=useV2Session();
  const multimediaEnabled=!session||Boolean(session.overview.properties.find(property=>property.id===session.overview.activeContext?.propertyId)?.enabledModules.includes('MULTIMEDIA'));
  const canUpload=multimediaEnabled&&hasPermission('MEDIA_MANAGE');
  const saving=useRef(false);const savedBirth=useRef<ReproductionBirth|null>(null);
  const birthData=useRef<FormData|null>(null);
  const [birthSaved,setBirthSaved]=useState(false);
  const [birthOptions,setBirthOptions]=useState<{groups:LivestockGroup[];breeds:CatalogItem[];colors:CatalogItem[];owners:LivestockOwner[]}>({groups:[],breeds:[],colors:[],owners:[]});
  const [records, setRecords] = useState<ReproductionRecords | null>(null);
  const [candidates, setCandidates] = useState<ReproductionCandidate[]>([]);
  const [settings, setSettings] = useState<ReproductionSettings | null>(null);
  const [cowId, setCowId] = useState('');
  const [calfCount, setCalfCount] = useState(1);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeForm, setActiveForm] = useState<'HEAT'|'PREGNANCY'|'SERVICE'|'BIRTH'|'LOSS'|null>(null);
  const closeForm=()=>{if(saving.current)return;if(savedBirth.current){setError('El parto ya está registrado. Pulsa Completar fotografías para terminar.');return;}setActiveForm(null);if(initialAction)onCompleted?.();};
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [selectedCategory,setSelectedCategory]=useState<ReproductionKind|null>(null);
  const [upcoming,setUpcoming]=useState(false);
  const [selectedRecord,setSelectedRecord]=useState<string|null>(null);
  const [search,setSearch]=useState('');
  const [newest,setNewest]=useState(true);
  const females = candidates.filter((animal) => animal.sex === 'FEMALE');
  const [prefilledAnimalId,setPrefilledAnimalId]=useState<string|null>(null);
  useEffect(()=>{const action=initialAction??new URLSearchParams(window.location.search).get('accion');
    const form=({CELO:'HEAT',SERVICIO:'SERVICE',PRENEZ:'PREGNANCY',PARTO:'BIRTH',
      PERDIDA:'LOSS'} as const)[action as 'CELO'];
    if(!form||
    !initialAnimalId||initialAnimalId===prefilledAnimalId||!canManage||
    !candidates.some(animal=>animal.id===initialAnimalId&&animal.sex==='FEMALE'))return;
    setCowId(initialAnimalId);setActiveForm(form);setPrefilledAnimalId(initialAnimalId);
  },[initialAnimalId,prefilledAnimalId,candidates,canManage,initialAction]);
  const males = candidates.filter((animal) => animal.sex === 'MALE');
  const confirmed = records?.pregnancies.filter((pregnancy) => pregnancy.status === 'CONFIRMED'&&!records?.births.some(birth=>birth.pregnancyId===pregnancy.id)) ?? [];
  const rows=useMemo<ReproductionRow[]>(()=>records?[
    ...records.heats.map(item=>({id:item.id,kind:'HEAT' as const,name:item.cowName,
      date:item.startsOn,summary:`${item.isFalse?'Celo aparente':'Celo'}${item.endsOn?` · Fin ${formatDate(item.endsOn)}`:''}`,
      notes:item.notes,status:item.cancelled?'Cancelado':'Registrado',canCancel:!item.cancelled})),
    ...records.services.map(item=>({id:item.id,kind:'SERVICE' as const,name:item.cowName,
      date:item.occurredOn,summary:item.kind==='INSEMINATION'?'Inseminación artificial':'Transferencia de embriones',
      notes:item.notes,status:item.cancelled?'Cancelado':item.hasPregnancy?'Con preñez':'Registrado',
      canCancel:!item.cancelled&&!item.hasPregnancy})),
    ...records.pregnancies.map(item=>({id:item.id,kind:'PREGNANCY' as const,name:item.cowName,
      date:item.confirmedOn,summary:`Parto estimado: ${item.expectedBirthOn?formatDate(item.expectedBirthOn):'sin estimación'}`,
      notes:item.notes,status:item.status==='CONFIRMED'?'Confirmada':item.status==='BORN'?'Parto registrado':
        item.status==='LOST'?'Pérdida':'Cancelada',canCancel:item.status==='CONFIRMED'})),
    ...records.births.map(item=>({id:item.id,kind:'BIRTH' as const,name:item.motherName,
      date:item.occurredOn,summary:`${item.liveCount} vivas · ${item.stillbornCount} nacidas muertas${
        item.calves.length?` · ${item.calves.map(calf=>calf.name).join(', ')}`:''}`,
      notes:item.notes,status:'Registrado',canCancel:false})),
    ...records.losses.map(item=>({id:item.id,kind:'LOSS' as const,name:item.cowName,
      date:item.occurredOn,summary:'Pérdida de preñez',notes:item.notes,status:'Registrado',canCancel:false})),
  ]:[],[records]);
  const relatedIds=useMemo(()=>new Set(initialAnimalId&&records?[
    ...records.heats.filter(item=>item.cowId===initialAnimalId).map(item=>item.id),
    ...records.services.filter(item=>item.cowId===initialAnimalId||item.fatherId===initialAnimalId||
      item.donorId===initialAnimalId).map(item=>item.id),
    ...records.pregnancies.filter(item=>item.cowId===initialAnimalId||item.fatherId===initialAnimalId)
      .map(item=>item.id),
    ...records.births.filter(item=>item.motherId===initialAnimalId||
      item.calves.some(calf=>calf.id===initialAnimalId)).map(item=>item.id),
    ...records.losses.filter(item=>item.cowId===initialAnimalId).map(item=>item.id),
  ]:[]),[records,initialAnimalId]);
  const visible=useMemo(()=>rows.filter(item=>(!initialAnimalId||relatedIds.has(item.id))&&
    (!selectedCategory||selectedCategory===item.kind)&&(!upcoming||item.kind==='PREGNANCY'&&item.status==='Confirmada')&&
    `${item.name} ${item.summary} ${item.notes??''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a,b)=>(newest?-1:1)*a.date.localeCompare(b.date)),
    [rows,selectedCategory,search,newest,initialAnimalId,relatedIds,upcoming]);
  const viewing=rows.find(item=>`${item.kind}:${item.id}`===selectedRecord);

  useEffect(() => {
    let active = true;
    void Promise.all([getReproduction(accessToken), getReproductionCandidates(accessToken),
      getReproductionSettings(accessToken)])
      .then(([next, animals, config]) => {
        if (active) { setRecords(next); setCandidates(animals); setSettings(config); }
      })
      .catch((failure) => { if (active) setError(errorMessage(failure)); });
    return () => { active = false; };
  }, [accessToken, revision]);

  useEffect(()=>{if(activeForm!=='BIRTH')return;let active=true;
    void Promise.all([hasPermission('GROUP_VIEW')?listGroups(accessToken):Promise.resolve([]),
      hasPermission('CATALOG_VIEW')?listCatalogItems(accessToken,'BREEDS'):Promise.resolve([]),
      hasPermission('CATALOG_VIEW')?listCatalogItems(accessToken,'COLORS'):Promise.resolve([]),
      hasPermission('ANIMAL_VIEW')?listOwners(accessToken):Promise.resolve([])]).then(([groups,breeds,colors,owners])=>{
        if(active)setBirthOptions({groups:groups.filter(x=>x.active),breeds:breeds.filter(x=>x.active),colors:colors.filter(x=>x.active),owners:owners.filter(x=>x.active)});
      }).catch(reason=>{if(active)setError(errorMessage(reason));});return()=>{active=false;};
  },[activeForm,accessToken,hasPermission]);
  async function run(operation: () => Promise<unknown>, form?: HTMLFormElement) {
    if(saving.current)return;saving.current=true;setBusy(true); setError(null);
    try { await operation(); form?.reset();setActiveForm(null);setSettingsOpen(false);
      setSelectedRecord(null);setRevision((value) => value + 1);if(initialAction)onCompleted?.(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { saving.current=false;setBusy(false); }
  }

  function checkAges(data:FormData,eventField:string,cowField='cowId',fatherField='fatherId'){
    const eventOn=String(data.get(eventField));
    for(const [key,months] of [[cowField,settings?.minimumCowMonths],['donorId',settings?.minimumCowMonths],[fatherField,settings?.minimumBullMonths]] as const){
      const animal=candidates.find(item=>item.id===String(data.get(key)));
      if(animal&&months!==undefined&&!reachedReproductionAge(animal.birthDate,eventOn,months)){
        setError(`${animal.name} debe tener al menos ${months} meses en la fecha del evento.`);return false;
      }
    }
    return true;
  }
  function heat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if(!checkAges(data,'startsOn','cowId','bullId'))return;
    void run(() => createHeat(accessToken, {
      cowId: String(data.get('cowId')), bullId: optional(data, 'bullId'),
      startsOn: String(data.get('startsOn')), endsOn: optional(data, 'endsOn'),
      isFalse: data.get('isFalse') === 'on', notes: optional(data, 'notes'),
    }), form);
  }

  function pregnancy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if(!checkAges(data,'confirmedOn'))return;
    const days = optional(data, 'gestationDays');
    const serviceId = optional(data, 'serviceId');
    const service = records?.services.find((row) => row.id === serviceId);
    void run(() => createPregnancy(accessToken, {
      cowId: String(data.get('cowId')), heatId: service ? null : optional(data, 'heatId'), serviceId,
      fatherId: service ? null : optional(data, 'fatherId'),
      externalFather: service ? null : optional(data, 'externalFather'),
      conceptionMethod: service?.kind ?? String(data.get('conceptionMethod')),
      confirmationMethod: String(data.get('confirmationMethod')),
      confirmedOn: String(data.get('confirmedOn')),
      ...(days ? { gestationDays: Number(days) } : {}), notes: optional(data, 'notes'),
    }), form);
  }

  function reproductiveService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if(!checkAges(data,'occurredOn'))return;
    void run(() => createService(accessToken, {
      cowId: String(data.get('cowId')), heatId: optional(data, 'heatId'),
      fatherId: optional(data, 'fatherId'), externalFather: optional(data, 'externalFather'),
      donorId: optional(data, 'donorId'), externalDonor: optional(data, 'externalDonor'),
      kind: String(data.get('kind')) as 'INSEMINATION' | 'EMBRYO_TRANSFER',
      occurredOn: String(data.get('occurredOn')), materialCode: optional(data, 'materialCode'),
      quality: optional(data, 'quality'), technician: optional(data, 'technician'),
      supplier: optional(data, 'supplier'), notes: optional(data, 'notes'),
    }), form);
  }

  function birth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=event.currentTarget;const data=birthData.current??new FormData(form);
    const photos:Array<{file:File;animalIndex?:number;relationCode?:'PROFILE'|'COVER'}>=[];
    for(const file of data.getAll('birthPhoto'))if(file instanceof File&&file.size)photos.push({file});
    const calves:BirthCalfInput[]=Array.from({length:calfCount},(_,index)=>{
      for(const [name,relationCode] of [['profilePhoto','PROFILE'],['coverPhoto','COVER']] as const){
        const file=data.get(`${name}:${index}`);if(file instanceof File&&file.size)photos.push({file,animalIndex:index,relationCode});
      }
      const weight=optional(data,`calfWeight:${index}`);const owner=optional(data,`calfOwner:${index}`);
      return {name:String(data.get(`calfName:${index}`)),sex:String(data.get(`calfSex:${index}`)) as 'FEMALE'|'MALE',
        ...(optional(data,`calfTag:${index}`)?{earTagCode:optional(data,`calfTag:${index}`)!}:{}),
        description:optional(data,`calfDescription:${index}`),
        birthCondition:String(data.get(`calfCondition:${index}`)) as 'ALIVE'|'WEAK'|'UNKNOWN',
        ...(optional(data,`calfGroup:${index}`)?{groupId:optional(data,`calfGroup:${index}`)!}:{}),
        ...(weight?{initialWeight:Number(weight),initialWeightUnitCode:'KILOGRAM'}:{}),
        breedIds:optional(data,`calfBreed:${index}`)?[optional(data,`calfBreed:${index}`)!]:[],
        colorIds:optional(data,`calfColor:${index}`)?[optional(data,`calfColor:${index}`)!]:[],
        ...(owner?{owners:[{partyId:owner,percent:100,isPrimary:true}]}:{}),
      };
    });
    if(photos.some(({file})=>!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)){
      setError('Elige fotografías JPG, PNG o WebP de hasta 10 MB.');return;
    }
    void run(async()=>{
      const created=savedBirth.current??await recordBirth(accessToken,{
        pregnancyId:String(data.get('pregnancyId')),occurredOn:String(data.get('occurredOn')),
        kind:String(data.get('kind')) as ReproductionBirth['kind'],calves,
        stillbornCount:Number(data.get('stillbornCount')),notes:optional(data,'notes')});
      savedBirth.current=created;birthData.current=data;setBirthSaved(true);
      for(const photo of photos){
        if(photo.animalIndex===undefined)await uploadMedia(accessToken,{file:photo.file,
          entityType:'REPRODUCTION_BIRTH',entityId:created.id,capturedOn:created.occurredOn});
        else await uploadMedia(accessToken,{file:photo.file,animalIds:[created.calves[photo.animalIndex]!.id],
          relationCode:photo.relationCode,capturedOn:created.occurredOn});
        // Clear only confirmed or durably queued photos; retry keeps the saved birth.
        const name=photo.animalIndex===undefined?'birthPhoto':`${photo.relationCode==='PROFILE'?'profilePhoto':'coverPhoto'}:${photo.animalIndex}`;
        const field=form.elements.namedItem(name) as HTMLInputElement|null;
        if(field&&field.files?.length===1)field.value='';data.delete(name);
      }
      savedBirth.current=null;birthData.current=null;setBirthSaved(false);
    },form);
  }

  function loss(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(() => recordLoss(accessToken, {
      pregnancyId: String(data.get('pregnancyId')),
      occurredOn: String(data.get('occurredOn')), notes: String(data.get('notes')).trim(),
    }), form);
  }

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const days = (key: string) => Number(data.get(key));
    const checked = (key: string) => data.get(key) === 'on';
    void run(() => updateReproductionSettings(accessToken, {
      daysAfterBirthHeat: days('daysAfterBirthHeat'),
      daysAfterBirthPregnancy: days('daysAfterBirthPregnancy'),
      daysAfterLossHeat: days('daysAfterLossHeat'),
      daysAfterLossPregnancy: days('daysAfterLossPregnancy'),
      minimumCowMonths: days('minimumCowMonths'), minimumBullMonths: days('minimumBullMonths'),
      allowSecondHeat: checked('allowSecondHeat'),
      allowFalseHeatInPregnancy: checked('allowFalseHeatInPregnancy'),
      useLastValidHeat: checked('useLastValidHeat'),
      maxMilkingDays: days('maxMilkingDays'),
    }));
  }

  return <section className="module-no-header reproduction-panel">
    <div className="activity-type-strip"><button type="button" className={!selectedCategory?'selected':''}
      onClick={()=>{setUpcoming(false);setSelectedCategory(null);}}><span><Baby size={20}/></span><small>Todos</small></button>
      {(Object.keys(categories) as ReproductionKind[]).map(kind=><button type="button" key={kind}
        className={selectedCategory===kind?'selected':''} onClick={()=>{setUpcoming(false);setSelectedCategory(kind);}}>
        <span>{kind==='HEAT'?<Heart size={20}/>:kind==='SERVICE'?<Syringe size={20}/>:kind==='PREGNANCY'?<Stethoscope size={20}/>:kind==='BIRTH'?<Baby size={20}/>:<TriangleAlert size={20}/>}</span><small>{categories[kind]}</small></button>)}<button type="button" className={upcoming?'selected':''} onClick={()=>{setUpcoming(true);setSelectedCategory('PREGNANCY');}}><span><CalendarClock size={20}/></span><small>Próximos partos</small></button></div>
    <CompactToolbar search={search} onSearch={setSearch} placeholder="Buscar animal o evento…"
      count={visible.length} actions={<><IconButton label={newest?'Más recientes':'Más antiguos'}
        onClick={()=>setNewest(value=>!value)}><ArrowUpDown size={18}/></IconButton>
        {canManage&&settings?.canManageRules&&<IconButton label="Reglas de reproducción" onClick={()=>setSettingsOpen(true)}>
          <Settings2 size={18}/></IconButton>}</>}/>
    {error && <div role="alert" className="form-error admin-error">{error}</div>}
    {!records && !error && <LoadingState/>}
    {!records && error && <ErrorState message={error} onRetry={()=>setRevision(value=>value+1)}/>}
    {canManage && settings?.canManageRules && settingsOpen && <Modal title="Reglas de reproducción" wide
      onClose={()=>setSettingsOpen(false)} footer={<Button variant="ghost"
        onClick={()=>setSettingsOpen(false)}>Cerrar</Button>}>
      <form className="group-new-form" onSubmit={saveSettings} key={revision}>
        <p className="muted">Estas reglas se aplican a todas las propiedades del dueño de esta cuenta. El historial conserva sus datos.</p>
        {([
          ['daysAfterBirthHeat', 'Días tras parto para celo', 365],
          ['daysAfterBirthPregnancy', 'Días tras parto para preñez', 365],
          ['daysAfterLossHeat', 'Días tras pérdida para celo', 365],
          ['daysAfterLossPregnancy', 'Días tras pérdida para preñez', 365],
          ['minimumCowMonths', 'Edad mínima de la vaca (meses)', 120],
          ['minimumBullMonths', 'Edad mínima del toro (meses)', 120],
          ['maxMilkingDays', 'Máximo de días de ordeño tras parto', 730],
        ] as const).map(([key, label, max]) => <label key={key}><span>{label}</span>
          <input type="number" name={key} min={key==='maxMilkingDays'?1:0} max={max} required defaultValue={settings[key]} />
        </label>)}
        {([
          ['allowSecondHeat', 'Permitir más de un celo en el ciclo'],
          ['allowFalseHeatInPregnancy', 'Permitir celos falsos durante la preñez'],
          ['useLastValidHeat', 'Usar el final del último celo válido para calcular el parto'],
        ] as const).map(([key, label]) => <label key={key}><span>{label}</span>
          <input type="checkbox" name={key} defaultChecked={settings[key]} />
        </label>)}
        <button className="primary-button compact" disabled={busy}>Guardar reglas</button>
      </form>
    </Modal>}
    {canManage && activeForm && <Modal title="Registrar evento reproductivo" wide
      onClose={closeForm} footer={<Button variant="ghost" onClick={closeForm}>Cerrar</Button>}>
      {!initialAction&&<div className="form-toolbar" aria-label="Tipo de evento">
      {([['HEAT','Celo'],['SERVICE','Servicio'],['PREGNANCY','Preñez'],
        ['BIRTH','Parto'],['LOSS','Pérdida']] as const).map(([id,label])=><button
          key={id} type="button" className={activeForm===id?'active':''}
          disabled={busy||birthSaved} aria-pressed={activeForm===id} onClick={()=>setActiveForm(id)}>
          {label}</button>)}
      </div>}
      <div className="reproduction-forms">
      <form className="group-new-form" onSubmit={heat} hidden={activeForm!=='HEAT'}>
        <h3>Registrar celo</h3>
        <label><span>Vaca *</span><Select name="cowId" required defaultValue={initialAnimalId??''}
          disabled={Boolean(initialAction)}>
          <option value="" disabled>Selecciona la vaca</option>
          {females.map((animal) => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </Select>{initialAction&&<input type="hidden" name="cowId" value={initialAnimalId}/>}</label>
        <label><span>Toro registrado</span><Select name="bullId" defaultValue="">
          <option value="">No registrado</option>
          {males.map((animal) => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </Select></label>
        <label><span>Inicio *</span><DateInput type="date" name="startsOn" required defaultValue={localDate()} /></label>
        <label><span>Fin</span><DateInput type="date" name="endsOn" /></label>
        <label><span>Celo aparente o falso</span><input type="checkbox" name="isFalse" /></label>
        <label><span>Observaciones</span><textarea name="notes" maxLength={500} /></label>
        <button className="primary-button compact" disabled={busy || !females.length}>Guardar celo</button>
      </form>

      <form className="group-new-form" onSubmit={pregnancy} hidden={activeForm!=='PREGNANCY'}>
        <h3>Confirmar preñez</h3>
        <label><span>Vaca *</span><Select name="cowId" required value={cowId}
          disabled={Boolean(initialAction)}
          onChange={(event) => setCowId(event.target.value)}>
          <option value="" disabled>Selecciona la vaca</option>
          {females.map((animal) => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </Select>{initialAction&&<input type="hidden" name="cowId" value={initialAnimalId}/>}</label>
        <label><span>Celo relacionado</span><Select name="heatId" defaultValue="" key={cowId}>
          <option value="">Sin celo registrado</option>
          {records?.heats.filter((entry) => entry.cowId === cowId && !entry.cancelled && !entry.isFalse)
            .map((entry) => <option key={entry.id} value={entry.id}>{formatDate(entry.startsOn)}</option>)}
        </Select></label>
        <label><span>Servicio asistido relacionado</span><Select name="serviceId" defaultValue="" key={`service:${cowId}`}>
          <option value="">Sin servicio asistido</option>
          {records?.services.filter((entry) => entry.cowId === cowId && !entry.cancelled && !entry.hasPregnancy)
            .map((entry) => <option key={entry.id} value={entry.id}>
              {formatDate(entry.occurredOn)} · {entry.kind === 'INSEMINATION' ? 'Inseminación' : 'Transferencia'}</option>)}
        </Select><small>Si eliges un servicio, se toman su celo y padre.</small></label>
        <label><span>Padre registrado</span><Select name="fatherId" defaultValue="">
          <option value="">No registrado</option>
          {males.map((animal) => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </Select></label>
        <label><span>Padre externo</span><input name="externalFather" maxLength={240} /></label>
        <label><span>Método de embarazo</span><Select name="conceptionMethod" defaultValue="NATURAL">
          <option value="NATURAL">Monta natural</option>
          <option value="INSEMINATION">Inseminación</option>
          <option value="EMBRYO_TRANSFER">Transferencia de embriones</option>
          <option value="UNKNOWN">Desconocido</option>
        </Select></label>
        <label><span>Método de confirmación</span><Select name="confirmationMethod" defaultValue="PALPATION">
          <option value="PALPATION">Palpación</option><option value="ULTRASOUND">Ecografía</option>
          <option value="BLOOD_TEST">Análisis de sangre</option>
          <option value="OBSERVATION">Observación</option><option value="OTHER">Otro</option>
        </Select></label>
        <label><span>Fecha de confirmación *</span><DateInput type="date" name="confirmedOn"
          required defaultValue={localDate()} /></label>
        <label><span>Días de gestación</span><input type="number" name="gestationDays" min="0" max="400" />
          <small>Con un celo se calculan automáticamente; sin selección se usa el último celo válido según las reglas.</small></label>
        <label><span>Observaciones</span><textarea name="notes" maxLength={500} /></label>
        <button className="primary-button compact" disabled={busy || !females.length}>
          Confirmar preñez</button>
      </form>

      <form className="group-new-form" onSubmit={reproductiveService} hidden={activeForm!=='SERVICE'}>
        <h3>Inseminación o transferencia</h3>
        <label><span>Receptora *</span><Select name="cowId" required defaultValue={initialAnimalId??''}
          disabled={Boolean(initialAction)}>
          <option value="" disabled>Selecciona la vaca</option>
          {females.map((animal) => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </Select>{initialAction&&<input type="hidden" name="cowId" value={initialAnimalId}/>}</label>
        <label><span>Tipo *</span><Select name="kind" defaultValue="INSEMINATION">
          <option value="INSEMINATION">Inseminación artificial</option>
          <option value="EMBRYO_TRANSFER">Transferencia de embriones</option>
        </Select></label>
        <label><span>Fecha *</span><DateInput type="date" name="occurredOn" required defaultValue={localDate()} /></label>
        <label><span>Celo relacionado</span><Select name="heatId" defaultValue="">
          <option value="">Sin celo registrado</option>
          {records?.heats.filter((entry) => !entry.cancelled && !entry.isFalse&&
            (!initialAction||entry.cowId===initialAnimalId))
            .map((entry) => <option key={entry.id} value={entry.id}>{entry.cowName} · {formatDate(entry.startsOn)}</option>)}
        </Select></label>
        <label><span>Padre registrado</span><Select name="fatherId" defaultValue="">
          <option value="">Sin padre registrado</option>
          {males.map((animal) => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </Select></label>
        <label><span>Padre externo</span><input name="externalFather" maxLength={240} /></label>
        <label><span>Donante registrada (solo transferencia)</span><Select name="donorId" defaultValue="">
          <option value="">Sin donante registrada</option>
          {females.map((animal) => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </Select></label>
        <label><span>Donante externa (solo transferencia)</span><input name="externalDonor" maxLength={240} /></label>
        <label><span>Código de material</span><input name="materialCode" maxLength={160} /></label>
        <label><span>Calidad</span><input name="quality" maxLength={120} /></label>
        <label><span>Técnico</span><input name="technician" maxLength={160} /></label>
        <label><span>Proveedor</span><input name="supplier" maxLength={160} /></label>
        <label><span>Observaciones</span><textarea name="notes" maxLength={2000} /></label>
        <button className="primary-button compact" disabled={busy || !females.length}>Guardar servicio</button>
      </form>

      <form className="group-new-form birth-registration-form" onSubmit={birth} hidden={activeForm!=='BIRTH'}>
        <fieldset disabled={busy||birthSaved}>
        <h3>Registrar parto</h3>
        <label><span>Preñez confirmada *</span><Select name="pregnancyId" required
          defaultValue={confirmed.find(item=>item.cowId===initialAnimalId)?.id??''}>
          <option value="" disabled>Selecciona una preñez</option>
          {confirmed.filter(item=>!initialAction||item.cowId===initialAnimalId)
            .map((item) => <option key={item.id} value={item.id}>
            {item.cowName} · {formatDate(item.confirmedOn)}</option>)}
        </Select></label>
        <label><span>Fecha de parto *</span><DateInput type="date" name="occurredOn"
          required defaultValue={localDate()} /></label>
        <label><span>Tipo de parto</span><Select name="kind" defaultValue="NORMAL"><option value="NORMAL">Normal</option><option value="ASSISTED">Asistido</option><option value="CAESAREAN">Cesárea</option><option value="UNKNOWN">Sin determinar</option></Select></label>
        {canUpload&&<label><span>Foto del parto</span><input type="file" name="birthPhoto" accept="image/jpeg,image/png,image/webp"/><small>Hasta 10 MB.</small></label>}
        <label><span>Crías vivas</span><input type="number" min="0" max="8" value={calfCount}
          onChange={(event) => setCalfCount(Math.min(8,Math.max(0,Math.floor(Number(event.target.value)||0))))} /></label>
        {Array.from({ length: calfCount }, (_, index) => <div key={index} className="group-inline-form">
          <label><span>Nombre de la cría {index + 1} *</span>
            <input name={`calfName:${index}`} required maxLength={160} /></label>
          <label><span>Sexo *</span><Select name={`calfSex:${index}`} defaultValue="FEMALE">
            <option value="FEMALE">Hembra</option><option value="MALE">Macho</option>
          </Select></label>
          <label><span>Arete individual</span><input name={`calfTag:${index}`} maxLength={80} /></label>
          <label><span>Estado al nacer</span><Select name={`calfCondition:${index}`} defaultValue="ALIVE"><option value="ALIVE">Viva</option><option value="WEAK">Débil</option><option value="UNKNOWN">Sin determinar</option></Select></label>
          <label><span>Peso al nacer (kg)</span><input name={`calfWeight:${index}`} type="number" min="0.001" max="999999999" step="0.001"/></label>
          <label><span>Raza</span><Select name={`calfBreed:${index}`} defaultValue=""><option value="">Sin registrar</option>{birthOptions.breeds.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
          <label><span>Color</span><Select name={`calfColor:${index}`} defaultValue=""><option value="">Sin registrar</option>{birthOptions.colors.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
          <label><span>Grupo</span><Select name={`calfGroup:${index}`} defaultValue=""><option value="">Sin grupo</option>{birthOptions.groups.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
          <label><span>Propietario de la cría</span><Select name={`calfOwner:${index}`} defaultValue=""><option value="">Los mismos propietarios de la madre</option>{birthOptions.owners.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select><small>Si eliges uno, tendrá el 100 % de participación.</small></label>
          <label><span>Información de la cría</span><textarea name={`calfDescription:${index}`} maxLength={5000}/></label>
          {canUpload&&<><label><span>Foto de perfil de la cría {index+1}</span><input type="file" name={`profilePhoto:${index}`} accept="image/jpeg,image/png,image/webp"/></label>
          <label><span>Foto de portada de la cría {index+1}</span><input type="file" name={`coverPhoto:${index}`} accept="image/jpeg,image/png,image/webp"/></label></>}
        </div>)}
        <label><span>Crías nacidas muertas</span><input type="number" name="stillbornCount"
          defaultValue="0" min="0" max="8" required /></label>
        <label><span>Observaciones</span><textarea name="notes" maxLength={5000} /></label>
        </fieldset><button className="primary-button compact" disabled={busy || !confirmed.length}>
          {birthSaved?'Completar fotografías':'Registrar parto y crías'}</button>
      </form>

      <form className="group-new-form" onSubmit={loss} hidden={activeForm!=='LOSS'}>
        <h3>Registrar pérdida de preñez</h3>
        <label><span>Preñez confirmada *</span><Select name="pregnancyId" required
          defaultValue={confirmed.find(item=>item.cowId===initialAnimalId)?.id??''}>
          <option value="" disabled>Selecciona una preñez</option>
          {confirmed.filter(item=>!initialAction||item.cowId===initialAnimalId)
            .map((item) => <option key={item.id} value={item.id}>
            {item.cowName} · {formatDate(item.confirmedOn)}</option>)}
        </Select></label>
        <label><span>Fecha *</span><DateInput type="date" name="occurredOn"
          required defaultValue={localDate()} /></label>
        <label><span>Observaciones *</span><textarea name="notes" required maxLength={5000} /></label>
        <button className="secondary-button compact" disabled={busy || !confirmed.length}>
          Registrar pérdida</button>
      </form>
    </div></Modal>}

    {records && (visible.length?<Card className="record-list">
      <div className="record-list-head"><span>Animal</span><span>Fecha</span>
        <span>Evento</span><span>Estado</span><span/><span/></div>
      {visible.map(item=><button type="button" className="record-list-row" key={`${item.kind}:${item.id}`}
        onClick={()=>setSelectedRecord(`${item.kind}:${item.id}`)}>
        <span><strong>{item.name}</strong><small>{categories[item.kind]}</small></span>
        <span><strong>{formatDate(item.date)}</strong></span>
        <span><strong>{item.summary}</strong></span>
        <span><Badge tone={item.status==='Cancelado'?'danger':item.status==='Registrado'||
          item.status==='Confirmada'?'success':'neutral'}>{item.status}</Badge></span>
        <span/><span className="record-row-actions"><ChevronRight size={18}/></span>
      </button>)}</Card>:<EmptyState icon={Baby} title="Sin eventos reproductivos"
      description={rows.length?'Prueba con otra búsqueda o categoría.':
        'Registra celos, preñeces, servicios y partos de la propiedad.'}/>)}
    {viewing&&<Modal title="Detalle reproductivo" wide onClose={()=>setSelectedRecord(null)}
      footer={<><Button variant="ghost" onClick={()=>setSelectedRecord(null)}>Cerrar</Button>
        {canManage&&viewing.canCancel&&<Button variant="secondary" disabled={busy}
          onClick={()=>{if(!window.confirm('¿Cancelar este evento? Se conservará en el historial.'))return;
            void run(()=>viewing.kind==='HEAT'?cancelHeat(accessToken,viewing.id):
              viewing.kind==='SERVICE'?cancelService(accessToken,viewing.id):
                cancelPregnancy(accessToken,viewing.id));}}>Cancelar evento</Button>}</>}>
      <div className="record-detail"><div className="record-detail-heading"><div className="record-icon">
        <Baby size={22}/></div><div><h2>{viewing.name}</h2><p>{categories[viewing.kind]} · {formatDate(viewing.date)}</p></div>
        <Badge tone={viewing.status==='Cancelado'?'danger':'success'}>{viewing.status}</Badge></div>
        <section><h3>Información</h3><div className="detail-grid"><div><small>Tipo de evento</small>
          <strong>{categories[viewing.kind]}</strong></div><div><small>Fecha</small>
          <strong>{formatDate(viewing.date)}</strong></div></div><p>{viewing.summary}</p></section>
        {viewing.kind==='BIRTH'&&records?.births.find(item=>item.id===viewing.id)?.calves.length
          ?<section><h3>Crías</h3><div className="detail-lines compact">{records.births.find(
            item=>item.id===viewing.id)?.calves.map(calf=><div key={calf.id}><span>
              <button type="button" className="text-button" onClick={()=>navigate(`/animales/${calf.id}`)}>{calf.name} · Ver animal</button><small>{calf.sex==='FEMALE'?'Hembra':'Macho'}</small>
            </span></div>)}</div></section>:null}
        {viewing.kind==='BIRTH'&&multimediaEnabled&&hasPermission('MEDIA_VIEW')&&<section><h3>Fotografías del parto</h3><RecordMedia accessToken={accessToken} entityType="REPRODUCTION_BIRTH" entityId={viewing.id} canManage={canUpload} title="Fotografías del parto"/></section>}
        {viewing.notes&&<section><h3>Observaciones</h3><p>{viewing.notes}</p></section>}
      </div></Modal>}
    {canManage&&<FloatingActionDock><IconButton label="Nuevo evento reproductivo" onClick={()=>
      setActiveForm(selectedCategory??'HEAT')}><Plus size={22}/></IconButton></FloatingActionDock>}
  </section>;
}
