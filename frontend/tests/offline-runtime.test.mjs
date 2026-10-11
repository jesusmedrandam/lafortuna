import assert from 'node:assert/strict';
import {build} from 'vite';
import {fileURLToPath} from 'node:url';

// Exercise the real runtime/API with a durable structured-clone storage adapter.
// Browser IndexedDB and Android window insets still require a device smoke test.
const root=fileURLToPath(new URL('../',import.meta.url));
const state={cache:new Map(),settings:new Map(),outbox:new Map(),media:new Map()};
globalThis.__offlineTestDB=state;
const adapter=`
const db=globalThis.__offlineTestDB;
const clone=value=>structuredClone(value);
export const offlineScopeKey=s=>[s.userId,s.propertyId,s.roleId].join(':')+(s.supportMode===true?':support':s.supportMode===false?':user':'');
const key=(s,p)=>offlineScopeKey(s)+p;
export const getCache=async(s,p)=>clone(db.cache.get(key(s,p))??null);
export const putCache=async(s,p,payload,etag=null)=>db.cache.set(key(s,p),clone({path:p,payload,etag,scopeKey:offlineScopeKey(s),savedAt:Date.now()}));
export const listCache=async s=>clone([...db.cache.values()].filter(e=>e.scopeKey===offlineScopeKey(s)));
export const listUserCache=async user=>clone([...db.cache.values()].filter(e=>e.scopeKey.startsWith(user+':')));
export const removeCachedPaths=async(s,paths)=>{for(const p of paths)db.cache.delete(key(s,p));};
export const getSetting=async k=>clone(db.settings.get(k)??null);
export const putSetting=async(k,v)=>db.settings.set(k,clone(v));
export const listOutbox=async user=>clone([...db.outbox.values()].filter(e=>e.scope.userId===user).sort((a,b)=>a.createdAt-b.createdAt));
export const putOutbox=async e=>db.outbox.set(e.id,clone(e));
export const removeOutbox=async id=>db.outbox.delete(id);
export const getOfflineSize=async s=>({entries:(await listCache(s)).length,bytes:0,savedAt:Date.now()});
export const putLocalMedia=async v=>db.media.set(v.id,clone(v));
export const putMediaMutation=async(e,v)=>{db.media.set(v.id,clone(v));db.outbox.set(e.id,clone(e));};
export const getLocalMedia=async(user,id)=>{const v=db.media.get(id);return v?.userId===user?clone(v):null;};
export const getLocalMediaInfo=async user=>{const rows=[...db.media.values()].filter(v=>v.userId===user);return {count:rows.length,bytes:rows.reduce((n,v)=>n+v.file.size,0)};};
export const listLocalMedia=async user=>clone([...db.media.values()].filter(v=>v.userId===user));
export const removeLocalMedia=async id=>db.media.delete(id);
`;
const result=await build({root,configFile:false,logLevel:'error',plugins:[{
  name:'offline-test-storage',
  enforce:'pre',
  resolveId(id){if(id.endsWith('/database'))return '\0offline-test-database';},
  load(id){if(id==='\0offline-test-database')return adapter;},
}],build:{write:false,minify:false,lib:{entry:root+'tests/offline-entry.ts',formats:['es'],fileName:'test'},
  rolldownOptions:{output:{codeSplitting:false}}}});
const code=(Array.isArray(result)?result[0]:result).output.find(value=>value.type==='chunk').code;
let incarnation=0;
const load=()=>import('data:text/javascript;base64,'+Buffer.from(code).toString('base64')+'#'+incarnation++);
let online=false,wifi=false;
const mirrored=new Map();
globalThis.window=new EventTarget();
Object.assign(window,{setTimeout,clearTimeout,setInterval,clearInterval,SGBAndroid:{
  isOnline:()=>online,isWifiConnected:()=>wifi,configureOfflineSync(){},setAutomaticMediaDownloads(){},downloadMedia(){},
  mirrorOfflineMutation:text=>{const entry=JSON.parse(text);mirrored.set(entry.id,entry);},
  removeMirroredMutation:id=>mirrored.delete(id),getMediaCacheInfo:()=>'{"count":0,"bytes":0}'}});
let runtime=await load();
const scope={userId:'user-a',propertyId:'property-a',roleId:'editor'};
const headers={authorization:'Bearer test-token'};
const noNetwork=async()=>{throw new Error('Unexpected network access while offline');};
const get=path=>runtime.offlineRequest(path,{headers},noNetwork);
const change=(path,body,method='PATCH')=>runtime.offlineRequest(path,{method,headers,body:JSON.stringify(body)},noNetwork);
const animal={id:'animal-a',name:'Lucera',description:'Antes',version:1,sex:'FEMALE',speciesCode:'BOVINE',
  breeds:[{id:'breed-old',name:'Holstein'}],colors:[],brands:[{id:'brand-old',name:'Marca vieja'}],
  owners:[{id:'owner-old',name:'Dueño anterior',percent:100,isPrimary:true}],mother:null,father:null,
  group:{id:'group-a',name:'Vacas'},location:null,earTagCode:'A1',entryDate:'2026-01-01',birthDate:null};
await runtime.configureOfflineRuntime(scope,'test-token');
await assert.rejects(()=>change('/auth/password',{currentPassword:'Synthetic-current-2026',newPassword:'Synthetic-new-2026'},'POST'),/Unexpected network access/);
await assert.rejects(()=>change('/auth/profile',{displayName:'Perfil personal'}),/Unexpected network access/);
await assert.rejects(()=>change('/auth/email',{email:'new@example.test',currentPassword:'Synthetic-current-2026'},'POST'),/Unexpected network access/);
await assert.rejects(()=>change('/auth/sessions/session-a',{},'DELETE'),/Unexpected network access/);
assert.equal(state.outbox.size,0,'Account credentials and profile changes are never queued for offline synchronization');
await runtime.putCache(scope,'/health-records/conditions',[{id:'condition-a',treatmentCount:1}]);
await runtime.putCache(scope,'/health-records/campaigns',[{id:'campaign-a',status:'COMPLETADO',animals:[{selected:true,conditionId:'condition-a'}]}]);
assert.equal((await get('/health-records/conditions/condition-a/treatments'))[0].id,'campaign-a');
await runtime.putCache(scope,'/health-records/conditions',[{id:'condition-a',treatmentCount:2}]);
await assert.rejects(()=>get('/health-records/conditions/condition-a/treatments'),/todavía no se descargó/,'An incomplete cached history is never presented as the full list');
const medicineBody={name:'Offline medicine',kind:'OTRO',defaultUnitCode:'MILLILITER',withdrawalMilkDays:0,withdrawalMeatDays:0,
 administrationRoutes:['ORAL'],doseAmount:1,doseWeight:50,doseWeightUnitCode:'KILOGRAM'};
