import {
  getCache,getOfflineSize,getSetting,listCache,listOutbox,offlineScopeKey,putCache,putOutbox,
  putSetting,removeOutbox,getLocalMedia,putMediaMutation,getLocalMediaInfo,listLocalMedia,removeLocalMedia,
  removeCachedPaths,listUserCache,type OfflineScope,type OutboxEntry,type StoredFormPart,
} from './database';
import {LocalValidationError,validateLocalMutation} from './validation';
import {mediaThumbnailUrl,optimizedCloudinaryMediaUrl} from '../../media';
import {dataCategoryForPath,defaultDownloadPreferences,downloadCategoryLabel,normalizeDownloadPreferences,
  photoCategoryForPath,photoCategoryForType,type DownloadPreferences} from './preferences';

export interface OfflineTransportResponse<T> {
  data:T;
  etag:string|null;
  notModified:boolean;
}

export type OfflineTransportRequest=RequestInit&{onUploadProgress?:(loaded:number,total:number)=>void};
type Transport = <T>(path:string,init:OfflineTransportRequest)=>Promise<OfflineTransportResponse<T>>;

export class OfflineUnavailableError extends Error {
  readonly status=0;
  readonly code='OFFLINE_DATA_UNAVAILABLE';
}

export interface OfflineRuntimeState {
  retryAt?:number;
  online:boolean;
  wifi:boolean;
  automaticDownloads:boolean;
  preferences:DownloadPreferences;
  pending:number;
  failed:number;
  syncing:boolean;
  syncProgress?:{completed:number;total:number;current:string;loaded:number;bytes:number};
  cachedEntries:number;
  cachedBytes:number;
  mediaFiles:number;
  mediaBytes:number;
  mediaPending:number;
  mediaFailed:number;
  lastDownload:number|null;
}

const excludedMutationRoots=['/auth','/invitations','/property-team','/property-settings','/my-account',
  '/superadmin','/notifications','/audit'];
let activeScope:OfflineScope|null=null;
let activeToken:string|null=null;
let automaticDownloads=false;
let downloadPreferences=defaultDownloadPreferences();
let transport:Transport|null=null;
let syncing=false;
let syncTask:Promise<void>|null=null;
let syncProgress:OfflineRuntimeState['syncProgress'];
let apiBase='';
let lastCreatedAt=0;
let mutationChain:Promise<unknown>=Promise.resolve();
let cacheGeneration=0;
let retryAt=0;
let downloadTask:{key:string;promise:Promise<{downloaded:number;failed:number;errors:string[]}>}|null=null;
const refreshing=new Set<string>();
const mediaUrls=new Map<string,string>();

function emit(name:string,detail?:unknown){
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(name,{detail}));
}

function nativeOnline(){
  try{return window.SGBAndroid?.isOnline?.()??navigator.onLine;}catch{return navigator.onLine;}
}

export function isRuntimeOnline(){return nativeOnline();}

export function isRuntimeWifi(){
  if(!isRuntimeOnline())return false;
  try{const native=window.SGBAndroid?.isWifiConnected?.();if(typeof native==='boolean')return native;
    const connection=(navigator as Navigator&{connection?:{type?:string}}).connection;
    return connection?.type==='wifi';}catch{return false;}
}
export function canAutomaticallyDownload(){return automaticDownloads&&isRuntimeWifi();}
function selectedData(path:string){const category=dataCategoryForPath(path);
  return category==='media'?Object.values(downloadPreferences.photos).some(mode=>mode!=='none'):downloadPreferences.data[category]===true;}

export function installOfflineTransport(value:Transport){transport=value;}
export function updateOfflineAccessToken(userId:string,token:string){
  if(activeScope?.userId!==userId)return false;
  activeToken=token;return true;
}
export function offlineUserId(){return activeScope?.userId??null;}
export function isSynchronizing(){return syncing;}
export function setOfflineApiBase(value:string){apiBase=value.replace(/\/$/,'');}

export async function configureOfflineRuntime(scope:OfflineScope|null,token:string|null){
  activeScope=scope;activeToken=token;
  automaticDownloads=scope?await getSetting<boolean>(`automatic-downloads:${scope.userId}`)??Boolean(window.SGBAndroid):false;
  downloadPreferences=normalizeDownloadPreferences(scope?await getSetting(`download-preferences:${scope.userId}`):null);
  if(scope!==activeScope||token!==activeToken)return;
  try{
    if(scope&&token&&!scope.supportMode)window.SGBAndroid?.configureOfflineSync?.(apiBase,token,scope.userId,
      scope.propertyId??'',scope.roleId??'');
    else window.SGBAndroid?.clearOfflineSyncSession?.();
    window.SGBAndroid?.setOfflineUserScope?.(scope?.userId??'');
    // Downloads are selected here; native interception cannot identify their category.
    window.SGBAndroid?.setAutomaticMediaDownloads?.(false);
  }catch{/* Solo Android. */}
  if(scope&&!syncing)await reprojectQueued(scope);
  await publishState();
}

export async function setAutomaticDownloads(enabled:boolean){
  automaticDownloads=enabled;
  if(activeScope)await putSetting(`automatic-downloads:${activeScope.userId}`,enabled);
  try{window.SGBAndroid?.setAutomaticMediaDownloads?.(false);}catch{/* Solo Android. */}
  await publishState();
}

export async function setDownloadPreferences(value:DownloadPreferences){
  downloadPreferences=normalizeDownloadPreferences(value);
  if(activeScope)await putSetting(`download-preferences:${activeScope.userId}`,downloadPreferences);
  await publishState();
}

function authenticated(init:RequestInit){return new Headers(init.headers).has('authorization');}
function method(init:RequestInit){return String(init.method??'GET').toUpperCase();}
function mutationAllowed(path:string,init:RequestInit){
  return authenticated(init)&&!excludedMutationRoots.some(root=>path===root||path.startsWith(`${root}/`));
}

function sameScope(left:OfflineScope,right:OfflineScope){return offlineScopeKey(left)===offlineScopeKey(right);}

async function storedBody(body:BodyInit|null|undefined){
  if(body instanceof Blob)return {bodyType:'binary' as const,jsonBody:null,
    formParts:[{name:'file',value:body,filename:body instanceof File?body.name:'archivo'}]};
  if(body instanceof FormData){
    const formParts:StoredFormPart[]=[];
    body.forEach((value,name)=>formParts.push(value instanceof File
      ?{name,value,filename:value.name}:{name,value:String(value)}));
    return {bodyType:'form' as const,jsonBody:null,formParts};
  }
  if(typeof body==='string'){
    try{return {bodyType:'json' as const,jsonBody:JSON.parse(body) as unknown,formParts:[]};}
    catch{return {bodyType:'json' as const,jsonBody:body,formParts:[]};}
  }
  return {bodyType:'none' as const,jsonBody:null,formParts:[]};
}

function temporaryId(path:string,verb:string){
  if(verb!=='POST')return null;
  if(/\/(apply|cancel|resolve|finish|void|action|read|read-all|milking)$/.test(path))return null;
  return `offline-${crypto.randomUUID()}`;
}

function bodyRecord(body:unknown){
  return body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:{};
}

async function findCachedName(scope:OfflineScope,id:unknown){
  if(typeof id!=='string'||!id)return null;
  const entries=await listCache(scope);
  const visit=(value:unknown):string|null=>{
    if(Array.isArray(value)){for(const item of value){const found=visit(item);if(found)return found;}return null;}
    if(!value||typeof value!=='object')return null;
    const row=value as Record<string,unknown>;
    if(row.id===id||row.animalId===id||row.cowId===id||row.partyId===id){
      const name=row.name??row.title??row.animalName;if(typeof name==='string')return name;}
    for(const candidate of Object.values(row)){const found=visit(candidate);if(found)return found;}
    return null;
  };
  for(const entry of entries){const found=visit(entry.payload);if(found)return found;}
  return null;
}

