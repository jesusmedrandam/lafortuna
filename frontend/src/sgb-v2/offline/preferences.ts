export const downloadGroups={animals:'Animales',spaces:'Grupos, potreros y corrales',catalogs:'Catálogos',
  movements:'Movimientos',weighings:'Pesajes',activities:'Actividades y agenda',production:'Producción',
  reproduction:'Reproducción',health:'Sanidad',cleanings:'Limpieza de potreros',commerce:'Compras y ventas',
  finances:'Ingresos y egresos',property:'Multimedia de la propiedad'};
type Group=keyof typeof downloadGroups;
interface DataChoice {id:string;label:string;group:Group;permission?:string;module?:string;personal?:boolean;paths:string[]}
export const dataChoices:DataChoice[]=[
  {id:'animals',label:'Animales y clasificación',group:'animals',permission:'ANIMAL_VIEW',
    paths:['/animals?page=1&search=','/animals/summary','/animals/classification','/animal-status','/animal-status/options']},
  {id:'groups',label:'Grupos',group:'spaces',permission:'GROUP_VIEW',paths:['/groups']},
  {id:'locations',label:'Potreros y corrales',group:'spaces',permission:'LOCATION_VIEW',paths:['/locations']},
  {id:'catalogs',label:'Opciones, propietarios y marquillas',group:'catalogs',permission:'CATALOG_VIEW',
    paths:['/owners','/owners/users','/animal-brands','/catalogs/reference','/catalogs/BREEDS/items',
      '/catalogs/COLORS/items','/catalogs/MOVEMENT_REASONS/items','/catalogs/HEALTH_CONDITION_TYPES/items',
      '/catalogs/TREATMENT_TYPES/items','/catalogs/ADMINISTRATION_ROUTES/items','/catalogs/medicines','/catalogs/products','/catalogs/GRASS_TYPES/items','/catalogs/MEDIA_TAGS/items']},
  {id:'movements',label:'Registros de movimientos',group:'movements',permission:'MOVEMENT_VIEW',module:'MOVEMENTS',paths:['/movements','/movements/options']},
  {id:'weighings',label:'Registros de pesajes',group:'weighings',permission:'WEIGHING_VIEW',module:'WEIGHING',paths:['/weighings','/weighings/options']},
  {id:'activities',label:'Registros de actividades',group:'activities',permission:'ACTIVITY_VIEW',module:'TASKS',paths:['/activities','/activities/options']},
  {id:'agenda',label:'Tareas y eventos',group:'activities',paths:['/agenda','/agenda/options']},
  {id:'production',label:'Registros de producción',group:'production',permission:'PRODUCTION_VIEW',module:'PRODUCTION',paths:['/production']},
  {id:'reproduction',label:'Registros de reproducción',group:'reproduction',permission:'REPRODUCTION_VIEW',module:'REPRODUCTION',paths:['/reproduction','/reproduction/candidates','/reproduction/settings']},
  {id:'health',label:'Problemas, tratamientos y campañas',group:'health',permission:'HEALTH_VIEW',module:'HEALTH',paths:['/health-records/conditions','/health-records/medicines','/health-records/options','/health-records/campaigns']},
  {id:'cleanings',label:'Limpiezas y productos',group:'cleanings',permission:'CLEANING_VIEW',module:'PASTURE_CLEANING',paths:['/cleanings','/cleanings/options','/cleanings/products','/catalogs/AGROCHEMICAL_CATEGORIES/items']},
  {id:'commerce',label:'Compras, ventas y compradores',group:'commerce',permission:'COMMERCE_VIEW',module:'SALES_PURCHASES',paths:['/commerce','/commerce/animals','/catalogs/BUYERS/items','/catalogs/SALE_PRODUCTS/items']},
  {id:'property-finance',label:'Finanzas de la propiedad',group:'finances',permission:'FINANCE_VIEW',module:'PROPERTY_FINANCE',paths:['/finances/property/accounts','/finances/property/movements']},
  {id:'personal-finance',label:'Mis finanzas',group:'finances',personal:true,paths:['/finances/personal/accounts','/finances/personal/movements']},
];
interface PhotoChoice {id:string;label:string;group:Group;types:string[];permission?:string;module?:string;history?:boolean}
export const photoChoices:PhotoChoice[]=[
  {id:'profile',label:'Fotos de perfil',group:'animals',types:['ANIMAL'],permission:'ANIMAL_VIEW',history:true},
  {id:'cover',label:'Fotos de portada',group:'animals',types:['ANIMAL'],permission:'ANIMAL_VIEW',history:true},
  {id:'animal-photos',label:'Otras fotos de animales',group:'animals',types:['ANIMAL'],permission:'ANIMAL_VIEW'},
  {id:'movement-photos',label:'Fotos de movimientos',group:'movements',types:['LIVESTOCK_MOVEMENT'],permission:'MOVEMENT_VIEW',module:'MOVEMENTS'},
  {id:'activity-photos',label:'Fotos de actividades',group:'activities',types:['LIVESTOCK_ACTIVITY'],permission:'ACTIVITY_VIEW',module:'TASKS'},
  {id:'production-photos',label:'Fotos de producción',group:'production',types:['MILK_LACTATION','MILK_PRODUCTION','MILK_TANK_PRODUCTION'],permission:'PRODUCTION_VIEW',module:'PRODUCTION'},
  {id:'reproduction-photos',label:'Fotos de reproducción',group:'reproduction',types:['REPRODUCTION_HEAT','REPRODUCTION_SERVICE','REPRODUCTION_PREGNANCY','REPRODUCTION_BIRTH','REPRODUCTION_LOSS'],permission:'REPRODUCTION_VIEW',module:'REPRODUCTION'},
  {id:'health-photos',label:'Fotos de campañas sanitarias',group:'health',types:['HEALTH_CAMPAIGN'],permission:'HEALTH_VIEW',module:'HEALTH'},
  {id:'cleaning-photos',label:'Fotos de limpiezas',group:'cleanings',types:['CLEANING'],permission:'CLEANING_VIEW',module:'PASTURE_CLEANING'},
  {id:'property-photos',label:'Fotos de la propiedad',group:'property',types:['PROPERTY'],permission:'MODULE_VIEW'},
];
export type PhotoMode='none'|'latest'|'all';
export interface DownloadPreferences {data:Record<string,boolean>;photos:Record<string,PhotoMode>;videos:boolean}
export function defaultDownloadPreferences():DownloadPreferences{
  return {data:Object.fromEntries(dataChoices.map(item=>[item.id,true])),
    photos:Object.fromEntries(photoChoices.map(item=>[item.id,item.history?'latest':'none'])),videos:false};
}
export function normalizeDownloadPreferences(value:unknown):DownloadPreferences{
  const defaults=defaultDownloadPreferences();
  const input=value&&typeof value==='object'?value as Partial<DownloadPreferences>:{};
  for(const item of dataChoices)if(typeof input.data?.[item.id]==='boolean')defaults.data[item.id]=input.data[item.id]!;
  for(const item of photoChoices){const mode=input.photos?.[item.id];
    if(mode==='none'||mode==='all'||mode==='latest'&&item.history)defaults.photos[item.id]=mode;}
  defaults.videos=input.videos===true;return defaults;
}
export function availableDownloadChoices(modules:string[],permissions:string[],personalFinance:boolean){
  const can=(permission?:string)=>!permission||permissions.includes(permission);
  return {data:dataChoices.filter(item=>item.personal?personalFinance:item.id==='agenda'
    ?modules.includes('TASKS')&&can('AGENDA_TASK_VIEW')||modules.includes('EVENTS')&&can('AGENDA_EVENT_VIEW')
    :can(item.permission)&&(!item.module||modules.includes(item.module))),
    photos:modules.includes('MULTIMEDIA')&&can('MEDIA_VIEW')?photoChoices.filter(item=>
      can(item.permission)&&(!item.module||modules.includes(item.module))):[]};
}
export function selectedDownloadPaths(preferences:DownloadPreferences,available:ReturnType<typeof availableDownloadChoices>){
  const paths=available.data.filter(item=>preferences.data[item.id]).flatMap(item=>item.paths);
  const types=new Set(available.photos.filter(item=>preferences.photos[item.id]!=='none').flatMap(item=>item.types));
  for(const type of types)paths.push('/media?'+new URLSearchParams({entityType:type}));
  if(paths.some(path=>!path.startsWith('/finances/personal/')))paths.push('/catalogs/reference');
  return [...new Set(paths)];
}
export function dataCategoryForPath(path:string){
  const root=path.split('?')[0]!;
  if(root==='/media'||root.startsWith('/media/'))return 'media';
  if(root==='/animal-status'||root.startsWith('/animal-status/')||root==='/animals'||root.startsWith('/animals/'))return 'animals';
  for(const item of dataChoices)if(item.paths.some(candidate=>{
    const prefix=candidate.split('?')[0]!;return root===prefix||root.startsWith(prefix+'/');}))return item.id;
  return 'other';
}
export function photoCategoryForType(type:unknown,relation:unknown){
  if(type==='ANIMAL')return relation==='PROFILE'?'profile':relation==='COVER'?'cover':'animal-photos';
  return photoChoices.find(item=>item.types.includes(String(type)))?.id??'other';
}
export function photoCategoryForPath(path:string){
  const category=dataCategoryForPath(path);
  const categories:Record<string,string>={animals:'animal-photos',movements:'movement-photos',activities:'activity-photos',
    production:'production-photos',reproduction:'reproduction-photos',health:'health-photos',
    cleanings:'cleaning-photos'};return categories[category]??'other';
}
export function downloadCategoryLabel(id:string){
  return dataChoices.find(item=>item.id===id)?.label??photoChoices.find(item=>item.id===id)?.label??
    (id==='media'?'Información de fotos y videos':'Otros datos guardados');
}