const medicine=await change('/health-records/medicines/structured',medicineBody,'POST');
assert.equal(medicine.active,true);
assert.equal((await get('/catalogs/medicines'))[0].doseWeight,50);
assert.equal((await get('/health-records/medicines'))[0].id,medicine.id);
const route=await change('/catalogs/ADMINISTRATION_ROUTES/items',{name:'Nueva vía'},'POST');
assert.equal(route.active,true);assert.equal(route.systemDefined,false);assert.equal(route.catalogCode,'ADMINISTRATION_ROUTES');
await runtime.putCache(scope,'/health-records/options',{animals:[],units:[],groups:[],administrationRoutes:[]});
assert.ok((await get('/health-records/options')).administrationRoutes.some(item=>item.id===route.id));
const catalogMedicine=await change('/catalogs/medicines',{...medicineBody,name:'Catalog medicine',administrationRoutes:[route.id]},'POST');
assert.ok((await get('/health-records/medicines')).some(item=>item.id===catalogMedicine.id&&item.active));
const edited=await change('/catalogs/medicines/'+catalogMedicine.id,{medicine:{...medicineBody,name:'Edited catalog medicine'},active:false,expectedVersion:1});
assert.equal(edited.name,'Edited catalog medicine');assert.equal(edited.active,false);assert.equal(edited.version,2);
assert.equal(edited.medicine,undefined);assert.equal(edited.expectedVersion,undefined);
assert.equal((await get('/health-records/medicines')).find(item=>item.id===catalogMedicine.id).name,'Edited catalog medicine');
assert.equal((await get('/catalogs/medicines')).find(item=>item.id===catalogMedicine.id).active,false);
await assert.rejects(()=>change('/catalogs/medicines/'+catalogMedicine.id,{medicine:medicineBody,active:true,expectedVersion:1}),error=>error.code==='LOCAL_VALIDATION_FAILED');
await assert.rejects(()=>change('/catalogs/medicines/'+catalogMedicine.id,{medicine:{...medicineBody,defaultUnitCode:''},active:true,expectedVersion:2}),error=>error.code==='LOCAL_VALIDATION_FAILED');
await runtime.discardPendingMutation((await runtime.listOutbox(scope.userId)).find(item=>item.path==='/catalogs/medicines/'+catalogMedicine.id).id);
const rangedBody={...medicineBody,name:'Classification medicine',doseAmount:null,doseWeight:null,doseWeightUnitCode:null,
 doseClassificationRanges:[{classificationCode:'VACA',min:5,max:10},{classificationCode:'TERNERO',min:3,max:5}]};
const ranged=await change('/health-records/medicines/classification',rangedBody,'POST');
assert.deepEqual((await get('/catalogs/medicines')).find(item=>item.id===ranged.id).doseClassificationRanges,rangedBody.doseClassificationRanges);
await assert.rejects(()=>change('/catalogs/medicines/classification',{...rangedBody,doseClassificationRanges:[{classificationCode:'VACA',min:10,max:5}]},'POST'),error=>error.code==='LOCAL_VALIDATION_FAILED');
await assert.rejects(()=>change('/catalogs/medicines/classification',{...rangedBody,doseAmount:2},'POST'),error=>error.code==='LOCAL_VALIDATION_FAILED');
await assert.rejects(()=>change('/catalogs/medicines/classification',{...rangedBody,doseClassificationRanges:[rangedBody.doseClassificationRanges[0],rangedBody.doseClassificationRanges[0]]},'POST'),error=>error.code==='LOCAL_VALIDATION_FAILED');
await assert.rejects(()=>change('/catalogs/medicines',{...medicineBody,doseWeight:null},'POST'),error=>error.code==='LOCAL_VALIDATION_FAILED');
for(const item of (await runtime.listOutbox(scope.userId)).reverse())if([medicine.id,route.id,catalogMedicine.id,ranged.id].includes(item.temporaryId))await runtime.discardPendingMutation(item.id);

await runtime.putCache(scope,'/animals?page=1',{items:[animal],page:1,total:1,hasMore:false});
await runtime.putCache(scope,'/animals/animal-a',animal);
await runtime.putCache(scope,'/catalogs/BREEDS/items',[{id:'breed-new',name:'Jersey'}]);
await runtime.putCache(scope,'/animal-owners',[{id:'owner-new',name:'Jesús'}]);
await runtime.putCache(scope,'/animal-brands',[{id:'brand-new',name:'Marca nueva'}]);
await runtime.putCache(scope,'/groups',[{id:'group-a',name:'Vacas',active:true}]);
let row=await change('/animals/animal-a/description',{description:'Primera edición',expectedVersion:1});
assert.equal(row.name,'Lucera');assert.equal(row.version,2);assert.equal(row.brands.map(x=>x.name)[0],'Marca vieja');
row=await change('/animals/animal-a/catalogs',{breedIds:['breed-new'],colorIds:[],expectedVersion:2});
assert.equal(row.breeds[0].name,'Jersey');assert.equal(row.owners[0].name,'Dueño anterior');
row=await change('/animals/animal-a/owners',{owners:[{partyId:'owner-new',percent:100,isPrimary:true}],expectedVersion:3},'PUT');
assert.equal(row.owners[0].id,'owner-new');assert.equal(row.primaryOwnerName,'Jesús');
row=await change('/animals/animal-a/brands',{brandIds:['brand-new'],expectedVersion:4});
row=await change('/animals/animal-a/parents',{mother:{reportedName:'Madre externa'},father:null,expectedVersion:5});
row=await change('/animals/animal-a/description',{description:'Última edición',expectedVersion:6});
assert.equal(row.version,7);assert.equal(row.mother.name,'Madre externa');assert.equal(row.brands[0].name,'Marca nueva');
assert.equal((await get('/animals?page=1')).items[0].description,'Última edición');
const count=state.outbox.size;
await assert.rejects(change('/animals/animal-a/owners',{owners:[{partyId:'owner-new',percent:80,isPrimary:true}],expectedVersion:7},'PUT'),/sumar 100/);
await assert.rejects(change('/animals/animal-a/description',{description:'Vieja',expectedVersion:1}),/registro cambió/);
assert.equal(state.outbox.size,count);assert.equal((await get('/animals/animal-a')).description,'Última edición');

