import type {OutboxEntry} from './database';

export class LocalValidationError extends Error {
  readonly status=400;
  readonly code='LOCAL_VALIDATION_FAILED';
}
function requireValue(valid:unknown,message:string):asserts valid{
  if(!valid)throw new LocalValidationError(message);
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
