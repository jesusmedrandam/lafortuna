import {
  getCache,getOfflineSize,getSetting,listCache,listOutbox,offlineScopeKey,putCache,putOutbox,
  putSetting,removeOutbox,type OfflineScope,type OutboxEntry,type StoredFormPart,
} from './database';

export interface OfflineTransportResponse<T> {
  data:T;
  etag:string|null;
  notModified:boolean;
}

type Transport = <T>(path:string,init:RequestInit)=>Promise<OfflineTransportResponse<T>>;

export class OfflineUnavailableError extends Error {
  readonly status=0;
  readonly code='OFFLINE_DATA_UNAVAILABLE';
}

export interface OfflineRuntimeState {
  online:boolean;
  automaticDownloads:boolean;
  pending:number;
  failed:number;
  syncing:boolean;
  cachedEntries:number;
  cachedBytes:number;
  lastDownload:number|null;
}

const excludedMutationRoots=['/auth','/invitations','/property-team','/property-settings','/my-account',
  '/superadmin','/notifications','/audit'];
let activeScope:OfflineScope|null=null;
let activeToken:string|null=null;
let automaticDownloads=false;
let transport:Transport|null=null;
let syncing=false;
let apiBase='';

function emit(name:string,detail?:unknown){
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(name,{detail}));
}

function nativeOnline(){
  try{return window.SGBAndroid?.isOnline?.()??navigator.onLine;}catch{return navigator.onLine;}
}

export function isRuntimeOnline(){return nativeOnline();}

export function installOfflineTransport(value:Transport){transport=value;}
export function setOfflineApiBase(value:string){apiBase=value.replace(/\/$/,'');}

export async function configureOfflineRuntime(scope:OfflineScope|null,token:string|null){
  activeScope=scope;activeToken=token;
  automaticDownloads=scope?await getSetting<boolean>(`automatic-downloads:${scope.userId}`)??false:false;
  try{
    if(scope&&token)window.SGBAndroid?.configureOfflineSync?.(apiBase,token,scope.userId,
      scope.propertyId??'',scope.roleId??'');
    else window.SGBAndroid?.clearOfflineSyncSession?.();
  }catch{/* Solo Android. */}
  await publishState();
}

export async function setAutomaticDownloads(enabled:boolean){
  automaticDownloads=enabled;
  if(activeScope)await putSetting(`automatic-downloads:${activeScope.userId}`,enabled);
  await publishState();
}

function authenticated(init:RequestInit){return new Headers(init.headers).has('authorization');}
function method(init:RequestInit){return String(init.method??'GET').toUpperCase();}
function mutationAllowed(path:string,init:RequestInit){
  return authenticated(init)&&!excludedMutationRoots.some(root=>path===root||path.startsWith(`${root}/`));
}

function sameScope(left:OfflineScope,right:OfflineScope){return offlineScopeKey(left)===offlineScopeKey(right);}

async function storedBody(body:BodyInit|null|undefined){
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
    if((row.id===id||row.animalId===id||row.cowId===id||row.partyId===id)&&typeof row.name==='string')return row.name;
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
  const common={...input,id,version:Number(input.expectedVersion??0)+1,createdAt:now,
    ...actionPatch(entry.path,input),...pending};

  if(entry.path==='/animals')return {...common,description:input.description??null,
    earTagCode:input.earTagCode??null,birthDate:input.birthDate??null,entryDate:input.entryDate??now.slice(0,10),
    initialWeight:input.initialWeight??null,initialWeightUnitCode:input.initialWeightUnitCode??null,
    availabilityStatusCode:'ACTIVE',profilePhotoUrl:null,primaryOwnerName:null,classification:null,
    breed:null,breeds:[],colors:[],owners:[],brands:[],mother:null,father:null,group:null,location:null};
  if(entry.path==='/groups')return {...common,active:true,animalCount:0,location:null};
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
  return common;
}