const bytes='real-local-photo-bytes';
const upload=await runtime.uploadMedia('test-token',{file:new File([bytes],'vaca.jpg',{type:'image/jpeg'}),animalIds:['animal-a'],relationCode:'PROFILE'});
const mediaPath='/media?entityType=ANIMAL&entityId=animal-a';
let photos=await get(mediaPath);
assert.equal(photos[0].id,upload.id);assert.equal(await (await fetch(photos[0].url)).text(),bytes);
assert.equal(state.media.size,1);assert.equal((await runtime.runtimeState()).mediaFiles,1);
const binaryEntry=[...state.outbox.values()].find(entry=>entry.bodyType==='binary');
assert.equal(binaryEntry.formParts[0].value,binaryEntry.id);
assert.equal(await state.media.get(binaryEntry.id).file.text(),bytes);
assert.equal(binaryEntry.requestHeaders['content-type'],'image/jpeg');
assert(!mirrored.has(binaryEntry.id));
await change('/groups/group-a',{name:'Grupo nuevo'});
assert.equal((await get('/groups'))[0].name,'Grupo nuevo');
assert(![...mirrored.values()].some(entry=>entry.path==='/groups/group-a'),'Native sync must stop before the queued photo');

runtime=await load();await runtime.configureOfflineRuntime(scope,'test-token');
assert.equal((await get('/animals/animal-a')).description,'Última edición');
photos=await get(mediaPath);assert.equal(await(await fetch(photos[0].url)).text(),bytes);
assert.equal(await(await fetch((await get('/animals/animal-a')).profilePhotoUrl)).text(),bytes);
await runtime.configureOfflineRuntime({...scope,propertyId:'property-b'},'test-token');
await assert.rejects(get(mediaPath),/todavía no se descargó/);
await runtime.configureOfflineRuntime(scope,'test-token');

const sent=[];let serverVersion=1;
const send=async(path,init)=>{
  sent.push({path,init});
  if(init.method==='POST'&&path.startsWith('/media?')){
    assert(init.body instanceof Blob);assert.equal(await init.body.text(),bytes);
    assert.equal(new Headers(init.headers).get('content-type'),'image/jpeg');
    return {data:{id:'attachment-real',attachmentIds:['attachment-real']},etag:null,notModified:false};
  }
  if(path.startsWith('/media?'))return {data:[{id:'attachment-real',storage_object_id:'storage-real',entity_type:'ANIMAL',entity_id:'animal-a',
    relation_code:'PROFILE',kind:'IMAGE',url:'https://example.test/photo.jpg',thumbnailUrl:null,tags:[]}],etag:null,notModified:false};
  if(path.startsWith('/animals/')){
    const data=JSON.parse(init.body);serverVersion++;
    assert.equal(data.expectedVersion,serverVersion-1);
    // An older response must leave the final queued description visible.
    return {data:{id:'animal-a',...data,version:serverVersion},etag:null,notModified:false};
  }
  return {data:{id:'group-a',name:'Grupo nuevo'},etag:null,notModified:false};
};
runtime.installOfflineTransport(send);online=true;
await runtime.syncOfflineMutations();online=false;
assert.equal(state.outbox.size,0);assert.equal((await get('/animals/animal-a')).description,'Última edición');
assert.equal((await get('/animals/animal-a')).version,7);
photos=await get(mediaPath);assert.equal(photos[0].id,'attachment-real');assert.equal(photos[0].storage_object_id,'storage-real');
assert.equal(await(await fetch(photos[0].url)).text(),bytes);
assert(sent.findIndex(x=>x.path.startsWith('/media?'))<sent.findIndex(x=>x.path==='/groups/group-a'));

// A new offline animal can be edited and photographed before its server ID exists.
let newborn=await change('/animals',{name:'Ternera',groupId:'group-a',sex:'FEMALE',speciesCode:'BOVINE'},'POST');
await change(`/animals/${newborn.id}/description`,{description:'Local',expectedVersion:1});
await runtime.uploadMedia('test-token',{file:new File(['calf'],'calf.jpg',{type:'image/jpeg'}),animalIds:[newborn.id]});
runtime.installOfflineTransport(async(path,init)=>{
  if(path==='/animals')return {data:{id:'animal-real',name:'Ternera',version:1},etag:null,notModified:false};
  assert(!path.includes('offline-'),'Temporary IDs must be replaced before sending');
  if(path.startsWith('/animals/'))return {data:{id:'animal-real',description:'Local',version:2},etag:null,notModified:false};
  if(init.method==='POST')return {data:{id:'calf-photo',attachmentIds:['calf-photo']},etag:null,notModified:false};
  return {data:[{id:'calf-photo',storage_object_id:'calf-storage',entity_type:'ANIMAL',entity_id:'animal-real',relation_code:'GENERAL',kind:'IMAGE',url:'https://example.test/calf.jpg',tags:[]}],etag:null,notModified:false};
});
online=true;await runtime.syncOfflineMutations();online=false;
assert.equal(state.outbox.size,0);assert.equal((await get('/animals/animal-real')).description,'Local');
assert.equal((await get('/media?entityType=ANIMAL&entityId=animal-real'))[0].id,'calf-photo');

// If acknowledgement lookup fails, retry it without uploading the bytes twice.
const doomed=await runtime.uploadMedia('test-token',{file:new File(['delete-me'],'extra.jpg',{type:'image/jpeg'}),animalIds:['animal-a']});
await runtime.offlineRequest(`/media/${doomed.id}`,{method:'DELETE',headers},noNetwork);
assert(!(await get(mediaPath)).some(photo=>photo.id===doomed.id));
let uploads=0,lookups=0;const deleted=[];
runtime.installOfflineTransport(async(path,init)=>{
  if(init.method==='DELETE'){deleted.push(path);return {data:undefined,etag:null,notModified:false};}
  if(init.method==='POST'){uploads++;return {data:{id:'doomed-real',attachmentIds:['doomed-real']},etag:null,notModified:false};}
  if(lookups++===0)throw Object.assign(new Error('Sin conexión'),{status:0});
  return {data:[{id:'doomed-real',storage_object_id:'doomed-object',entity_type:'ANIMAL',entity_id:'animal-a',relation_code:'GENERAL',kind:'IMAGE',url:'https://example.test/extra.jpg',tags:[]}],etag:null,notModified:false};
});
online=true;await runtime.syncOfflineMutations();
assert.equal(state.outbox.size,2);assert.equal((await runtime.listOutbox(scope.userId))[0].state,'PENDING');
await runtime.syncOfflineMutations();online=false;
assert.equal(uploads,1);assert.deepEqual(deleted,['/media/doomed-real']);assert.equal(state.outbox.size,0);
assert(!(await get(mediaPath)).some(photo=>photo.id==='doomed-real'));

// Deterministic server errors block later entries instead of reordering them.
await change('/groups/group-a',{name:'Primero'});await change('/groups/group-a',{name:'Segundo'});
let attempts=0;
runtime.installOfflineTransport(async()=>{attempts++;throw Object.assign(new Error('Conflicto'),{status:409,code:'CONFLICT'});});
online=true;await runtime.syncOfflineMutations();await runtime.syncOfflineMutations();online=false;
assert.equal(attempts,1);assert.equal((await get('/groups'))[0].name,'Segundo');
assert.equal(state.outbox.size,2);

