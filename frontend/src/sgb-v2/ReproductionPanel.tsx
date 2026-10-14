import {DateInput} from '../components/ui';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {ArrowUpDown,Baby,ChevronRight,Plus,Settings2,Heart,Stethoscope,CalendarClock,TriangleAlert,Syringe,Trash2} from 'lucide-react';
import {Badge,Button,Card,CompactToolbar,EmptyState,ErrorState,FloatingActionDock,
  IconButton,LoadingState,Modal,Select} from '../components/ui';
import {reachedReproductionAge,reproductionToday} from './reproductionAge';
import {cycleTrueHeats} from './reproductionCycle';
import {formatDate} from '../utils';
import {useNavigate} from 'react-router-dom';
import {useV2Session} from './V2Session';
import {ImagePicker} from './ImagePicker';
import {reproductionSectionEnabled} from './reproductionSections';
import {RecordMedia} from './RecordMedia';
import {
  ApiRequestError, finishHeat, cancelService, createHeat, createPregnancy, createService,
  getReproduction, getReproductionCandidates, getReproductionSettings,
  recordBirth, recordLoss,uploadMedia,listGroups,listCatalogItems,listOwners,
  type LivestockGroup,type CatalogItem,type LivestockOwner,type BirthCalfInput,type ReproductionBirth,
  type ReproductionCandidate, type ReproductionRecords, type ReproductionSettings,
} from './api';