function targetForMutation(path:string){
  const rules:Array<[RegExp,string,string|null]>=[
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
  const target=targetForMutation(entry.path);if(!target)return;
  const originalId=entityId(entry.path,entry.temporaryId);
  const id=replacementId??String(record.id??originalId);
  const entries=await listCache(entry.scope);
  for(const cached of entries){
    if(!(cached.path===target.root||cached.path.startsWith(`${target.root}?`)||
      cached.path.startsWith(`${target.root}/`)))continue;
    let payload=updateCollection(cached.payload,originalId,{...record,id},create,target.field);
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

async function reprojectQueued(scope:OfflineScope){
  const entries=(await listOutbox(scope.userId)).filter(entry=>sameScope(entry.scope,scope));
  for(const entry of entries){
    const optimistic=await optimisticRecord(entry);
    await projectEntry(entry,{...optimistic,__syncState:entry.state,
      __syncError:entry.lastError},Boolean(entry.temporaryId));
  }
}

function errorInfo(error:unknown){
  const value=error as {status?:number;code?:string;message?:string};
  return {status:Number(value?.status??0),code:String(value?.code??'REQUEST_FAILED'),
    message:value?.message??'No se pudo sincronizar el cambio.'};
}

function rebuildBody(entry:OutboxEntry,replacements:Record<string,string>){
  const replace=(value:unknown):unknown=>{
    if(typeof value==='string')return replacements[value]??value;
    if(Array.isArray(value))return value.map(replace);
    if(value&&typeof value==='object'&&!(value instanceof Blob))return Object.fromEntries(
      Object.entries(value as Record<string,unknown>).map(([key,item])=>[key,replace(item)]));
    return value;
  };
  if(entry.bodyType==='json')return JSON.stringify(replace(entry.jsonBody));
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

async function sendEntry(entry:OutboxEntry){
  if(!transport||!activeToken)throw new OfflineUnavailableError('No hay una sesión disponible para sincronizar.');
  const replacements=await getSetting<Record<string,string>>(`temporary-ids:${entry.scope.userId}`)??{};
  const path=Object.entries(replacements).reduce((value,[from,to])=>value.replaceAll(from,to),entry.path);
  const headers=new Headers({authorization:`Bearer ${activeToken}`,'x-idempotency-key':entry.idempotencyKey});
  if(entry.bodyType==='json')headers.set('content-type','application/json');
  const response=await transport<unknown>(path,{method:entry.method,headers,body:rebuildBody(entry,replacements)});
  const result=response.data;
  const actual=bodyRecord(result);
  const actualId=typeof actual.id==='string'?actual.id:null;
  if(entry.temporaryId&&actualId)await saveReplacement(entry.scope.userId,entry.temporaryId,actualId);
  await projectEntry(entry,{...actual,__syncState:null,__mutationId:null},false,actualId??undefined);
  await removeOutbox(entry.id);
  try{window.SGBAndroid?.removeMirroredMutation?.(entry.id);}catch{/* Solo Android. */}
  emit('sgb-v2-cache-updated',{path:entry.path,scopeKey:offlineScopeKey(entry.scope)});
  return result;
}

export async function syncOfflineMutations(){
  if(syncing||!activeScope||!activeToken||!transport||!isRuntimeOnline())return;
  syncing=true;await publishState();
  const original={...activeScope};
  try{
    const entries=(await listOutbox(activeScope.userId)).filter(entry=>entry.state==='PENDING');
    let serverScope={...original};
    for(const entry of entries){
      try{
        if(!sameScope(serverScope,entry.scope)&&entry.scope.propertyId&&entry.scope.roleId){
          await transport('/auth/context',{method:'POST',headers:{authorization:`Bearer ${activeToken}`,
            'content-type':'application/json'},body:JSON.stringify({propertyId:entry.scope.propertyId,
            roleId:entry.scope.roleId})});serverScope={...entry.scope};
        }
        await sendEntry(entry);
      }catch(error){
        const info=errorInfo(error);entry.attempts+=1;entry.lastError=info.message;entry.errorCode=info.code;
        if(info.status>0&&info.status<500&&info.code!=='IDEMPOTENCY_IN_PROGRESS')entry.state='FAILED';
        await putOutbox(entry);
        if(entry.state==='FAILED')try{window.SGBAndroid?.removeMirroredMutation?.(entry.id);}catch{/* Solo Android. */}
        const optimistic=await optimisticRecord(entry);
        await projectEntry(entry,{...optimistic,__syncState:entry.state,__syncError:info.message},false);
        break;
      }
    }
    if(!sameScope(serverScope,original)&&original.propertyId&&original.roleId){
      await transport('/auth/context',{method:'POST',headers:{authorization:`Bearer ${activeToken}`,
        'content-type':'application/json'},body:JSON.stringify({propertyId:original.propertyId,roleId:original.roleId})});
    }
  }finally{syncing=false;await publishState();}
}

export async function retryFailedMutations(){
  if(!activeScope)return;
  const entries=await listOutbox(activeScope.userId);
  for(const entry of entries){if(entry.state==='FAILED'){
    entry.state='PENDING';entry.lastError=null;entry.errorCode=null;await putOutbox(entry);
    if(entry.bodyType!=='form')try{window.SGBAndroid?.mirrorOfflineMutation?.(JSON.stringify(entry));}
    catch{/* La cola IndexedDB sigue siendo la fuente canónica. */}
    const optimistic=await optimisticRecord(entry);await projectEntry(entry,optimistic,false);
  }}
  await publishState();await syncOfflineMutations();
}

async function backgroundRefresh<T>(scope:OfflineScope,path:string,init:RequestInit){
  if(!transport||!isRuntimeOnline())return;
  try{
    const current=await getCache<T>(scope,path);
    const headers=new Headers(init.headers);
    if(current?.etag)headers.set('if-none-match',current.etag);
    const response=await transport<T>(path,{...init,headers,cache:'no-cache'});
    if(response.notModified&&current){await putCache(scope,path,current.payload,response.etag??current.etag);return;}
    const fresh=response.data;
    if(JSON.stringify(current?.payload)!==JSON.stringify(fresh)){
      await putCache(scope,path,fresh,response.etag);await reprojectQueued(scope);
      emit('sgb-v2-cache-updated',{path,scopeKey:offlineScopeKey(scope)});
    }else if(current)await putCache(scope,path,current.payload,response.etag??current.etag);
  }catch{/* El caché válido continúa siendo la fuente visible. */}
}

async function derivedCache<T>(scope:OfflineScope,path:string):Promise<T|null>{
  const entries=await listCache(scope);
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
  installOfflineTransport(send);
  if(!activeScope||!authenticated(init)||path.startsWith('/auth/'))return (await send<T>(path,init)).data;
  const verb=method(init);
  if(verb==='GET'){
    const cached=await getCache<T>(activeScope,path);
    if(cached){if(isRuntimeOnline())void backgroundRefresh<T>(activeScope,path,init);return cached.payload as T;}
    const derived=await derivedCache<T>(activeScope,path);
    if(derived!==null){if(isRuntimeOnline())void backgroundRefresh<T>(activeScope,path,init);return derived;}
    if(!isRuntimeOnline())throw new OfflineUnavailableError('Este contenido todavía no se descargó para usarlo sin conexión.');
    const response=await send<T>(path,{...init,cache:'no-cache'});
    if(automaticDownloads)await putCache(activeScope,path,response.data,response.etag);
    return response.data;
  }
  if(!mutationAllowed(path,init))return (await send<T>(path,init)).data;

  const body=await storedBody(init.body);
  const entry:OutboxEntry={id:crypto.randomUUID(),idempotencyKey:crypto.randomUUID(),scope:{...activeScope},
    path,method:verb,...body,temporaryId:temporaryId(path,verb),state:'PENDING',attempts:0,
    createdAt:Date.now(),lastError:null,errorCode:null};
  await putOutbox(entry);
  if(entry.bodyType!=='form')try{window.SGBAndroid?.mirrorOfflineMutation?.(JSON.stringify(entry));}
  catch{/* La cola IndexedDB sigue siendo la fuente canónica. */}
  const optimistic=await optimisticRecord(entry);
  await projectEntry(entry,optimistic,true);
  emit('sgb-v2-cache-updated',{path,scopeKey:offlineScopeKey(entry.scope)});await publishState();

  if(isRuntimeOnline()){
    try{const result=await sendEntry(entry);await publishState();
      return result as T;
    }catch(error){
      const info=errorInfo(error);entry.attempts=1;entry.lastError=info.message;entry.errorCode=info.code;
      if(info.status>0&&info.status<500&&info.code!=='IDEMPOTENCY_IN_PROGRESS'){
        entry.state='FAILED';await putOutbox(entry);await projectEntry(entry,{...optimistic,
          __syncState:'FAILED',__syncError:info.message},false);
        try{window.SGBAndroid?.removeMirroredMutation?.(entry.id);}catch{/* Solo Android. */}
        await publishState();throw error;
      }
      await putOutbox(entry);await publishState();
    }
  }
  return optimistic as T;
}

export async function downloadPaths(paths:string[]){
  if(!activeScope||!activeToken||!transport||!isRuntimeOnline())throw new OfflineUnavailableError(
    'Conéctate a internet para descargar los datos.');
  let downloaded=0;let failed=0;
  for(const requestedPath of paths){
    let path=requestedPath;let more=true;let page=1;
    while(more){
      try{
        if(requestedPath.startsWith('/animals?')){
          const query=new URLSearchParams(requestedPath.split('?')[1]??'');query.set('page',String(page));
          path=`/animals?${query}`;
        }
        const current=await getCache(activeScope,path);
        const headers=new Headers({authorization:`Bearer ${activeToken}`});
        if(current?.etag)headers.set('if-none-match',current.etag);
        const response=await transport(path,{headers,cache:'no-cache'});
        const payload=response.notModified&&current?current.payload:response.data;
        await putCache(activeScope,path,payload,response.etag??current?.etag??null);downloaded+=1;
        const record=bodyRecord(payload);more=requestedPath.startsWith('/animals?')&&record.hasMore===true&&page<500;
        page+=1;
      }catch{failed+=1;more=false;}
    }
  }
  await reprojectQueued(activeScope);
  emit('sgb-v2-cache-updated',{scopeKey:offlineScopeKey(activeScope)});await publishState();
  if(!downloaded&&failed)throw new Error('No fue posible descargar los datos de esta propiedad.');
  return {downloaded,failed};
}

export async function runtimeState():Promise<OfflineRuntimeState>{
  if(!activeScope)return {online:isRuntimeOnline(),automaticDownloads:false,pending:0,failed:0,syncing,
    cachedEntries:0,cachedBytes:0,lastDownload:null};
  const [entries,size]=await Promise.all([listOutbox(activeScope.userId),getOfflineSize(activeScope)]);
  return {online:isRuntimeOnline(),automaticDownloads,pending:entries.filter(item=>item.state==='PENDING').length,
    failed:entries.filter(item=>item.state==='FAILED').length,syncing,cachedEntries:size.entries,
    cachedBytes:size.bytes,lastDownload:size.savedAt};
}

async function publishState(){
  const state=await runtimeState();
  try{window.SGBAndroid?.setPendingMutations?.(state.pending+state.failed);}catch{/* Solo Android. */}
  emit('sgb-v2-offline-state',state);
}