// Editing metadata keeps the file, updates every related cache, and remaps newly added relations.
const mediaScope={...scope,userId:'media-editor'};
const binaryFilesBefore=state.media.size;
await runtime.configureOfflineRuntime(mediaScope,'test-token');
const original={id:'old-general',storage_object_id:'photo-object',entity_type:'ANIMAL',entity_id:'animal-a',
  entity_name:'Lucera',relation_code:'GENERAL',kind:'IMAGE',url:'https://example.test/original.jpg',
  thumbnailUrl:'https://example.test/thumb.jpg',byteSize:25,created_at:'2026-10-01T15:00:00Z',
  captured_on:null,description:'Original',tags:[]};
const profile={...original,id:'profile-relation',relation_code:'PROFILE'};
await runtime.putCache(mediaScope,'/media',[original,profile]);
await runtime.putCache(mediaScope,mediaPath,[original,profile]);
await runtime.putCache(mediaScope,'/animals?page=1',{items:[animal,{...animal,id:'animal-b',name:'Moka'}]});
await runtime.putCache(mediaScope,'/catalogs/MEDIA_TAGS/items',[{id:'tag-new',name:'Parto',active:true}]);
await runtime.updateMediaDetails('test-token','photo-object',{capturedOn:'2026-09-30',description:'Editada',
  tagIds:['tag-new'],animalIds:['animal-a','animal-b'],expectedAttachmentIds:['old-general','profile-relation']});
photos=await get('/media');
assert.equal(photos.length,3);assert(photos.every(photo=>photo.description==='Editada'&&photo.captured_on==='2026-09-30'));
assert(photos.every(photo=>photo.url===original.url&&photo.byteSize===25&&photo.tags[0].name==='Parto'));
const added=photos.find(photo=>photo.entity_id==='animal-b');assert(added.id.startsWith('offline-'));
const addedPath='/media?entityType=ANIMAL&entityId=animal-b';
assert.equal((await get(addedPath))[0].id,added.id);
await runtime.updateMediaDetails('test-token','photo-object',{capturedOn:null,description:null,
  tagIds:[],animalIds:['animal-a','animal-b'],expectedAttachmentIds:photos.map(photo=>photo.id)});
photos=await get('/media');assert(photos.every(photo=>photo.description===null&&photo.captured_on===null&&photo.tags.length===0));
assert(![...mirrored.values()].some(entry=>entry.scope.userId===mediaScope.userId),'Native sync waits for canonical relation IDs');
runtime=await load();await runtime.configureOfflineRuntime(mediaScope,'test-token');
assert.equal((await get(addedPath))[0].description,null);assert.equal(state.media.size,binaryFilesBefore,'Metadata does not upload a second binary');
await runtime.configureOfflineRuntime({...mediaScope,propertyId:'property-b'},'test-token');
await assert.rejects(get('/media'),/todavía no se descargó/);
await runtime.configureOfflineRuntime(mediaScope,'test-token');
let updates=0;
runtime.installOfflineTransport(async(path,init)=>{
  assert.equal(path,'/media/objects/photo-object');assert.equal(init.method,'PATCH');
  const input=JSON.parse(init.body);updates++;
  if(updates===1)assert.deepEqual(input.expectedAttachmentIds,['old-general','profile-relation']);
  else{assert(input.expectedAttachmentIds.includes('new-canonical'));assert(!input.expectedAttachmentIds.some(id=>id.startsWith('offline-')));}
  const attachments=[original,profile,{...original,id:'new-canonical',entity_id:'animal-b',entity_name:'Moka'}]
    .map(photo=>({...photo,description:input.description,captured_on:input.capturedOn,tags:input.tagIds.map(id=>({id,name:'Parto'}))}));
  return {data:{attachmentIds:attachments.map(photo=>photo.id),attachments},etag:null,notModified:false};
});
online=true;await runtime.syncOfflineMutations();online=false;
assert.equal(updates,2);assert.equal((await runtime.listOutbox(mediaScope.userId)).length,0);
photos=await get('/media');assert.equal(photos.length,3);assert(photos.every(photo=>photo.description===null&&photo.tags.length===0));
assert.equal((await get(addedPath))[0].id,'new-canonical');
await runtime.updateMediaDetails('test-token','photo-object',{capturedOn:null,description:'Solo perfil',tagIds:[],
  animalIds:['animal-a'],expectedAttachmentIds:photos.map(photo=>photo.id)});
assert.equal((await get(addedPath)).length,0);assert.equal((await get('/media')).length,2);
assert((await get('/media')).some(photo=>photo.relation_code==='PROFILE'));
console.log('PASS: animal edits, persistent binary photos, metadata/relations, scope isolation, FIFO sync, canonical IDs and conflict blocking.');

// Selection persists per user; automatic data/media downloads require confirmed Wi-Fi.
const downloadScope={userId:'download-user',propertyId:'property-a',roleId:'editor'};
await runtime.configureOfflineRuntime(downloadScope,'test-token');
let preferences=(await runtime.runtimeState()).preferences;
preferences={...preferences,data:{...preferences.data,animals:false,activities:true},
  photos:{...preferences.photos,'profile':'latest','cover':'none','activity-photos':'all'}};
await runtime.setDownloadPreferences(preferences);await runtime.setAutomaticDownloads(true);
online=true;wifi=false;let downloads=0;const native=[];
window.SGBAndroid.downloadMedia=value=>native.push(...JSON.parse(value));
const network=async path=>{downloads++;return {data:path.startsWith('/animals')?{items:[],hasMore:false}:[{id:'record-a'}],etag:null,notModified:false};};
runtime.installOfflineTransport(network);
assert.equal(runtime.canAutomaticallyDownload(),false);
await runtime.offlineRequest('/activities',{headers},network);
assert.equal(await runtime.getCache(downloadScope,'/activities'),null,'Cellular browsing must not persist automatic downloads');
await runtime.downloadPaths(['/activities'],{automatic:true});assert.equal(downloads,1);
await runtime.downloadPaths(['/activities']);assert.equal(downloads,2,'Manual download works over cellular');
assert(await runtime.getCache(downloadScope,'/activities'));
wifi=true;assert.equal(runtime.canAutomaticallyDownload(),true);
await runtime.offlineRequest('/animals?page=1',{headers},network);
assert.equal(await runtime.getCache(downloadScope,'/animals?page=1'),null,'Disabled category is not downloaded automatically');
await runtime.configureOfflineRuntime({...downloadScope,userId:'different-user'},'test-token');
assert.equal((await runtime.runtimeState()).preferences.data.animals,true);
await runtime.configureOfflineRuntime(downloadScope,'test-token');
assert.equal((await runtime.runtimeState()).preferences.data.animals,false);
const photo=(id,date,type='ANIMAL',relation='PROFILE',entity='animal-a')=>({id,entity_id:entity,entity_type:type,
  relation_code:relation,kind:'IMAGE',url:'https://res.cloudinary.com/demo/image/upload/'+id+'.jpg',created_at:date});