async function optimisticRecord(entry:OutboxEntry){
  const input=bodyRecord(entry.jsonBody);
  const id=entry.temporaryId??entityId(entry.path,null);
  const now=new Date(entry.createdAt).toISOString();
  const pending={__syncState:'PENDING',__mutationId:entry.id};
  const current=await cachedRecord(entry);
  const common={...current,...input,id,version:Number(input.expectedVersion??current?.version??0)+1,
    createdAt:current?.createdAt??now,
    ...actionPatch(entry.path,input),...pending};

  if(/^\/catalogs\/medicines\/[^/]+$/.test(entry.path)&&entry.method==='PATCH'){
    const {medicine:_medicine,expectedVersion:_version,...rest}=common as Record<string,unknown>;
    return {...rest,...bodyRecord(input.medicine)};
  }

  if(entry.path==='/animals/classification'||entry.path.endsWith('/settings'))return common;
  if(entry.path.startsWith('/animals')){
    const animal:Record<string,unknown>={description:null,
    earTagCode:input.earTagCode??null,birthDate:input.birthDate??null,entryDate:input.entryDate??now.slice(0,10),
    initialWeight:input.initialWeight??null,initialWeightUnitCode:input.initialWeightUnitCode??null,
    availabilityStatusCode:'ACTIVE',profilePhotoUrl:null,primaryOwnerName:null,classification:null,
    breed:null,breeds:[],colors:[],owners:[],brands:[],mother:null,father:null,group:null,location:null,...common};
    const references=async(ids:unknown)=>Promise.all((Array.isArray(ids)?ids:[]).map(async value=>({
      id:String(value),name:await findCachedName(entry.scope,value)??String(value)})));
    if(input.breedIds!==undefined||input.breedId!==undefined){
      animal.breeds=await references(input.breedIds??(input.breedId?[input.breedId]:[]));
      animal.breed=(animal.breeds as unknown[])[0]??null;
    }
    if(input.colorIds!==undefined)animal.colors=await references(input.colorIds);
    if(input.brandIds!==undefined)animal.brands=await references(input.brandIds);
    if(Array.isArray(input.owners)){
      animal.owners=await Promise.all(input.owners.map(async value=>{
        const owner=bodyRecord(value);return {id:owner.partyId,name:await findCachedName(entry.scope,owner.partyId)??'Propietario',
          percent:owner.percent,isPrimary:owner.isPrimary};}));
      animal.primaryOwnerName=(animal.owners as Record<string,unknown>[]).find(owner=>owner.isPrimary)?.name??null;
    }
    if(input.groupId)animal.group={id:input.groupId,name:await findCachedName(entry.scope,input.groupId)??'Grupo'};
    for(const key of ['mother','father'])if(key in input){
      const parent=bodyRecord(input[key]);animal[key]=input[key]?{animalId:parent.animalId??null,
        name:parent.reportedName??await findCachedName(entry.scope,parent.animalId)??'Animal'}:null;
    }
    return animal;
  }
  if(entry.path.startsWith('/media?')&&entry.bodyType==='binary')return {
    id:entry.temporaryId,attachmentIds:mediaAttachments(entry).map(row=>row.id),...pending};
  if(entry.path==='/groups')return {...common,active:true,animalCount:0,location:null};
  if(['/health-records/medicines','/health-records/medicines/structured','/health-records/medicines/classification','/catalogs/medicines','/catalogs/medicines/classification'].includes(entry.path))return {
    active:true,administrationRoutes:['ORAL','INTRAMUSCULAR','SUBCUTANEA','INTRAVENOSA','TOPICA','OTRA'],
    doseAmount:null,doseWeight:null,doseWeightUnitCode:null,doseClassificationRanges:[],...common};
  if(/^\/catalogs\/[^/]+\/items$/.test(entry.path))return {
    active:true,systemDefined:false,itemCode:null,speciesCode:null,catalogCode:entry.path.split('/')[2],...common};
  if(entry.path==='/locations')return {...common,active:true,group:null,grasses:input.grasses??[]};
  if(entry.path==='/weighings')return {...common,animalName:await findCachedName(entry.scope,input.animalId)??'Animal',
    earTagCode:null,weightKg:input.unitCode==='POUND'?Number(input.weight??0)*0.45359237:input.weight,
    voidedAt:null};
  if(entry.path==='/health-records/conditions')return {...common,
    animalName:await findCachedName(entry.scope,input.animalId)??'Animal',status:'POR_RESOLVER',
    resolvedOn:null,treatmentCount:0};
  if(entry.path==='/movements')return {...common,status:'BORRADOR',appliedAt:null,cancelledAt:null,
    sourcePropertyId:entry.scope.propertyId,sourcePropertyName:'Propiedad actual',
    destinationPropertyName:await findCachedName(entry.scope,input.destinationPropertyId)??'Propiedad',
    sourceGroupName:await findCachedName(entry.scope,input.sourceGroupId)??'Grupo',
    destinationGroupName:await findCachedName(entry.scope,input.destinationGroupId)??'Grupo',
    sourceLocationId:null,sourceLocationName:null,destinationLocationName:
      await findCachedName(entry.scope,input.destinationLocationId)??null,
    animals:Array.isArray(input.animalIds)?await Promise.all(input.animalIds.map(async animalId=>({
      id:String(animalId),name:await findCachedName(entry.scope,animalId)??'Animal',
      sourceGroupId:String(input.sourceGroupId??''),sourceLocationId:null,
      destinationGroupId:String(input.destinationGroupId??''),destinationLocationId:input.destinationLocationId??null,
    }))):[]};
  if(entry.path==='/health-records/campaigns')return {...common,status:'BORRADOR',medicineName:
    await findCachedName(entry.scope,input.medicineId)??'Tratamiento',kind:'OTRO',groupName:
    await findCachedName(entry.scope,input.groupId)??null,appliedAt:null,cancelledAt:null,
    animals:Array.isArray(input.animals)?await Promise.all(input.animals.map(async value=>{
      const animal=bodyRecord(value);return {...animal,name:await findCachedName(entry.scope,animal.animalId)??'Animal'};
    })):[]};
  if(entry.path==='/production/milk')return {...common,cowName:await findCachedName(entry.scope,input.cowId)??'Vaca',
    lactationId:input.lactationId??null};
  if(entry.path==='/production/tanks')return common;
  if(entry.path==='/production/lactations')return {...common,cowId:'',cowName:'Vaca',startedOn:now.slice(0,10),
    endedOn:input.endedOn??null};
  if(entry.path==='/agenda')return {...common,status:'PENDING',createdBy:entry.scope.userId,
    createdByName:'Usuario',myResponse:null,users:[],animals:[]};
  if(entry.path==='/commerce')return {...common,status:'ACTIVE',currency:'USD',cancellationReason:null,
    registeredBy:'Usuario',lines:input.lines??[],total:Array.isArray(input.lines)?input.lines.reduce((sum,value)=>{
      const row=bodyRecord(value);return sum+Number(row.quantity??0)*Number(row.unitPrice??0);},0):0};
  if(entry.path==='/activities'||/^\/activities\/[^/]+$/.test(entry.path))return {...common,
    status:current?.status??'BORRADOR',brandName:await findCachedName(entry.scope,input.brandId)??current?.brandName??null,
    appliedAt:current?.appliedAt??null,cancelledAt:current?.cancelledAt??null,
    animals:Array.isArray(input.animalIds)?await Promise.all(input.animalIds.map(async id=>({id,
      name:await findCachedName(entry.scope,id)??'Animal',earTagCode:null}))):current?.animals??[]};
  if(['/cleanings/products','/catalogs/products'].includes(entry.path))return {active:true,category:null,activeIngredient:null,formulatedBy:null,description:null,...common};
  if(entry.path==='/cleanings'||/^\/cleanings\/[^/]+$/.test(entry.path))return {...common,
    locationName:await findCachedName(entry.scope,input.locationId)??current?.locationName??'Potrero',
    status:current?.status??'BORRADOR',completedAt:current?.completedAt??null,cancelledAt:current?.cancelledAt??null,
    areaValue:current?.areaValue??null,areaUnitCode:current?.areaUnitCode??null,
    products:await Promise.all((Array.isArray(input.products)?input.products:[]).map(async value=>{
      const product=bodyRecord(value);return {...product,productName:await findCachedName(entry.scope,product.productId)??'Producto',
        totalQuantity:Number(product.quantityPerApplication??0)*Number(input.applicationCount??1)};})),
    operators:input.operators??current?.operators??[],activities:input.activities??current?.activities??[]};
  if(entry.path.startsWith('/reproduction/')&&entry.temporaryId){
    const pregnancyId=input.pregnancyId;
    let pregnancy:Record<string,unknown>|null=null;
    for(const cached of await listCache(entry.scope)){if(cached.path==='/reproduction')pregnancy=findRecord(cached.payload,String(pregnancyId));}
    const cowId=input.cowId??pregnancy?.cowId;
    return {...common,cowId,cowName:await findCachedName(entry.scope,cowId)??pregnancy?.cowName??'Vaca',
      motherId:cowId,motherName:await findCachedName(entry.scope,cowId)??pregnancy?.cowName??'Vaca',
      heatId:input.heatId??null,serviceId:input.serviceId??null,bullId:input.bullId??null,
      fatherId:input.fatherId??null,externalFather:input.externalFather??null,cancelled:false,hasPregnancy:false,
      status:'CONFIRMED',endsOn:input.endsOn??null,notes:input.notes??null,
      calves:Array.isArray(input.calves)?input.calves.map((value,index)=>({...bodyRecord(value),id:`${id}-calf-${index}`})):[]};
  }
  return common;
}

async function cachedRecord(entry:OutboxEntry){
  const target=targetForMutation(entry.path);if(!target||entry.temporaryId)return null;
  const id=entityId(entry.path,null);
  const caches=(await listCache(entry.scope)).filter(cached=>cached.path===target.root
    ||cached.path.startsWith(`${target.root}?`)||cached.path.startsWith(`${target.root}/`));
  caches.sort((a,b)=>Number(b.path===`${target.root}/${id}`)-Number(a.path===`${target.root}/${id}`)
    ||b.savedAt-a.savedAt);
  if(entry.path.endsWith('/settings')||entry.path==='/animals/classification')return caches.length?bodyRecord(caches[0]!.payload):null;
  for(const cached of caches){const row=findRecord(cached.payload,id);if(row)return row;}
  return null;
}

function mediaAttachments(entry:OutboxEntry){
  const query=new URLSearchParams(entry.path.split('?')[1]);
  const ids=(query.get('animalIds')||query.get('entityId')||'').split(',').filter(Boolean);
  const file=entry.formParts[0]?.value;
  return ids.map((id,index)=>({id:index===0?entry.temporaryId:`${entry.temporaryId}-${index}`,
    storage_object_id:`local-object-${entry.id}`,entity_type:query.get('entityType'),entity_id:id,
    entity_name:null,relation_code:query.get('relationCode')??'GENERAL',description:query.get('description'),
    captured_on:query.get('capturedOn'),tags:[],kind:entry.requestHeaders?.['x-media-kind']??'IMAGE',
    byteSize:entry.binarySize??(file instanceof Blob?file.size:0),created_at:new Date(entry.createdAt).toISOString(),
    url:'',thumbnailUrl:null,local_media_id:entry.id,__syncState:entry.state,__mutationId:entry.id}));
}

async function hydrateLocalMedia<T>(scope:OfflineScope,value:T,path?:string):Promise<T>{
  if(path==='/health-records/options'){
    const routes=await getCache<unknown[]>(scope,'/catalogs/ADMINISTRATION_ROUTES/items');
    if(routes&&Array.isArray(routes.payload)){
      const options=bodyRecord(value);const stored=Array.isArray(options.administrationRoutes)?options.administrationRoutes:[];
      value={...options,administrationRoutes:[...new Map([...stored,...routes.payload].map(item=>[bodyRecord(item).id,item])).values()]} as T;
    }
  }
  const visit=async(value:unknown):Promise<unknown>=>{
    if(Array.isArray(value))return Promise.all(value.map(visit));
    if(!value||typeof value!=='object')return value;
    const row=value as Record<string,unknown>;const id=row.local_media_id;
    if(typeof row.profile_local_media_id==='string'){
      const photo=await visit({local_media_id:row.profile_local_media_id,kind:'IMAGE'}) as Record<string,unknown>;
      return {...row,profilePhotoUrl:photo.url??row.profilePhotoUrl};
    }
    if(typeof id==='string'){
      const key=`${scope.userId}:${id}`;
      let url=mediaUrls.get(key);
      if(!url){const local=await getLocalMedia(scope.userId,id);
        if(local){url=URL.createObjectURL(local.file);mediaUrls.set(key,url);}}
      if(url)return {...row,url,thumbnailUrl:row.kind==='IMAGE'?url:row.thumbnailUrl};
    }
    return Object.fromEntries(await Promise.all(Object.entries(row).map(async([key,item])=>[key,await visit(item)])));
  };
  return await visit(value) as T;
}

async function projectMedia(entry:OutboxEntry,canonical?:Record<string,unknown>[]){
  const all=await listCache(entry.scope);
  const caches=all.filter(cache=>cache.path==='/media'||cache.path.startsWith('/media?'));
  const upload=entry.bodyType==='binary'&&entry.method==='POST';
  const editing=entry.method==='PATCH'&&entry.path.startsWith('/media/objects/');
  const objectId=entityId(entry.path,null);
  let incoming=canonical??(upload?mediaAttachments(entry):[]);
  if(editing&&!canonical){
    const input=bodyRecord(entry.jsonBody);
    const originals=[...new Map(caches.flatMap(cache=>Array.isArray(cache.payload)?cache.payload:[])
      .map(value=>bodyRecord(value)).filter(row=>row.storage_object_id===objectId).map(row=>[row.id,row])).values()];
    const ids=Array.isArray(input.animalIds)?input.animalIds.map(String):[];
    const tags=await Promise.all((Array.isArray(input.tagIds)?input.tagIds:[]).map(async id=>({id,
      name:await findCachedName(entry.scope,id)??'Etiqueta'})));
    incoming=originals.filter(row=>row.entity_type!=='ANIMAL'||row.relation_code!=='GENERAL'||ids.includes(String(row.entity_id)))
      .map(row=>({...row,description:input.description,captured_on:input.capturedOn,tags,
        __syncState:entry.state,__mutationId:entry.id}));
    for(const id of ids)if(!incoming.some(row=>row.entity_type==='ANIMAL'&&row.entity_id===id)&&originals[0])
      incoming.push({...originals[0],id:`offline-${entry.id}-${id}`,entity_type:'ANIMAL',entity_id:id,
        entity_name:await findCachedName(entry.scope,id)??'Animal',relation_code:'GENERAL',
        description:input.description,captured_on:input.capturedOn,tags,__syncState:entry.state,__mutationId:entry.id});
  }
  if(upload||editing){
    for(const row of incoming){const path=`/media?${new URLSearchParams({entityType:String(row.entity_type),entityId:String(row.entity_id)})}`;
      if(!caches.some(cache=>cache.path===path)){
        const previous=await derivedCache<unknown[]>(entry.scope,path)??[];
        await putCache(entry.scope,path,previous);
        const cache=await getCache(entry.scope,path);if(cache)caches.push(cache);
      }
    }
  }
  for(const cache of caches){
    const query=new URLSearchParams(cache.path.split('?')[1]);
    let rows=(Array.isArray(cache.payload)?cache.payload:[]) as Record<string,unknown>[];
    if(entry.method==='DELETE'){
      const id=entityId(entry.path,null);
      const deleted=rows.filter(row=>entry.path.startsWith('/media/objects/')?row.storage_object_id===id:row.id===id);
      for(const photo of deleted.filter(row=>row.relation_code==='PROFILE'&&row.entity_type==='ANIMAL')){
        const animalEntry={...entry,method:'PATCH',path:`/animals/${photo.entity_id}`,temporaryId:null};
        const animal=await cachedRecord(animalEntry);
        if(!photo.local_media_id||animal?.profile_local_media_id===photo.local_media_id)
          await projectEntry(animalEntry,{id:photo.entity_id,profilePhotoUrl:null,profile_local_media_id:null},false);
      }
      rows=rows.filter(row=>entry.path.startsWith('/media/objects/')?row.storage_object_id!==id:row.id!==id);
    }else if(upload||editing){
      const relevant=incoming.filter(row=>(!query.get('entityType')||row.entity_type===query.get('entityType'))
        &&(!query.get('entityId')||row.entity_id===query.get('entityId')));
      rows=rows.filter(row=>row.__mutationId!==entry.id&&!relevant.some(next=>next.id===row.id)
        &&(!editing||row.storage_object_id!==objectId));
      for(const next of relevant){
        if(['PROFILE','COVER'].includes(String(next.relation_code)))rows=rows.filter(row=>
          !(row.entity_id===next.entity_id&&row.entity_type===next.entity_type&&row.relation_code===next.relation_code));
      }
      rows=[...relevant,...rows];
    }
    await putCache(entry.scope,cache.path,rows,cache.etag);
  }
  if((upload||editing)&&incoming.some(row=>row.relation_code==='PROFILE')){
    const hydrated=await hydrateLocalMedia(entry.scope,incoming);
    for(const photo of hydrated.filter(row=>row.relation_code==='PROFILE')){
      const animalEntry={...entry,path:`/animals/${photo.entity_id}`,temporaryId:null};
      await projectEntry(animalEntry,{id:photo.entity_id,profilePhotoUrl:photo.url,
        profile_local_media_id:photo.local_media_id},false);
    }
  }
}

