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