const attachments=[photo('older','2026-01-01'),photo('newer','2026-10-01'),
  photo('other-animal','2026-09-01','ANIMAL','PROFILE','animal-b'),photo('cover','2026-10-01','ANIMAL','COVER'),
  photo('activity','2026-10-01','LIVESTOCK_ACTIVITY','GENERAL'),
  {...photo('video','2026-10-01','LIVESTOCK_ACTIVITY','GENERAL'),kind:'VIDEO',url:'https://res.cloudinary.com/demo/video/upload/a.mp4'}];
let selected=runtime.collectNativeMedia([{path:'/media',payload:attachments}],preferences,'property-a',true);
assert(selected.some(file=>file.source===attachments[1].url));assert(selected.some(file=>file.source===attachments[2].url));
assert(!selected.some(file=>file.source===attachments[0].url||file.source===attachments[3].url||file.source.includes('/video/')));
assert(selected.every(file=>file.wifiOnly&&file.propertyId==='property-a'));
selected=runtime.collectNativeMedia([{path:'/media',payload:attachments}],{...preferences,photos:{...preferences.photos,profile:'all'}},'property-a');
assert(selected.some(file=>file.source===attachments[0].url));
// Complete media pages remain visible offline, including an existing general media cache.
const pages=[];runtime.installOfflineTransport(async path=>{pages.push(path);const page=new URLSearchParams(path.split('?')[1]).get('page');
  return {data:page==='1'?Array.from({length:500},(_,n)=>photo('page-'+n,'2026-10-01')):[photo('page-last','2026-09-01')],etag:null,notModified:false};});
await runtime.putCache(downloadScope,'/media',[]);
await runtime.downloadPaths(['/media?entityType=ANIMAL']);assert.equal(pages.length,2);
online=false;
assert.equal((await get('/media')).length,501);assert.equal((await get('/media?entityType=ANIMAL&entityId=animal-a')).length,501);
// Category deletion is scoped and refuses queued work; media cleanup keeps pending upload bytes.
await runtime.removeDownloadedData('activities');assert.equal(await runtime.getCache(downloadScope,'/activities'),null);
await runtime.putCache(downloadScope,'/groups',[{id:'local-group',name:'Before'}]);
await change('/groups/local-group',{name:'After'});
await assert.rejects(runtime.removeDownloadedData('groups'),/Sincroniza/);
await runtime.uploadMedia('test-token',{file:new File(['pending'],'pending.jpg',{type:'image/jpeg'}),animalIds:['animal-a']});
const pendingPhoto=[...state.media.values()].find(file=>file.userId===downloadScope.userId&&file.filename==='pending.jpg');
const details=await runtime.getOfflineDetails();assert(details.media.find(file=>file.id==='local:'+pendingPhoto.id).protected);
await assert.rejects(runtime.removeDownloadedMedia(['local:'+pendingPhoto.id]),/pendientes/);
const oldOutbox=state.outbox.size;
const finishedId='finished-photo';state.media.set(finishedId,{id:finishedId,userId:downloadScope.userId,file:new File(['synced'],'synced.jpg',{type:'image/jpeg'}),filename:'synced.jpg'});
await runtime.putCache(downloadScope,'/animals/animal-finished',{id:'animal-finished',profile_local_media_id:finishedId,profilePhotoUrl:'blob:old'});
await runtime.putCache(downloadScope,'/media?entityType=ANIMAL&entityId=animal-finished',[
  {id:'finished-attachment',local_media_id:finishedId,url:'https://example.test/finished.jpg',kind:'IMAGE',entity_type:'ANIMAL',entity_id:'animal-finished'}]);
await runtime.removeDownloadedMedia(['local:'+finishedId]);assert(!state.media.has(finishedId));assert.equal(state.outbox.size,oldOutbox);
assert.equal((await runtime.getCache(downloadScope,'/animals/animal-finished')).payload.profilePhotoUrl,'https://example.test/finished.jpg');
assert(state.media.has(pendingPhoto.id));
console.log('PASS: Wi-Fi gating, manual cellular downloads, user choices, latest/all photos, media paging and safe category/file cleanup.');
// A network transition during an automatic read must not persist the response on cellular.
online=true;wifi=true;
const transitionPath='/production';let completeRead;
const delayed=new Promise(resolve=>{completeRead=resolve;});
const reading=runtime.offlineRequest(transitionPath,{headers},async()=>delayed);
await new Promise(resolve=>setTimeout(resolve,10));wifi=false;
completeRead({data:{milk:[]},etag:null,notModified:false});await reading;
assert.equal(await runtime.getCache(downloadScope,transitionPath),null);
console.log('PASS: automatic reads stop caching after Wi-Fi is lost.');
// Support and user caches remain separate, even with the same property and role IDs.
const modeScope={userId:'mode-admin',propertyId:'own-property',roleId:'owner',supportMode:false};
const supportScope={...modeScope,supportMode:true,supportAccountId:'own-account'};
online=false;await runtime.configureOfflineRuntime(supportScope,'mode-token');
await runtime.putCache(supportScope,'/animals/animal-a',{...animal,description:'Support-only cached data'});
await change('/animals/animal-a/description',{description:'Pending support change',expectedVersion:1});
const modeEntries=await runtime.listOutbox(modeScope.userId);assert.equal(modeEntries.length,1);
assert(!mirrored.has(modeEntries[0].id),'Native background sync must not impersonate support context');
await runtime.configureOfflineRuntime(modeScope,'mode-token');
await assert.rejects(get('/animals/animal-a'),/no se descargó/);
let modeCalls=[];runtime.installOfflineTransport(async(path,init)=>{modeCalls.push({path,init});return {data:{id:'animal-a',version:2},etag:null,notModified:false};});
online=true;await runtime.syncOfflineMutations();assert.equal(modeCalls.length,0,'Normal mode never starts support to send a queued support change');
assert.equal((await runtime.listOutbox(modeScope.userId))[0].state,'PENDING');
await runtime.configureOfflineRuntime({...supportScope,propertyId:'another-property',supportAccountId:'another-account'},'mode-token');
await runtime.syncOfflineMutations();assert.equal((await runtime.listOutbox(modeScope.userId)).length,0);
assert.equal(modeCalls[0].path,'/superadmin/support-context');
assert.equal(JSON.parse(modeCalls[0].init.body).accountId,'own-account');
assert.equal(modeCalls.at(-1).path,'/superadmin/support-context');
assert.equal(JSON.parse(modeCalls.at(-1).init.body).accountId,'another-account');
console.log('PASS: support/user cache isolation and explicit support scope during queued synchronization.');