function targetForMutation(path:string){
  const rules:Array<[RegExp,string,string|null]>=[
    [/^\/animals\/classification$/,'/animals/classification',null],
    [/^\/reproduction\/settings$/,'/reproduction/settings',null],
    [/^\/cleanings\/products(?:\/|$)/,'/cleanings/products',null],
    [/^\/catalogs\/products(?:\/|$)/,'/catalogs/products',null],
    [/^\/reproduction\/heats(?:\/|$)/,'/reproduction','heats'],
    [/^\/reproduction\/services(?:\/|$)/,'/reproduction','services'],
    [/^\/reproduction\/pregnancies(?:\/|$)/,'/reproduction','pregnancies'],
    [/^\/reproduction\/births(?:\/|$)/,'/reproduction','births'],
    [/^\/reproduction\/losses(?:\/|$)/,'/reproduction','losses'],
    [/^\/production\/lactations(?:\/|$)/,'/production','lactations'],
    [/^\/production\/cows(?:\/|$)/,'/production','cows'],
    [/^\/production\/milk(?:\/|$)/,'/production','milk'],
    [/^\/production\/tanks(?:\/|$)/,'/production','tanks'],
    [/^\/health-records\/conditions(?:\/|$)/,'/health-records/conditions',null],
    [/^\/health-records\/campaigns(?:\/|$)/,'/health-records/campaigns',null],
    [/^\/health-records\/medicines(?:\/|$)/,'/health-records/medicines',null],
    [/^\/catalogs\/medicines(?:\/|$)/,'/catalogs/medicines',null],
    [/^\/catalogs\/[^/]+\/items(?:\/|$)/,'$CATALOG_ITEMS',null],
    [/^\/finances\/(property|personal)\/accounts(?:\/|$)/,'$MATCH_ACCOUNTS',null],
    [/^\/finances\/(property|personal)\/movements(?:\/|$)/,'$MATCH_MOVEMENTS',null],
  ];
  for(const [pattern,target,field] of rules){
    const match=path.match(pattern);if(!match)continue;
    if(target==='$MATCH_ACCOUNTS')return {root:`/finances/${match[1]}/accounts`,field};
    if(target==='$MATCH_MOVEMENTS')return {root:`/finances/${match[1]}/movements`,field};
    if(target==='$CATALOG_ITEMS')return {root:path.split('/').slice(0,4).join('/'),field};
    return {root:target,field};
  }
  const segments=path.split('?')[0]!.split('/').filter(Boolean);
  if(!segments.length)return null;
  const root=`/${segments[0]}`;
  return {root,field:null};
}

function entityId(path:string,temporary:string|null){
  if(temporary)return temporary;
  const parts=path.split('?')[0]!.split('/').filter(Boolean);
  const action=new Set(['apply','cancel','resolve','finish','void','action','milking','state','description',
    'catalogs','owners','brands','parents']);
  const tail=parts.at(-1)??'';
  return decodeURIComponent(action.has(tail)?parts.at(-2)??'':tail);
}

function actionPatch(path:string,body:Record<string,unknown>){
  if(/^\/reproduction\/(heats|services)\/[^/]+\/cancel$/.test(path))return {cancelled:true};
  if(/^\/reproduction\/pregnancies\/[^/]+\/cancel$/.test(path))return {status:'CANCELLED'};
  if(path.startsWith('/activities/')&&path.endsWith('/apply'))return {status:'COMPLETADA',appliedAt:new Date().toISOString()};
  if(path.startsWith('/activities/')&&path.endsWith('/cancel'))return {status:'CANCELADA',cancelledAt:new Date().toISOString()};
  if(path.startsWith('/cleanings/')&&path.endsWith('/apply'))return {status:'COMPLETADO',completedAt:new Date().toISOString()};
  if(path.endsWith('/action'))return body.action==='COMPLETE'?{status:'COMPLETED'}:
    body.action==='CANCEL'?{status:'CANCELLED'}:{myResponse:body.action==='ACCEPT'?'ACCEPTED':'DECLINED'};
  if(path.endsWith('/apply'))return {status:'COMPLETADO',appliedAt:new Date().toISOString()};
  if(path.endsWith('/cancel'))return {status:'CANCELADO',cancelledAt:new Date().toISOString(),
    cancellationReason:body.reason??null};
  if(path.endsWith('/resolve'))return {status:'RESUELTA',resolvedOn:body.resolvedOn??null};
  if(path.endsWith('/finish'))return {endedOn:body.endedOn??null,inMilking:false};
  if(path.endsWith('/void'))return {voidedAt:new Date().toISOString()};
  if(path.endsWith('/milking'))return {inMilking:Boolean(body.inMilking)};
  if(path.endsWith('/state'))return {active:Boolean(body.active)};
  return {};
}

function updateCollection(value:unknown,id:string,record:Record<string,unknown>,create:boolean,
  field:string|null):unknown{
  if(field&&value&&typeof value==='object'&&!Array.isArray(value)){
    const object=value as Record<string,unknown>;const rows=Array.isArray(object[field])?object[field] as unknown[]:[];
    return {...object,[field]:updateCollection(rows,id,record,create,null)};
  }
  if(Array.isArray(value)){
    const exists=value.some(item=>bodyRecord(item).id===id);
    if(create&&!exists)return [record,...value];
    return value.map(item=>bodyRecord(item).id===id?{...bodyRecord(item),...record}:item);
  }
  if(value&&typeof value==='object'){
    const object=value as Record<string,unknown>;
    if(Array.isArray(object.items))return {...object,items:updateCollection(object.items,id,record,create,null),
      total:create&&!object.items.some(item=>bodyRecord(item).id===id)?Number(object.total??object.items.length)+1:object.total};
    if(object.id===id)return {...object,...record};
  }
  return value;
}

function findRecord(value:unknown,id:string):Record<string,unknown>|null{
  if(Array.isArray(value)){for(const item of value){const found=findRecord(item,id);if(found)return found;}return null;}
  if(!value||typeof value!=='object')return null;
  const object=value as Record<string,unknown>;if(object.id===id)return object;
  for(const item of Object.values(object)){const found=findRecord(item,id);if(found)return found;}
  return null;
}

async function projectMovementAnimals(entry:OutboxEntry,movementId:string){
  if(!entry.path.endsWith('/apply'))return;
  const entries=await listCache(entry.scope);
  let movement:Record<string,unknown>|null=null;
  for(const cached of entries.filter(item=>item.path==='/movements')){
    movement=findRecord(cached.payload,movementId);if(movement)break;
  }
  if(!movement)return;
  const animals=Array.isArray(movement.animals)?movement.animals.map(bodyRecord):[];
  const byId=new Map(animals.map(animal=>[String(animal.id),animal]));
  const syncState=movement.__syncState??null;
  const syncError=movement.__syncError??null;
  const leavesProperty=['PROPIEDAD','COMBINADO'].includes(String(movement.kind))&&
    movement.destinationPropertyId!==entry.scope.propertyId;
  for(const cached of entries.filter(item=>item.path.startsWith('/animals?')||/^\/animals\/[^/]+$/.test(item.path))){
    const patch=(value:unknown):unknown=>{
      if(Array.isArray(value))return value.flatMap(item=>{
        const row=bodyRecord(item);const destination=byId.get(String(row.id));
        if(!destination)return [item];
        if(leavesProperty)return syncState?[{...row,__syncState:syncState,__syncError:syncError,
          __pendingPropertyTransfer:true}]:[];
        return [{...row,group:{id:destination.destinationGroupId,
          name:movement?.destinationGroupName??'Grupo'},location:destination.destinationLocationId
            ?{id:destination.destinationLocationId,name:movement?.destinationLocationName??'Ubicación',kind:'PASTURE'}:null,
          __syncState:syncState,__syncError:syncError}];
      });
      if(value&&typeof value==='object'){
        const object=value as Record<string,unknown>;
        if(Array.isArray(object.items)){const next=patch(object.items) as unknown[];
          return {...object,items:next,total:leavesProperty?Math.max(0,Number(object.total??next.length)-
            (object.items.length-next.length)):object.total};}
        const destination=byId.get(String(object.id));
        if(destination&&leavesProperty&&syncState)return {...object,__syncState:syncState,
          __syncError:syncError,__pendingPropertyTransfer:true};
        if(destination&&leavesProperty)return {...object,__syncState:null,__syncError:null,
          __pendingPropertyTransfer:false};
        if(destination&&!leavesProperty)return {...object,group:{id:destination.destinationGroupId,
          name:movement?.destinationGroupName??'Grupo'},location:destination.destinationLocationId
            ?{id:destination.destinationLocationId,name:movement?.destinationLocationName??'Ubicación',kind:'PASTURE'}:null,
          __syncState:syncState,__syncError:syncError};
      }
      return value;
    };
    await putCache(entry.scope,cached.path,patch(cached.payload),cached.etag);
  }
}