function localDate() {
  return reproductionToday();
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
  const [choosing,setChoosing]=useState(false);
  const [serviceKind,setServiceKind]=useState<'INSEMINATION'|'EMBRYO_TRANSFER'>('INSEMINATION');
  const [cowId, setCowId] = useState('');
  const [eventOn,setEventOn]=useState(localDate());
  const [heatId,setHeatId]=useState('');const [linkedServiceId,setLinkedServiceId]=useState('');
  const [pregnancyOrigin,setPregnancyOrigin]=useState<'NONE'|'HEAT'|'INSEMINATION'|'EMBRYO_TRANSFER'>('NONE');
  const [gestationDays,setGestationDays]=useState('');
  const [targetPregnancyId,setTargetPregnancyId]=useState<string|null>(null);
  const [heatChoice,setHeatChoice]=useState<{input:Parameters<typeof createHeat>[1];form:HTMLFormElement}|null>(null);
  const nextCalfKey=useRef(1);
  const [calfKeys,setCalfKeys]=useState([0]);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeForm, setActiveForm] = useState<'HEAT'|'PREGNANCY'|'SERVICE'|'BIRTH'|'LOSS'|null>(null);
  const closeForm=()=>{if(saving.current)return;if(savedBirth.current){setError('El parto ya está registrado. Pulsa Completar fotografías para terminar.');return;}setHeatChoice(null);setActiveForm(null);if(initialAction)onCompleted?.();};
  const [selectedCategory,setSelectedCategory]=useState<ReproductionKind|null>(null);
  const [upcoming,setUpcoming]=useState(false);
  const [selectedRecord,setSelectedRecord]=useState<string|null>(null);
  const [search,setSearch]=useState('');
  const [newest,setNewest]=useState(true);
  const [prefilledAnimalId,setPrefilledAnimalId]=useState<string|null>(null);
  useEffect(()=>{const action=initialAction??new URLSearchParams(window.location.search).get('accion');
    const form=({CELO:'HEAT',SERVICIO:'SERVICE',INSEMINACION:'SERVICE',TRANSFERENCIA:'SERVICE',PRENEZ:'PREGNANCY',PARTO:'BIRTH',
      PERDIDA:'LOSS'} as const)[action as 'CELO'|'SERVICIO'|'INSEMINACION'|'TRANSFERENCIA'|'PRENEZ'|'PARTO'|'PERDIDA'];
    if(!form||!records||!settings||
    !initialAnimalId||initialAnimalId===prefilledAnimalId||!canManage||
    !candidates.some(animal=>animal.id===initialAnimalId&&animal.sex==='FEMALE'))return;
    if(!reproductionSectionEnabled(settings,form==='SERVICE'?(action==='TRANSFERENCIA'?'EMBRYO_TRANSFER':'INSEMINATION'):form))return;
    if(form==='BIRTH'&&!confirmed.some(item=>item.cowId===initialAnimalId))return;
    if(form==='SERVICE')setServiceKind(action==='TRANSFERENCIA'?'EMBRYO_TRANSFER':'INSEMINATION');
    setCowId(initialAnimalId);setActiveForm(form);setPrefilledAnimalId(initialAnimalId);
  },[initialAnimalId,prefilledAnimalId,candidates,canManage,initialAction,settings,records]);
  const cycleHeats=useMemo(()=>records?cycleTrueHeats(records,cowId,eventOn):[],[records,cowId,eventOn]);
  const availableHeats=cycleHeats.filter(heat=>heat.startsOn<=eventOn);
  const selectedHeat=records?.heats.find(heat=>heat.id===heatId);
  const selectedService=records?.services.find(service=>service.id===linkedServiceId);
  const cowPregnant=Boolean(records?.pregnancies.some(row=>row.cowId===cowId&&row.status==='CONFIRMED'
    &&!records.births.some(birth=>birth.pregnancyId===row.id)&&!records.losses.some(loss=>loss.pregnancyId===row.id)));
  const pregnancySources=useMemo(()=>{
    if(!records||!settings)return [];
    const eligible=(id:string,on:string)=>{const cow=candidates.find(animal=>animal.id===id);
      return cow?.sex==='FEMALE'&&(!initialAction||id===initialAnimalId)&&reachedReproductionAge(cow.birthDate,on,settings.minimumCowMonths)
        &&!records.pregnancies.some(row=>row.cowId===id&&row.status==='CONFIRMED'&&!records.births.some(birth=>birth.pregnancyId===row.id)&&!records.losses.some(loss=>loss.pregnancyId===row.id));};
    const heats=records.heats.filter(row=>row.startsOn<=eventOn&&eligible(row.cowId,settings.useLastValidHeat?row.endsOn??row.startsOn:row.startsOn)
      &&cycleTrueHeats(records,row.cowId,eventOn).some(heat=>heat.id===row.id))
      .map(row=>({value:`HEAT:${row.id}`,cowId:row.cowId,date:row.startsOn,label:`Celo · ${candidates.find(animal=>animal.id===row.cowId)?.name??row.cowName??'Hembra'} · ${formatDate(row.startsOn)}`}));
    const services=records.services.filter(row=>reproductionSectionEnabled(settings,row.kind)&&!row.cancelled&&!row.hasPregnancy&&row.occurredOn<=eventOn&&eligible(row.cowId,row.occurredOn)
      &&!records.births.some(birth=>birth.motherId===row.cowId&&birth.occurredOn>row.occurredOn&&birth.occurredOn<=eventOn)
      &&!records.losses.some(loss=>loss.cowId===row.cowId&&loss.occurredOn>row.occurredOn&&loss.occurredOn<=eventOn)
      &&(!row.heatId||cycleTrueHeats(records,row.cowId,eventOn).some(heat=>heat.id===row.heatId)))
      .map(row=>({value:`SERVICE:${row.id}`,cowId:row.cowId,date:row.occurredOn,label:`${row.kind==='INSEMINATION'?'Inseminación':'Transferencia'} · ${candidates.find(animal=>animal.id===row.cowId)?.name??row.cowName??'Hembra'} · ${formatDate(row.occurredOn)}`}));
    return [...heats,...services].sort((a,b)=>b.date.localeCompare(a.date));
  },[records,settings,candidates,eventOn,initialAction,initialAnimalId]);
  const pregnancySource=linkedServiceId?`SERVICE:${linkedServiceId}`:heatId?`HEAT:${heatId}`:'';
  function choosePregnancySource(value:string){
    const source=pregnancySources.find(row=>row.value===value);setCowId(source?.cowId??'');setGestationDays('');
    setLinkedServiceId(value.startsWith('SERVICE:')?value.slice(8):'');setHeatId(value.startsWith('HEAT:')?value.slice(5):'');
  }
  useEffect(()=>{if(activeForm==='PREGNANCY'&&records&&settings&&pregnancySource&&!pregnancySources.some(row=>row.value===pregnancySource)){
    setCowId('');setLinkedServiceId('');setHeatId('');
  }},[activeForm,records,settings,pregnancySource,pregnancySources]);
  useEffect(()=>{if(activeForm==='PREGNANCY'){setPregnancyOrigin('NONE');setHeatId('');setLinkedServiceId('');if(!initialAnimalId)setCowId('');}},[activeForm,initialAnimalId]);
  const estimatedConception=new Date(`${eventOn||localDate()}T00:00:00Z`);
  estimatedConception.setUTCDate(estimatedConception.getUTCDate()-Math.min(400,Math.max(0,Number(gestationDays)||0)));
  const parentOn=activeForm==='PREGNANCY'?(selectedService?.occurredOn
    ??(selectedHeat?(settings?.useLastValidHeat?selectedHeat.endsOn??selectedHeat.startsOn:selectedHeat.startsOn):estimatedConception.toISOString().slice(0,10))):eventOn;
  const females = candidates.filter(animal=>animal.sex==='FEMALE'&&settings&&reachedReproductionAge(animal.birthDate,parentOn,settings.minimumCowMonths));
  const males=candidates.filter(animal=>animal.sex==='MALE'&&settings&&reachedReproductionAge(animal.birthDate,parentOn,settings.minimumBullMonths));
  useEffect(()=>{if(activeForm!=='PREGNANCY')setHeatId(cycleHeats.find(heat=>heat.startsOn<=eventOn)?.id??'');},[cowId,eventOn,records,activeForm]);
  useEffect(()=>{if(activeForm!=='PREGNANCY')setLinkedServiceId('');},[cowId,activeForm]);
  const confirmed = records?.pregnancies.filter((pregnancy) => pregnancy.status === 'CONFIRMED'&&!records?.births.some(birth=>birth.pregnancyId===pregnancy.id)) ?? [];
  const rows=useMemo<ReproductionRow[]>(()=>records?[
    ...records.heats.map(item=>({id:item.id,kind:'HEAT' as const,name:item.cowName,
      date:item.startsOn,summary:`${item.isFalse?'Celo aparente':'Celo'}${item.endsOn?` · Fin ${formatDate(item.endsOn)}`:''}`,
      notes:item.notes,status:item.cancelled?'Anulado':item.endsOn?'Finalizado':'En curso',canCancel:false})),
    ...records.services.map(item=>({id:item.id,kind:'SERVICE' as const,name:item.cowName,
      date:item.occurredOn,summary:item.kind==='INSEMINATION'?'Inseminación artificial':'Transferencia de embriones',
      notes:item.notes,status:item.cancelled?'Cancelado':item.hasPregnancy?'Con preñez':'Registrado',
      canCancel:!item.cancelled&&!item.hasPregnancy})),
    ...records.pregnancies.map(item=>({id:item.id,kind:'PREGNANCY' as const,name:item.cowName,
      date:item.confirmedOn,summary:`Parto estimado: ${item.expectedBirthOn?formatDate(item.expectedBirthOn):'sin estimación'}`,
      notes:item.notes,status:item.status==='CONFIRMED'?'Confirmada':item.status==='BORN'?'Parto registrado':
        item.status==='LOST'?'Aborto o pérdida':'Anulada',canCancel:false})),
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
    (!selectedCategory||selectedCategory===item.kind)&&(selectedCategory!=='SERVICE'||records?.services.find(service=>service.id===item.id)?.kind===serviceKind)&&(!upcoming||item.kind==='PREGNANCY'&&item.status==='Confirmada')&&
    `${item.name} ${item.summary} ${item.notes??''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a,b)=>(newest?-1:1)*a.date.localeCompare(b.date)),
    [rows,selectedCategory,serviceKind,records,search,newest,initialAnimalId,relatedIds,upcoming]);
  const viewing=rows.find(item=>`${item.kind}:${item.id}`===selectedRecord);
  const canCreateEvent=canManage&&Boolean(records&&settings)&&(['HEAT','INSEMINATION','EMBRYO_TRANSFER','PREGNANCY','BIRTH','LOSS'] as const)
    .some(kind=>reproductionSectionEnabled(settings,kind));
  const viewingEnabled=viewing&&reproductionSectionEnabled(settings,viewing.kind==='SERVICE'
    ?records?.services.find(service=>service.id===viewing.id)?.kind??'INSEMINATION':viewing.kind);

  useEffect(() => {
    let active = true;
    void Promise.all([getReproduction(accessToken), getReproductionCandidates(accessToken,initialAnimalId),
      getReproductionSettings(accessToken)])
      .then(([next, animals, config]) => {
        if (active) { setRecords(next); setCandidates(animals); setSettings(config); }
      })
      .catch((failure) => { if (active) setError(errorMessage(failure)); });
    return () => { active = false; };
  }, [accessToken, revision,initialAnimalId]);

  useEffect(()=>{if(activeForm!=='BIRTH')return;let active=true;
    void Promise.all([hasPermission('GROUP_VIEW')?listGroups(accessToken):Promise.resolve([]),
      hasPermission('CATALOG_VIEW')?listCatalogItems(accessToken,'BREEDS'):Promise.resolve([]),
      hasPermission('CATALOG_VIEW')?listCatalogItems(accessToken,'COLORS'):Promise.resolve([]),
      hasPermission('ANIMAL_VIEW')?listOwners(accessToken):Promise.resolve([])]).then(([groups,breeds,colors,owners])=>{
        if(active)setBirthOptions({groups:groups.filter(x=>x.active&&x.location),breeds:breeds.filter(x=>x.active),colors:colors.filter(x=>x.active),owners:owners.filter(x=>x.active)});
      }).catch(reason=>{if(active)setError(errorMessage(reason));});return()=>{active=false;};
  },[activeForm,accessToken,hasPermission]);
  async function run(operation: () => Promise<unknown>, form?: HTMLFormElement) {
    if(saving.current)return;saving.current=true;setBusy(true); setError(null);
    try { await operation(); form?.reset();setActiveForm(null);
      setSelectedRecord(null);setRevision((value) => value + 1);if(initialAction)onCompleted?.(); }
    catch (failure) { setError(errorMessage(failure));
      if(failure instanceof ApiRequestError&&['TRUE_HEAT_SELECTION_REQUIRED','TRUE_HEAT_CHANGED'].includes(failure.code))setRevision(value=>value+1);
    }
    finally { saving.current=false;setBusy(false); }
  }

  function checkAges(data:FormData,eventField:string,cowField='cowId',fatherField='fatherId'){
    const eventOn=activeForm==='PREGNANCY'?parentOn:String(data.get(eventField));
    for(const [key,months] of [[cowField,settings?.minimumCowMonths],['donorId',settings?.minimumCowMonths],[fatherField,settings?.minimumBullMonths]] as const){
      const inheritedFather=activeForm==='PREGNANCY'&&key===fatherField?(selectedService?.fatherId??selectedHeat?.bullId):null;
      const animal=candidates.find(item=>item.id===(String(data.get(key)||'')||inheritedFather));
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
    const input={
      cowId: String(data.get('cowId')), bullId: optional(data, 'bullId'),
      startsOn: String(data.get('startsOn')), endsOn: optional(data, 'endsOn'),
      isFalse: cowPregnant||data.get('isFalse') === 'on', notes: optional(data, 'notes'),
    };
    if(!input.isFalse&&records&&cycleTrueHeats(records,input.cowId,input.startsOn).length){setHeatChoice({input,form});return;}
    void run(()=>createHeat(accessToken,input),form);
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
      useLastHeat:pregnancyOrigin!=='NONE',
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
    const calves:BirthCalfInput[]=calfKeys.map((_,index)=>{
      for(const [name,relationCode] of [['profilePhoto','PROFILE'],['coverPhoto','COVER']] as const){
        const file=data.get(`${name}:${index}`);if(file instanceof File&&file.size)photos.push({file,animalIndex:index,relationCode});
      }
      const weight=optional(data,`calfWeight:${index}`);const owner=optional(data,`calfOwner:${index}`);
      return {name:String(data.get(`calfName:${index}`)),sex:String(data.get(`calfSex:${index}`)) as 'FEMALE'|'MALE',
        ...(optional(data,`calfTag:${index}`)?{earTagCode:optional(data,`calfTag:${index}`)!}:{}),
        description:optional(data,`calfDescription:${index}`),
        birthCondition:String(data.get(`calfCondition:${index}`)) as 'ALIVE'|'WEAK'|'UNKNOWN',
        groupId:String(data.get(`calfGroup:${index}`)||''),
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
        if(field&&field.files?.length===1){field.value='';field.dispatchEvent(new Event('change',{bubbles:true}));}data.delete(name);
      }
      savedBirth.current=null;birthData.current=null;setBirthSaved(false);setCalfKeys([nextCalfKey.current++]);
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

  if(initialAction&&!activeForm&&!prefilledAnimalId)return <Modal title="Registrar reproducción" onClose={()=>onCompleted?.()}
    footer={<Button variant="ghost" onClick={()=>onCompleted?.()}>Cerrar</Button>}>
    {error?<ErrorState message={error} onRetry={()=>setRevision(value=>value+1)}/>:!records||!settings?<LoadingState/>:
      <ErrorState message="El animal o esta acción no están disponibles. Actualiza la ficha y revisa sus políticas de operación." onRetry={()=>setRevision(value=>value+1)}/>}
  </Modal>;
  return <section className="module-no-header reproduction-panel">
    {!activeForm&&<><div className="activity-type-strip"><button type="button" className={!selectedCategory?'selected':''}
      onClick={()=>{setUpcoming(false);setSelectedCategory(null);}}><span><Baby size={20}/></span><small>Todos</small></button>
      {(Object.keys(categories) as ReproductionKind[]).filter(kind=>kind!=='SERVICE'&&reproductionSectionEnabled(settings,kind as 'HEAT')).map(kind=><button type="button" key={kind}
        className={selectedCategory===kind?'selected':''} onClick={()=>{setUpcoming(false);setSelectedCategory(kind);}}>
        <span>{kind==='HEAT'?<Heart size={20}/>:kind==='SERVICE'?<Syringe size={20}/>:kind==='PREGNANCY'?<Stethoscope size={20}/>:kind==='BIRTH'?<Baby size={20}/>:<TriangleAlert size={20}/>}</span><small>{categories[kind]}</small></button>)}{(['INSEMINATION','EMBRYO_TRANSFER'] as const).filter(kind=>reproductionSectionEnabled(settings,kind)).map(kind=><button type="button" key={kind}
        className={selectedCategory==='SERVICE'&&serviceKind===kind?'selected':''} onClick={()=>{setUpcoming(false);setSelectedCategory('SERVICE');setServiceKind(kind);}}>
        <span><Syringe size={20}/></span><small>{kind==='INSEMINATION'?'Inseminación':'Embriones'}</small></button>)}{reproductionSectionEnabled(settings,'PREGNANCY')&&<button type="button" className={upcoming?'selected':''} onClick={()=>{setUpcoming(true);setSelectedCategory('PREGNANCY');}}><span><CalendarClock size={20}/></span><small>Próximos partos</small></button>}</div>
    <CompactToolbar search={search} onSearch={setSearch} placeholder="Buscar animal o evento…"
      count={visible.length} actions={<><IconButton label={newest?'Más recientes':'Más antiguos'}
        onClick={()=>setNewest(value=>!value)}><ArrowUpDown size={18}/></IconButton>
        {canManage&&settings?.canManageRules&&<IconButton label="Reglas de reproducción" onClick={()=>navigate('/configuracion?seccion=reglas&opcion=reproduccion')}>
          <Settings2 size={18}/></IconButton>}</>}/></>}
    {error && !activeForm && <div role="alert" className="form-error admin-error">{error}</div>}
    {!records && !error && <LoadingState/>}
    {!records && error && <ErrorState message={error} onRetry={()=>setRevision(value=>value+1)}/>}
    {canManage && activeForm && <Modal title={activeForm==='BIRTH'?'Registrar parto':activeForm==='HEAT'?'Registrar celo':activeForm==='SERVICE'?(serviceKind==='INSEMINATION'?'Registrar inseminación':'Registrar transferencia de embriones'):activeForm==='PREGNANCY'?'Confirmar preñez':'Registrar pérdida'} wide
      onClose={closeForm} footer={<Button variant="ghost" onClick={closeForm}>Cerrar</Button>}>
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="reproduction-forms">
      {heatChoice&&<section aria-label="Elegir celo verdadero" className="animal-rules-options">
        <h3>¿Cuál celo deseas dejar como verdadero?</h3><p>Solo uno puede ser verdadero en este ciclo. Los demás quedarán marcados como falsos.</p>
        {records&&cycleTrueHeats(records,heatChoice.input.cowId,heatChoice.input.startsOn).map(heat=><Button type="button" variant="secondary" key={heat.id} disabled={busy}
          onClick={()=>{const choice=heatChoice;setHeatChoice(null);void run(()=>createHeat(accessToken,{...choice.input,trueHeatId:heat.id}),choice.form);}}>
          Conservar el celo del {formatDate(heat.startsOn)}</Button>)}
        <Button type="button" disabled={busy} onClick={()=>{const choice=heatChoice;setHeatChoice(null);void run(()=>createHeat(accessToken,{...choice.input,trueHeatId:'NEW'}),choice.form);}}>Dejar el nuevo celo como verdadero</Button>
        <Button type="button" variant="ghost" onClick={()=>setHeatChoice(null)}>Seguir editando</Button>
      </section>}

      <form className="group-new-form" onSubmit={heat} hidden={activeForm!=='HEAT'||Boolean(heatChoice)}>
        <h3>Registrar celo</h3>
        <label><span>Vaca *</span><Select name="cowId" required value={cowId} onChange={event=>setCowId(event.target.value)}
          disabled={Boolean(initialAction)}>
          <option value="" disabled>Selecciona la vaca</option>
          {females.map((animal) => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </Select>{initialAction&&<input type="hidden" name="cowId" value={initialAnimalId}/>}</label>
        <label><span>Toro registrado</span><Select name="bullId" defaultValue="" key={`bull:${parentOn}`}>
          <option value="">No registrado</option>
          {males.map((animal) => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </Select></label>
        <label><span>Inicio *</span><DateInput type="date" name="startsOn" required value={eventOn} onChange={event=>setEventOn(event.target.value)} /></label>
        <label><span>Fin</span><DateInput type="date" name="endsOn" /></label>
        <label><span>Celo aparente o falso</span><input type="checkbox" name="isFalse" key={`${cowId}:${cowPregnant}`} defaultChecked={cowPregnant} disabled={cowPregnant}/></label>
        {cowPregnant&&<p className="muted">Esta hembra tiene una preñez confirmada. El celo se guardará obligatoriamente como falso.</p>}
        <label><span>Observaciones</span><textarea name="notes" maxLength={500} /></label>
        <button className="primary-button compact" disabled={busy || !females.length}>Guardar celo</button>
      </form>

      <form className="group-new-form" onSubmit={pregnancy} hidden={activeForm!=='PREGNANCY'}>
        <h3>Confirmar preñez</h3>
        <label><span>Seleccionar desde</span><Select name="pregnancyOrigin" value={pregnancyOrigin} onChange={event=>{
          setPregnancyOrigin(event.target.value as typeof pregnancyOrigin);setHeatId('');setLinkedServiceId('');if(!initialAnimalId)setCowId('');
        }}><option value="NONE">Ninguno</option>{reproductionSectionEnabled(settings,'HEAT')&&<option value="HEAT">Celo</option>}
          {reproductionSectionEnabled(settings,'INSEMINATION')&&<option value="INSEMINATION">Inseminación artificial</option>}
          {reproductionSectionEnabled(settings,'EMBRYO_TRANSFER')&&<option value="EMBRYO_TRANSFER">Implantación de embrión</option>}</Select></label>
        {pregnancyOrigin==='NONE'?<label><span>Hembra *</span><Select name="cowId" required value={cowId} onChange={event=>setCowId(event.target.value)}>
          <option value="" disabled>Selecciona la hembra</option>{females.filter(animal=>(!initialAction||animal.id===initialAnimalId)&&!confirmed.some(row=>row.cowId===animal.id)).map(animal=><option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </Select><small>Puedes confirmar la preñez aunque no hayas registrado un celo o servicio.</small></label>:<label><span>Registro previo *</span><Select name="pregnancySource" required value={pregnancySource}
          onChange={event=>choosePregnancySource(event.target.value)}><option value="" disabled>Selecciona el registro previo</option>
          {pregnancySources.filter(source=>pregnancyOrigin==='HEAT'?source.value.startsWith('HEAT:'):records?.services.find(row=>`SERVICE:${row.id}`===source.value)?.kind===pregnancyOrigin).map(source=><option key={source.value} value={source.value}>{source.label}</option>)}</Select></label>}
        {pregnancyOrigin!=='NONE'&&<input type="hidden" name="cowId" value={cowId}/>}<input type="hidden" name="heatId" value={heatId}/><input type="hidden" name="serviceId" value={linkedServiceId}/>
        {cowId&&<div className="health-fixed-animal"><span>Hembra seleccionada</span><strong>{candidates.find(animal=>animal.id===cowId)?.name}</strong></div>}
        <label><span>Padre registrado</span><Select name="fatherId" defaultValue="" disabled={Boolean(selectedService)} key={`father:${parentOn}:${pregnancySource}`}>
          <option value="">No registrado</option>
          {males.map((animal) => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </Select></label>
        <label><span>Padre externo</span><input name="externalFather" maxLength={240} disabled={Boolean(selectedService)}/></label>
        <label><span>Método de embarazo</span><Select name="conceptionMethod" defaultValue={selectedService?.kind??(pregnancyOrigin==='NONE'?'UNKNOWN':'NATURAL')} key={`${pregnancyOrigin}:${pregnancySource}`} disabled={Boolean(selectedService)}>
          <option value="NATURAL">Monta natural</option>
          {reproductionSectionEnabled(settings,'INSEMINATION')&&<option value="INSEMINATION">Inseminación</option>}
          {reproductionSectionEnabled(settings,'EMBRYO_TRANSFER')&&<option value="EMBRYO_TRANSFER">Transferencia de embriones</option>}
          <option value="UNKNOWN">Desconocido</option>
        </Select></label>
        <label><span>Método de confirmación</span><Select name="confirmationMethod" defaultValue="PALPATION">
          <option value="PALPATION">Palpación</option><option value="ULTRASOUND">Ecografía</option>
          <option value="BLOOD_TEST">Análisis de sangre</option>
          <option value="OBSERVATION">Observación</option><option value="OTHER">Otro</option>
        </Select></label>
        <label><span>Fecha de confirmación *</span><DateInput type="date" name="confirmedOn"
          required value={eventOn} onChange={event=>setEventOn(event.target.value)} /></label>
        <label><span>Días de gestación</span><input type="number" name="gestationDays" min="0" max="400" value={gestationDays} onChange={event=>setGestationDays(event.target.value)} />
          <small>Con un evento se calculan automáticamente. Si elegiste Ninguno, puedes indicar una estimación.</small></label>
        <label><span>Observaciones</span><textarea name="notes" maxLength={500} /></label>
        <button className="primary-button compact" disabled={busy || (pregnancyOrigin==='NONE'?!cowId:!pregnancySources.some(source=>source.value===pregnancySource))}>
          Confirmar preñez</button>
      </form>

      <form className="group-new-form" onSubmit={reproductiveService} hidden={activeForm!=='SERVICE'}>
        <h3>Inseminación o transferencia</h3>
        <label><span>Receptora *</span><Select name="cowId" required value={cowId} onChange={event=>setCowId(event.target.value)}
          disabled={Boolean(initialAction)}>
          <option value="" disabled>Selecciona la vaca</option>
          {females.map((animal) => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </Select>{initialAction&&<input type="hidden" name="cowId" value={initialAnimalId}/>}</label>
        <input type="hidden" name="kind" value={serviceKind}/>
        <label><span>Fecha *</span><DateInput type="date" name="occurredOn" required value={eventOn} onChange={event=>setEventOn(event.target.value)} /></label>
        <label><span>Celo relacionado</span><Select name="heatId" value={heatId} onChange={event=>setHeatId(event.target.value)}>
          <option value="">Sin celo registrado</option>
          {availableHeats
            .map((entry) => <option key={entry.id} value={entry.id}>{entry.cowName} · {formatDate(entry.startsOn)}</option>)}
        </Select></label>
        <label><span>Padre registrado</span><Select name="fatherId" defaultValue="" key={`father:${parentOn}`}>
          <option value="">Sin padre registrado</option>
          {males.map((animal) => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </Select></label>
        <label><span>Padre externo</span><input name="externalFather" maxLength={240} /></label>
        {serviceKind==='EMBRYO_TRANSFER'&&<>        <label><span>Donante registrada (solo transferencia)</span><Select name="donorId" defaultValue="">
          <option value="">Sin donante registrada</option>
          {females.map((animal) => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
        </Select></label>
        <label><span>Donante externa (solo transferencia)</span><input name="externalDonor" maxLength={240} /></label>
</>}
        <label><span>Código de material</span><input name="materialCode" maxLength={160} /></label>
        <label><span>Calidad</span><input name="quality" maxLength={120} /></label>
        <label><span>Técnico</span><input name="technician" maxLength={160} /></label>
        <label><span>Proveedor</span><input name="supplier" maxLength={160} /></label>
        <label><span>Observaciones</span><textarea name="notes" maxLength={2000} /></label>
        <button className="primary-button compact" disabled={busy || !females.length}>Guardar servicio</button>
      </form>

      <form className="group-new-form birth-registration-form" onSubmit={birth} hidden={activeForm!=='BIRTH'}>
        <fieldset disabled={busy||birthSaved}>
        <section className="birth-section"><h3>Preñez y parto</h3>
        <div className="group-inline-form birth-fields">
        <label><span>Preñez confirmada *</span><Select name="pregnancyId" required
          key={targetPregnancyId??initialAnimalId??''} defaultValue={targetPregnancyId??confirmed.find(item=>item.cowId===initialAnimalId)?.id??''}>
          <option value="" disabled>Selecciona una preñez</option>
          {confirmed.filter(item=>!initialAction||item.cowId===initialAnimalId)
            .map((item) => <option key={item.id} value={item.id}>
            {item.cowName} · {formatDate(item.confirmedOn)}</option>)}
        </Select></label>
        <label><span>Fecha de parto *</span><DateInput type="date" name="occurredOn"
          required defaultValue={localDate()} /></label>
        <label><span>Tipo de parto</span><Select name="kind" defaultValue="NORMAL"><option value="NORMAL">Normal</option><option value="ASSISTED">Asistido</option><option value="CAESAREAN">Cesárea</option><option value="UNKNOWN">Sin determinar</option></Select></label>
        </div><label><span>Observaciones del parto</span><textarea name="notes" maxLength={5000}/></label>
        {canUpload&&<ImagePicker accept="image/jpeg,image/png,image/webp" name="birthPhoto" label="Foto del parto"/>}</section>
        <section className="birth-section"><div className="section-heading-inline"><h3>Crías</h3>
          <Button type="button" variant="secondary" disabled={calfKeys.length>=8} onClick={()=>{
            const key=nextCalfKey.current++;setCalfKeys(previous=>[...previous,key]);}}><Plus size={18}/>Agregar cría</Button></div>
        <p className="muted">Registra una ficha por cada cría viva. Puedes agregar hasta 8.</p>
        {calfKeys.length>0&&!birthOptions.groups.length&&<p className="form-error" role="alert">Necesitas un grupo activo con potrero o corral para registrar las crías.</p>}
        <div className="nested-list">
        {calfKeys.map((key,index)=><div key={key} className="nested-card birth-calf">
          <div className="nested-card-header"><strong>Cría {index+1}</strong>
            <IconButton type="button" label={`Quitar cría ${index+1}`} onClick={()=>setCalfKeys(previous=>previous.filter(value=>value!==key))}>
              <Trash2 size={17}/></IconButton></div><div className="group-inline-form birth-fields">
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
          <label><span>Grupo *</span><Select name={`calfGroup:${index}`} required defaultValue=""><option value="" disabled>Selecciona un grupo</option>{birthOptions.groups.map(item=><option key={item.id} value={item.id}>{item.name} · {item.location?.name}</option>)}</Select></label>
          <label><span>Propietario de la cría</span><Select name={`calfOwner:${index}`} defaultValue=""><option value="">Los mismos propietarios de la madre</option>{birthOptions.owners.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select><small>Si eliges uno, tendrá el 100 % de participación.</small></label>
          <label><span>Información de la cría</span><textarea name={`calfDescription:${index}`} maxLength={5000}/></label>
          </div>{canUpload&&<div className="birth-photo-fields">
            <ImagePicker accept="image/jpeg,image/png,image/webp" name={`profilePhoto:${index}`} label={`Foto de perfil de la cría ${index+1}`}/>
            <ImagePicker accept="image/jpeg,image/png,image/webp" name={`coverPhoto:${index}`} label={`Foto de portada de la cría ${index+1}`}/>
          </div>}
        </div>)}
        </div><label><span>Crías nacidas muertas</span><input type="number" name="stillbornCount"
          defaultValue="0" min="0" max="8" required /></label></section>
        </fieldset><button className="primary-button compact" disabled={busy || !confirmed.length || calfKeys.length>0&&!birthOptions.groups.length}>
          {birthSaved?'Completar fotografías':'Registrar parto y crías'}</button>
      </form>

      <form className="group-new-form" onSubmit={loss} hidden={activeForm!=='LOSS'}>
        <h3>Registrar aborto o pérdida de preñez</h3>
        <label><span>Preñez confirmada *</span><Select name="pregnancyId" required
          key={targetPregnancyId??initialAnimalId??''} defaultValue={targetPregnancyId??confirmed.find(item=>item.cowId===initialAnimalId)?.id??''}>
          <option value="" disabled>Selecciona una preñez</option>
          {confirmed.filter(item=>!initialAction||item.cowId===initialAnimalId)
            .map((item) => <option key={item.id} value={item.id}>
            {item.cowName} · {formatDate(item.confirmedOn)}</option>)}
        </Select></label>
        <label><span>Fecha *</span><DateInput type="date" name="occurredOn"
          required defaultValue={localDate()} /></label>
        <label><span>Observaciones *</span><textarea name="notes" required maxLength={5000} /></label>
        <button className="secondary-button compact" disabled={busy || !confirmed.length}>
          Registrar aborto</button>
      </form>
    </div></Modal>}

    {!activeForm&&records && (visible.length?<Card className="record-list">
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
        {canManage&&viewingEnabled&&viewing.kind==='SERVICE'&&viewing.canCancel&&<Button variant="secondary" disabled={busy}
          onClick={()=>{if(window.confirm('¿Anular este servicio? Se conservará en el historial.'))void run(()=>cancelService(accessToken,viewing.id));}}>Anular servicio</Button>}
        {canManage&&viewing.kind==='PREGNANCY'&&viewing.status==='Confirmada'&&(['BIRTH','LOSS'] as const).filter(kind=>reproductionSectionEnabled(settings,kind)).map(kind=>
          <Button key={kind} disabled={busy} onClick={()=>{setTargetPregnancyId(viewing.id);setCowId(records!.pregnancies.find(pregnancy=>pregnancy.id===viewing.id)!.cowId);setSelectedRecord(null);setActiveForm(kind);}}>
            {kind==='BIRTH'?'Registrar parto':'Registrar aborto'}</Button>)}</>}>
      {error&&<p role="alert" className="form-error">{error}</p>}
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
        {viewing.kind==='HEAT'&&canManage&&reproductionSectionEnabled(settings,'HEAT')&&records?.heats.some(heat=>heat.id===viewing.id&&!heat.cancelled&&!heat.endsOn)&&
          <form className="animal-rules-form" onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);
            void run(()=>finishHeat(accessToken,viewing.id,String(data.get('endsOn'))));}}>
            <h3>Finalizar celo</h3><label><span>Fecha de fin *</span><DateInput name="endsOn" required defaultValue={localDate()}
              min={viewing.date} max={localDate()} disabled={busy}/></label><Button type="submit" loading={busy}>Finalizar celo</Button>
          </form>}
        {viewing.notes&&<section><h3>Observaciones</h3><p>{viewing.notes}</p></section>}
      </div></Modal>}
    {canCreateEvent&&!activeForm&&<FloatingActionDock><IconButton label="Nuevo evento reproductivo" onClick={()=>{
      setTargetPregnancyId(null);setGestationDays('');setEventOn(localDate());if(selectedCategory)setActiveForm(selectedCategory);else setChoosing(true);}}><Plus size={22}/></IconButton></FloatingActionDock>}
    {choosing&&<Modal title="Registrar reproducción" onClose={()=>setChoosing(false)}>
      <div className="animal-rules-options">{([
        ['HEAT','Registrar celo'],['INSEMINATION','Registrar inseminación'],['EMBRYO_TRANSFER','Registrar transferencia de embriones'],
        ['PREGNANCY','Confirmar preñez'],['BIRTH','Registrar parto'],['LOSS','Registrar aborto'],
      ] as const).filter(([kind])=>reproductionSectionEnabled(settings,kind)).map(([kind,label])=><Button key={kind} type="button" variant="secondary"
        disabled={(kind==='BIRTH'||kind==='LOSS')&&!confirmed.length} onClick={()=>{setChoosing(false);
          if(kind==='INSEMINATION'||kind==='EMBRYO_TRANSFER'){setServiceKind(kind);setActiveForm('SERVICE');}else setActiveForm(kind);}}>{label}</Button>)}</div>
    </Modal>}
  </section>;
}