// The cache is the first source even when Wi-Fi/automatic downloads are disabled.
const manageScope={userId:'manage-user',propertyId:'manage-property',roleId:'editor'};
online=true;wifi=false;await runtime.configureOfflineRuntime(manageScope,'test-token');await runtime.setAutomaticDownloads(false);
await runtime.putCache(manageScope,'/animals/animal-a',{...animal,profilePhotoUrl:'https://example.test/original.jpg'});
let requestedNetwork=false;
const cachedFirst=await Promise.race([runtime.offlineRequest('/animals/animal-a',{headers},async()=>{requestedNetwork=true;return new Promise(()=>{});}),
  new Promise((_,reject)=>setTimeout(()=>reject(new Error('Cached startup waited for the server')),100))]);
assert.equal(cachedFirst.name,'Lucera');assert.equal(requestedNetwork,false);
online=false;
await change('/animals/animal-a/description',{description:'Primero',expectedVersion:1});
await change('/animals/animal-a/description',{description:'Segundo',expectedVersion:2});
let managed=await runtime.listOutbox(manageScope.userId);
await runtime.discardPendingMutation(managed[0].id);
assert.equal((await get('/animals/animal-a')).description,'Segundo');
assert.equal((await get('/animals/animal-a')).version,2);
assert.equal((await runtime.listOutbox(manageScope.userId))[0].jsonBody.expectedVersion,1);
await runtime.discardPendingMutation(managed[1].id);
assert.equal((await get('/animals/animal-a')).description,'Antes');
assert.equal((await get('/animals/animal-a')).version,1);

await runtime.putCache(manageScope,'/media',[]);
await runtime.uploadMedia('test-token',{file:new File(['photo-edit-discard'],'portrait.jpg',{type:'image/jpeg'}),animalIds:['animal-a'],relationCode:'PROFILE'});
let queuedPhoto=(await runtime.listOutbox(manageScope.userId))[0];
const originalPhotoKey=queuedPhoto.idempotencyKey;
assert.equal(queuedPhoto.summary,'Actualización de foto de perfil · Lucera');
await runtime.editPendingMutation(queuedPhoto.id,{description:'Nueva foto',capturedOn:'2026-10-06',relationCode:'PROFILE'});
queuedPhoto=(await runtime.listOutbox(manageScope.userId))[0];
assert.equal(new URLSearchParams(queuedPhoto.path.split('?')[1]).get('capturedOn'),'2026-10-06');
assert.notEqual(queuedPhoto.idempotencyKey,originalPhotoKey);
await runtime.discardPendingMutation(queuedPhoto.id);
assert.equal((await get('/animals/animal-a')).profilePhotoUrl,'https://example.test/original.jpg');
assert.equal((await get('/media')).length,0);assert(!state.media.has(queuedPhoto.id));

await change('/animals/animal-a/description',{description:'Confirmado',expectedVersion:1});
await change('/animals/animal-a/description',{description:'Error',expectedVersion:2});
const progressEvents=[];const captureProgress=event=>progressEvents.push(event.detail.syncProgress);
window.addEventListener('sgb-v2-offline-state',captureProgress);
const manageTransport=async(path,init)=>{
  const body=JSON.parse(init.body);init.onUploadProgress?.(50,100);
  if(body.description==='Error')throw Object.assign(new Error('Descripción inválida'),{status:422,code:'VALIDATION_ERROR'});
  return {data:{id:'animal-a',description:body.description,version:body.expectedVersion+1},etag:null,notModified:false};
};
runtime.installOfflineTransport(manageTransport);online=true;await runtime.syncOfflineMutations();online=false;
assert.equal((await runtime.listOutbox(manageScope.userId)).length,1);
assert(progressEvents.some(progress=>progress?.completed===1&&progress.total===2));
assert(progressEvents.some(progress=>progress?.loaded===50&&progress.bytes===100));
let failure=(await runtime.listOutbox(manageScope.userId))[0];const failedKey=failure.idempotencyKey;
await runtime.editPendingMutation(failure.id,{description:'Corregido'});
failure=(await runtime.listOutbox(manageScope.userId))[0];assert.equal(failure.state,'PENDING');assert.notEqual(failure.idempotencyKey,failedKey);
assert.equal(failure.jsonBody.expectedVersion,2);
await runtime.discardPendingMutation(failure.id);
assert.equal((await get('/animals/animal-a')).description,'Confirmado');assert.equal((await get('/animals/animal-a')).version,2);
assert.equal((await runtime.listOutbox(manageScope.userId)).length,0);
window.removeEventListener('sgb-v2-offline-state',captureProgress);
console.log('PASS: cache-first startup, readable photo queue, edit/discard with undo, rebased versions and measured upload progress.');

await change('/animals/animal-a/description',{description:'En conflicto',expectedVersion:2});
runtime.installOfflineTransport(async()=>{throw Object.assign(new Error('El animal cambió'),{status:409,code:'ANIMAL_VERSION_CONFLICT'});});
online=true;await runtime.syncOfflineMutations();online=false;
const versionConflict=(await runtime.listOutbox(manageScope.userId))[0];
await assert.rejects(runtime.editPendingMutation(versionConflict.id,{description:'Corrección final'}),/Conéctate/);
online=true;runtime.installOfflineTransport(async(path)=>{
  assert.equal(path,'/animals/animal-a');return {data:{...animal,description:'Cambio ajeno confirmado',version:8},etag:null,notModified:false};
});
await runtime.editPendingMutation(versionConflict.id,{description:'Corrección final'});online=false;
assert.equal((await runtime.listOutbox(manageScope.userId))[0].jsonBody.expectedVersion,8);
assert.equal((await get('/animals/animal-a')).description,'Corrección final');
await runtime.discardPendingMutation(versionConflict.id);
assert.equal((await get('/animals/animal-a')).description,'Cambio ajeno confirmado');
assert.equal((await get('/animals/animal-a')).version,8);
console.log('PASS: editing a real ANIMAL_VERSION_CONFLICT fetches current server version and preserves confirmed external changes on discard.');