async function projectTreatedConditions(entry:OutboxEntry,campaignId:string,record:Record<string,unknown>){
  if(!entry.path.endsWith('/apply'))return;
  const entries=await listCache(entry.scope);let campaign=record;
  if(!Array.isArray(campaign.animals)){
    for(const cached of entries.filter(item=>item.path==='/health-records/campaigns')){
      const found=findRecord(cached.payload,campaignId);if(found){campaign=found;break;}
    }
  }
  const conditionIds=new Set((Array.isArray(campaign.animals)?campaign.animals:[]).map(bodyRecord)
    .filter(animal=>animal.selected!==false&&typeof animal.conditionId==='string')
    .map(animal=>String(animal.conditionId)));
  if(!conditionIds.size)return;
  for(const cached of entries.filter(item=>item.path==='/health-records/conditions')){
    let payload=cached.payload;
    for(const id of conditionIds){const current=findRecord(payload,id);
      const mutationIds=Array.isArray(current?.__treatmentMutationIds)
        ?current.__treatmentMutationIds.map(String):[];
      const alreadyProjected=mutationIds.includes(entry.id);
      payload=updateCollection(payload,id,{status:'EN_TRATAMIENTO',
        treatmentCount:Number(current?.treatmentCount??0)+(alreadyProjected?0:1),
        __treatmentMutationIds:alreadyProjected?mutationIds:[...mutationIds,entry.id],
        __syncState:campaign.__syncState??null,__syncError:campaign.__syncError??null},false,null);}
    await putCache(entry.scope,cached.path,payload,cached.etag);
  }
}

async function projectEntry(entry:OutboxEntry,record:Record<string,unknown>,create:boolean,
  replacementId?:string){
  if(['/health-records/medicines','/health-records/medicines/structured','/health-records/medicines/classification','/catalogs/medicines','/catalogs/medicines/classification'].includes(entry.path)
    ||entry.method==='PATCH'&&/^\/catalogs\/medicines\/[^/]+$/.test(entry.path)){
    const alias=entry.path.startsWith('/health-records/medicines')?'/catalogs/medicines':'/health-records/medicines';
    await projectCatalogAlias(entry,record,create,replacementId,alias);
  }
  if(/^\/(?:cleanings|catalogs)\/products(?:\/|$)/.test(entry.path)){
    const alias=entry.path.startsWith('/cleanings/')?'/catalogs/products':'/cleanings/products';
    await projectCatalogAlias(entry,record,create,replacementId,alias);
  }
  if(entry.path.split('?')[0]==='/media'||entry.path.startsWith('/media/')){
    if(entry.path!=='/media/usage')await projectMedia(entry,Array.isArray(record.attachments)?record.attachments.map(bodyRecord):undefined);return;
  }
  const target=targetForMutation(entry.path);if(!target)return;
  const originalId=entityId(entry.path,entry.temporaryId);
  const id=replacementId??String(record.id??originalId);
  const entries=await listCache(entry.scope);
  if(entry.path.endsWith('/settings')||entry.path==='/animals/classification'){
    await putCache(entry.scope,entry.path,record);return;
  }
  if(create&&!entries.some(cache=>cache.path===target.root||cache.path.startsWith(`${target.root}?`))){
    const payload=target.field?{[target.field]:[record]}:target.root==='/animals'
      ?{items:[record],page:1,hasMore:false,total:1}:[record];
    await putCache(entry.scope,target.root==='/animals'?'/animals?page=1':target.root,payload);
  }
  for(const cached of entries){
    if(!(cached.path===target.root||cached.path.startsWith(`${target.root}?`)||
      cached.path===`${target.root}/${originalId}`))continue;
    const query=new URLSearchParams(cached.path.split('?')[1]);
    const insert=create&&[...query.keys()].every(key=>key==='page'||key==='search'&&!query.get('search'))
      &&(!query.get('page')||query.get('page')==='1');
    let payload=entry.method==='DELETE'?removeCollection(cached.payload,originalId,target.field)
      :updateCollection(cached.payload,originalId,{...record,id},insert,target.field);
    if(replacementId&&replacementId!==originalId){
      payload=updateCollection(payload,replacementId,{...record,id:replacementId},false,target.field);
      payload=JSON.parse(JSON.stringify(payload).replaceAll(originalId,replacementId)) as unknown;
    }
    await putCache(entry.scope,cached.path,payload,cached.etag);
  }
  if(entry.path==='/animals'&&entry.temporaryId)await putCache(entry.scope,`/animals/${id}`,record);
  if(entry.path.startsWith('/movements/'))await projectMovementAnimals(entry,replacementId??originalId);
  if(entry.path.startsWith('/health-records/campaigns/'))
    await projectTreatedConditions(entry,replacementId??originalId,record);
}
async function projectCatalogAlias(entry:OutboxEntry,record:Record<string,unknown>,create:boolean,replacementId:string|undefined,path:string){
  const id=entry.temporaryId??String(record.id);const cached=await getCache(entry.scope,path);
  let payload=entry.method==='DELETE'?removeCollection(cached?.payload??[],id,null)
    :updateCollection(cached?.payload??[],id,{...record,id:replacementId??record.id},create,null);
  if(replacementId&&replacementId!==id)payload=JSON.parse(JSON.stringify(payload).replaceAll(id,replacementId));
  await putCache(entry.scope,path,payload,cached?.etag);
}

function removeCollection(value:unknown,id:string,field:string|null):unknown{
  if(Array.isArray(value))return value.filter(row=>bodyRecord(row).id!==id);
  const object=bodyRecord(value);
  if(field)return {...object,[field]:removeCollection(object[field],id,null)};
  if(Array.isArray(object.items)){
    const items=removeCollection(object.items,id,null) as unknown[];
    return {...object,items,total:Math.max(0,Number(object.total??object.items.length)-(object.items.length-items.length))};
  }
  return object.id===id?null:value;
}

async function projectWithUndo(entry:OutboxEntry,rebaseVersion=false){
  const input=bodyRecord(entry.jsonBody);
  const current=await cachedRecord(entry);
  const conflict=!rebaseVersion&&typeof input.expectedVersion==='number'&&typeof current?.version==='number'&&input.expectedVersion!==current.version;
  if(conflict){entry.state='FAILED';entry.errorCode='ANIMAL_VERSION_CONFLICT';entry.lastError='El registro cambió en el servidor. Revisa este cambio antes de enviarlo.';}
  if(rebaseVersion&&typeof input.expectedVersion==='number'){
    if(typeof current?.version==='number')entry.jsonBody={...input,expectedVersion:current.version};
  }
  const before=await listCache(entry.scope);
  await projectEntry(entry,{...await optimisticRecord(entry),...(conflict?{version:Number(current?.version)+1}:{}),
    __syncState:entry.state,__syncError:entry.lastError},Boolean(entry.temporaryId));
  const after=await listCache(entry.scope);
  // ponytail: snapshots copy changed query payloads; use record deltas if long queues consume too much storage.
  entry.undo=after.filter(row=>JSON.stringify(row.payload)!==JSON.stringify(before.find(old=>old.path===row.path)?.payload))
    .map(row=>{const old=before.find(item=>item.path===row.path);return {path:row.path,payload:old?.payload??null,etag:old?.etag??null,existed:Boolean(old)};});
  await putOutbox(entry);
}
async function restorePending(entries:OutboxEntry[]){
  for(const entry of [...entries].reverse())for(const saved of entry.undo??[]){
    if(saved.existed)await putCache(entry.scope,saved.path,saved.payload,saved.etag);
    else await removeCachedPaths(entry.scope,[saved.path]);
  }
}
async function rewindPendingFrom(entry:OutboxEntry){
  const later=(await listOutbox(entry.scope.userId)).filter(item=>sameScope(item.scope,entry.scope)&&item.createdAt>=entry.createdAt);
  await restorePending(later);
}

async function reprojectQueued(scope:OfflineScope,rebase=false,rebaseVersions=true){
  const entries=(await listOutbox(scope.userId)).filter(entry=>sameScope(entry.scope,scope));
  const replacements=await getSetting<Record<string,string>>(`temporary-ids:${scope.userId}`)??{};
  for(const original of entries){
    const entry={...original,path:replaceIds(original.path,replacements),jsonBody:replaceValues(original.jsonBody,replacements)};
    if(rebase){await projectWithUndo(entry,rebaseVersions);continue;}
    const optimistic=await optimisticRecord(entry);
    await projectEntry(entry,{...optimistic,__syncState:entry.state,
      __syncError:entry.lastError},Boolean(entry.temporaryId));
  }
}

function errorInfo(error:unknown){
  const value=error as {status?:number;code?:string;message?:string;retryAt?:number};
  if(value?.status===429)retryAt=Math.max(retryAt,value.retryAt&&value.retryAt>Date.now()?value.retryAt:Date.now()+60_000);
  return {status:Number(value?.status??0),code:String(value?.code??'REQUEST_FAILED'),
    message:value?.message??'No se pudo sincronizar el cambio.'};
}

async function rebuildBody(entry:OutboxEntry,replacements:Record<string,string>){
  const replace=(value:unknown):unknown=>{
    if(typeof value==='string')return replacements[value]??value;
    if(Array.isArray(value))return value.map(replace);
    if(value&&typeof value==='object'&&!(value instanceof Blob))return Object.fromEntries(
      Object.entries(value as Record<string,unknown>).map(([key,item])=>[key,replace(item)]));
    return value;
  };
  if(entry.bodyType==='json')return JSON.stringify(replace(entry.jsonBody));
  if(entry.bodyType==='binary'){
    const local=await getLocalMedia(entry.scope.userId,entry.id);
    if(local)return local.file;
    const legacy=entry.formParts[0]?.value;
    if(legacy instanceof Blob)return legacy;
    throw new OfflineUnavailableError('No se encontró el archivo guardado localmente.');
  }
  if(entry.bodyType==='form'){
    const data=new FormData();for(const part of entry.formParts){
      const value=typeof part.value==='string'?String(replace(part.value)):part.value;
      if(value instanceof Blob)data.append(part.name,value,part.filename);else data.append(part.name,value);
    }return data;
  }
  return undefined;
}

async function saveReplacement(userId:string,temporary:string,actual:string){
  const key=`temporary-ids:${userId}`;const current=await getSetting<Record<string,string>>(key)??{};
  await putSetting(key,{...current,[temporary]:actual});
}

function replaceIds(value:string,replacements:Record<string,string>){
  return Object.entries(replacements).reduce((value,[from,to])=>value.replaceAll(from,to),value);
}
function replaceValues(value:unknown,replacements:Record<string,string>):unknown{
  if(typeof value==='string')return replacements[value]??value;
  if(Array.isArray(value))return value.map(item=>replaceValues(item,replacements));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>
    [key,replaceValues(item,replacements)]));
  return value;
}
async function remapCachedReferences(scope:OfflineScope,from:string,to:string){
  for(const cache of await listCache(scope))await putCache(scope,replaceIds(cache.path,{[from]:to}),
    replaceValues(cache.payload,{[from]:to}),cache.etag);
}

