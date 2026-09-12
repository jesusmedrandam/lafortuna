export type QueueState = 'PENDING' | 'FAILED';

export interface OfflineCacheEntry {
  key: string;
  userId: string;
  path: string;
  payload: unknown;
  savedAt: number;
}

export interface StoredFormEntry {
  key: string;
  value?: string | Blob;
  filename?: string;
  localMediaId?: string;
}

export interface OfflineMutation {
  id: string;
  userId: string;
  path: string;
  method: string;
  bodyType: 'none' | 'json' | 'form';
  jsonBody?: unknown;
  formEntries?: StoredFormEntry[];
  permission: string;
  state: QueueState;
  createdAt: number;
  attempts: number;
  lastError?: string;
  errorStatus?: number;
  errorCode?: string;
  errorDetails?: unknown;
  requestId?: string;
  failedAt?: number;
  temporaryId?: string;
  temporaryChildren?: string[];
  localMediaIds?: string[];
  description?: string;
}

export interface LocalMediaEntry {
  id: string;
  userId: string;
  blob: Blob;
  filename: string;
  mimeType: string;
  createdAt: number;
  remoteUrl?: string;
  optimizedAt?: number;
  originalBytes?: number;
}

export interface OfflineStats {
  cachedRequests: number;
  pending: number;
  failed: number;
  lastDownload: number | null;
  lastSync: number | null;
  structuredBytes: number;
  localMediaBytes: number;
  nativeMediaBytes: number;
  downloadedBytes: number;
}

export interface OfflineTransferPackage {
  format: 'SGB_OFFLINE_TRANSFER';
  version: 3;
  sourceUserId: string;
  exportedAt: number;
  cache: OfflineCacheEntry[];
  settings: Array<{ key: string; value: unknown }>;
  selection: OfflineTransferSelection;
  media: OfflineTransferMedia[];
}

export type OfflineTransferMediaCategory = 'perfiles'|'partos'|'movimientos'|'sanidad'|'potreros'|'actividades'|'otros';
export interface OfflineTransferSelection { moduleIds:string[];mediaCategories:OfflineTransferMediaCategory[] }
export interface OfflineTransferMedia { url:string;category:OfflineTransferMediaCategory }
export interface OfflineTransferOption { id:string;label:string;count:number }

export const offlineTransferMediaLabels:Record<OfflineTransferMediaCategory,string>={
  perfiles:'Perfil y portada de animales',partos:'Partos y reproducción',movimientos:'Movimientos',sanidad:'Sanidad y tratamientos',
  potreros:'Potreros y limpiezas',actividades:'Actividades',otros:'Otra multimedia',
};