await change('/animals/animal-a/description',{description:'Cambio en rol anterior',expectedVersion:8});
const formerRoleEntry=(await runtime.listOutbox(manageScope.userId))[0];
await runtime.configureOfflineRuntime({...manageScope,roleId:'new-role'},'test-token');
await assert.rejects(runtime.editPendingMutation(formerRoleEntry.id,{description:'Otra'}),/Selecciona la propiedad/);
await runtime.discardPendingMutation(formerRoleEntry.id);
assert.equal((await runtime.listOutbox(manageScope.userId)).length,0);
await runtime.configureOfflineRuntime(manageScope,'test-token');
assert.equal((await get('/animals/animal-a')).description,'Cambio ajeno confirmado');
console.log('PASS: private pending data from a former role can be discarded without using its server permissions.');

await change('/animals/animal-a/description',{description:'Enviado por Android',expectedVersion:8});
const nativeStarted=(await runtime.listOutbox(manageScope.userId))[0];
window.SGBAndroid.reservePendingMutation=()=>false;
await assert.rejects(runtime.editPendingMutation(nativeStarted.id,{description:'Duplicado'}),/Android ya inició/);
await assert.rejects(runtime.discardPendingMutation(nativeStarted.id),/Android ya inició/);
assert.equal((await runtime.listOutbox(manageScope.userId))[0].idempotencyKey,nativeStarted.idempotencyKey);
assert.equal((await get('/animals/animal-a')).description,'Enviado por Android');
window.SGBAndroid.reservePendingMutation=()=>true;
await runtime.discardPendingMutation(nativeStarted.id);
assert.equal((await get('/animals/animal-a')).description,'Cambio ajeno confirmado');
console.log('PASS: pending changes already sent by Android cannot be edited with a new key or discarded before confirmation.');

// Cleanup preflight, duplicate draft protection, product aliases and server backoff.
online=false;runtime=await load();await runtime.configureOfflineRuntime(manageScope,'test-token');
await runtime.putCache(manageScope,'/cleanings',[]);await runtime.putCache(manageScope,'/cleanings/products',[]);
const cleaning={locationId:'pasture-a',startedOn:'2026-10-01',areaType:'TOTAL',activities:['FUMIGACION'],applicationUnit:'TANQUES',applicationCount:2,
 products:[],operators:[{name:'Ana',notes:'Protección'}]};
const offlineProduct=await change('/catalogs/products',{name:'Producto sin conexión'},'POST');
assert.equal(offlineProduct.active,true);assert.equal((await get('/cleanings/products'))[0].id,offlineProduct.id);
assert.equal((await get('/catalogs/products'))[0].id,offlineProduct.id);
const application={...cleaning,products:[{productId:offlineProduct.id,unitCode:'MILLILITER',quantityPerApplication:3}]};
await assert.rejects(()=>change('/cleanings',{...application,applicationCount:null},'POST'),/cuántos tanques/);
await assert.rejects(()=>change('/cleanings',{...application,operators:[{name:'Ana'},{name:' ana '}]},'POST'),/responsables distintos/);
await assert.rejects(()=>change('/cleanings',{...application,products:[{...application.products[0],notes:'x'.repeat(301)}]},'POST'),/300 caracteres/);
const draft=await change('/cleanings',application,'POST');
await assert.rejects(()=>change('/cleanings',application,'POST'),/borrador ya está guardado/);
assert.equal((await get('/cleanings')).length,1);assert.equal((await runtime.listOutbox(manageScope.userId)).length,2);
let cleanupAttempts=0;const keys=[];const originalNow=Date.now;let checkClock=originalNow();Date.now=()=>checkClock;
runtime.installOfflineTransport(async(path,init)=>{cleanupAttempts++;keys.push(new Headers(init.headers).get('x-idempotency-key'));
 throw Object.assign(new Error('El servidor pidió esperar'),{status:429,code:'SESSION_REFRESH_RATE_LIMIT',retryAt:checkClock+2000});});
online=true;await runtime.syncOfflineMutations();
assert.equal(cleanupAttempts,1);assert.ok((await runtime.listOutbox(manageScope.userId)).every(row=>row.state==='PENDING'));
await runtime.syncOfflineMutations();assert.equal(cleanupAttempts,1,'Immediate retry respects server pause');
await assert.rejects(()=>runtime.downloadPaths(['/cleanings','/cleanings/options']),/Tus cambios siguen guardados/);
assert.equal(cleanupAttempts,1,'Download does not amplify refresh throttling');
checkClock+=2100;
runtime.installOfflineTransport(async(path,init)=>{cleanupAttempts++;keys.push(new Headers(init.headers).get('x-idempotency-key'));const body=JSON.parse(init.body);
 if(path==='/catalogs/products')return {data:{...body,id:'product-confirmed',active:true,version:1},etag:null,notModified:false};
 assert.equal(path,'/cleanings');assert.equal(body.products[0].productId,'product-confirmed','Queued cleanup uses confirmed product ID');
 return {data:{...body,id:'cleaning-confirmed',status:'BORRADOR',version:1},etag:null,notModified:false};});
await runtime.syncOfflineMutations();assert.equal((await runtime.listOutbox(manageScope.userId)).length,0);
assert.equal(keys[0],keys[1],'A retry retains its original idempotency key');
assert.equal((await get('/cleanings')).length,1);assert.equal((await get('/cleanings'))[0].id,'cleaning-confirmed');
assert.equal((await runtime.runtimeState()).retryAt,0);Date.now=originalNow;online=true;
runtime=await load();await runtime.configureOfflineRuntime(manageScope,'test-token');
// Download error reports preserve the server reason and stop the remaining batch.
let cleanupDownloads=0;runtime.installOfflineTransport(async()=>{cleanupDownloads++;throw Object.assign(new Error('Tu sesión venció. Inicia sesión de nuevo.'),{status:401,code:'UNAUTHORIZED'});});
await assert.rejects(()=>runtime.downloadPaths(['/unavailable','/cleanings/options']),/Tu sesión venció/);
assert.equal(cleanupDownloads,1);
console.log('PASS: cleanup validation, unique drafts, account product aliases, preserved pending data, rate-limit backoff, stable keys and readable download errors.');