async function sendEntry(entry:OutboxEntry){
  if(!transport||!activeToken)throw new OfflineUnavailableError('No hay una sesión disponible para sincronizar.');
  const replacements=await getSetting<Record<string,string>>(`temporary-ids:${entry.scope.userId}`)??{};
  const path=replaceIds(entry.path,replacements);
  if(entry.bodyType==='json')validateLocalMutation({...entry,path,jsonBody:replaceValues(entry.jsonBody,replacements)},null);
  const headers=new Headers({...entry.requestHeaders,authorization:`Bearer ${activeToken}`,'x-idempotency-key':entry.idempotencyKey});
  if(entry.bodyType==='json')headers.set('content-type','application/json');
  const result=entry.bodyType==='binary'&&entry.serverResult!==undefined?entry.serverResult:
    (await transport<unknown>(path,{method:entry.method,headers,body:await rebuildBody(entry,replacements),
      onUploadProgress:(loaded,total)=>{if(syncProgress){syncProgress={...syncProgress,loaded,bytes:total};void publishState();}}})).data;
  const actual=bodyRecord(result);
  const actualId=typeof actual.id==='string'?actual.id:null;
  if(entry.bodyType==='binary'){
    entry.serverResult=result;await putOutbox(entry);
    // Keep the file and idempotency key until the canonical attachments are cached.
    const query=new URLSearchParams(path.split('?')[1]);
    const ids=(query.get('animalIds')||query.get('entityId')||'').split(',');
    const rows:Record<string,unknown>[]=[];
    for(const id of ids){
      let response:OfflineTransportResponse<unknown[]>;
      try{response=await transport<unknown[]>(`/media?${new URLSearchParams({entityType:query.get('entityType')??'ANIMAL',entityId:id})}`,
        {headers:{authorization:`Bearer ${activeToken}`}});}
      catch{throw new OfflineUnavailableError('El archivo está enviado; se confirmará cuando el servidor vuelva a responder.');}
      rows.push(...response.data.map(bodyRecord).filter(row=>Array.isArray(actual.attachmentIds)&&actual.attachmentIds.includes(row.id)));
    }
    if(rows.length!==ids.length)throw new OfflineUnavailableError('La foto está enviada; falta confirmar sus datos.');
    await rewindPendingFrom(entry);
    const originals=mediaAttachments({...entry,path});
    for(const [index,row] of rows.entries()){
      const original=originals.find(item=>item.entity_id===row.entity_id)??originals[index]!;
      await saveReplacement(entry.scope.userId,String(original.id),String(row.id));
      await remapCachedReferences(entry.scope,String(original.id),String(row.id));
      await saveReplacement(entry.scope.userId,String(original.storage_object_id),String(row.storage_object_id));
      await remapCachedReferences(entry.scope,String(original.storage_object_id),String(row.storage_object_id));
    }
    await projectMedia({...entry,path},rows.map(row=>({...row,local_media_id:entry.id,__syncState:null,__mutationId:entry.id})));
  }else{
    if(path.startsWith('/media/objects/')&&entry.method==='PATCH'&&Array.isArray(actual.attachments)){
      const objectId=entityId(path,null);
      const rows=(await listCache(entry.scope)).flatMap(cache=>Array.isArray(cache.payload)?cache.payload:[])
        .map(bodyRecord).filter(row=>row.storage_object_id===objectId&&String(row.id).startsWith('offline-'));
      for(const row of rows){
        const saved=actual.attachments.map(bodyRecord).find(next=>next.entity_type===row.entity_type
          &&next.entity_id===row.entity_id&&next.relation_code===row.relation_code);
        if(saved&&row.id!==saved.id){await saveReplacement(entry.scope.userId,String(row.id),String(saved.id));
          await remapCachedReferences(entry.scope,String(row.id),String(saved.id));}
      }
    }
    await rewindPendingFrom(entry);
    const current=await cachedRecord({...entry,path,temporaryId:null});
    await projectEntry({...entry,path},{...current,...actual,__syncState:null,__mutationId:null},Boolean(entry.temporaryId),actualId??undefined);
  }
  if(entry.temporaryId&&actualId){
    await saveReplacement(entry.scope.userId,entry.temporaryId,actualId);
    await remapCachedReferences(entry.scope,entry.temporaryId,actualId);
  }
  await removeOutbox(entry.id);
  cacheGeneration+=1;
  await reprojectQueued(entry.scope,true);
  try{window.SGBAndroid?.confirmMirroredMutation?.(entry.id,entry.idempotencyKey);
    window.SGBAndroid?.removeMirroredMutation?.(entry.id);}catch{/* Solo Android. */}
  emit('sgb-v2-cache-updated',{path:entry.path,scopeKey:offlineScopeKey(entry.scope)});
  if(entry.bodyType==='binary'||entry.method==='DELETE')return result;
  return await cachedRecord({...entry,path:replaceIds(path,entry.temporaryId&&actualId?{[entry.temporaryId]:actualId}:{}),temporaryId:null})??result;
}

export function syncOfflineMutations():Promise<void>{
  if(Date.now()<retryAt)return Promise.resolve();
  if(syncTask)return syncTask;
  const operation=mutationChain.then(syncQueue);
  mutationChain=operation.catch(()=>{});
  syncTask=operation.finally(()=>{syncTask=null;});return syncTask;
}
async function syncQueue(){
  if(syncing||!activeScope||!activeToken||!transport||!isRuntimeOnline())return;
  syncing=true;await publishState();
  const original={...activeScope};
  try{
    const entries=await listOutbox(activeScope.userId);
    syncProgress={completed:0,total:entries.length,current:'Preparando cambios',loaded:0,bytes:0};await publishState();
    let serverScope={...original};
    for(const entry of entries){
      if(!activeScope||!sameScope(activeScope,original))break;
      if(entry.state==='FAILED')break;
      try{
        if(Boolean(entry.scope.supportMode)!==Boolean(original.supportMode))throw new OfflineUnavailableError(
          entry.scope.supportMode?'Vuelve a Dar soporte para sincronizar los cambios de soporte pendientes.'
            :'Finaliza el soporte para sincronizar tus cambios de usuario pendientes.');
        if(!sameScope(serverScope,entry.scope)&&entry.scope.propertyId&&entry.scope.roleId){
          await transport(entry.scope.supportMode?'/superadmin/support-context':'/auth/context',{
            method:'POST',headers:{authorization:`Bearer ${activeToken}`,'content-type':'application/json'},
            body:JSON.stringify(entry.scope.supportMode?{propertyId:entry.scope.propertyId,accountId:entry.scope.supportAccountId}
              :{propertyId:entry.scope.propertyId,roleId:entry.scope.roleId})});serverScope={...entry.scope};
        }
        syncProgress={...syncProgress!,current:entry.summary??await pendingChangeSummary(entry),loaded:0,bytes:entry.binarySize??0};await publishState();
        await sendEntry(entry);syncProgress={...syncProgress!,completed:syncProgress!.completed+1,loaded:0,bytes:0};await publishState();
      }catch(error){
        const info=errorInfo(error);entry.attempts+=1;entry.lastError=info.message;entry.errorCode=info.code;
        if(info.status>0&&info.status<500&&info.status!==429&&info.code!=='IDEMPOTENCY_IN_PROGRESS')entry.state='FAILED';
        await putOutbox(entry);
        if(entry.state==='FAILED')try{window.SGBAndroid?.removeMirroredMutation?.(entry.id);}catch{/* Solo Android. */}
        const optimistic=await optimisticRecord(entry);
        await projectEntry(entry,{...optimistic,__syncState:entry.state,__syncError:info.message},false);
        await reprojectQueued(entry.scope);
        break;
      }
    }
    if(activeScope&&sameScope(activeScope,original)&&!sameScope(serverScope,original)&&original.propertyId&&original.roleId){
      await transport(original.supportMode?'/superadmin/support-context':'/auth/context',{
        method:'POST',headers:{authorization:`Bearer ${activeToken}`,'content-type':'application/json'},
        body:JSON.stringify(original.supportMode?{propertyId:original.propertyId,accountId:original.supportAccountId}
          :{propertyId:original.propertyId,roleId:original.roleId})});
    }
  }finally{syncing=false;await publishState();}
}

export async function retryFailedMutations(){
  if(!activeScope)return;
  const entries=await listOutbox(activeScope.userId);
  for(const entry of entries){if(entry.state==='FAILED'){
    entry.state='PENDING';entry.lastError=null;entry.errorCode=null;await putOutbox(entry);
    const optimistic=await optimisticRecord(entry);await projectEntry(entry,optimistic,false);
  }}
  await publishState();await syncOfflineMutations();
}

function applyServerCache(scope:OfflineScope,path:string,payload:unknown,etag:string|null,generation:number){
  const operation=mutationChain.then(async()=>{
    if(generation!==cacheGeneration||!activeScope||!sameScope(scope,activeScope))return false;
    const entries=(await listOutbox(scope.userId)).filter(entry=>sameScope(entry.scope,scope));
    await restorePending(entries);const previous=await getCache(scope,path);
    await putCache(scope,path,preserveLocalMedia(previous?.payload,payload),etag);
    await reprojectQueued(scope,true,false);return true;
  });mutationChain=operation.catch(()=>{});return operation;
}

async function backgroundRefresh<T>(scope:OfflineScope,path:string,init:RequestInit){
  if(!transport||!canAutomaticallyDownload()||!selectedData(path)||downloadTask||Date.now()<retryAt)return;
  const key=offlineScopeKey(scope)+path;if(refreshing.has(key))return;refreshing.add(key);
  try{
  if((await listOutbox(scope.userId)).some(entry=>sameScope(scope,entry.scope)
    &&dataCategoryForPath(entry.path)===dataCategoryForPath(path)))return;
  const generation=cacheGeneration;
  try{
    const current=await getCache<T>(scope,path);
    const headers=new Headers(init.headers);
    if(current?.etag)headers.set('if-none-match',current.etag);
    const response=await transport<T>(path,{...init,headers,cache:'no-cache'});
    if(generation!==cacheGeneration||!canAutomaticallyDownload()||!selectedData(path)
      ||!activeScope||!sameScope(scope,activeScope))return;
    if(canAutomaticallyDownload()&&activeScope&&sameScope(scope,activeScope)){
      try{window.SGBAndroid?.downloadMedia?.(JSON.stringify(collectNativeMedia(
        [{path,payload:response.notModified&&current?current.payload:response.data}],downloadPreferences,scope.propertyId,true)));}catch{/* Solo Android. */}
    }
    if(response.notModified&&current){await putCache(scope,path,current.payload,response.etag??current.etag);return;}
    const fresh=response.data;
    if(JSON.stringify(current?.payload)!==JSON.stringify(fresh)){
      if(!await applyServerCache(scope,path,fresh,response.etag,generation))return;
      emit('sgb-v2-cache-updated',{path,scopeKey:offlineScopeKey(scope)});
    }else if(current)await putCache(scope,path,current.payload,response.etag??current.etag);
  }catch(reason){errorInfo(reason);/* El caché válido continúa siendo la fuente visible. */}
  }finally{refreshing.delete(key);}
}

