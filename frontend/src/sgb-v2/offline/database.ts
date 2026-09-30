export interface OfflineScope {
  userId: string;
  propertyId: string | null;
  roleId: string | null;
}

export interface CacheEntry {
  key: string;
  scopeKey: string;
  path: string;
  payload: unknown;
  etag: string | null;
  savedAt: number;
}

export interface StoredFormPart {
  name: string;
  value: string | Blob;
  filename?: string;
}

export interface OutboxEntry {
  id: string;
  idempotencyKey: string;
  scope: OfflineScope;
  path: string;
  method: string;
  bodyType: 'none' | 'json' | 'form';
  jsonBody: unknown;
  formParts: StoredFormPart[];
  temporaryId: string | null;
  state: 'PENDING' | 'FAILED';
  attempts: number;
  createdAt: number;
  lastError: string | null;
  errorCode: string | null;
}

export interface SessionSnapshot<T = unknown> {
  id: 'last-session';
  userId: string;
  payload: T;
  savedAt: number;
}

const DATABASE_NAME = 'sgb-v2-offline-v1';
const DATABASE_VERSION = 1;
const CACHE = 'cache';
const OUTBOX = 'outbox';
const SETTINGS = 'settings';
const SESSIONS = 'sessions';

let opening: Promise<IDBDatabase> | null = null;

function database() {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE)) {
        const cache = db.createObjectStore(CACHE, { keyPath: 'key' });
        cache.createIndex('scopeKey', 'scopeKey');
      }
      if (!db.objectStoreNames.contains(OUTBOX)) {
        const outbox = db.createObjectStore(OUTBOX, { keyPath: 'id' });
        outbox.createIndex('userId', 'scope.userId');
        outbox.createIndex('state', 'state');
      }
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(SESSIONS)) db.createObjectStore(SESSIONS, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}

function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store(name: string, mode: IDBTransactionMode = 'readonly') {
  return (await database()).transaction(name, mode).objectStore(name);
}

export function offlineScopeKey(scope: OfflineScope) {
  return [scope.userId, scope.propertyId ?? 'none', scope.roleId ?? 'none']
    .map(encodeURIComponent).join(':');
}

export function offlineCacheKey(scope: OfflineScope, path: string) {
  return `${offlineScopeKey(scope)}:${path}`;
}

export async function getCache<T>(scope: OfflineScope, path: string): Promise<(Omit<CacheEntry,'payload'>&{payload:T}) | null> {
  return (await result((await store(CACHE)).get(offlineCacheKey(scope, path))) as
    (Omit<CacheEntry,'payload'>&{payload:T}) | undefined) ?? null;
}

export async function putCache(scope: OfflineScope, path: string, payload: unknown, etag: string | null = null) {
  const entry: CacheEntry = {
    key: offlineCacheKey(scope, path), scopeKey: offlineScopeKey(scope), path,
    payload, etag, savedAt: Date.now(),
  };
  await result((await store(CACHE, 'readwrite')).put(entry));
}

export async function listCache(scope: OfflineScope) {
  return await result((await store(CACHE)).index('scopeKey').getAll(offlineScopeKey(scope))) as CacheEntry[];
}

export async function clearScopeCache(scope: OfflineScope) {
  const objectStore = await store(CACHE, 'readwrite');
  const cursorRequest = objectStore.index('scopeKey').openKeyCursor(IDBKeyRange.only(offlineScopeKey(scope)));
  await new Promise<void>((resolve, reject) => {
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return resolve();
      objectStore.delete(cursor.primaryKey);
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
  });
}

export async function putOutbox(entry: OutboxEntry) {
  await result((await store(OUTBOX, 'readwrite')).put(entry));
}

export async function removeOutbox(id: string) {
  await result((await store(OUTBOX, 'readwrite')).delete(id));
}

export async function listOutbox(userId: string) {
  const entries = await result((await store(OUTBOX)).index('userId').getAll(userId)) as OutboxEntry[];
  return entries.sort((left, right) => left.createdAt - right.createdAt);
}

export async function getSetting<T>(key: string): Promise<T | null> {
  const entry = await result((await store(SETTINGS)).get(key)) as {key:string;value:T}|undefined;
  return entry?.value ?? null;
}

export async function putSetting<T>(key: string, value: T) {
  await result((await store(SETTINGS, 'readwrite')).put({ key, value }));
}

export async function putSessionSnapshot<T>(userId: string, payload: T) {
  const snapshot: SessionSnapshot<T> = { id: 'last-session', userId, payload, savedAt: Date.now() };
  await result((await store(SESSIONS, 'readwrite')).put(snapshot));
}

export async function getSessionSnapshot<T>() {
  return (await result((await store(SESSIONS)).get('last-session')) as SessionSnapshot<T>|undefined) ?? null;
}

export async function clearSessionSnapshot() {
  await result((await store(SESSIONS, 'readwrite')).delete('last-session'));
}

export async function getOfflineSize(scope: OfflineScope) {
  const entries = await listCache(scope);
  const bytes = new Blob(entries.map(entry => JSON.stringify(entry.payload))).size;
  return { entries: entries.length, bytes, savedAt: entries.reduce((latest, item) => Math.max(latest, item.savedAt), 0) || null };
}