// A real queued draft expires from its original creation time, including edits and attachments.
online=false;const expiryScope={userId:'expiry-user',propertyId:'expiry-property',roleId:'owner'};
runtime=await load();await runtime.configureOfflineRuntime(expiryScope,'test-token');
const realNow=Date.now;let draftClock=realNow();Date.now=()=>draftClock;
try{
 await runtime.putCache(expiryScope,'/cleanings',[]);
 const firstDraft=await change('/cleanings',cleaning,'POST');
 assert.equal(mirrored.has((await runtime.listOutbox(expiryScope.userId))[0].id),false,'Unapplied drafts stay out of the Android background worker');
 draftClock+=23*60*60*1000;
 await change('/cleanings/'+firstDraft.id,{...cleaning,expectedVersion:1,notes:'Edited near expiry'},'PUT');
 await runtime.putCache(expiryScope,'/media',[]);
 const attached=await runtime.uploadMedia('test-token',{file:new File(['draft-photo'],'draft.jpg',{type:'image/jpeg'}),entityType:'CLEANING',entityId:firstDraft.id});
 const photoEntry=(await runtime.listOutbox(expiryScope.userId)).find(entry=>entry.bodyType==='binary');
 await runtime.updateMediaDetails('test-token','local-object-'+photoEntry.id,{description:'Draft attachment description',capturedOn:null,animalIds:[],expectedAttachmentIds:attached.attachmentIds,tagIds:[]});
 const other=await change('/catalogs/products',{name:'Keep independent product'},'POST');
 await runtime.expireLocalDrafts();assert.equal((await get('/cleanings')).length,1,'Draft survives before 24 hours');
 draftClock+=60*60*1000;
 await runtime.expireLocalDrafts();
 assert.equal(state.media.has(photoEntry.id),false,'Expired draft attachments leave local storage');
 assert.ok((await runtime.listOutbox(expiryScope.userId)).every(entry=>!entry.path.includes('local-object-'+photoEntry.id)),'Dependent photo metadata leaves the queue');
 assert.equal((await get('/cleanings')).length,0,'Editing does not extend the 24-hour lifetime');
 assert.ok((await runtime.listOutbox(expiryScope.userId)).every(entry=>!entry.path.startsWith('/cleanings')),'Expired root and dependent edits leave the queue');
 assert.equal((await get('/catalogs/products'))[0].id,other.id,'Independent catalog changes survive');
 const appliedDraft=await change('/cleanings',cleaning,'POST');await change('/cleanings/'+appliedDraft.id+'/apply',{},'POST');
 draftClock+=25*60*60*1000;await runtime.expireLocalDrafts();
 assert.ok((await runtime.listOutbox(expiryScope.userId)).some(entry=>entry.path.endsWith('/apply')),'Applied offline work is retained until confirmed');
 assert.equal((await get('/cleanings'))[0].status,'COMPLETADO');
 await runtime.putCache(expiryScope,'/activities',[{id:'old-server-draft',status:'BORRADOR',createdAt:new Date(draftClock-24*60*60*1000).toISOString()},
  {id:'applied-server',status:'COMPLETADA',createdAt:new Date(draftClock-48*60*60*1000).toISOString()}]);
 assert.deepEqual((await get('/activities')).map(row=>row.id),['applied-server'],'Cached server drafts expire offline too');
 await assert.rejects(()=>change('/activities/old-server-draft/apply',{},'POST'),/24 horas/);
}finally{Date.now=realNow;}
console.log('PASS: draft expiry at 24 hours, dependent queue cleanup, unchanged creation deadline and applied-work preservation.');

// A queued birth and all calf photos survive restart and bind to the server IDs.
const birthScope={userId:'birth-offline',propertyId:'birth-property',roleId:'owner'};
online=false;await runtime.configureOfflineRuntime(birthScope,'test-token');
await runtime.putCache(birthScope,'/reproduction',{heats:[],services:[],births:[],losses:[],pregnancies:[{id:'pregnancy-a',cowId:'cow-a',cowName:'Madre',status:'CONFIRMED'}]});
const queuedNewborn=await change('/reproduction/births',{pregnancyId:'pregnancy-a',occurredOn:'2026-10-10',kind:'NORMAL',stillbornCount:0,
 calves:[{name:'Cría offline',sex:'FEMALE',initialWeight:31,initialWeightUnitCode:'KILOGRAM'}]},'POST');
await assert.rejects(()=>change('/reproduction/births',{pregnancyId:'pregnancy-a',occurredOn:'2026-10-10',calves:[{name:'Repetida',sex:'FEMALE'}],stillbornCount:0},'POST'),/ya está guardado/);
await runtime.uploadMedia('test-token',{file:new File([new Uint8Array([255,216,255,217])],'calf.jpg',{type:'image/jpeg'}),animalIds:[queuedNewborn.calves[0].id],relationCode:'PROFILE'});
await runtime.uploadMedia('test-token',{file:new File([new Uint8Array([255,216,255,217])],'birth.jpg',{type:'image/jpeg'}),entityType:'REPRODUCTION_BIRTH',entityId:queuedNewborn.id});
runtime=await load();await runtime.configureOfflineRuntime(birthScope,'test-token');
const photoTargets=[];let birthWrites=0;
runtime.installOfflineTransport(async(path,init)=>{
 if(path==='/reproduction/births'){birthWrites++;return {data:{id:'birth-server',calves:[{id:'calf-server',name:'Cría offline',sex:'FEMALE'}]},etag:null,notModified:false};}
 if(path.startsWith('/media?')&&init.method==='POST'){const q=new URLSearchParams(path.split('?')[1]);photoTargets.push(q.get('entityId'));
  return {data:{id:'object-'+photoTargets.length,attachmentIds:['photo-'+photoTargets.length]},etag:null,notModified:false};}
 if(path.startsWith('/media?')||path.startsWith('/media'))return {data:photoTargets.map((id,index)=>({id:'photo-'+(index+1),storage_object_id:'object-'+(index+1),entity_type:id==='calf-server'?'ANIMAL':'REPRODUCTION_BIRTH',entity_id:id,relation_code:id==='calf-server'?'PROFILE':'GENERAL',kind:'IMAGE',url:'https://example.test/photo.jpg',tags:[]})),etag:null,notModified:false};
 return {data:{},etag:null,notModified:false};
});
online=true;await runtime.syncOfflineMutations();online=false;
assert.equal(birthWrites,1);assert.deepEqual(photoTargets,['calf-server','birth-server']);
assert.equal((await runtime.listOutbox(birthScope.userId)).length,0);
assert.equal(runtime.reachedReproductionAge('2025-01-31','2025-02-27',1),false);
assert.equal(runtime.reachedReproductionAge('2025-01-31','2025-02-28',1),true);
assert.equal(runtime.reachedReproductionAge('2024-02-29','2025-02-28',12),true);
console.log('PASS: birth/calf photo remapping after restart and calendar-month minimum ages.');

await runtime.putCache(birthScope,'/reproduction/settings',{minimumBullMonths:12});
online=true;
const refreshedRules=await runtime.offlineRequest('/reproduction/settings',{headers},async()=>({data:{minimumBullMonths:24},etag:null,notModified:false}));
assert.equal(refreshedRules.minimumBullMonths,24,'Read the current owner policy even when another property cached older rules');
await assert.rejects(()=>runtime.offlineRequest('/reproduction/settings',{headers},async()=>{throw Object.assign(new Error('Sin permiso'),{status:403});}),/Sin permiso/);
online=false;
console.log('PASS: current owner rules replace stale online reads and permission failures never fall back to cached policies.');