async function derivedCache<T>(scope:OfflineScope,path:string):Promise<T|null>{
  if(path==='/cleanings/products'||path==='/catalogs/products'){
    const cached=await getCache<T>(scope,path==='/cleanings/products'?'/catalogs/products':'/cleanings/products');if(cached)return cached.payload;
  }
  if(path==='/health-records/medicines'||path==='/catalogs/medicines'){
    const alias=path==='/health-records/medicines'?'/catalogs/medicines':'/health-records/medicines';
    const cached=await getCache<T>(scope,alias);if(cached)return cached.payload;
  }
  const entries=await listCache(scope);
  const conditionTreatments=path.match(/^\/health-records\/conditions\/([^/]+)\/treatments$/);
  if(conditionTreatments){
    const condition=(entries.find(item=>item.path==='/health-records/conditions')?.payload as Array<Record<string,unknown>>|undefined)
      ?.find(item=>item.id===conditionTreatments[1]);
    const rows=(entries.find(item=>item.path==='/health-records/campaigns')?.payload as Array<Record<string,unknown>>|undefined)
      ?.filter(item=>item.status==='COMPLETADO'&&Array.isArray(item.animals)&&item.animals.some(value=>{
        const animal=bodyRecord(value);return animal.selected&&animal.conditionId===conditionTreatments[1];}));
    const count=rows?.reduce((total,item)=>total+(item.animals as Array<Record<string,unknown>>)
      .filter(animal=>animal.selected&&animal.conditionId===conditionTreatments[1]).length,0);
    if(condition&&rows&&count===condition.treatmentCount)return rows as T;
    return null;
  }
  if(path.startsWith('/animals?')){
    const query=new URLSearchParams(path.split('?')[1]??'');
    const merged=new Map<string,Record<string,unknown>>();
    const animalEntries=entries.filter(item=>item.path.startsWith('/animals?'));
    const baseEntries=animalEntries.filter(entry=>{
      const params=new URLSearchParams(entry.path.split('?')[1]??'');
      return !params.get('search')&&[...params.keys()].every(key=>key==='page'||key==='search');
    });
    const sources=(baseEntries.length?baseEntries:animalEntries).sort((left,right)=>{
      const leftPage=Number(new URLSearchParams(left.path.split('?')[1]??'').get('page')??1);
      const rightPage=Number(new URLSearchParams(right.path.split('?')[1]??'').get('page')??1);
      return leftPage-rightPage||left.savedAt-right.savedAt;
    });
    for(const entry of sources){
      const payload=bodyRecord(entry.payload);const items=Array.isArray(payload.items)?payload.items:[];
      for(const value of items){const row=bodyRecord(value);if(typeof row.id==='string')merged.set(row.id,row);}
    }
    let rows=[...merged.values()];if(!rows.length)return null;
    const normalize=(value:unknown)=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLocaleLowerCase('es');
    const search=normalize((query.get('search')??'').trim());
    const classification=query.get('classification')??'';
    if(search)rows=rows.filter(row=>normalize([row.name,row.earTagCode,row.description,row.primaryOwnerName,
      ...((Array.isArray(row.owners)?row.owners:[]).map(owner=>bodyRecord(owner).name)),
      ...((Array.isArray(row.brands)?row.brands:[]).map(brand=>bodyRecord(brand).name))].join(' ')).includes(search));
    if(classification)rows=rows.filter(row=>bodyRecord(row.classification).code===classification);
    const exactFilters:{query:string;field:string}[]=[{query:'sex',field:'sex'},{query:'status',field:'availabilityStatusCode'}];
    for(const filter of exactFilters){const value=query.get(filter.query);if(value)rows=rows.filter(row=>row[filter.field]===value);}
    const nestedFilters:Array<{query:string;field:string;many?:boolean}>=[
      {query:'groupId',field:'group'},{query:'locationId',field:'location'},
      {query:'ownerId',field:'owners',many:true},{query:'breedId',field:'breeds',many:true},
      {query:'colorId',field:'colors',many:true},{query:'brandId',field:'brands',many:true},
    ];
    for(const filter of nestedFilters){const value=query.get(filter.query);if(!value)continue;
      rows=rows.filter(row=>filter.many
        ?(Array.isArray(row[filter.field])?row[filter.field] as unknown[]:[]).some(item=>bodyRecord(item).id===value)
        :bodyRecord(row[filter.field]).id===value);}
    const birthFrom=query.get('birthFrom');const birthTo=query.get('birthTo');
    if(birthFrom)rows=rows.filter(row=>typeof row.birthDate==='string'&&row.birthDate>=birthFrom);
    if(birthTo)rows=rows.filter(row=>typeof row.birthDate==='string'&&row.birthDate<=birthTo);
    const page=Math.max(1,Number(query.get('page')??1));const limit=25;const start=(page-1)*limit;
    return {items:rows.slice(start,start+limit),page,hasMore:start+limit<rows.length,total:rows.length} as T;
  }
  const animal=path.match(/^\/animals\/([^/?]+)$/);
  if(animal){
    const id=decodeURIComponent(animal[1]!);
    for(const entry of entries.filter(item=>item.path.startsWith('/animals?'))){
      const row=(bodyRecord(entry.payload).items as unknown[]|undefined)?.find(item=>bodyRecord(item).id===id);
      if(row)return row as T;
    }
  }
  const queryRoot=path.split('?')[0];
  const candidates=entries.filter(item=>item.path.split('?')[0]===queryRoot);
  if(queryRoot==='/media'&&candidates.length){
    const query=new URLSearchParams(path.split('?')[1]??'');
    const rows=[...new Map(candidates.sort((a,b)=>a.savedAt-b.savedAt).flatMap(entry=>
        Array.isArray(entry.payload)?entry.payload:[]).map(row=>[bodyRecord(row).id,row])).values()];
    return rows.filter(row=>(!query.get('entityType')||bodyRecord(row).entity_type===query.get('entityType'))
      &&(!query.get('entityId')||bodyRecord(row).entity_id===query.get('entityId'))) as T;
  }
  if(candidates.length){
    const payload=candidates.sort((a,b)=>b.savedAt-a.savedAt)[0]!.payload;
    const animalId=new URLSearchParams(path.split('?')[1]??'').get('animalId');
    if(animalId&&(queryRoot==='/weighings'||queryRoot==='/animal-status')&&Array.isArray(payload))
      return payload.filter(item=>bodyRecord(item).animalId===animalId) as T;
    return payload as T;
  }
  return null;
}

export async function offlineRequest<T>(path:string,init:RequestInit,send:Transport):Promise<T>{
  if(path.startsWith('/auth/'))return (await send<T>(path,init)).data;
  if(method(init)==='GET')return performOfflineRequest<T>(path,init,send);
  const operation=mutationChain.then(()=>performOfflineRequest<T>(path,init,send));
  mutationChain=operation.catch(()=>{});return operation;
}

function preserveLocalMedia(previous:unknown,next:unknown):unknown{
  if(!Array.isArray(previous)||!Array.isArray(next)){
    const old=bodyRecord(previous),fresh=bodyRecord(next);
    return old.id===fresh.id&&old.profile_local_media_id?{...fresh,profile_local_media_id:old.profile_local_media_id}:next;
  }
  return next.map(value=>{const row=bodyRecord(value);const local=previous.map(bodyRecord).find(item=>item.id===row.id);
    return local?.local_media_id?{...row,local_media_id:local.local_media_id}:value;});
}

async function performOfflineRequest<T>(path:string,init:RequestInit,send:Transport):Promise<T>{
  installOfflineTransport(send);
  if(!activeScope||!authenticated(init)||path.startsWith('/auth/')||path.startsWith('/superadmin/'))return (await send<T>(path,init)).data;
  const verb=method(init);
  if(verb==='GET'){
    const requestScope={...activeScope};const generation=cacheGeneration;
    const saveAutomatically=canAutomaticallyDownload()&&selectedData(path);
    const cached=await getCache<T>(activeScope,path);
    if(path.split('?')[0]==='/media'){
      const media=await derivedCache<T>(activeScope,path);
      if(media!==null){if(saveAutomatically)void backgroundRefresh<T>(activeScope,path,init);return hydrateLocalMedia(activeScope,media);}
    }
    if(cached){if(saveAutomatically)void backgroundRefresh<T>(activeScope,path,init);return hydrateLocalMedia(activeScope,cached.payload as T,path);}
    const derived=await derivedCache<T>(activeScope,path);
    if(derived!==null){if(saveAutomatically)void backgroundRefresh<T>(activeScope,path,init);return hydrateLocalMedia(activeScope,derived,path);}
    if(!isRuntimeOnline())throw new OfflineUnavailableError('Este contenido todavía no se descargó para usarlo sin conexión.');
    const response=await send<T>(path,{...init,cache:'no-cache'});
    if(saveAutomatically&&canAutomaticallyDownload()&&selectedData(path)&&activeScope
      &&sameScope(requestScope,activeScope)&&generation===cacheGeneration){
      await applyServerCache(requestScope,path,response.data,response.etag,generation);
      try{window.SGBAndroid?.downloadMedia?.(JSON.stringify(collectNativeMedia([{path,payload:response.data}],
        downloadPreferences,activeScope.propertyId,true)));}
      catch{/* Solo Android. */}
    }
    return response.data;
  }
  if(!mutationAllowed(path,init))return (await send<T>(path,init)).data;

  const body=await storedBody(init.body);
  const queued=await listOutbox(activeScope.userId);
  if(path==='/cleanings'&&verb==='POST'&&queued.some(entry=>entry.path===path&&entry.method===verb
    &&entry.state==='PENDING'&&sameScope(entry.scope,activeScope!)&&JSON.stringify(entry.jsonBody)===JSON.stringify(body.jsonBody)))
    throw new LocalValidationError('Este borrador ya está guardado y pendiente de sincronizar. Ábrelo desde el listado para editarlo.');
  lastCreatedAt=queued.reduce((latest,entry)=>Math.max(latest,entry.createdAt+1),Math.max(Date.now(),lastCreatedAt+1));
  const requestHeaders:Record<string,string>={};
  const originalHeaders=new Headers(init.headers);
  for(const key of ['content-type','x-media-kind']){const value=originalHeaders.get(key);if(value)requestHeaders[key]=value;}
  const entry:OutboxEntry={id:crypto.randomUUID(),idempotencyKey:crypto.randomUUID(),scope:{...activeScope},
    path,method:verb,...body,requestHeaders,temporaryId:temporaryId(path,verb),state:'PENDING',attempts:0,
    createdAt:lastCreatedAt,lastError:null,errorCode:null};
  entry.summary=await pendingChangeSummary(entry);
  validateLocalMutation(entry,await cachedRecord(entry));
  const optimistic=await optimisticRecord(entry);
  if(entry.bodyType==='binary'){
    const part=entry.formParts[0]!;const file=part.value as Blob;
    entry.binarySize=file.size;entry.formParts=[{...part,value:entry.id}];
    await putMediaMutation(entry,{id:entry.id,userId:entry.scope.userId,file,filename:part.filename??'archivo'});
  }else await putOutbox(entry);
  cacheGeneration+=1;
  await projectWithUndo(entry);
  emit('sgb-v2-cache-updated',{path,scopeKey:offlineScopeKey(entry.scope)});await publishState();

  if(isRuntimeOnline()&&!syncing&&queued.length===0&&Date.now()>=retryAt){
    syncing=true;syncProgress={completed:0,total:1,current:entry.summary,loaded:0,bytes:entry.binarySize??0};await publishState();
    try{const result=await sendEntry(entry);syncProgress={...syncProgress,completed:1,loaded:0,bytes:0};await publishState();
      return result as T;
    }catch(error){
      const info=errorInfo(error);entry.attempts=1;entry.lastError=info.message;entry.errorCode=info.code;
      if(info.status>0&&info.status<500&&info.status!==429&&info.code!=='IDEMPOTENCY_IN_PROGRESS'){
        entry.state='FAILED';await putOutbox(entry);await projectEntry(entry,{...optimistic,
          __syncState:'FAILED',__syncError:info.message},false);
        try{window.SGBAndroid?.removeMirroredMutation?.(entry.id);}catch{/* Solo Android. */}
        await publishState();throw error;
      }
      await putOutbox(entry);await publishState();
    }finally{syncing=false;await publishState();}
  }
  return optimistic as T;
}

interface NativeMediaDownload {
  source:string;
  url:string;
  aliases:string[];
  categories:string[];
  propertyId:string|null;
  wifiOnly:boolean;
  name:string;
}

interface NativeMediaInfo {
  count?:number;
  bytes?:number;
  pending?:number;
  failed?:number;
}

