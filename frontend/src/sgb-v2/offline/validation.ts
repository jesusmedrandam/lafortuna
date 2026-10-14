import type {OutboxEntry} from './database';
import type {ReproductionRecords,ReproductionSettings,ReproductionCandidate} from '../api';
import {reachedReproductionAge,reproductionToday} from '../reproductionAge';
import {cycleTrueHeats} from '../reproductionCycle';
import {reproductionSectionEnabled} from '../reproductionSections';

export class LocalValidationError extends Error {
  readonly status=400;
  readonly code='LOCAL_VALIDATION_FAILED';
}
function requireValue(valid:unknown,message:string):asserts valid{
  if(!valid)throw new LocalValidationError(message);
}
export function validateReproductionMutation(entry:OutboxEntry,context:{records:ReproductionRecords;
  settings:ReproductionSettings;candidates:ReproductionCandidate[];today:string}){
  const {records,settings,candidates,today}=context;const input=(entry.jsonBody??{}) as Record<string,unknown>;
  const kind=entry.path.split('/').at(-1);
  const section=kind==='heats'?'HEAT':kind==='services'?input.kind==='EMBRYO_TRANSFER'?'EMBRYO_TRANSFER':'INSEMINATION'
    :kind==='pregnancies'?'PREGNANCY':kind==='births'?'BIRTH':'LOSS';
  requireValue(reproductionSectionEnabled(settings,section),'Este registro está desactivado en las políticas de operación.');
  if(kind==='pregnancies'&&['INSEMINATION','EMBRYO_TRANSFER'].includes(String(input.conceptionMethod)))
    requireValue(reproductionSectionEnabled(settings,input.conceptionMethod as 'INSEMINATION'|'EMBRYO_TRANSFER'),
      'Ese método de reproducción está desactivado en las políticas de operación.');
  const on=String(input[kind==='heats'?'startsOn':kind==='pregnancies'?'confirmedOn':'occurredOn']??'');
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(on)&&on<=today,'Indica una fecha válida que no sea futura.');
  if(input.endsOn)requireValue(String(input.endsOn)>=on&&String(input.endsOn)<=today,'El fin del celo debe estar entre su inicio y hoy.');
  const noteLimit=kind==='births'||kind==='losses'?5000:kind==='services'?2000:500;
  if(input.notes!=null)requireValue(typeof input.notes==='string'&&input.notes.trim().length<=noteLimit,`Las observaciones admiten hasta ${noteLimit} caracteres.`);
  const pregnancy=records.pregnancies.find(row=>row.id===input.pregnancyId);
  const unresolved=(id:string)=>!records.births.some(row=>row.pregnancyId===id)&&!records.losses.some(row=>row.pregnancyId===id);
  if(kind==='births'||kind==='losses'){
    requireValue(pregnancy?.status==='CONFIRMED'&&unresolved(pregnancy.id),'Selecciona una preñez confirmada que todavía no tenga parto ni aborto.');
    requireValue(on>=pregnancy.confirmedOn,'El parto o aborto no puede ser anterior a la confirmación de preñez.');
    if(kind==='losses')requireValue(typeof input.notes==='string'&&input.notes.trim().length>0,'Describe el aborto o pérdida de preñez.');
    return;
  }
  const cowId=String(input.cowId??'');
  const age=(id:unknown,sex:'FEMALE'|'MALE',date:string)=>{
    const animal=candidates.find(row=>row.id===id);requireValue(animal&&animal.sex===sex,'Selecciona un animal disponible del sexo correspondiente.');
    const months=sex==='FEMALE'?settings.minimumCowMonths:settings.minimumBullMonths;
    requireValue(months===0||animal.birthDate!==undefined,`Falta verificar la fecha de nacimiento de ${animal.name}. Abre su ficha con conexión antes de usarlo.`);
    requireValue(reachedReproductionAge(animal.birthDate,date,months),`${animal.name} debe tener al menos ${months} meses en la fecha del evento.`);
  };
  age(cowId,'FEMALE',on);
  const active=records.pregnancies.some(row=>row.cowId===cowId&&row.status==='CONFIRMED'&&unresolved(row.id));
  if(kind==='heats'&&active){input.isFalse=true;delete input.trueHeatId;}
  requireValue(!active||(kind==='heats'&&input.isFalse===true),kind==='heats'?'La hembra tiene una preñez confirmada. Solo puede registrarse un celo aparente o falso.':'La hembra ya tiene una preñez confirmada.');
  const shift=(date:string,days:number)=>{const value=new Date(date+'T12:00:00Z');value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);};
  const birth=records.births.filter(row=>row.motherId===cowId&&row.occurredOn<=on).map(row=>row.occurredOn).sort().at(-1);
  const loss=records.losses.filter(row=>row.cowId===cowId&&row.occurredOn<=on).map(row=>row.occurredOn).sort().at(-1);
  for(const [previous,days,label] of [[birth,kind==='heats'?settings.daysAfterBirthHeat:settings.daysAfterBirthPregnancy,'parto'],
    [loss,kind==='heats'?settings.daysAfterLossHeat:settings.daysAfterLossPregnancy,'aborto o pérdida']] as const)
    if(previous)requireValue(on>=shift(previous,days),`Deben transcurrir ${days} días después del ${label}.`);
  const boundary=[birth,loss].filter(Boolean).sort().at(-1)??'';
  if(kind==='heats'&&!settings.allowSecondHeat&&!active)requireValue(!records.heats.some(row=>row.cowId===cowId&&!row.cancelled&&row.startsOn>=boundary&&row.startsOn<=on),
    'Las políticas de operación no permiten otro celo en este ciclo.');
  const trueHeats=cycleTrueHeats(records,cowId,on);
  if(kind==='heats'){
    if(input.bullId)age(input.bullId,'MALE',on);
    if(!input.isFalse&&trueHeats.length)requireValue(input.trueHeatId==='NEW'||trueHeats.some(row=>row.id===input.trueHeatId),'Ya hay un celo verdadero en este ciclo. Elige cuál conservar como verdadero.');
    if(input.trueHeatId)requireValue(!input.isFalse&&trueHeats.length>0&&(input.trueHeatId==='NEW'||trueHeats.some(row=>row.id===input.trueHeatId)),
      'El celo verdadero cambió. Vuelve a abrir el registro y elige otra vez.');
    return;
  }
  if(input.fatherId&&input.externalFather)requireValue(false,'Selecciona un padre registrado o uno externo, no ambos.');
  for(const [key,max] of [['externalFather',240],['externalDonor',240],['materialCode',160],['quality',120],['technician',160],['supplier',160]] as const)
    if(input[key]!=null)requireValue(typeof input[key]==='string'&&String(input[key]).trim().length<=max
      &&(!key.startsWith('external')||String(input[key]).trim().length>0),`Revisa los datos del servicio: cada campo debe respetar su longitud máxima (${max} caracteres).`);
  if(kind==='services'){
    requireValue(!(input.donorId&&input.externalDonor),'Selecciona una donante registrada o una externa, no ambas.');
    requireValue(input.kind!=='INSEMINATION'||!input.donorId&&!input.externalDonor,'La donante requiere transferencia de embriones.');
  }
  let conceptionOn=on;let fatherId=input.fatherId;
  let heatId=input.heatId;
  if(kind==='pregnancies'){
    requireValue(['NATURAL','INSEMINATION','EMBRYO_TRANSFER','UNKNOWN'].includes(String(input.conceptionMethod)),'Selecciona el método de reproducción.');
    requireValue(['PALPATION','ULTRASOUND','BLOOD_TEST','OBSERVATION','OTHER'].includes(String(input.confirmationMethod)),'Selecciona el método de confirmación.');
    if(input.gestationDays!=null)requireValue(Number.isInteger(input.gestationDays)&&Number(input.gestationDays)>=0&&Number(input.gestationDays)<=400,'Los días de gestación deben ser enteros entre 0 y 400.');
    if(input.serviceId){
      const service=records.services.find(row=>row.id===input.serviceId);
      requireValue(service&&service.cowId===cowId&&!service.cancelled&&!service.hasPregnancy&&service.kind===input.conceptionMethod
        &&service.occurredOn>=boundary&&service.occurredOn<=on,'Selecciona un servicio disponible del ciclo actual para esta hembra.');
      heatId=service.heatId;fatherId=service.fatherId;conceptionOn=service.occurredOn;
    }else{
      if(!heatId&&settings.useLastValidHeat&&input.useLastHeat!==false)heatId=trueHeats.find(row=>row.startsOn<=on)?.id;
      if(input.gestationDays!=null&&!heatId)conceptionOn=shift(on,-Number(input.gestationDays));
    }
  }else requireValue(['INSEMINATION','EMBRYO_TRANSFER'].includes(String(input.kind)),'Selecciona inseminación o transferencia de embriones.');
  if(heatId){
    const heat=trueHeats.find(row=>row.id===heatId&&row.startsOn<=on);
    requireValue(heat,'Selecciona un celo verdadero del ciclo actual para esta hembra.');
    if(!fatherId&&!input.externalFather)fatherId=heat.bullId;
    if(kind==='pregnancies'&&!input.serviceId)conceptionOn=settings.useLastValidHeat?heat.endsOn??heat.startsOn:heat.startsOn;
  }
  requireValue(conceptionOn<=on,'La confirmación no puede ser anterior al celo o servicio seleccionado.');
  if(kind==='pregnancies'){
    requireValue((Date.parse(on)-Date.parse(conceptionOn))/86400000<=400,'La confirmación supera los 400 días desde el celo o servicio.');
    age(cowId,'FEMALE',conceptionOn);
  }
  if(fatherId)age(fatherId,'MALE',conceptionOn);
  if(input.donorId)age(input.donorId,'FEMALE',on);
}
export function validateLocalMutation(entry:OutboxEntry,current:Record<string,unknown>|null){
  const original=(entry.jsonBody??{}) as Record<string,unknown>;
  const editingMedicine=entry.method==='PATCH'&&/^\/catalogs\/medicines\/[^/]+$/.test(entry.path);
  const input=editingMedicine?{...(original.medicine as Record<string,unknown>),expectedVersion:original.expectedVersion}:original;
  if(editingMedicine)requireValue(typeof original.active==='boolean','Indica si el medicamento está activo.');
  const validateNumbers=(value:unknown):void=>{
    if(typeof value==='number')requireValue(Number.isFinite(value),'Ingresa números válidos.');
    else if(Array.isArray(value))value.forEach(validateNumbers);
    else if(value&&typeof value==='object')Object.values(value).forEach(validateNumbers);
  };
  validateNumbers(input);
  if(entry.method==='POST'&&entry.path==='/groups'||/^\/groups\/[^/]+\/state$/.test(entry.path)&&input.active===true)requireValue(typeof input.locationId==='string'&&input.locationId.length>0,'Selecciona un potrero o corral para el grupo.');
  if(entry.path==='/reproduction/births'){
    const calves=input.calves;const stillborn=Number(input.stillbornCount);
    requireValue(Array.isArray(calves)&&Number.isInteger(stillborn)&&stillborn>=0&&calves.length+stillborn>=1&&calves.length+stillborn<=8,
      'Registra entre una y ocho crías en total, incluyendo las nacidas muertas.');
    requireValue(input.kind===undefined||['NORMAL','ASSISTED','CAESAREAN','UNKNOWN'].includes(String(input.kind)),'Selecciona un tipo de parto válido.');
    for(const calf of calves){
      requireValue(calf&&typeof calf==='object'&&!Array.isArray(calf),'Completa la ficha de cada cría.');
      requireValue(calf.birthCondition===undefined||['ALIVE','WEAK','UNKNOWN'].includes(calf.birthCondition),'Selecciona el estado al nacer de cada cría.');
      validateLocalMutation({...entry,path:'/animals',jsonBody:{...calf,speciesCode:'BOVINE'}},null);
    }
  }
  if(/^\/reproduction\/heats\/[^/]+\/finish$/.test(entry.path)){
    const endsOn=String(input.endsOn??'');const today=reproductionToday();
    const date=new Date(`${endsOn}T12:00:00Z`);
    requireValue(/^\d{4}-\d{2}-\d{2}$/.test(endsOn)&&Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===endsOn
      &&endsOn<=today&&(!current?.startsOn||endsOn>=String(current.startsOn)),
      'La fecha de fin debe estar entre el inicio del celo y hoy.');
  }
  if(editingMedicine||['/health-records/medicines','/health-records/medicines/structured','/health-records/medicines/classification','/catalogs/medicines','/catalogs/medicines/classification'].includes(entry.path)){
    requireValue(typeof input.name==='string'&&input.name.trim().length>=2&&input.name.trim().length<=160,
      'El nombre del medicamento debe tener entre 2 y 160 caracteres.');
    requireValue(['VACUNA','DESPARASITACION','ENFERMEDAD','OTRO'].includes(String(input.kind)),
      'Selecciona el uso principal del medicamento.');
    requireValue(['MILLIGRAM','GRAM','MILLILITER','LITER','UNIT','DOSE'].includes(String(input.defaultUnitCode)),
      'Selecciona la unidad de dosis.');
    if(input.administrationRoutes!==undefined){const routes=input.administrationRoutes;
      requireValue(Array.isArray(routes)&&routes.length>0&&routes.length<=30&&new Set(routes).size===routes.length
        &&routes.every(route=>typeof route==='string'&&route.length>0),'Selecciona vías distintas de administración.');}
    for(const field of ['doseAmount','doseWeight'])if(input[field]!=null)requireValue(typeof input[field]==='number'
      &&Number(input[field])>=0.000001&&Number(input[field])<=1000000,'La referencia de dosis debe ser positiva.');
    requireValue((input.doseWeight!=null)===(input.doseWeightUnitCode!=null)&&
      (input.doseWeight==null||input.doseAmount!=null&&['KILOGRAM','POUND'].includes(String(input.doseWeightUnitCode))),
      'Completa cantidad, peso base y unidad para la dosis por peso.');
    if(input.doseClassificationRanges!==undefined){const ranges=input.doseClassificationRanges;
      requireValue(Array.isArray(ranges)&&ranges.length<=6,'Selecciona hasta seis clasificaciones.');
      const codes=ranges.map(range=>range?.classificationCode);
      requireValue(new Set(codes).size===codes.length&&ranges.every(range=>range&&
        ['VACA','VACONA','TERNERA','TORO','TORETE','TERNERO'].includes(range.classificationCode)&&
        typeof range.min==='number'&&typeof range.max==='number'&&range.min>=0.000001
        &&range.max>=range.min&&range.max<=1000000),'Configura rangos válidos para clasificaciones distintas.');
      requireValue(!ranges.length||input.doseAmount==null&&input.doseWeight==null&&input.doseWeightUnitCode==null,
        'Elige una referencia por clasificación o por cantidad/peso.');
    }
    for(const field of ['withdrawalMilkDays','withdrawalMeatDays'])if(input[field]!=null)
      requireValue(Number.isInteger(input[field])&&Number(input[field])>=0&&Number(input[field])<=10000,
        'Los días de retiro deben ser enteros entre 0 y 10000.');
  }
  if('expectedVersion' in input){
    requireValue(Number.isInteger(input.expectedVersion)&&Number(input.expectedVersion)>0,
      'La versión del registro no es válida. Vuelve a abrirlo.');
    if(current?.version!==undefined)requireValue(input.expectedVersion===current.version,
      'El registro cambió. Vuelve a abrirlo antes de guardar.');
  }
  const date=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)
    &&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  for(const key of ['birthDate','entryDate','capturedOn','performedOn','occurredOn','resolvedOn','startedOn','endedOn',
    'startsOn','endsOn','weighedOn','detectedOn','appliedOn','finishedOn','tradedOn','producedOn','confirmedOn'])
    if(input[key]!=null)requireValue(date(input[key]),'Ingresa una fecha válida.');
  if(entry.method==='POST'&&entry.path==='/cleanings'||entry.method==='PUT'&&/^\/cleanings\/[^/]+$/.test(entry.path)){
    const text=(value:unknown,min:number,max:number)=>typeof value==='string'&&value.trim().length>=min&&value.trim().length<=max;
    const positive=(value:unknown,max:number)=>typeof value==='number'&&value>0&&value<=max;
    requireValue(text(input.locationId,1,100),'Selecciona un potrero para la limpieza.');
    requireValue(date(input.startedOn),'Indica la fecha de inicio de la limpieza.');
    requireValue(input.finishedOn==null||String(input.finishedOn)>=String(input.startedOn),'La finalización no puede ser anterior al inicio.');
    const today=new Date();const localToday=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    requireValue(String(input.startedOn)<=localToday&&(input.finishedOn==null||String(input.finishedOn)<=localToday),'Las fechas de limpieza no pueden ser futuras.');
    const activities=input.activities;
    requireValue(Array.isArray(activities)&&activities.length>0&&activities.length<=4&&new Set(activities).size===activities.length
      &&activities.every(value=>['FUMIGACION','TALA_SELECTIVA','DESBROCE','OTRA'].includes(value)),'Selecciona al menos una labor sin repetirla.');
    requireValue(input.areaType==='TOTAL'||input.areaType==='PARCIAL','Selecciona el área intervenida.');
    requireValue(input.areaType==='PARCIAL'?positive(input.partialPercent,100)&&Number(input.partialPercent)<100:input.partialPercent==null,
      'Indica un porcentaje mayor a 0 y menor a 100 para el área parcial.');
    const products=input.products;const operators=input.operators;const spray=activities.includes('FUMIGACION');
    requireValue(Array.isArray(products)&&products.length<=30,'Selecciona hasta 30 productos.');
    requireValue(Array.isArray(operators)&&operators.length<=30,'Registra hasta 30 responsables.');
    requireValue(spray||(!input.applicationUnit&&!input.applicationCount&&!input.tankCapacityLiters&&!products.length),
      'Tanques, bombadas y productos solo corresponden a fumigación.');
    requireValue(input.applicationUnit==null||['TANQUES','BOMBADAS'].includes(String(input.applicationUnit)),'Selecciona tanques o bombadas.');
    requireValue(input.applicationCount==null||positive(input.applicationCount,100000),'Indica una cantidad de aplicaciones mayor a cero.');
    requireValue(input.tankCapacityLiters==null||positive(input.tankCapacityLiters,100000),'Indica una capacidad mayor a cero.');
    requireValue(!input.applicationCount||input.applicationUnit,'Selecciona tanques o bombadas para la aplicación.');
    requireValue(!products.length||positive(input.applicationCount,100000),'Indica cuántos tanques o bombadas se aplicaron para calcular los productos.');
    requireValue(new Set(products.map(value=>value?.productId)).size===products.length&&products.every(value=>value
      &&text(value.productId,1,100)&&['MILLIGRAM','GRAM','KILOGRAM','MILLILITER','LITER','UNIT','DOSE'].includes(value.unitCode)
      &&positive(value.quantityPerApplication,1000000)&&(value.notes==null||text(value.notes,0,300))),
      'Selecciona productos distintos, con una cantidad válida y observaciones de hasta 300 caracteres.');
    requireValue(new Set(operators.map(value=>String(value?.name??'').trim().toLocaleLowerCase())).size===operators.length
      &&operators.every(value=>value&&text(value.name,2,160)&&(value.function==null||text(value.function,0,100))
      &&(value.notes==null||text(value.notes,0,300))),'Registra responsables distintos con nombres de 2 a 160 caracteres y observaciones de hasta 300.');
    requireValue(input.notes==null||text(input.notes,0,5000),'Las observaciones de limpieza admiten hasta 5000 caracteres.');
    if(entry.method==='PUT')requireValue(Number.isInteger(input.expectedVersion)&&Number(input.expectedVersion)>0,'Vuelve a abrir el borrador antes de editarlo.');
  }
  if(/^(\/cleanings|\/catalogs)\/products(?:\/[^/]+)?$/.test(entry.path)&&['POST','PATCH'].includes(entry.method)){
    requireValue(typeof input.name==='string'&&input.name.trim().length>=2&&input.name.trim().length<=160,'El nombre del producto debe tener entre 2 y 160 caracteres.');
    for(const [key,max] of [['description',2000],['activeIngredient',2000],['formulatedBy',200],['category',160]] as const)
      requireValue(input[key]==null||typeof input[key]==='string'&&String(input[key]).trim().length<=max,`El campo ${key==='category'?'categoría':key==='formulatedBy'?'formulado por':key==='activeIngredient'?'principio activo':'descripción'} admite hasta ${max} caracteres.`);
    if(entry.method==='PATCH')requireValue(typeof input.active==='boolean'&&Number.isInteger(input.expectedVersion),'Vuelve a abrir el producto antes de editarlo.');
  }
  if(entry.method==='PATCH'&&/^\/catalogs\/[^/]+\/items\/[^/]+$/.test(entry.path)&&input.name!==undefined){
    requireValue(typeof input.name==='string'&&input.name.trim().length>=2&&input.name.trim().length<=160,'El nombre debe tener entre 2 y 160 caracteres.');
    requireValue(Number.isInteger(input.expectedVersion),'Vuelve a abrir la opción antes de editarla.');
  }
  if(entry.path.startsWith('/animals')){
    if(entry.path==='/animals'){
      requireValue(typeof input.name==='string'&&input.name.trim().length>0&&input.name.trim().length<=160,
        'El nombre debe tener entre 1 y 160 caracteres.');
      requireValue(input.groupId,'Selecciona un grupo para el animal.');
      requireValue(['FEMALE','MALE'].includes(String(input.sex))&&input.speciesCode==='BOVINE',
        'Selecciona el sexo y la especie del animal.');
      requireValue((input.initialWeight===undefined)===(input.initialWeightUnitCode===undefined),
        'Indica juntos el peso y su unidad.');
      if(input.initialWeight!==undefined)requireValue(typeof input.initialWeight==='number'
        &&input.initialWeight>0&&input.initialWeight<=999999999&&/^\d+(\.\d{1,3})?$/.test(String(input.initialWeight)),
        'El peso debe ser positivo y tener como máximo tres decimales.');
      if(input.initialWeightUnitCode!==undefined)requireValue(/^[A-Z_]{2,30}$/.test(String(input.initialWeightUnitCode)),
        'Selecciona una unidad de peso válida.');
    }
    if(input.description!=null)requireValue(typeof input.description==='string'&&input.description.trim().length<=5000,
      'La descripción admite hasta 5000 caracteres.');
    if(input.earTagCode!==undefined)requireValue(typeof input.earTagCode==='string'
      &&input.earTagCode.trim().length>0&&input.earTagCode.trim().length<=80,'El arete admite entre 1 y 80 caracteres.');
    for(const key of ['breedIds','colorIds','brandIds'])if(input[key]!==undefined){
      const ids=input[key];requireValue(Array.isArray(ids)&&ids.length<=12
        &&ids.every(id=>typeof id==='string'&&id.length>0)&&new Set(ids).size===ids.length,
        'Selecciona hasta 12 elementos distintos por catálogo.');
    }
    if(input.owners!==undefined){
      const owners=input.owners as Array<{partyId:string;percent:number;isPrimary:boolean}>;
      requireValue(Array.isArray(owners)&&owners.length>0&&owners.length<=30
        &&owners.every(owner=>owner&&typeof owner.partyId==='string'&&owner.percent>0&&owner.percent<=100
          &&typeof owner.isPrimary==='boolean')&&new Set(owners.map(owner=>owner.partyId)).size===owners.length
        &&owners.filter(owner=>owner.isPrimary).length===1
        &&Math.abs(owners.reduce((sum,owner)=>sum+owner.percent,0)-100)<0.001,
        'Los propietarios deben ser distintos, sumar 100 % y tener un propietario principal.');
    }
    for(const key of ['mother','father'])if(input[key]!=null){
      const parent=input[key] as {animalId?:string;reportedName?:string};
      requireValue((typeof parent.animalId==='string'&&parent.animalId.length>0&&parent.animalId!==current?.id)
        ||(typeof parent.reportedName==='string'&&parent.reportedName.trim().length>0
          &&parent.reportedName.trim().length<=160),'Selecciona un progenitor distinto del animal o indica su nombre.');
    }
    requireValue(!input.mother||!input.father
      ||(input.mother as {animalId?:string}).animalId===undefined
      ||(input.mother as {animalId?:string}).animalId!==(input.father as {animalId?:string}).animalId,
      'La madre y el padre deben ser animales distintos.');
  }
  if(entry.method==='PATCH'&&entry.path.startsWith('/media/objects/')){
    if(input.description!=null)requireValue(typeof input.description==='string'&&input.description.length<=2000,
      'La descripción admite hasta 2000 caracteres.');
    for(const key of ['animalIds','tagIds','expectedAttachmentIds']){
      const ids=input[key];requireValue(Array.isArray(ids)&&ids.length<=100
        &&ids.every(id=>typeof id==='string'&&id.length>0)&&new Set(ids).size===ids.length,
        'Selecciona hasta 100 relaciones o etiquetas distintas.');
    }
    requireValue((input.expectedAttachmentIds as unknown[]).length>0,'Vuelve a abrir la foto antes de editarla.');
  }
  if(entry.bodyType==='binary'){
    const file=entry.formParts[0]?.value;
    requireValue(file instanceof Blob&&file.size>0,'Selecciona un archivo que contenga datos.');
    const kind=entry.requestHeaders?.['x-media-kind'];
    requireValue((kind==='IMAGE'&&file.type.startsWith('image/'))||(kind==='VIDEO'&&file.type.startsWith('video/')),
      'Selecciona una imagen o un video compatible.');
    requireValue(file.size<=(kind==='IMAGE'?20:120)*1024*1024,
      kind==='IMAGE'?'La imagen admite hasta 20 MiB.':'El video admite hasta 120 MiB.');
    const query=new URLSearchParams(entry.path.split('?')[1]);
    const ids=(query.get('animalIds')||query.get('entityId')||'').split(',').filter(Boolean);
    requireValue(ids.length>0&&ids.length<=100&&new Set(ids).size===ids.length,
      'Selecciona registros distintos para adjuntar el archivo.');
    if(['PROFILE','COVER'].includes(query.get('relationCode')??''))requireValue(kind==='IMAGE'
      &&query.get('entityType')==='ANIMAL'&&ids.length===1,'El perfil y la portada admiten una foto de un solo animal.');
    if(query.get('capturedOn'))requireValue(date(query.get('capturedOn')),'Ingresa una fecha válida para el archivo.');
  }
}