const DATABASE_NAME = 'sgb-offline-v1';
const DATABASE_VERSION = 2;
const CACHE_STORE = 'cache';
const QUEUE_STORE = 'queue';
const SETTINGS_STORE = 'settings';
const LOCAL_MEDIA_STORE = 'localMedia';

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CACHE_STORE)) {
        const store = database.createObjectStore(CACHE_STORE, { keyPath: 'key' });
        store.createIndex('userId', 'userId');
      }
      if (!database.objectStoreNames.contains(QUEUE_STORE)) {
        const store = database.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        store.createIndex('userId', 'userId');
      }
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) database.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      if (!database.objectStoreNames.contains(LOCAL_MEDIA_STORE)) {
        const store = database.createObjectStore(LOCAL_MEDIA_STORE, { keyPath: 'id' });
        store.createIndex('userId', 'userId');
        store.createIndex('remoteUrl', 'remoteUrl', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store(name: string, mode: IDBTransactionMode = 'readonly') {
  return (await openDatabase()).transaction(name, mode).objectStore(name);
}

export function offlineCacheKey(userId: string, path: string) {
  return `${userId}:${path}`;
}

export async function putOfflineCache(userId: string, path: string, payload: unknown) {
  const entry: OfflineCacheEntry = { key: offlineCacheKey(userId, path), userId, path, payload, savedAt: Date.now() };
  await requestResult((await store(CACHE_STORE, 'readwrite')).put(entry));
}

export async function getOfflineCache<T>(userId: string, path: string): Promise<T | null> {
  const entry = await requestResult((await store(CACHE_STORE)).get(offlineCacheKey(userId, path))) as OfflineCacheEntry | undefined;
  return (entry?.payload as T | undefined) ?? null;
}

export async function removeOfflineCache(userId: string, path: string) {
  await requestResult((await store(CACHE_STORE, 'readwrite')).delete(offlineCacheKey(userId, path)));
}

export async function clearOfflineCache(userId: string) {
  const objectStore = await store(CACHE_STORE, 'readwrite');
  const request = objectStore.index('userId').openKeyCursor(IDBKeyRange.only(userId));
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      objectStore.delete(cursor.primaryKey);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function listOfflineCacheEntries(userId: string): Promise<OfflineCacheEntry[]> {
  return await requestResult((await store(CACHE_STORE)).index('userId').getAll(userId)) as OfflineCacheEntry[];
}

export async function addOfflineMutation(mutation: OfflineMutation) {
  await requestResult((await store(QUEUE_STORE, 'readwrite')).put(mutation));
}

export async function updateOfflineMutation(mutation: OfflineMutation) {
  await requestResult((await store(QUEUE_STORE, 'readwrite')).put(mutation));
}

export async function removeOfflineMutation(id: string) {
  await requestResult((await store(QUEUE_STORE, 'readwrite')).delete(id));
}

export async function putLocalMedia(entry: LocalMediaEntry) {
  await requestResult((await store(LOCAL_MEDIA_STORE, 'readwrite')).put(entry));
}

export async function getLocalMedia(id: string): Promise<LocalMediaEntry | null> {
  return (await requestResult((await store(LOCAL_MEDIA_STORE)).get(id)) as LocalMediaEntry | undefined) ?? null;
}

export async function getLocalMediaByRemoteUrl(remoteUrl: string): Promise<LocalMediaEntry | null> {
  return (await requestResult((await store(LOCAL_MEDIA_STORE)).index('remoteUrl').get(remoteUrl)) as LocalMediaEntry | undefined) ?? null;
}

export async function linkLocalMediaToRemote(id: string, remoteUrl: string) {
  const entry = await getLocalMedia(id);
  if (entry) await putLocalMedia({ ...entry, remoteUrl });
}

export async function removeLocalMedia(id: string) {
  await requestResult((await store(LOCAL_MEDIA_STORE, 'readwrite')).delete(id));
}

export async function clearLocalMedia(userId: string, preserveIds: string[] = []) {
  const preserved = new Set(preserveIds);
  const objectStore = await store(LOCAL_MEDIA_STORE, 'readwrite');
  const request = objectStore.index('userId').openKeyCursor(IDBKeyRange.only(userId));
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      if (!preserved.has(String(cursor.primaryKey))) objectStore.delete(cursor.primaryKey);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function listOfflineMutations(userId: string): Promise<OfflineMutation[]> {
  const values = await requestResult((await store(QUEUE_STORE)).index('userId').getAll(userId)) as OfflineMutation[];
  return values.sort((left, right) => left.createdAt - right.createdAt);
}

export async function getOfflineSetting<T>(key: string): Promise<T | null> {
  const value = await requestResult((await store(SETTINGS_STORE)).get(key)) as { key: string; value: T } | undefined;
  return value?.value ?? null;
}

export async function putOfflineSetting<T>(key: string, value: T) {
  await requestResult((await store(SETTINGS_STORE, 'readwrite')).put({ key, value }));
}

function transferableSetting(key:string,userId:string){
  if(!key.endsWith(`:${userId}`))return false;
  return ['autoDownloadEnabled:','autoDownloadWifiOnly:','downloadModules:','animalIdentities:'].some((prefix)=>key.startsWith(prefix));
}

function transferableCachePath(path:string){
  if(!path.startsWith('/'))return false;
  return !['/auth','/usuarios','/roles','/configuracion','/dashboard/preferencias','/notificaciones','/auditoria','/animales/opciones/propietarios']
    .some((blocked)=>path===blocked||path.startsWith(`${blocked}/`)||path.startsWith(`${blocked}?`));
}

const transferModuleRules:Array<[string,(path:string)=>boolean]>=[
  ['panel',(path)=>path.startsWith('/dashboard')],
  ['animales',(path)=>path.startsWith('/animales')],
  ['multimedia',(path)=>path.startsWith('/imagenes')],
  ['lugares',(path)=>['/grupos','/ubicaciones','/potreros','/corrales','/configuracion/operaciones-animales'].some((root)=>path.startsWith(root))],
  ['movimientos',(path)=>path.startsWith('/movimientos')],
  ['sanidad',(path)=>['/jornadas-sanitarias','/registros/tratamientos','/condiciones-salud'].some((root)=>path.startsWith(root))],
  ['limpiezas',(path)=>['/limpiezas-potrero','/operadores'].some((root)=>path.startsWith(root))],
  ['reproduccion',(path)=>['/reproduccion','/partos','/registros/abortos'].some((root)=>path.startsWith(root))],
  ['produccion',(path)=>['/registros/lactancias','/registros/producciones','/registros/produccion-tanque'].some((root)=>path.startsWith(root))],
  ['registros',(path)=>['/registros/pesajes','/registros/muertes'].some((root)=>path.startsWith(root))],
  ['comercio',(path)=>['/ventas','/compras'].some((root)=>path.startsWith(root))],
  ['actividades',(path)=>['/actividades','/marquillas'].some((root)=>path.startsWith(root))],
  ['catalogos',(path)=>path.startsWith('/catalogos/')],
];

export function offlineTransferModuleForPath(path:string){
  return transferModuleRules.find(([,matches])=>matches(path))?.[0]??'otros';
}

export function offlineTransferMediaCategoryForContext(context:string):OfflineTransferMediaCategory{
  const value=context.toLowerCase();
  if(/parto|cria|preñez|prenez|celo|aborto|insemin|embrion/.test(value))return'partos';
  if(/movimiento|traslado|grupo_historial|ubicacion_historial/.test(value))return'movimientos';
  if(/sanidad|tratamiento|condicion_salud|medicamento|jornada/.test(value))return'sanidad';
  if(/potrero|limpieza|ubicacion|corral/.test(value))return'potreros';
  if(/actividad|marquilla|herraje|descorne/.test(value))return'actividades';
  if(/animal|perfil|portada|foto_perfil|imagenes_portada/.test(value))return'perfiles';
  return'otros';
}

function collectTransferMedia(value:unknown,path:string,result=new Map<string,OfflineTransferMediaCategory>(),context=path){
  if(typeof value==='string'){
    if(/^https?:\/\//i.test(value)&&(/\.(?:jpe?g|png|webp|gif|avif|mp4|mov)(?:[?#]|$)/i.test(value)||/\/(?:image|video)\/upload\//i.test(value)))result.set(value,offlineTransferMediaCategoryForContext(context));
    return result;
  }
  if(Array.isArray(value)){value.forEach((item,index)=>collectTransferMedia(item,path,result,`${context} ${index}`));return result;}
  if(value&&typeof value==='object'){
    const record=value as Record<string,unknown>;
    const hints=['tipo_entidad','entidad_tipo','tipo','modulo','categoria','descripcion','etiquetas'].map((key)=>record[key]).filter(Boolean).join(' ');
    Object.entries(record).forEach(([key,item])=>collectTransferMedia(item,path,result,`${context} ${key} ${hints}`));
  }
  return result;
}

export async function getOfflineTransferOptions(userId:string){
  const entries=(await listOfflineCacheEntries(userId)).filter((item)=>transferableCachePath(item.path));
  const moduleCounts=new Map<string,number>();const media=new Map<string,OfflineTransferMediaCategory>();
  entries.forEach((item)=>{const id=offlineTransferModuleForPath(item.path);moduleCounts.set(id,(moduleCounts.get(id)??0)+1);collectTransferMedia(item.payload,item.path,media);});
  const mediaCounts=new Map<OfflineTransferMediaCategory,number>();
  media.forEach((category)=>mediaCounts.set(category,(mediaCounts.get(category)??0)+1));
  return{moduleCounts,mediaCounts,media:[...media].map(([url,category])=>({url,category}))};
}

export async function createOfflineTransferPackage(userId:string,selection?:Partial<OfflineTransferSelection>):Promise<OfflineTransferPackage>{
  const settings=await requestResult((await store(SETTINGS_STORE)).getAll()) as Array<{key:string;value:unknown}>;
  const options=await getOfflineTransferOptions(userId);
  const allModules=[...options.moduleCounts.keys()];
  const allMediaCategories=[...options.mediaCounts.keys()];
  const resolved:OfflineTransferSelection={moduleIds:selection?.moduleIds??allModules,mediaCategories:selection?.mediaCategories??allMediaCategories};
  const cache=(await listOfflineCacheEntries(userId)).filter((item)=>transferableCachePath(item.path)&&resolved.moduleIds.includes(offlineTransferModuleForPath(item.path)));
  const selectedMedia=options.media.filter((item)=>resolved.mediaCategories.includes(item.category));
  return{
    format:'SGB_OFFLINE_TRANSFER',version:3,sourceUserId:userId,exportedAt:Date.now(),
    cache,
    settings:settings.filter((item)=>transferableSetting(item.key,userId)),
    selection:resolved,media:selectedMedia,
  };
}

export function inspectOfflineTransferPackage(value:unknown){
  if(!value||typeof value!=='object')throw new Error('El archivo seleccionado no es un respaldo de SGB válido.');
  const transfer=value as Partial<OfflineTransferPackage>&{version?:number};
  if(transfer.format!=='SGB_OFFLINE_TRANSFER'||![1,2,3].includes(Number(transfer.version))||!Array.isArray(transfer.cache)||!Array.isArray(transfer.settings))throw new Error('El formato del respaldo no es compatible con esta versión de SGB.');
  const moduleCounts=new Map<string,number>();
  transfer.cache.forEach((item)=>{if(item&&typeof item.path==='string'){const id=offlineTransferModuleForPath(item.path);moduleCounts.set(id,(moduleCounts.get(id)??0)+1);}});
  const legacyMedia=new Map<string,OfflineTransferMediaCategory>();
  if(Number(transfer.version)<3)transfer.cache.forEach((item)=>collectTransferMedia(item?.payload,item?.path??'',legacyMedia));
  const media=Number(transfer.version)>=3&&Array.isArray(transfer.media)?transfer.media.filter((item)=>item&&typeof item.url==='string'&&item.category in offlineTransferMediaLabels):[...legacyMedia].map(([url,category])=>({url,category}));
  const mediaCounts=new Map<OfflineTransferMediaCategory,number>();media.forEach((item)=>mediaCounts.set(item.category,(mediaCounts.get(item.category)??0)+1));
  return{transfer,moduleCounts,mediaCounts,media};
}

export async function importOfflineTransferPackage(userId:string,value:unknown,selection?:Partial<OfflineTransferSelection>,onProgress?:(current:number,total:number)=>void){
  const inspected=inspectOfflineTransferPackage(value);const transfer=inspected.transfer;
  const sourceUserId=String((transfer as unknown as {sourceUserId?:string;userId?:string}).sourceUserId??(transfer as unknown as {userId?:string}).userId??'');
  if(!sourceUserId)throw new Error('No se pudo identificar el origen del respaldo.');
  if(Number(transfer.version)===1&&sourceUserId!==userId)throw new Error('Esta copia antigua solo puede importarse con la cuenta que la creó. Crea una copia nueva protegida con contraseña.');
  if(transfer.cache!.length>10_000)throw new Error('El respaldo contiene demasiados registros.');
  const moduleIds=selection?.moduleIds??[...inspected.moduleCounts.keys()];
  const mediaCategories=selection?.mediaCategories??[...inspected.mediaCounts.keys()];
  const cache=transfer.cache!.filter((item)=>moduleIds.includes(offlineTransferModuleForPath(item.path)));
  let imported=0;let preserved=0;
  for(let index=0;index<cache.length;index+=1){
    const item=cache[index];
    if(!item||typeof item.path!=='string'||!transferableCachePath(item.path)||item.userId!==sourceUserId)continue;
    const current=await getOfflineCache<unknown>(userId,item.path);
    const currentEntry=current===null?null:await requestResult((await store(CACHE_STORE)).get(offlineCacheKey(userId,item.path))) as OfflineCacheEntry|undefined;
    if(currentEntry&&Number(currentEntry.savedAt)>=Number(item.savedAt)){preserved+=1;continue;}
    await requestResult((await store(CACHE_STORE,'readwrite')).put({...item,key:offlineCacheKey(userId,item.path),userId,savedAt:Number(item.savedAt)||Date.now()}));
    imported+=1;
    onProgress?.(index+1,cache.length);
  }
  for(const item of transfer.settings!){
    if(item&&typeof item.key==='string'&&transferableSetting(item.key,sourceUserId)){
      const destinationKey=`${item.key.slice(0,-sourceUserId.length)}${userId}`;
      await putOfflineSetting(destinationKey,item.value);
    }
  }
  await putOfflineSetting(`lastDownload:${userId}`,Date.now());
  emitOfflineChange();
  return{imported,preserved,total:cache.length,exportedAt:Number(transfer.exportedAt)||null,mediaUrls:inspected.media.filter((item)=>mediaCategories.includes(item.category)).map((item)=>item.url)};
}

export async function getOfflineStats(userId: string): Promise<OfflineStats> {
  const entries = await listOfflineCacheEntries(userId);
  const queue = await listOfflineMutations(userId);
  const localMedia = await requestResult((await store(LOCAL_MEDIA_STORE)).index('userId').getAll(userId)) as LocalMediaEntry[];
  const encoder = new TextEncoder();
  const structuredBytes = entries.reduce((total, entry) => {
    try { return total + encoder.encode(JSON.stringify(entry.payload)).byteLength; }
    catch { return total; }
  }, 0);
  const localMediaBytes = localMedia.reduce((total, entry) => total + Number(entry.blob?.size ?? 0), 0);
  let nativeMediaBytes = 0;
  try {
    const raw = window.SGBAndroid?.getMediaCacheInfo?.();
    if (raw) nativeMediaBytes = Number((JSON.parse(raw) as { bytes?: number }).bytes ?? 0);
  } catch { /* El puente nativo puede no estar disponible en el navegador. */ }
  return {
    cachedRequests: entries.length,
    pending: queue.filter((item) => item.state === 'PENDING').length,
    failed: queue.filter((item) => item.state === 'FAILED').length,
    lastDownload: await getOfflineSetting<number>(`lastDownload:${userId}`),
    lastSync: await getOfflineSetting<number>(`lastSync:${userId}`),
    structuredBytes,
    localMediaBytes,
    nativeMediaBytes,
    downloadedBytes: structuredBytes + localMediaBytes + nativeMediaBytes,
  };
}

export function emitOfflineChange() {
  window.dispatchEvent(new CustomEvent('sgb-offline-change'));
}