function isRemoteMedia(value:unknown):value is string{
  return typeof value==='string'&&/^https?:\/\//i.test(value)&&(
    value.includes('/image/upload/')||value.includes('/video/upload/')||
    /\.(?:jpe?g|png|webp|gif|avif|heic|mp4|m4v|mov|webm)(?:[?#].*)?$/i.test(value));
}

export function collectNativeMedia(entries:{path:string;payload:unknown}[],preferences:DownloadPreferences,
  propertyId:string|null,wifiOnly=false){
  const candidates:Array<{source:string;kind:'IMAGE'|'VIDEO';category:string;identity:string;name:string;time:number;thumbnail:string|null}>=[];
  const add=(source:string,kind:'IMAGE'|'VIDEO',category:string,row:Record<string,unknown>,thumbnail:string|null=null)=>{
    if(preferences.photos[category]==='none'||!preferences.photos[category]||kind==='VIDEO'&&!preferences.videos)return;
    candidates.push({source,kind,category,identity:String(row.entity_id??row.animalId??row.id??source),
      name:String(row.entity_name??row.animalName??row.name??downloadCategoryLabel(category)),
      time:Date.parse(String(row.created_at??row.createdAt??''))||0,thumbnail});
  };
  const visit=(value:unknown,fallback:string,parent:Record<string,unknown>={},key='')=>{
    if(isRemoteMedia(value)){
      const category=/profile.*(?:photo|image).*url|profilePhotoUrl/i.test(key)?'profile':/cover.*url/i.test(key)?'cover':fallback;
      add(value,value.includes('/video/upload/')||/\.(mp4|mov|webm)(?:[?#]|$)/i.test(value)?'VIDEO':'IMAGE',category,parent);return;
    }
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){for(const item of value)visit(item,fallback,parent);return;}
    const row=value as Record<string,unknown>;
    if(isRemoteMedia(row.url)&&(row.kind==='IMAGE'||row.kind==='VIDEO')){
      const category=row.entity_type?photoCategoryForType(row.entity_type,row.relation_code):fallback;
      add(row.url,row.kind,category,row,isRemoteMedia(row.thumbnailUrl)?row.thumbnailUrl:null);
    }
    for(const [field,item] of Object.entries(row)){
      if(isRemoteMedia(row.url)&&(row.kind==='IMAGE'||row.kind==='VIDEO')&&(field==='url'||field==='thumbnailUrl'))continue;
      visit(item,fallback,row,field);
    }
  };
  for(const entry of entries)visit(entry.payload,photoCategoryForPath(entry.path));
  const latest=new Map<string,typeof candidates[number]>();
  for(const item of candidates)if(preferences.photos[item.category]==='latest'){
    const key=item.category+':'+item.identity;const previous=latest.get(key);
    if(!previous||item.time>previous.time)latest.set(key,item);
  }
  const downloads=new Map<string,NativeMediaDownload>();
  const remember=(source:string,url:string,item:typeof candidates[number],aliases:string[]=[])=>{
    const current=downloads.get(source);downloads.set(source,{source,url:current?.url??url,
      aliases:[...new Set([...(current?.aliases??[]),...aliases].filter(value=>value!==source))],
      categories:[...new Set([...(current?.categories??[]),item.category])],propertyId,wifiOnly,name:item.name});
  };
  for(const item of candidates){
    if(preferences.photos[item.category]==='latest'&&latest.get(item.category+':'+item.identity)!==item)continue;
    const type=item.kind==='VIDEO'?'VIDEO':'IMAGEN';
    remember(item.source,optimizedCloudinaryMediaUrl(item.source,type,'offline'),item,
      [optimizedCloudinaryMediaUrl(item.source,type,'display'),optimizedCloudinaryMediaUrl(item.source,type,'download')]);
    if(item.kind==='IMAGE'){const thumbnail=item.thumbnail??mediaThumbnailUrl(item.source);
      if(thumbnail!==item.source)remember(thumbnail,thumbnail,item);}
  }
  return [...downloads.values()];
}

function readNativeMediaInfo():NativeMediaInfo{
  try{return JSON.parse(window.SGBAndroid?.getMediaCacheInfo?.()??'{}') as NativeMediaInfo;}
  catch{return {};}
}

async function waitForNativeMedia(){
  if(!window.SGBAndroid?.getMediaCacheInfo)return;
  const deadline=Date.now()+12*60_000;
  while(Date.now()<deadline){
    const info=readNativeMediaInfo();
    await publishState();
    if(Number(info.pending??0)<=0){
      if(Number(info.failed??0)>0)throw new Error(
        `${Number(info.failed)} archivo(s) no pudieron guardarse para uso sin conexión.`);
      return;
    }
    await new Promise(resolve=>window.setTimeout(resolve,300));
  }
  throw new Error('La descarga de fotos y videos tardó demasiado. Intenta actualizar nuevamente.');
}

async function downloadNativeMedia(items:NativeMediaDownload[]){
  if(!items.length||!window.SGBAndroid?.downloadMedia)return;
  const unique=[...new Map(items.map(item=>[item.source,item])).values()];
  for(let index=0;index<unique.length;index+=30){
    window.SGBAndroid.downloadMedia(JSON.stringify(unique.slice(index,index+30)));
    await waitForNativeMedia();
  }
}

export function downloadPaths(paths:string[],options:{automatic?:boolean}={}):Promise<{downloaded:number;failed:number;errors:string[]}>{
  const key=JSON.stringify([activeScope,paths,Boolean(options.automatic)]);
  if(downloadTask)return downloadTask.key===key?downloadTask.promise:downloadTask.promise.catch(()=>undefined).then(()=>downloadPaths(paths,options));
  const promise=performDownloadPaths([...new Set(paths)],options).finally(()=>{downloadTask=null;});
  downloadTask={key,promise};return promise;
}
async function performDownloadPaths(paths:string[],options:{automatic?:boolean}){
  if(!activeScope||!activeToken||!transport||!isRuntimeOnline())throw new OfflineUnavailableError(
    'Conéctate a internet para descargar los datos.');
  if(Date.now()<retryAt)throw new Error(`El servidor pidió una pausa. Podrás sincronizar en ${Math.max(1,Math.ceil((retryAt-Date.now())/60_000))} minuto(s). Tus cambios siguen guardados en este dispositivo.`);
  const scope={...activeScope};const token=activeToken;
  if(options.automatic&&!canAutomaticallyDownload())return {downloaded:0,failed:0,errors:[]};
  const preferences=normalizeDownloadPreferences(downloadPreferences);
  let downloaded=0;let failed=0;let stop=false;const errors:string[]=[];const payloads:Array<{path:string;payload:unknown}>=[];
  for(const requestedPath of paths){
    let path=requestedPath;let more=true;let page=1;
    while(more){
      if(options.automatic&&!canAutomaticallyDownload())throw new Error('La descarga automática se pausó hasta volver a tener Wi-Fi.');
      if(!activeScope||!sameScope(activeScope,scope))throw new Error(
        'La sesión o propiedad cambió. Actualiza los datos de la propiedad seleccionada.');
      try{
        if(requestedPath.startsWith('/animals?')||requestedPath.startsWith('/media?')){
          const query=new URLSearchParams(requestedPath.split('?')[1]??'');query.set('page',String(page));
          path=`${requestedPath.split('?')[0]}?${query}`;
        }
        const generation=cacheGeneration;const current=await getCache(scope,path);
        const headers=new Headers({authorization:`Bearer ${token}`});
        if(current?.etag)headers.set('if-none-match',current.etag);
        const response=await transport(path,{headers,cache:'no-cache'});
        const payload=response.notModified&&current?current.payload:response.data;
        if(!await applyServerCache(scope,path,payload,response.etag??current?.etag??null,generation))throw new Error('Los datos cambiaron durante la descarga.');
        downloaded+=1;
        payloads.push({path,payload});
        const record=bodyRecord(payload);more=requestedPath.startsWith('/animals?')&&record.hasMore===true&&page<500
          ||requestedPath.startsWith('/media?')&&Array.isArray(payload)&&payload.length===500&&page<10000;
        page+=1;
      }catch(reason){const info=errorInfo(reason);failed+=1;more=false;
        errors.push(`${downloadCategoryLabel(dataCategoryForPath(path))}: ${info.message}${info.status===429
          ?` Tus cambios siguen guardados. Volveremos a intentar después de ${Math.max(1,Math.ceil((retryAt-Date.now())/60_000))} minuto(s).`:''}`);
        stop=info.status===429||info.status===401||info.status===0;
      }
    }
    if(stop)break;
  }
  if(!activeScope||!sameScope(activeScope,scope))throw new Error(
    'La sesión o propiedad cambió. Actualiza los datos de la propiedad seleccionada.');
  try{await downloadNativeMedia(collectNativeMedia(payloads,preferences,scope.propertyId,Boolean(options.automatic)));}
  finally{
    await reprojectQueued(scope);
    emit('sgb-v2-cache-updated',{scopeKey:offlineScopeKey(scope)});await publishState();
  }
  if(!downloaded&&failed)throw new Error(errors[0]);
  return {downloaded,failed,errors};
}

export async function runtimeState():Promise<OfflineRuntimeState>{
  if(!activeScope)return {online:isRuntimeOnline(),wifi:isRuntimeWifi(),automaticDownloads:false,preferences:downloadPreferences,pending:0,failed:0,syncing,
    cachedEntries:0,cachedBytes:0,mediaFiles:0,mediaBytes:0,mediaPending:0,mediaFailed:0,lastDownload:null,syncProgress};
  const [entries,size,local]=await Promise.all([listOutbox(activeScope.userId),getOfflineSize(activeScope),getLocalMediaInfo(activeScope.userId)]);
  const nativeMedia=readNativeMediaInfo();
  return {retryAt:retryAt>Date.now()?retryAt:0,online:isRuntimeOnline(),wifi:isRuntimeWifi(),automaticDownloads,preferences:downloadPreferences,pending:entries.filter(item=>item.state==='PENDING').length,
    failed:entries.filter(item=>item.state==='FAILED').length,syncing,syncProgress,cachedEntries:size.entries,
    cachedBytes:size.bytes,mediaFiles:Number(nativeMedia.count??0)+local.count,mediaBytes:Number(nativeMedia.bytes??0)+local.bytes,
    mediaPending:Number(nativeMedia.pending??0),mediaFailed:Number(nativeMedia.failed??0),lastDownload:size.savedAt};
}

export interface OfflineDataDetail {category:string;label:string;entries:number;bytes:number;protected:boolean}
export interface OfflineMediaDetail {id:string;name:string;bytes:number;mime:string;categories:string[];propertyIds:string[];local:boolean;protected:boolean}
export interface OfflineDetails {data:OfflineDataDetail[];media:OfflineMediaDetail[];changes:OutboxEntry[]}
async function pendingChangeSummary(entry:OutboxEntry){
  const query=new URLSearchParams(entry.path.split('?')[1]);const input=bodyRecord(entry.jsonBody);
  const media=entry.path.startsWith('/media');
  const ids=(query.get('animalIds')||query.get('entityId')||String(input.animalId??input.cowId??'')).split(',').filter(Boolean);
  if(entry.path.startsWith('/media/objects/')){
    const objectId=entry.path.split('/')[3];
    for(const cache of await listCache(entry.scope))if(Array.isArray(cache.payload))for(const value of cache.payload){
      const row=bodyRecord(value);if(row.storage_object_id===objectId&&typeof row.entity_id==='string')ids.push(row.entity_id);}
  }
  if(entry.path.startsWith('/animals/'))ids.push(entry.path.split('/')[2]!);
  const names=[...new Set((await Promise.all(ids.map(id=>findCachedName(entry.scope,id)))).filter(Boolean))];
  const row=await cachedRecord(entry);const name=names.join(', ')||String(input.name??row?.name??row?.title??'');
  const relation=query.get('relationCode');
  const action=media?(relation==='PROFILE'?'Actualización de foto de perfil':relation==='COVER'?'Actualización de foto de portada':
    entry.method==='DELETE'?'Eliminar archivo':entry.method==='PATCH'?'Editar información de foto':'Subida de foto o video'):
    `${entry.method==='POST'?'Crear':entry.method==='DELETE'?'Eliminar':'Actualizar'} ${downloadCategoryLabel(dataCategoryForPath(entry.path)).toLocaleLowerCase('es')}`;
  return `${action}${name?' · '+name:''}`;
}

export function pendingMutationFields(entry:OutboxEntry){
  if(entry.bodyType==='binary'){
    const query=new URLSearchParams(entry.path.split('?')[1]);
    return {description:query.get('description')??'',capturedOn:query.get('capturedOn')??'',relationCode:query.get('relationCode')??'GENERAL'};
  }
  return bodyRecord(entry.jsonBody);
}

async function managedPending(id:string,discard=false){
  if(!activeScope||syncing)throw new Error('Espera a que termine la sincronización.');
  const entries=await listOutbox(activeScope.userId);const entry=entries.find(item=>item.id===id);
  if(!entry)throw new Error('Este cambio ya se sincronizó o se descartó.');
  if(!discard&&!sameScope(activeScope,entry.scope))throw new Error('Selecciona la propiedad, el rol y el modo de este cambio antes de modificarlo.');
  if(entry.serverResult!==undefined)throw new Error('Este archivo ya se subió. Confirma su sincronización antes de modificarlo.');
  const dependencies=entries.filter(item=>{if(item.id===id)return false;const body=JSON.stringify([item.path,item.jsonBody,item.formParts.map(part=>part.value)]);
    return Boolean(entry.temporaryId&&body.includes(entry.temporaryId))||body.includes('local-object-'+entry.id);});
  if(discard&&dependencies.length)throw new Error('Otros cambios usan este dato. Corrige o descarta primero sus cambios relacionados.');
  return entry;
}
export function discardPendingMutation(id:string):Promise<void>{
  const operation=mutationChain.then(async()=>{
    const entry=await managedPending(id,true);reservePending(entry);cacheGeneration++;
    await rewindPendingFrom(entry);await removeOutbox(id);
    if(!entry.undo){
      const clean=(value:unknown):unknown=>{if(Array.isArray(value))return value.map(clean);if(!value||typeof value!=='object')return value;
        const row={...bodyRecord(value)};if(row.__mutationId===id){row.__syncState=null;row.__syncError=null;row.__mutationId=null;}
        if(row.profile_local_media_id===id){row.profilePhotoUrl=null;row.profile_local_media_id=null;}
        return Object.fromEntries(Object.entries(row).map(([key,item])=>[key,clean(item)]));};
      for(const cache of await listCache(entry.scope))await putCache(entry.scope,cache.path,clean(cache.payload),cache.etag);
      if(entry.temporaryId)await projectEntry({...entry,method:'DELETE',path:entry.bodyType==='binary'?`/media/objects/local-object-${id}`:entry.path},
        {id:entry.temporaryId},false);
    }
    try{window.SGBAndroid?.removeMirroredMutation?.(id);}catch{/* Solo Android. */}
    if(entry.bodyType==='binary'){await removeLocalMedia(id);const key=entry.scope.userId+':'+id;const url=mediaUrls.get(key);
      if(url)URL.revokeObjectURL(url);mediaUrls.delete(key);}
    await reprojectQueued(entry.scope,true);emit('sgb-v2-cache-updated');await publishState();
  });mutationChain=operation.catch(()=>{});return operation;
}
export function editPendingMutation(id:string,fields:Record<string,unknown>):Promise<void>{
  const operation=mutationChain.then(async()=>{
    const entry=await managedPending(id);cacheGeneration++;
    const original=bodyRecord(entry.jsonBody);const body={...original,...fields,
      ...(typeof original.expectedVersion==='number'?{expectedVersion:original.expectedVersion}:{})};
    let confirmed:Record<string,unknown>|null=null;
    if(entry.errorCode?.endsWith('VERSION_CONFLICT')&&entry.path.startsWith('/animals/')&&typeof original.expectedVersion==='number'){
      if(!isRuntimeOnline()||!transport||!activeToken)throw new Error('Conéctate para comprobar la versión actual del animal antes de corregir este conflicto.');
      confirmed=bodyRecord((await transport(`/animals/${entry.path.split('/')[2]}`,{headers:{authorization:`Bearer ${activeToken}`}})).data);
    }
    // A retry keeps the same key unless the user changes the payload.
    if(entry.bodyType==='binary'){
      const query=new URLSearchParams(entry.path.split('?')[1]);
      for(const key of ['description','capturedOn','relationCode'])if(Object.hasOwn(fields,key)){
        const value=String(fields[key]??'');if(value)query.set(key,value);else query.delete(key);}
      if(!['GENERAL','PROFILE','COVER'].includes(query.get('relationCode')??'GENERAL'))throw new Error('Elige una relación válida.');
      entry.path='/media?'+query;
    }else {const current=await cachedRecord(entry);validateLocalMutation({...entry,jsonBody:body},
      current&&typeof original.expectedVersion==='number'?{...current,version:original.expectedVersion}:current);}
    reservePending(entry);await rewindPendingFrom(entry);
    if(confirmed)await projectEntry({...entry,path:`/animals/${entry.path.split('/')[2]}`,method:'PATCH'},confirmed,false);
    if(entry.bodyType!=='binary')entry.jsonBody=body;
    entry.idempotencyKey=crypto.randomUUID();entry.state='PENDING';entry.lastError=null;entry.errorCode=null;entry.attempts=0;
    entry.summary=await pendingChangeSummary(entry);await putOutbox(entry);
    try{window.SGBAndroid?.removeMirroredMutation?.(id);}catch{/* Solo Android. */}
    await reprojectQueued(entry.scope,true);emit('sgb-v2-cache-updated');await publishState();
  });mutationChain=operation.catch(()=>{});return operation;
}
function reservePending(entry:OutboxEntry){
  if(window.SGBAndroid?.reservePendingMutation?.(entry.id,entry.idempotencyKey)===false)
    throw new Error('Android ya inició el envío de este cambio. Sincroniza para confirmar el resultado antes de modificarlo.');
}
export async function getOfflineDetails():Promise<OfflineDetails>{
  if(!activeScope)return {data:[],media:[],changes:[]};
  const scope={...activeScope};
  const [cache,changes,local]=await Promise.all([listCache(scope),listOutbox(scope.userId),listLocalMedia(scope.userId)]);
  const groups=new Map<string,OfflineDataDetail>();
  for(const entry of cache){const category=dataCategoryForPath(entry.path);const current=groups.get(category)??
    {category,label:downloadCategoryLabel(category),entries:0,bytes:0,protected:false};
    current.entries++;current.bytes+=new Blob([JSON.stringify(entry.payload)]).size;
    current.protected=changes.some(item=>sameScope(item.scope,scope)&&dataCategoryForPath(item.path)===category);
    groups.set(category,current);}
  let native:OfflineMediaDetail[]=[];
  try{const result=JSON.parse(window.SGBAndroid?.getMediaCacheDetails?.()??'{"items":[]}');
    native=(Array.isArray(result.items)?result.items:[]).map((item:OfflineMediaDetail)=>({...item,local:false,protected:false}));}
  catch{/* Las versiones anteriores de Android no exponen el detalle por archivo. */}
  return {data:[...groups.values()].sort((a,b)=>b.bytes-a.bytes),changes:await Promise.all(changes.map(async entry=>({...entry,summary:entry.summary??await pendingChangeSummary(entry)}))),
    media:[...native,...local.map(file=>({id:'local:'+file.id,name:file.filename,bytes:file.file.size,
      mime:file.file.type,categories:['local'],propertyIds:[],local:true,
      protected:changes.some(entry=>entry.id===file.id||entry.formParts.some(part=>part.value===file.id))}))]
      .sort((a,b)=>b.bytes-a.bytes)};
}
export async function removeDownloadedData(category:string){
  if(!activeScope)return;
  const scope={...activeScope};const changes=await listOutbox(scope.userId);
  if(changes.some(entry=>sameScope(entry.scope,scope)&&dataCategoryForPath(entry.path)===category))
    throw new Error('Sincroniza los cambios de esta categoría antes de eliminar sus datos descargados.');
  const cache=await listCache(scope);
  cacheGeneration++;
  await removeCachedPaths(scope,cache.filter(entry=>dataCategoryForPath(entry.path)===category).map(entry=>entry.path));
  emit('sgb-v2-cache-updated',{scopeKey:offlineScopeKey(scope)});await publishState();
}
export async function removeDownloadedMedia(ids:string[]){
  if(!activeScope)return;
  const userId=activeScope.userId;const details=await getOfflineDetails();
  const files=details.media.filter(file=>ids.includes(file.id));
  if(files.some(file=>file.protected))throw new Error('Estas fotos contienen cambios pendientes de enviar. Sincroniza primero.');
  cacheGeneration++;
  const native=files.filter(file=>!file.local).map(file=>file.id);
  if(native.length){if(!window.SGBAndroid?.removeMediaCacheFiles)throw new Error('Actualiza la app para eliminar archivos por categoría.');
    window.SGBAndroid.removeMediaCacheFiles(JSON.stringify(native));}
  const local=files.filter(file=>file.local).map(file=>file.id.slice(6));
  if(local.length){
    const caches=await listUserCache(userId);
    const remotePhotos=new Map<string,string>();
    for(const entry of caches)if(Array.isArray(entry.payload))for(const row of entry.payload as Record<string,unknown>[])
      if(typeof row.local_media_id==='string'&&isRemoteMedia(row.url))remotePhotos.set(row.local_media_id,row.url);
    const clean=(value:unknown):unknown=>{if(Array.isArray(value))return value.map(clean);
      if(!value||typeof value!=='object')return value;const row={...value} as Record<string,unknown>;
      if(typeof row.profile_local_media_id==='string'&&local.includes(row.profile_local_media_id)){
        row.profilePhotoUrl=remotePhotos.get(row.profile_local_media_id)??null;delete row.profile_local_media_id;}
      if(typeof row.local_media_id==='string'&&local.includes(row.local_media_id))delete row.local_media_id;
      return Object.fromEntries(Object.entries(row).map(([key,item])=>[key,clean(item)]));};
    for(const entry of caches){const payload=clean(entry.payload);if(JSON.stringify(payload)!==JSON.stringify(entry.payload)){
      const [user,property,role,mode]=entry.scopeKey.split(':').map(decodeURIComponent);
      await putCache({userId:user!,propertyId:property==='none'?null:property!,roleId:role==='none'?null:role!,
        ...(mode==='support'?{supportMode:true}:mode==='user'?{supportMode:false}:{})},entry.path,payload,entry.etag);}}
    for(const id of local){await removeLocalMedia(id);const key=userId+':'+id;const url=mediaUrls.get(key);
      if(url)URL.revokeObjectURL(url);mediaUrls.delete(key);}
  }
  emit('sgb-v2-cache-updated');await publishState();
}

async function publishState(){
  const state=await runtimeState();
  if(activeScope){
    let barrier=false;
    for(const entry of await listOutbox(activeScope.userId)){
      // ponytail: media relation IDs are remapped in WebView; extend the native worker before syncing these in background.
      barrier=barrier||Boolean(activeScope.supportMode)||Boolean(entry.scope.supportMode)||entry.state==='FAILED'||entry.bodyType==='binary'||entry.bodyType==='form'
        ||entry.method==='PATCH'&&entry.path.startsWith('/media/objects/');
      try{
        if(barrier)window.SGBAndroid?.removeMirroredMutation?.(entry.id);
        else window.SGBAndroid?.mirrorOfflineMutation?.(JSON.stringify(entry));
      }catch{/* IndexedDB mantiene la cola completa y los archivos locales. */}
    }
  }
  try{window.SGBAndroid?.setPendingMutations?.(state.pending+state.failed);}catch{/* Solo Android. */}
  emit('sgb-v2-offline-state',state);
}
