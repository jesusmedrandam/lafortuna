import { clearSession, loadSession, saveSession } from './storage';
import type { Animal, AnimalFilterOptions, ApiFailure, ApiSuccess, AuthTokens, Birth, GenericRecord, Group, Location, MultimediaItem, OwnerOption, SelectableAnimal, TankProduction } from '../types/api';
import {
  addOfflineMutation, emitOfflineChange, getLocalMedia, getLocalMediaByRemoteUrl, getOfflineCache, getOfflineSetting,
  linkLocalMediaToRemote, listOfflineCacheEntries, listOfflineMutations, putLocalMedia, putOfflineCache, putOfflineSetting,
  removeOfflineCache, removeOfflineMutation, updateOfflineMutation,
  type OfflineMutation, type StoredFormEntry,
} from '../offline/database';
import { permissionForMutation, userHasPermission } from '../offline/permissions';
import { validateOfflineMutation } from '../offline/validation';
import { showLocalNotification, SYNC_NOTIFICATION_ID } from '../offline/native';
import { describeOfflineMutation } from '../offline/descriptions';

export const API_URL = (import.meta.env.VITE_API_URL || 'https://lafortuna.onrender.com/api').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  auth?: boolean;
  retryAuth?: boolean;
};

let refreshPromise: Promise<AuthTokens | null> | null = null;
let synchronizationPromise: Promise<{ synced: number; failed: number }> | null = null;
let serverReachable: boolean | null = null;
export type ConnectionQuality = 'stable' | 'unstable' | 'offline';
let connectionQuality: ConnectionQuality = 'unstable';
let lastServerProbe = 0;
let serverProbePromise: Promise<boolean> | null = null;
let serverWakePromise: Promise<boolean> | null = null;
let lastServerWake = 0;
let nextAutomaticSyncAt = 0;
let transientSyncFailures = 0;

const SERVER_URL = API_URL.replace(/\/api$/, '');
const REQUEST_TIMEOUT_MS = 45_000;
// Evita abortar y reenviar desde cero un multipart grande mientras el teléfono
// siga conectado. Cada reintento completo volvería a consumir todos sus bytes.
const UPLOAD_TIMEOUT_MIN_MS = 15 * 60_000;
const UPLOAD_TIMEOUT_MAX_MS = 45 * 60_000;
const PROBE_TIMEOUT_MS = 8_000;
const WAKE_PROBE_TIMEOUT_MS = 15_000;
const WAKE_BUDGET_MS = 100_000;
const WAKE_RETRY_DELAY_MS = 2_500;
const WAKE_COOLDOWN_MS = 30_000;

class ServerUnavailableError extends Error {
  constructor(message = 'No se pudo conectar con el servidor de SGB.') {
    super(message);
    this.name = 'ServerUnavailableError';
  }
}

class SlowConnectionError extends ServerUnavailableError {
  constructor(message = 'La transferencia está tardando más de lo esperado. Se conservará para reintentarla.') {
    super(message);
    this.name = 'SlowConnectionError';
  }
}

function isAndroidOfflineEnabled() {
  return typeof window !== 'undefined' && Boolean(window.SGBAndroid) && 'indexedDB' in window;
}

function hasDeviceNetworkConnection() {
  if (typeof window === 'undefined') return true;
  try { return window.SGBAndroid?.isOnline?.() ?? navigator.onLine; }
  catch { return navigator.onLine; }
}

export function hasNetworkConnection() {
  return hasDeviceNetworkConnection() && serverReachable !== false;
}

export function getConnectionQuality(): ConnectionQuality {
  if (!hasDeviceNetworkConnection()) return 'offline';
  return connectionQuality;
}

function updateConnectionQuality(value: ConnectionQuality) {
  const changed = connectionQuality !== value;
  connectionQuality = value;
  serverReachable = value === 'stable' ? true : value === 'offline' ? false : null;
  lastServerProbe = Date.now();
  if (changed && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sgb-connectivity-verified', { detail: { online: value === 'stable', quality: value } }));
  }
}

function updateServerReachability(value: boolean) {
  updateConnectionQuality(value ? 'stable' : 'offline');
}

function updateServerWaking(value: boolean) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sgb-server-waking', { detail: { waking: value } }));
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

function bodySize(body: unknown) {
  if (!(body instanceof FormData)) return 0;
  let bytes = 0;
  body.forEach((value) => { bytes += typeof value === 'string' ? value.length : value.size; });
  return bytes;
}

function requestTimeout(body: unknown) {
  if (!(body instanceof FormData)) return REQUEST_TIMEOUT_MS;
  const estimated = UPLOAD_TIMEOUT_MIN_MS + Math.ceil(bodySize(body) / (1024 * 1024)) * 45_000;
  return Math.min(UPLOAD_TIMEOUT_MAX_MS, estimated);
}

async function optimizeImage(blob: Blob, filename: string) {
  if (!blob.type.startsWith('image/') || blob.type === 'image/gif' || blob.size < 900 * 1024 || typeof createImageBitmap !== 'function') {
    return { blob, filename, optimized: false };
  }
  try {
    const bitmap = await createImageBitmap(blob);
    const maximum = 2048;
    const ratio = Math.min(1, maximum / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * ratio));
    const height = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d', { alpha: true })?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const mimeType = blob.type === 'image/png' || blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
    const compressed = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, 0.82));
    if (!compressed || compressed.size >= blob.size * 0.92) return { blob, filename, optimized: false };
    const extension = mimeType === 'image/webp' ? 'webp' : 'jpg';
    return { blob: compressed, filename: filename.replace(/\.[^.]+$/, '') + `.${extension}`, optimized: true };
  } catch {
    return { blob, filename, optimized: false };
  }
}

async function probeServer(timeout: number) {
  return fetchWithTimeout(`${SERVER_URL}/health`, { cache: 'no-store' }, timeout)
    .then((response) => response.ok)
    .catch(() => false);
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

export async function wakeServer(force = false): Promise<boolean> {
  if (!hasDeviceNetworkConnection()) {
    updateServerReachability(false);
    return false;
  }
  if (serverReachable === true && Date.now() - lastServerProbe < 30_000) return true;
  if (!force && serverReachable === false && Date.now() - lastServerWake < WAKE_COOLDOWN_MS) return false;
  if (serverWakePromise) return serverWakePromise;

  lastServerWake = Date.now();
  updateConnectionQuality('unstable');
  updateServerWaking(true);
  serverWakePromise = (async () => {
    const deadline = Date.now() + WAKE_BUDGET_MS;
    while (hasDeviceNetworkConnection() && Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const reachable = await probeServer(Math.min(WAKE_PROBE_TIMEOUT_MS, Math.max(1_000, remaining)));
      if (reachable) {
        updateServerReachability(true);
        return true;
      }
      if (Date.now() + WAKE_RETRY_DELAY_MS < deadline) await wait(WAKE_RETRY_DELAY_MS);
    }
    updateServerReachability(false);
    return false;
  })().finally(() => {
    updateServerWaking(false);
    serverWakePromise = null;
  });
  return serverWakePromise;
}

export async function verifyServerConnection(force = false): Promise<boolean> {
  if (!hasDeviceNetworkConnection()) {
    updateServerReachability(false);
    return false;
  }
  if (force) return wakeServer(true);
  if (serverReachable !== null && Date.now() - lastServerProbe < 10_000) return serverReachable;
  if (!serverProbePromise) {
    serverProbePromise = probeServer(PROBE_TIMEOUT_MS)
      .then((reachable) => {
        if (reachable) updateServerReachability(true);
        else if (hasDeviceNetworkConnection()) updateConnectionQuality('unstable');
        else updateServerReachability(false);
        return reachable;
      })
      .finally(() => { serverProbePromise = null; });
  }
  return serverProbePromise;
}

function methodOf(options: RequestOptions) {
  return (options.method || 'GET').toUpperCase();
}

function shouldCache(path: string, options: RequestOptions) {
  return methodOf(options) === 'GET' && options.auth !== false && !path.startsWith('/auth/');
}

async function parseResponse<T>(response: Response): Promise<ApiSuccess<T> | null> {
  if (response.status === 204 || response.status === 304) return null;
  const contentType = response.headers.get('content-type');
  if (!contentType?.includes('application/json')) return null;
  return (await response.json()) as ApiSuccess<T>;
}

async function refreshSession(): Promise<AuthTokens | null> {
  const current = loadSession();
  if (!current?.refreshToken) return null;
  if (!refreshPromise) {
    refreshPromise = fetchWithTimeout(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) return null;
        if (!response.ok) throw new ServerUnavailableError(`El servidor no pudo renovar la sesión (HTTP ${response.status}).`);
        const payload = (await response.json()) as ApiSuccess<AuthTokens>;
        saveSession(payload.data);
        updateServerReachability(true);
        window.dispatchEvent(new CustomEvent('mm-session-updated'));
        return payload.data;
      })
      .catch((error) => {
        if (error instanceof ServerUnavailableError) throw error;
        if (hasDeviceNetworkConnection()) updateConnectionQuality('unstable');
        else updateServerReachability(false);
        throw new ServerUnavailableError('No se pudo renovar la sesión porque el servidor no está disponible.');
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

function requestBody(body: unknown): BodyInit | undefined {
  if (body === undefined) return undefined;
  return body instanceof FormData ? body : JSON.stringify(body);
}

async function networkResponse(path: string, options: RequestOptions): Promise<Response> {
  const { auth = true, retryAuth = true, body, headers, ...rest } = options;
  const session = loadSession();
  const requestHeaders = new Headers(headers);
  if (body !== undefined && !(body instanceof FormData)) requestHeaders.set('Content-Type', 'application/json');
  if (auth && session?.accessToken) requestHeaders.set('Authorization', `Bearer ${session.accessToken}`);
  let response: Response;
  try {
    response = await fetchWithTimeout(`${API_URL}${path}`, { ...rest, headers: requestHeaders, body: requestBody(body) }, requestTimeout(body));
    updateServerReachability(true);
  } catch (error) {
    if (!hasDeviceNetworkConnection()) updateServerReachability(false);
    else updateConnectionQuality('unstable');
    if (error instanceof ServerUnavailableError) throw error;
    throw error instanceof DOMException && error.name === 'AbortError'
      ? new SlowConnectionError(body instanceof FormData
        ? 'La carga del archivo tardó demasiado. Quedó guardada y se reintentará con una conexión estable.'
        : 'El servidor tardó demasiado en responder. La operación quedó guardada para reintentarse.')
      : new ServerUnavailableError('No se pudo establecer conexión con el servidor.');
  }
  if (response.status === 401 && auth && retryAuth) {
    let refreshed: AuthTokens | null;
    try { refreshed = await refreshSession(); }
    catch (error) { throw error; }
    if (refreshed) return networkResponse(path, { ...options, retryAuth: false });
    clearSession();
    window.dispatchEvent(new CustomEvent('mm-session-expired'));
  }
  return response;
}

async function responseError(response: Response) {
  let payload: ApiFailure | null = null;
  try { payload = (await response.json()) as ApiFailure; } catch { /* Respuesta no JSON. */ }
  return new ApiError(
    response.status,
    payload?.error.code ?? 'HTTP_ERROR',
    payload?.error.message ?? `Error HTTP ${response.status}`,
    payload?.error.details,
    payload?.requestId,
  );
}

function isNetworkFailure(error: unknown) {
  return !hasNetworkConnection() || error instanceof ServerUnavailableError || error instanceof TypeError || (error instanceof DOMException && (error.name === 'NetworkError' || error.name === 'AbortError'));
}

async function storedFormEntries(form: FormData, userId: string, mutationId: string): Promise<{ entries: StoredFormEntry[]; localMediaIds: string[] }> {
  const entries: StoredFormEntry[] = [];
  const localMediaIds: string[] = [];
  const rawEntries = [...form.entries()];
  for (let index = 0; index < rawEntries.length; index += 1) {
    const [key, value] = rawEntries[index];
    if (typeof value === 'string') {
      entries.push({ key, value });
      continue;
    }
    const localMediaId = `${mutationId}-${index}-${crypto.randomUUID()}`;
    const filename = value.name || `archivo-${index + 1}`;
    const optimized = await optimizeImage(value, filename);
    await putLocalMedia({
      id: localMediaId,
      userId,
      blob: optimized.blob,
      filename: optimized.filename,
      mimeType: optimized.blob.type || value.type || 'application/octet-stream',
      createdAt: Date.now(),
      optimizedAt: optimized.optimized ? Date.now() : undefined,
      originalBytes: value.size,
    });
    entries.push({ key, filename: optimized.filename, localMediaId });
    localMediaIds.push(localMediaId);
  }
  return { entries, localMediaIds };
}

function temporaryIdField(path: string) {
  if (path === '/animales') return 'id_animal';
  if (path === '/grupos') return 'id_grupo';
  if (path === '/movimientos') return 'id_movimiento';
  if (path === '/potreros') return 'id_potrero';
  if (path === '/corrales') return 'id_corral';
  if (path === '/ubicaciones') return 'id_ubicacion';
  if (path === '/limpiezas-potrero') return 'id_limpieza';
  if (path === '/actividades') return 'id_actividad';
  if (path === '/partos') return 'id_parto';
  if (path === '/compras') return 'id_compra';
  if (path === '/ventas') return 'id_venta';
  if (path === '/ventas/productos') return 'id_venta_producto';
  if (path === '/registros/lactancias') return 'id_lactancia';
  if (path === '/registros/producciones') return 'id_produccion';
  if (path === '/registros/produccion-tanque') return 'id_produccion_tanque';
  if (path === '/registros/tratamientos') return 'id_tratamiento';
  if (path === '/registros/pesajes') return 'id_pesaje';
  if (path === '/registros/muertes') return 'id_muerte';
  if (path === '/registros/abortos') return 'id_aborto';
  if (path === '/reproduccion/celos') return 'id_celo';
  if (path === '/reproduccion/preneces') return 'id_prenez';
  if (path === '/jornadas-sanitarias') return 'id_jornada';
  if (path === '/condiciones-salud') return 'id_condicion_salud';
  if (path === '/operadores') return 'id_operador';
  if (path === '/marquillas') return 'id_marquilla';
  const catalog = path.match(/^\/catalogos\/([^/?]+)/)?.[1];
  if (catalog) return catalogIdFields[catalog] ?? null;
  return null;
}

const catalogIdFields: Record<string, string> = {
  compradores: 'id_comprador',
  'productos-venta': 'id_producto_venta',
  unidades: 'id_unidad',
  'tipos-producto-compra': 'id_tipo_producto',
  'tipos-actividad': 'id_tipo_actividad',
  'etiquetas-multimedia': 'id_etiqueta',
  'categorias-animales': 'id_categoria_animal',
  'condiciones-animales': 'id_condicion_animal',
  especies: 'id_especie',
  origenes: 'id_origen',
  colores: 'id_color',
  razas: 'id_raza',
  'tipos-grupo': 'id_tipo_grupo',
  pastos: 'id_pasto',
  'usos-potrero': 'id_tipo_uso_potrero',
  'tipos-corral': 'id_tipo_corral',
  'motivos-movimiento': 'id_motivo_movimiento',
  'tipos-limpieza': 'id_tipo_limpieza',
  'categorias-agroquimicos': 'id_categoria_producto',
  agroquimicos: 'id_producto_agroquimico',
  'tipos-tratamiento': 'id_tipo_tratamiento',
  'tipos-condicion-salud': 'id_tipo_condicion_salud',
  vias: 'id_via_administracion',
  medicamentos: 'id_medicamento',
};

async function queueOfflineMutation<T>(path: string, options: RequestOptions): Promise<T> {
  const session = loadSession();
  if (!session?.user) throw new ApiError(0, 'OFFLINE_NO_SESSION', 'Inicia sesión con conexión antes de trabajar sin internet.');
  const method = methodOf(options);
  const permission = permissionForMutation(path, method);
  if (!permission) throw new ApiError(0, 'OFFLINE_NOT_SUPPORTED', 'Esta operación necesita conexión a internet.');
  if (!userHasPermission(session.user, permission)) throw new ApiError(403, 'FORBIDDEN', 'Tu usuario no tiene permiso para guardar esta operación.');

  const validation = validateOfflineMutation(path, method, options.body);
  if (validation.errors.length) {
    throw new ApiError(400, 'OFFLINE_VALIDATION_ERROR', validation.errors.join(' '), { formErrors: validation.errors, fieldErrors: {} });
  }
  await assertNoOfflineMilkProductionDuplicate(session.user.id, path, method, options.body);

  const idField = method === 'POST' ? temporaryIdField(path) : null;
  const temporaryId = idField ? `offline-${crypto.randomUUID()}` : undefined;
  const birthChildren = path === '/partos' && options.body && typeof options.body === 'object' && Array.isArray((options.body as { crias?: unknown[] }).crias)
    ? (options.body as { crias: unknown[] }).crias.map(() => `offline-${crypto.randomUUID()}`) : undefined;
  const bodyType: OfflineMutation['bodyType'] = options.body instanceof FormData ? 'form' : options.body === undefined ? 'none' : 'json';
  const mutationId = crypto.randomUUID();
  const storedForm = bodyType === 'form' ? await storedFormEntries(options.body as FormData, session.user.id, mutationId) : null;
  const mutation: OfflineMutation = {
    id: mutationId, userId: session.user.id, path, method, permission,
    bodyType, jsonBody: bodyType === 'json' ? options.body : undefined,
    formEntries: storedForm?.entries,
    localMediaIds: storedForm?.localMediaIds,
    state: 'PENDING', createdAt: Date.now(), attempts: 0, temporaryId, temporaryChildren: birthChildren,
    description: await describeOfflineMutation(session.user.id, path, method, options.body),
  };
  await addOfflineMutation(mutation);
  emitOfflineChange();
  window.SGBAndroid?.setPendingMutations?.((await listOfflineMutations(session.user.id)).length);
  let optimistic: Record<string, unknown> = typeof options.body === 'object' && options.body !== null && !(options.body instanceof FormData)
    ? { ...(options.body as Record<string, unknown>) } : {};
  if (options.body instanceof FormData) {
    const data = options.body.get('data');
    if (typeof data === 'string') {
      try { optimistic = JSON.parse(data) as Record<string, unknown>; } catch { /* El formulario puede no usar un campo data. */ }
    }
    options.body.forEach((value, key) => {
      if (typeof value !== 'string' || key === 'data') return;
      try { optimistic[key] = JSON.parse(value) as unknown; }
      catch { optimistic[key] = value; }
    });
  }
  if (idField && temporaryId) optimistic[idField] = temporaryId;
  if (path === '/animales' && method === 'POST' && temporaryId) {
    const profileMediaId = storedForm?.entries.find((entry) => entry.key === 'foto_perfil')?.localMediaId;
    if (profileMediaId) {
      const profileUrl = `sgb-local-media://${profileMediaId}`;
      optimistic.foto_perfil = profileUrl;
      optimistic.imagenes = [{
        id_imagen: `offline-${profileMediaId}`,
        id_animal: temporaryId,
        secure_url: profileUrl,
        public_id: `offline-${profileMediaId}`,
        es_perfil: true,
        descripcion: null,
        orden: 0,
        fecha_toma: new Date().toISOString().slice(0, 10),
        created_at: new Date().toISOString(),
        tipo_archivo: 'IMAGEN',
        animales: [{ id_animal: temporaryId, nombre: String(optimistic.nombre ?? 'Animal'), codigo_arete: optimistic.codigo_arete ?? null }],
        __offline: true,
        __sync_state: 'PENDING',
      }];
    }
  }
  if (birthChildren && Array.isArray(optimistic.crias)) {
    optimistic.crias = optimistic.crias.map((child, index) => {
      const record = child as { animal?: { nombre?: string } };
      return { ...(child as Record<string, unknown>), id_cria: birthChildren[index], cria: record.animal?.nombre ?? `Cría ${index + 1}` };
    });
  }
  optimistic.__offline = true;
  optimistic.__sync_state = 'PENDING';
  optimistic.__mutation_id = mutation.id;
  if (path === '/movimientos' && method === 'POST') optimistic = normalizeMovement(optimistic, mutation.id);
  await applyOptimisticMutation(session.user.id, path, method, optimistic);
  await applyOptimisticAction(session.user.id, path, method);
  if (method === 'DELETE') await applyOptimisticMediaDeletion(session.user.id, path);
  const optimisticMedia = storedForm?.localMediaIds.length
    ? await applyOptimisticMediaMutation(session.user.id, path, optimistic, storedForm.localMediaIds)
    : null;
  if (optimisticMedia?.length) return (optimisticMedia.length === 1 ? optimisticMedia[0] : optimisticMedia) as T;
  return await materializeLocalMedia(optimistic) as T;
}

async function assertNoOfflineMilkProductionDuplicate(userId: string, path: string, method: string, body: unknown) {
  if (pathWithoutQuery(path) !== '/registros/producciones' || method !== 'POST' || !body || typeof body !== 'object' || body instanceof FormData) return;
  const input = body as Record<string, unknown>;
  const animalId = String(input.id_vaca ?? '');
  const date = String(input.fecha_produccion ?? '');
  const shift = String(input.turno ?? 'UNICO');
  if (!animalId || !date) return;

  const duplicate = (value: unknown) => {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return String(record.id_vaca ?? '') === animalId
      && String(record.fecha_produccion ?? '').slice(0, 10) === date.slice(0, 10)
      && String(record.turno ?? 'UNICO') === shift
      && record.deleted_at == null;
  };
  const entries = await listOfflineCacheEntries(userId);
  const cachedDuplicate = entries
    .filter((entry) => pathWithoutQuery(entry.path) === '/registros/producciones')
    .some((entry) => dataArray<unknown>(entry.payload).some(duplicate));
  const pendingDuplicate = (await listOfflineMutations(userId)).some((item) =>
    item.state !== 'FAILED'
      && item.method === 'POST'
      && pathWithoutQuery(item.path) === '/registros/producciones'
      && duplicate(item.jsonBody));
  if (cachedDuplicate || pendingDuplicate) {
    throw new ApiError(409, 'DUPLICATE_MILK_PRODUCTION', `Ya existe una producción para este animal el ${date.slice(0, 10)} en el turno ${shift.toLowerCase()}.`, {
      formErrors: [], fieldErrors: { id_vaca: ['Este registro ya existe en los datos descargados o pendientes.'] },
    });
  }
}

function endpointRoot(path: string) {
  const catalogRoot = path.match(/^\/catalogos\/[^/?]+/)?.[0];
  if (catalogRoot) return catalogRoot;
  const roots = ['/ventas/productos', '/registros/produccion-tanque', '/registros/tratamientos', '/registros/lactancias', '/registros/producciones', '/registros/pesajes', '/registros/muertes', '/registros/abortos', '/reproduccion/celos', '/reproduccion/preneces', '/limpiezas-potrero', '/jornadas-sanitarias', '/condiciones-salud'];
  return roots.find((root) => path === root || path.startsWith(`${root}/`)) ?? `/${path.split('/').filter(Boolean)[0] ?? ''}`;
}

function matchesEntityId(value: unknown, idField: string, id: string) {
  return Boolean(value && typeof value === 'object' && (value as Record<string, unknown>)[idField] === id);
}

function pathWithoutQuery(path: string) {
  return path.split('?')[0];
}

interface AnimalIdentity { id_animal: string; nombre: string; codigo_arete: string | null }

function unwrapApiData(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) break;
    const record = current as Record<string, unknown>;
    if (!('data' in record) || (record.ok !== true && !('meta' in record))) break;
    current = record.data;
  }
  return current;
}

function dataArray<T>(value: unknown): T[] {
  const unwrapped = unwrapApiData(value);
  return Array.isArray(unwrapped) ? unwrapped as T[] : [];
}

function animalsFromPayload(value: unknown): Animal[] {
  const unwrapped = unwrapApiData(value);
  if (Array.isArray(unwrapped)) return unwrapped as Animal[];
  if (unwrapped && typeof unwrapped === 'object' && typeof (unwrapped as Animal).id_animal === 'string') return [unwrapped as Animal];
  return [];
}

async function rememberAnimalIdentities(userId: string, value: unknown) {
  const animals = animalsFromPayload(value).filter((animal) => typeof animal?.id_animal === 'string' && typeof animal?.nombre === 'string');
  if (!animals.length) return;
  const key = `animalIdentities:${userId}`;
  const current = (await getOfflineSetting<Record<string, AnimalIdentity>>(key)) ?? {};
  for (const animal of animals) current[animal.id_animal] = {
    id_animal: animal.id_animal,
    nombre: animal.nombre,
    codigo_arete: animal.codigo_arete ?? null,
  };
  await putOfflineSetting(key, current);
}

function mergeDefinedAnimal(previous: Animal | undefined, incoming: Animal) {
  const merged = { ...(previous ?? {}) } as Animal;
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value;
  }
  return merged;
}

async function mergeAnimalsIntoOfflineBase(userId: string, value: unknown) {
  const incoming = animalsFromPayload(value).filter((animal) => typeof animal?.id_animal === 'string');
  if (!incoming.length) return;
  const cached = await getOfflineCache<unknown>(userId, '/animales?limit=100');
  const current = dataArray<Animal>(cached);
  const merged = new Map(current.map((animal) => [animal.id_animal, animal]));
  for (const animal of incoming) merged.set(animal.id_animal, mergeDefinedAnimal(merged.get(animal.id_animal), animal));
  await putOfflineCache(userId, '/animales?limit=100', [...merged.values()]);
  await rememberAnimalIdentities(userId, incoming);
}

async function rememberAnimalsProgressively(userId: string, path: string, value: unknown) {
  const cleanPath = pathWithoutQuery(path);
  if (cleanPath !== '/animales' && !/^\/animales\/[^/]+$/.test(cleanPath)) return;
  await mergeAnimalsIntoOfflineBase(userId, value);
}

async function updateAnimalIdentity(userId: string, id: string, method: string, value: Record<string, unknown>) {
  const key = `animalIdentities:${userId}`;
  const current = (await getOfflineSetting<Record<string, AnimalIdentity>>(key)) ?? {};
  if (method === 'DELETE') delete current[id];
  else {
    const previous = current[id];
    const nombre = typeof value.nombre === 'string' ? value.nombre : previous?.nombre;
    if (nombre) current[id] = {
      id_animal: id,
      nombre,
      codigo_arete: value.codigo_arete === null || typeof value.codigo_arete === 'string' ? value.codigo_arete : previous?.codigo_arete ?? null,
    };
  }
  await putOfflineSetting(key, current);
}

async function loadOfflineAnimals(userId: string): Promise<Animal[] | null> {
  const cached = await getOfflineCache<unknown>(userId, '/animales?limit=100');
  const animals = dataArray<Animal>(cached);
  if (cached !== null && cached !== animals) await putOfflineCache(userId, '/animales?limit=100', animals);
  const identities = (await getOfflineSetting<Record<string, AnimalIdentity>>(`animalIdentities:${userId}`)) ?? {};
  const entries = await listOfflineCacheEntries(userId);
  const details = new Map<string, Animal>();
  for (const entry of entries) {
    const match = entry.path.match(/^\/animales\/([^/?]+)$/);
    if (!match || !entry.payload || typeof entry.payload !== 'object' || Array.isArray(entry.payload)) continue;
    const detail = entry.payload as Animal;
    if (detail.id_animal === match[1]) details.set(match[1], detail);
  }
  if (cached === null && !details.size) return null;
  const mergedAnimals = new Map(animals.map((animal) => [animal.id_animal, animal]));
  for (const [id, detail] of details) mergedAnimals.set(id, mergeDefinedAnimal(mergedAnimals.get(id), detail));
  return [...mergedAnimals.values()].map((animal) => {
    const id = animal.id_animal;
    const merged = mergeDefinedAnimal(animal, details.get(id) ?? animal);
    const identity = identities[id];
    return identity ? { ...merged, ...identity } : merged;
  });
}

function entityDetailId(root: string, path: string) {
  const normalizedRoot = pathWithoutQuery(root).split('/').filter(Boolean);
  const normalizedPath = pathWithoutQuery(path).split('/').filter(Boolean);
  if (normalizedPath.length !== normalizedRoot.length + 1) return null;
  if (!normalizedRoot.every((part, index) => normalizedPath[index] === part)) return null;
  const id = normalizedPath.at(-1) ?? null;
  return id && !['opciones', 'preview', 'seleccion'].includes(id) ? id : null;
}

function isEntityCollectionPath(root: string, path: string) {
  return pathWithoutQuery(path) === pathWithoutQuery(root);
}

function imageHasId(value: unknown, id: string) {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.id_imagen === id || record.id_multimedia === id || record.id_movimiento_imagen === id || record.id_limpieza_imagen === id || record.id_actividad_imagen === id;
}

const localObjectUrls = new Map<string, string>();

function normalizeMovement(value: Record<string, unknown>, fallbackId: string = crypto.randomUUID()): Record<string, unknown> {
  const animals = Array.isArray(value.animales) ? value.animales : [];
  const details = Array.isArray(value.detalles) ? value.detalles : animals.map((item, index) => {
    const animal = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      id_detalle: `${fallbackId}-detalle-${index}`,
      id_animal: String(animal.id_animal ?? ''),
      animal: String(animal.nombre ?? 'Animal pendiente de sincronizar'),
      arete: animal.codigo_arete ?? null,
      seleccionado: animal.seleccionado !== false,
      estado: 'PENDIENTE',
      mensaje_error: null,
      observaciones: animal.observaciones ?? null,
    };
  });
  const sourceProperty = value.id_propiedad_origen ?? value.propiedad_origen ?? null;
  return {
    id_movimiento: value.id_movimiento ?? `offline-${fallbackId}`,
    tipo_movimiento: value.tipo_movimiento ?? 'UBICACION',
    modo_seleccion: value.modo_seleccion ?? 'GRUPO',
    id_grupo_filtro: value.id_grupo_filtro ?? null,
    id_ubicacion_origen: value.id_ubicacion_origen ?? null,
    id_ubicacion_destino: value.id_ubicacion_destino ?? null,
    id_grupo_origen: value.id_grupo_origen ?? value.id_grupo_filtro ?? null,
    id_grupo_destino: value.id_grupo_destino ?? null,
    id_propiedad_origen: sourceProperty === 'PROPIEDAD_PRINCIPAL' ? null : sourceProperty,
    id_propiedad_destino: value.id_propiedad_destino ?? null,
    id_motivo_movimiento: value.id_motivo_movimiento ?? null,
    ubicacion_origen: value.ubicacion_origen ?? null,
    ubicacion_destino: value.ubicacion_destino ?? null,
    grupo_origen: value.grupo_origen ?? null,
    grupo_destino: value.grupo_destino ?? null,
    propiedad_origen: value.propiedad_origen === 'PROPIEDAD_PRINCIPAL' ? 'Propiedad principal' : value.propiedad_origen ?? null,
    propiedad_destino: value.propiedad_destino ?? null,
    propiedad_origen_es_principal: sourceProperty === 'PROPIEDAD_PRINCIPAL' || value.propiedad_origen_es_principal === true,
    propiedad_destino_es_principal: value.propiedad_destino_es_principal ?? null,
    fecha_movimiento: value.fecha_movimiento ?? new Date().toISOString().slice(0, 10),
    motivo: value.motivo ?? null,
    motivo_catalogo: value.motivo_catalogo ?? null,
    observaciones: value.observaciones ?? null,
    estado: value.estado ?? 'BORRADOR',
    total_candidatos: value.total_candidatos ?? details.length,
    total_seleccionados: value.total_seleccionados ?? details.filter((item) => Boolean((item as Record<string, unknown>).seleccionado)).length,
    aplicado_en: value.aplicado_en ?? null,
    detalles: details,
    fotos_origen: Array.isArray(value.fotos_origen) ? value.fotos_origen : [],
    fotos_destino: Array.isArray(value.fotos_destino) ? value.fotos_destino : [],
    ...value,
  };
}

async function normalizeOptimisticAnimal(userId: string, value: Record<string, unknown>): Promise<Record<string, unknown>> {
  const [filters, ownerOptions, origins] = await Promise.all([
    getOfflineCache<AnimalFilterOptions>(userId, '/animales/opciones/filtros'),
    getOfflineCache<OwnerOption[]>(userId, '/animales/opciones/propietarios'),
    getOfflineCache<Record<string,unknown>[]>(userId, '/catalogos/origenes'),
  ]);
  const lookup = <T extends Record<string, unknown>>(items: T[] | undefined, field: keyof T, id: unknown) =>
    items?.find((item) => item[field] === id);
  const rawOwners = Array.isArray(value.propietarios) ? value.propietarios as Record<string, unknown>[] : [];
  const propietarios = rawOwners.map((owner) => {
    const ownerId = owner.id ?? owner.id_usuario;
    const option = ownerOptions?.find((item) => item.id_usuario === ownerId);
    return {
      id_usuario: String(ownerId ?? ''),
      nombre: String(owner.nombre ?? option?.nombre ?? 'Propietario pendiente de sincronizar'),
      correo: String(owner.correo ?? option?.correo ?? ''),
      porcentaje: owner.porcentaje ?? null,
      es_principal: owner.principal === true || owner.es_principal === true,
    };
  });
  const rawColors = Array.isArray(value.colores) ? value.colores as Record<string, unknown>[] : [];
  const colores = rawColors.map((color) => {
    const colorId = color.id ?? color.id_color;
    return {
      id_color: String(colorId ?? ''),
      nombre: String(color.nombre ?? lookup(filters?.colores, 'id_color', colorId)?.nombre ?? 'Color pendiente'),
      es_principal: color.principal === true || color.es_principal === true,
    };
  });
  const rawBreeds = Array.isArray(value.razas) ? value.razas as Record<string, unknown>[] : [];
  const razas = rawBreeds.map((breed) => {
    const breedId = breed.id ?? breed.id_raza;
    return {
      id_raza: String(breedId ?? ''),
      nombre: String(breed.nombre ?? lookup(filters?.razas, 'id_raza', breedId)?.nombre ?? 'Raza pendiente'),
      porcentaje: breed.porcentaje ?? null,
    };
  });
  const species = lookup(filters?.especies, 'id_especie', value.id_especie);
  const category = lookup(filters?.categorias, 'id_categoria_animal', value.id_categoria_animal);
  const group = lookup(filters?.grupos, 'id_grupo', value.id_grupo_actual);
  const location = lookup(filters?.ubicaciones, 'id_ubicacion', value.id_ubicacion_actual);
  const mark = lookup(filters?.marquillas, 'id_marquilla', value.id_marquilla);
  const origin = origins?.find((item)=>item.id_origen===value.id_origen);
  const principalOwner = propietarios.find((owner) => owner.es_principal) ?? propietarios[0];
  return {
    codigo_arete: null,
    nombre: 'Animal pendiente de sincronizar',
    descripcion: null,
    fecha_nacimiento: null,
    id_madre: null,
    madre: null,
    id_padre: null,
    padre: null,
    id_marquilla: null,
    marquilla_foto: null,
    id_grupo_actual: null,
    id_ubicacion_actual: null,
    estado: 'ACTIVO',
    condicion: 'Activo',
    foto_perfil: null,
    imagenes: [],
    eventos_condicion: [],
    crias_registradas: [],
    historial_partos: [],
    historial_celos: [],
    historial_preneces: [],
    historial_abortos: [],
    historial_actividades: [],
    historial_movimientos: [],
    historial_tratamientos: [],
    total_partos: 0,
    total_crias: 0,
    ultimo_pesaje: value.peso_inicial_kg ? {
      peso_kg: value.peso_inicial_kg,
      fecha: value.fecha_pesaje_inicial ?? new Date().toISOString().slice(0, 10),
      metodo: value.metodo_pesaje_inicial ?? null,
    } : null,
    ultimo_tratamiento: null,
    ultimo_movimiento: null,
    ...value,
    especie: species?.nombre ?? 'Pendiente de sincronizar',
    categoria: category?.nombre ?? 'Pendiente de sincronizar',
    categoria_codigo: category?.codigo ?? null,
    grupo: group?.nombre ?? null,
    ubicacion: location?.nombre ?? null,
    marquilla: mark?.nombre ?? null,
    marquilla_codigo: mark?.codigo ?? null,
    origen: origin?.nombre ?? value.origen ?? null,
    propietario_principal: principalOwner?.nombre ?? null,
    propietarios,
    colores,
    razas,
  };
}

async function cachedCatalogLabel(userId: string, catalog: string, id: unknown, idField: string) {
  if (!id) return null;
  const values = await getOfflineCache<Record<string, unknown>[]>(userId, `/catalogos/${catalog}`);
  const item = values?.find((candidate) => candidate[idField] === id);
  return item ? String(item.nombre ?? item.nombre_comercial ?? item.codigo ?? '') || null : null;
}

async function normalizeOptimisticCleaning(userId: string, value: Record<string, unknown>): Promise<Record<string, unknown>> {
  const [pastures, operators] = await Promise.all([
    getOfflineCache<Array<Record<string, unknown>>>(userId, '/potreros'),
    getOfflineCache<Array<Record<string, unknown>>>(userId, '/operadores'),
  ]);
  const typeIds = Array.isArray(value.id_tipos_limpieza)
    ? value.id_tipos_limpieza.map(String).filter(Boolean)
    : value.id_tipo_limpieza ? [String(value.id_tipo_limpieza)] : [];
  const tipos_limpieza = await Promise.all(typeIds.map(async (id) => ({
    id_tipo_limpieza: id,
    nombre: await cachedCatalogLabel(userId, 'tipos-limpieza', id, 'id_tipo_limpieza') ?? 'Limpieza pendiente',
  })));
  const applications = Number(value.cantidad_tanques ?? 0);
  const rawProducts = Array.isArray(value.productos)
    ? value.productos.filter((item) => item && typeof item === 'object') as Record<string, unknown>[]
    : [];
  const productos = await Promise.all(rawProducts.map(async (product) => {
    const productId = String(product.id_producto ?? '');
    const unitId = String(product.id_unidad ?? '');
    const perApplication = Number(product.cantidad_por_tanque ?? 0);
    return {
      ...product,
      id_producto: productId,
      producto: await cachedCatalogLabel(userId, 'agroquimicos', productId, 'id_producto_agroquimico') ?? 'Producto pendiente',
      id_unidad: unitId,
      unidad: await cachedCatalogLabel(userId, 'unidades', unitId, 'id_unidad') ?? '',
      cantidad_por_tanque: product.cantidad_por_tanque ?? null,
      cantidad_total: product.cantidad_total ?? perApplication * applications,
      observaciones: product.observaciones ?? null,
    };
  }));
  const rawOperators = Array.isArray(value.operadores)
    ? value.operadores.filter((item) => item && typeof item === 'object') as Record<string, unknown>[]
    : [];
  const operadores = rawOperators.map((operator) => {
    const operatorId = String(operator.id_operador ?? '');
    const stored = operators?.find((candidate) => candidate.id_operador === operatorId);
    const storedName = [stored?.nombres, stored?.apellidos].filter(Boolean).join(' ');
    return {
      ...operator,
      id_operador: operatorId,
      nombre: String(operator.nombre ?? storedName ?? 'Operador pendiente'),
      funcion: operator.funcion ?? null,
      observaciones: operator.observaciones ?? null,
    };
  });
  const pasture = pastures?.find((candidate) => candidate.id_potrero === value.id_potrero);
  const typeText = tipos_limpieza.map((item) => item.nombre).join(', ') || 'Limpieza pendiente';
  return {
    fecha_finalizacion: null,
    unidad_aplicacion: 'TANQUES',
    cantidad_tanques: null,
    capacidad_tanque_litros: null,
    tipo_area_intervenida: 'TOTAL',
    area_intervenida: null,
    id_unidad_area: null,
    unidad_area: null,
    estado: 'COMPLETADO',
    observaciones: null,
    imagenes: [],
    ...value,
    id_tipo_limpieza: value.id_tipo_limpieza ?? typeIds[0] ?? '',
    tipos_limpieza,
    tipo_limpieza: String(value.tipo_limpieza ?? typeText),
    potrero: String(value.potrero ?? pasture?.nombre ?? 'Potrero pendiente'),
    productos,
    operadores,
  };
}

async function normalizeOperationalRecord(userId: string, root: string, value: Record<string, unknown>): Promise<Record<string, unknown>> {
  const animals = await loadOfflineAnimals(userId);
  const animalId = String(value.id_animal ?? value.id_vaca ?? value.id_madre ?? '');
  const animal = animals?.find((item) => item.id_animal === animalId);
  const common = animal ? {
    animal: value.animal ?? animal.nombre,
    vaca: value.vaca ?? animal.nombre,
    codigo_arete: value.codigo_arete ?? animal.codigo_arete,
    categoria: value.categoria ?? animal.categoria,
    categoria_codigo: value.categoria_codigo ?? animal.categoria_codigo,
  } : {};
  if (root === '/condiciones-salud') return {
    estado: 'POR_RESOLVER', fecha_resolucion: null, total_tratamientos: 0,
    tipo_condicion: await cachedCatalogLabel(userId, 'tipos-condicion-salud', value.id_tipo_condicion_salud, 'id_tipo_condicion_salud'),
    ...common, ...value,
  };
  if (root === '/registros/tratamientos') return { ...common, ...value };
  if (root === '/jornadas-sanitarias') {
    const selected = Array.isArray(value.animales) ? value.animales.filter((item) => item && typeof item === 'object') as Record<string, unknown>[] : [];
    const details = selected.map((item, index) => {
      const linked = animals?.find((animalItem) => animalItem.id_animal === item.id_animal);
      return {
        id_detalle: `offline-${String(value.id_jornada ?? 'jornada')}-${index}`,
        id_animal: item.id_animal,
        animal: linked?.nombre ?? 'Animal pendiente',
        codigo_arete: linked?.codigo_arete ?? null,
        seleccionado: item.seleccionado !== false,
        dosis_aplicada: item.dosis_aplicada ?? null,
        estado: 'PENDIENTE',
      };
    });
    return {
      estado: 'BORRADOR', aplicado_en: null, detalles: details,
      total_candidatos: details.length, total_seleccionados: details.filter((item) => item.seleccionado).length,
      tipo_tratamiento: await cachedCatalogLabel(userId, 'tipos-tratamiento', value.id_tipo_tratamiento, 'id_tipo_tratamiento') ?? 'Tratamiento pendiente',
      medicamento: await cachedCatalogLabel(userId, 'medicamentos', value.id_medicamento, 'id_medicamento') ?? 'Medicamento pendiente',
      via: await cachedCatalogLabel(userId, 'vias', value.id_via_administracion, 'id_via_administracion') ?? 'Vía pendiente',
      unidad: await cachedCatalogLabel(userId, 'unidades', value.id_unidad_dosis, 'id_unidad') ?? '',
      ...value,
    };
  }
  return { ...common, ...value };
}

async function normalizeOptimisticEntity(userId: string, root: string, value: Record<string, unknown>) {
  if (root === '/animales') {
    const animal = await normalizeOptimisticAnimal(userId, value);
    await rememberAnimalIdentities(userId, [animal as unknown as Animal]);
    return animal;
  }
  if (root === '/movimientos') return normalizeMovement(value);
  if (root === '/limpiezas-potrero') return normalizeOptimisticCleaning(userId, value);
  if (['/jornadas-sanitarias', '/condiciones-salud', '/registros/tratamientos', '/registros/lactancias', '/registros/producciones', '/registros/produccion-tanque', '/registros/pesajes', '/registros/muertes', '/registros/abortos', '/reproduccion/celos', '/reproduccion/preneces'].includes(root)) {
    return normalizeOperationalRecord(userId, root, value);
  }
  return value;
}

async function localUrl(id: string) {
  const existing = localObjectUrls.get(id);
  if (existing) return existing;
  const media = await getLocalMedia(id);
  if (!media) return null;
  const url = URL.createObjectURL(media.blob);
  localObjectUrls.set(id, url);
  return url;
}

async function materializeLocalMedia(value: unknown): Promise<unknown> {
  if (typeof value === 'string') {
    if (value.startsWith('sgb-local-media://')) return (await localUrl(value.slice('sgb-local-media://'.length))) ?? value;
    if (/^https?:\/\//i.test(value)) {
      const local = await getLocalMediaByRemoteUrl(value);
      if (local) return (await localUrl(local.id)) ?? value;
    }
    return value;
  }
  if (Array.isArray(value)) return Promise.all(value.map(materializeLocalMedia));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) result[key] = await materializeLocalMedia(child);
    return result;
  }
  return value;
}

async function prepareOfflinePayload(path: string, payload: unknown): Promise<unknown> {
  let prepared = unwrapApiData(payload);
  if (path === '/movimientos' && Array.isArray(prepared)) prepared = prepared.map((item) => normalizeMovement((item ?? {}) as Record<string, unknown>));
  else if (/^\/movimientos\/[^/?]+$/.test(path) && prepared && typeof prepared === 'object') prepared = normalizeMovement(prepared as Record<string, unknown>);
  return materializeLocalMedia(prepared);
}

function mutateCachedPayload(payload: unknown, method: string, rootCreate: boolean, id: string | null, idField: string, optimistic: Record<string, unknown>): unknown {
  if (Array.isArray(payload)) {
    if (method === 'POST' && rootCreate) {
      const optimisticId = typeof optimistic[idField] === 'string' ? String(optimistic[idField]) : null;
      return optimisticId && payload.some((item) => matchesEntityId(item, idField, optimisticId))
        ? payload.map((item) => matchesEntityId(item, idField, optimisticId) ? { ...(item as Record<string, unknown>), ...optimistic } : item)
        : [optimistic, ...payload];
    }
    if (method === 'DELETE' && id) return payload.filter((item) => !matchesEntityId(item, idField, id));
    if ((method === 'PATCH' || method === 'PUT') && id) return payload.map((item) => matchesEntityId(item, idField, id) ? { ...(item as Record<string, unknown>), ...optimistic } : item);
    return payload;
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if ('ok' in record && 'data' in record) return { ...record, data: mutateCachedPayload(record.data, method, rootCreate, id, idField, optimistic) };
    if (id && matchesEntityId(record, idField, id) && (method === 'PATCH' || method === 'PUT')) return { ...record, ...optimistic };
  }
  return payload;
}

async function applyOptimisticMutation(userId: string, path: string, method: string, optimistic: Record<string, unknown>) {
  const root = endpointRoot(path);
  const idField = temporaryIdField(root);
  if (!idField) return;
  const remainder = path.slice(root.length).split('?')[0].split('/').filter(Boolean);
  const id = remainder[0] && !['imagenes', 'aplicar', 'cancelar', 'resolver', 'seleccion'].includes(remainder[0]) ? remainder[0] : null;
  const rootCreate = method === 'POST' && path.split('?')[0] === root;
  if (!rootCreate && !id) return;
  let normalized=optimistic;
  if(rootCreate)normalized=await normalizeOptimisticEntity(userId,root,optimistic);
  else if(root==='/animales'&&id&&(method==='PATCH'||method==='PUT')){
    const detail=await getOfflineCache<Record<string,unknown>>(userId,`/animales/${id}`);
    const listed=(await loadOfflineAnimals(userId))?.find((item)=>item.id_animal===id) as unknown as Record<string,unknown>|undefined;
    normalized=await normalizeOptimisticEntity(userId,root,{...(listed??{}),...(detail??{}),...optimistic,id_animal:id});
  }
  if (root === '/animales' && id) await updateAnimalIdentity(userId, id, method, normalized);
  const optimisticId = typeof normalized[idField] === 'string' ? String(normalized[idField]) : null;
  for (const entry of await listOfflineCacheEntries(userId)) {
    const collection = isEntityCollectionPath(root, entry.path);
    const detailId = entityDetailId(root, entry.path);
    if (rootCreate ? !collection : !(collection || detailId === id)) continue;
    const payload = mutateCachedPayload(entry.payload, method, rootCreate, id, idField, normalized);
    await putOfflineCache(userId, entry.path, payload);
  }
  if (rootCreate && optimisticId) await putOfflineCache(userId, `${root}/${optimisticId}`, normalized);
  await mirrorCatalogCache(userId, root);
}

function cachedRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: unknown[] }).data.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
  }
  return value && typeof value === 'object' ? [value as Record<string, unknown>] : [];
}

function updateCachedRecords(value: unknown, idField: string, ids: Set<string>, update: (record: Record<string, unknown>) => Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((item) => item && typeof item === 'object' && ids.has(String((item as Record<string, unknown>)[idField])) ? update(item as Record<string, unknown>) : item);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('data' in record) return { ...record, data: updateCachedRecords(record.data, idField, ids, update) };
    if (ids.has(String(record[idField]))) return update(record);
  }
  return value;
}

async function applyOptimisticAction(userId: string, path: string, method: string) {
  if (method !== 'POST') return;
  const match = pathWithoutQuery(path).match(/^\/movimientos\/([^/]+)\/(aplicar|cancelar)$/);
  if (!match) return;
  const [, movementId, action] = match;
  const entries = await listOfflineCacheEntries(userId);
  let movement: Record<string, unknown> | null = null;
  for (const entry of entries) {
    if (!entry.path.startsWith('/movimientos')) continue;
    movement = cachedRecords(entry.payload).find((item) => String(item.id_movimiento) === movementId) ?? movement;
  }
  if (!movement) return;
  const marker = { __offline: true, __sync_state: 'PENDING' as const };
  const movementIds = new Set([movementId]);
  for (const entry of entries) {
    if (!entry.path.startsWith('/movimientos')) continue;
    const updated = updateCachedRecords(entry.payload, 'id_movimiento', movementIds, (record) => ({
      ...record,
      estado: action === 'aplicar' ? 'COMPLETADO' : 'CANCELADO',
      aplicado_en: action === 'aplicar' ? new Date().toISOString() : record.aplicado_en,
      ...marker,
    }));
    await putOfflineCache(userId, entry.path, updated);
  }
  if (action !== 'aplicar') return;

  const animalsEntry = entries.find((entry) => entry.path === '/animales?limit=100');
  const animalRecords = cachedRecords(animalsEntry?.payload);
  const selectedIds = new Set(
    (Array.isArray(movement.detalles) ? movement.detalles : [])
      .filter((detail) => (detail as Record<string, unknown>).seleccionado !== false)
      .map((detail) => String((detail as Record<string, unknown>).id_animal ?? ''))
      .filter(Boolean),
  );
  if (!selectedIds.size && movement.id_grupo_filtro) {
    animalRecords.filter((animal) => animal.id_grupo_actual === movement.id_grupo_filtro).forEach((animal) => selectedIds.add(String(animal.id_animal)));
  }
  if (!selectedIds.size) return;

  const groups = cachedRecords(entries.find((entry) => entry.path === '/grupos?limit=100')?.payload);
  const locations = cachedRecords(entries.find((entry) => entry.path === '/ubicaciones')?.payload);
  const destinationGroup = groups.find((group) => group.id_grupo === movement!.id_grupo_destino);
  const destinationLocationId = String(movement.id_ubicacion_destino ?? destinationGroup?.id_ubicacion_actual ?? '') || null;
  const destinationLocation = locations.find((location) => location.id_ubicacion === destinationLocationId);
  const destinationGroupId = String(movement.id_grupo_destino ?? '') || null;
  const patchAnimal = (animal: Record<string, unknown>) => ({
    ...animal,
    ...(destinationGroupId ? { id_grupo_actual: destinationGroupId, grupo: destinationGroup?.nombre ?? movement!.grupo_destino ?? animal.grupo } : {}),
    ...(destinationLocationId ? { id_ubicacion_actual: destinationLocationId, ubicacion: destinationLocation?.nombre ?? movement!.ubicacion_destino ?? animal.ubicacion } : {}),
    ultimo_movimiento: {
      id_movimiento: movementId,
      fecha: movement!.fecha_movimiento,
      ubicacion_origen: movement!.ubicacion_origen ?? null,
      ubicacion_destino: destinationLocation?.nombre ?? movement!.ubicacion_destino ?? null,
      grupo_origen: movement!.grupo_origen ?? null,
      grupo_destino: destinationGroup?.nombre ?? movement!.grupo_destino ?? null,
      motivo: movement!.motivo_catalogo ?? movement!.motivo ?? null,
    },
    ...marker,
  });
  for (const entry of entries) {
    if (!entry.path.startsWith('/animales')) continue;
    await putOfflineCache(userId, entry.path, updateCachedRecords(entry.payload, 'id_animal', selectedIds, patchAnimal));
  }
  if (String(movement.tipo_movimiento) === 'UBICACION' && movement.id_grupo_filtro && destinationLocationId) {
    const sourceGroupIds = new Set([String(movement.id_grupo_filtro)]);
    for (const entry of entries) {
      if (!entry.path.startsWith('/grupos')) continue;
      await putOfflineCache(userId, entry.path, updateCachedRecords(entry.payload, 'id_grupo', sourceGroupIds, (group) => ({ ...group, id_ubicacion_actual: destinationLocationId, ubicacion: destinationLocation?.nombre ?? movement!.ubicacion_destino ?? group.ubicacion, ...marker })));
    }
  }
}

function removeImageFromPayload(payload: unknown, imageId: string): unknown {
  if (Array.isArray(payload)) return payload.filter((item) => !imageHasId(item, imageId)).map((item) => removeImageFromPayload(item, imageId));
  if (!payload || typeof payload !== 'object') return payload;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) result[key] = removeImageFromPayload(value, imageId);
  return result;
}

async function applyOptimisticMediaDeletion(userId: string, path: string) {
  if (!path.includes('/imagenes/')) return;
  const imageId = path.split('?')[0].split('/').filter(Boolean).at(-1);
  if (!imageId || imageId === 'imagenes') return;
  for (const entry of await listOfflineCacheEntries(userId)) {
    const updated = removeImageFromPayload(entry.payload, imageId);
    await putOfflineCache(userId, entry.path, updated);
  }
}

function catalogNameFromRoot(root: string) {
  return root.match(/^\/catalogos\/([^/?]+)$/)?.[1] ?? null;
}

async function mirrorCatalogCache(userId: string, root: string) {
  const catalog = catalogNameFromRoot(root);
  if (!catalog) return;
  const data = await getOfflineCache<unknown>(userId, root);
  if (data === null) return;
  const key = `mm.catalog.${userId}.${catalog}`;
  let etag: string | null = null;
  try {
    const previous = localStorage.getItem(key);
    etag = previous ? (JSON.parse(previous) as { etag?: string | null }).etag ?? null : null;
  } catch { /* Se reemplaza una entrada local dañada. */ }
  localStorage.setItem(key, JSON.stringify({ etag, data }));
}

function addImagesToPayload(payload: unknown, entityId: string, entityIdField: string, field: string, images: Record<string, unknown>[]): unknown {
  if (Array.isArray(payload)) {
    return payload.map((item) => {
      if (!matchesEntityId(item, entityIdField, entityId)) return item;
      const current = Array.isArray((item as Record<string, unknown>)[field]) ? (item as Record<string, unknown>)[field] as unknown[] : [];
      const additions = images.filter((image) => !current.some((existing) => imageHasId(existing, String(image.id_imagen))));
      const profile = additions.find((image) => image.es_perfil === true)?.secure_url;
      return { ...(item as Record<string, unknown>), [field]: [...current, ...additions], ...(profile ? { foto_perfil: profile } : {}) };
    });
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if ('ok' in record && 'data' in record) return { ...record, data: addImagesToPayload(record.data, entityId, entityIdField, field, images) };
    if (matchesEntityId(record, entityIdField, entityId)) {
      const current = Array.isArray(record[field]) ? record[field] as unknown[] : [];
      const additions = images.filter((image) => !current.some((existing) => imageHasId(existing, String(image.id_imagen))));
      const profile = additions.find((image) => image.es_perfil === true)?.secure_url;
      return { ...record, [field]: [...current, ...additions], ...(profile ? { foto_perfil: profile } : {}) };
    }
  }
  return payload;
}

async function applyOptimisticMediaMutation(userId: string, path: string, optimistic: Record<string, unknown>, localMediaIds: string[]): Promise<Record<string, unknown>[]> {
  const now = new Date().toISOString();
  const images: Record<string, unknown>[] = localMediaIds.map((localMediaId, index) => ({
    id_imagen: `offline-${localMediaId}`,
    id_movimiento_imagen: `offline-${localMediaId}`,
    id_limpieza_imagen: `offline-${localMediaId}`,
    id_actividad_imagen: `offline-${localMediaId}`,
    secure_url: `sgb-local-media://${localMediaId}`,
    public_id: `offline-${localMediaId}`,
    nombre_original: `Foto local ${index + 1}`,
    descripcion: null,
    fecha_toma: String(optimistic.fecha_toma ?? now.slice(0, 10)),
    created_at: now,
    es_perfil: String(optimistic.es_perfil) === 'true',
    __offline: true,
    __sync_state: 'PENDING',
  }));
  let match: RegExpMatchArray | null;
  let root: string | null = null;
  let entityId: string | null = null;
  let field = 'imagenes';
  if ((match = path.match(/^\/movimientos\/([^/]+)\/imagenes\/(ORIGEN|DESTINO)$/))) {
    root = '/movimientos'; entityId = match[1]; field = match[2] === 'ORIGEN' ? 'fotos_origen' : 'fotos_destino';
    images.forEach((image) => { image.lado = match![2]; });
  } else if ((match = path.match(/^\/(limpiezas-potrero|actividades|partos)\/([^/]+)\/imagenes$/))) {
    root = `/${match[1]}`; entityId = match[2];
  } else if ((match = path.match(/^\/animales\/([^/]+)\/imagenes$/))) {
    root = '/animales'; entityId = match[1];
  }
  if (!root || !entityId) return [];
  const entityIdField = temporaryIdField(root);
  if (!entityIdField) return [];
  for (const entry of await listOfflineCacheEntries(userId)) {
    if (!(isEntityCollectionPath(root, entry.path) || entityDetailId(root, entry.path) === entityId)) continue;
    await putOfflineCache(userId, entry.path, addImagesToPayload(entry.payload, entityId, entityIdField, field, images));
  }
  const category = root === '/animales' ? 'ANIMALES' : root === '/movimientos' ? 'MOVIMIENTOS' : root === '/partos' ? 'PARTOS' : root === '/actividades' ? 'ACTIVIDADES' : root === '/limpiezas-potrero' ? 'LIMPIEZAS' : null;
  if (category && entityId) {
    const animals = Array.isArray(optimistic.id_animales)
      ? optimistic.id_animales.map((id) => ({ id_animal: String(id), nombre: 'Animal', codigo_arete: null }))
      : root === '/animales' ? [{ id_animal: entityId, nombre: 'Animal', codigo_arete: null }] : [];
    const multimedia = images.map((image, index) => ({
      id_multimedia: image.id_imagen,
      id_origen: image.id_imagen,
      categoria: category,
      subcategoria: root === '/movimientos' ? `Potrero ${field === 'fotos_origen' ? 'origen' : 'destino'}` : 'Fotografía local',
      titulo: 'Pendiente de sincronizar',
      subtitulo: 'Creada en este dispositivo',
      secure_url: image.secure_url,
      public_id: image.public_id,
      nombre_original: image.nombre_original,
      descripcion: null,
      fecha_toma: image.fecha_toma,
      created_at: now,
      tipo_archivo: 'IMAGEN',
      es_perfil: String(optimistic.es_perfil) === 'true',
      id_grupo: null,
      id_ubicacion: null,
      id_ubicacion_origen: null,
      id_ubicacion_destino: null,
      id_tipo_actividad: null,
      lado: image.lado ?? null,
      id_parto: root === '/partos' ? entityId : null,
      animales: animals,
      etiquetas: [],
      editable: true,
      __offline: true,
      __sync_state: 'PENDING',
      __index: index,
    }));
    for (const entry of await listOfflineCacheEntries(userId)) {
      if (!entry.path.startsWith('/imagenes/multimedia')) continue;
      const currentItems = entry.payload && typeof entry.payload === 'object' && !Array.isArray(entry.payload) && 'data' in (entry.payload as Record<string, unknown>)
        ? (Array.isArray((entry.payload as Record<string, unknown>).data) ? (entry.payload as Record<string, unknown>).data as unknown[] : [])
        : (Array.isArray(entry.payload) ? entry.payload : []);
      const additions = multimedia.filter((image) => !currentItems.some((existing) => imageHasId(existing, String(image.id_multimedia))));
      const payload = entry.payload && typeof entry.payload === 'object' && !Array.isArray(entry.payload) && 'data' in (entry.payload as Record<string, unknown>)
        ? { ...(entry.payload as Record<string, unknown>), data: [...additions, ...currentItems] }
        : [...additions, ...currentItems];
      await putOfflineCache(userId, entry.path, payload);
    }
  }
  return await materializeLocalMedia(images) as Record<string, unknown>[];
}

function optimisticFromMutation(mutation: OfflineMutation): Record<string, unknown> {
  let optimistic: Record<string, unknown> = mutation.jsonBody && typeof mutation.jsonBody === 'object'
    ? { ...(mutation.jsonBody as Record<string, unknown>) }
    : {};
  for (const entry of mutation.formEntries ?? []) {
    if (typeof entry.value !== 'string') continue;
    try { optimistic[entry.key] = JSON.parse(entry.value) as unknown; }
    catch { optimistic[entry.key] = entry.value; }
  }
  const idField = mutation.temporaryId ? temporaryIdField(mutation.path) : null;
  if (idField && mutation.temporaryId) optimistic[idField] = mutation.temporaryId;
  optimistic.__offline = true;
  optimistic.__sync_state = mutation.state;
  optimistic.__sync_error = mutation.lastError ?? null;
  optimistic.__mutation_id = mutation.id;
  return mutation.path === '/movimientos' && mutation.method === 'POST' ? normalizeMovement(optimistic, mutation.id) : optimistic;
}

async function reapplyPendingMutations(userId: string) {
  const temporaryIds = (await getOfflineSetting<Record<string, string>>(`temporaryIds:${userId}`)) ?? {};
  for (const mutation of await listOfflineMutations(userId)) {
    const optimistic = optimisticFromMutation(mutation);
    const resolvedPath = Object.entries(temporaryIds).reduce((result, [temporary, actual]) => result.replaceAll(temporary, actual), mutation.path);
    await applyOptimisticMutation(userId, resolvedPath, mutation.method, replaceTemporaryIds(optimistic, temporaryIds) as Record<string, unknown>);
    await applyOptimisticAction(userId, resolvedPath, mutation.method);
    if (mutation.method === 'DELETE') await applyOptimisticMediaDeletion(userId, mutation.path);
    if (mutation.localMediaIds?.length) await applyOptimisticMediaMutation(userId, mutation.path, optimistic, mutation.localMediaIds);
  }
}

async function offlineFallback<T>(path: string): Promise<T> {
  const session = loadSession();
  if (!session?.user) throw new ApiError(0, 'OFFLINE_NO_SESSION', 'Inicia sesión con conexión antes de usar el modo sin conexión.');
  if (path.startsWith('/animales?')) {
    const animals = await offlineCollection(session.user.id, path);
    if (animals) return animals.data as T;
  }
  const cached = await getOfflineCache<unknown>(session.user.id, path);
  if (cached !== null) {
    const normalized = unwrapApiData(cached);
    if (normalized !== cached) await putOfflineCache(session.user.id, path, normalized);
    if (path === '/animales/opciones/propietarios' && Array.isArray(normalized)) {
      const sanitized = normalized.filter((item) => Boolean(
        item && typeof item === 'object'
        && typeof (item as Record<string, unknown>).id_usuario === 'string'
        && typeof (item as Record<string, unknown>).correo === 'string'
        && String((item as Record<string, unknown>).correo).includes('@'),
      ));
      if (sanitized.length !== normalized.length) await putOfflineCache(session.user.id, path, sanitized);
      return await prepareOfflinePayload(path, sanitized) as T;
    }
    return await prepareOfflinePayload(path, normalized) as T;
  }
  const derived = await derivedOfflineResponse(session.user.id, path);
  if (derived !== null) return derived as T;
  const collection = await offlineCollection(session.user.id, path);
  if (collection) return collection.data as T;
  throw new ApiError(0, 'OFFLINE_NOT_DOWNLOADED', 'Este contenido no está descargado. Conéctate o descárgalo previamente desde Descargas.');
}

async function derivedOfflineResponse(userId: string, path: string): Promise<unknown | null> {
  if (path.startsWith('/registros/producciones/vacas-activas?')) {
    const cachedLactations = await getOfflineCache<unknown>(userId, '/registros/lactancias');
    if (cachedLactations === null) return null;
    const lactations = dataArray<GenericRecord>(cachedLactations);
    const query = new URLSearchParams(path.split('?')[1]);
    const date = query.get('fecha') ?? new Date().toISOString().slice(0, 10);
    const shift = query.get('turno') ?? 'UNICO';
    const excludeId = query.get('excluir_id');
    const cachedProductions = await getOfflineCache<unknown>(userId, '/registros/producciones');
    const registered = new Set(dataArray<GenericRecord>(cachedProductions).filter((item) => (
      String(item.id_produccion ?? '') !== excludeId
      && String(item.fecha_produccion ?? '').slice(0, 10) === date
      && String(item.turno ?? 'UNICO') === shift
      && item.deleted_at == null
    )).map((item) => String(item.id_vaca)));
    const lower = new Date(`${date}T00:00:00`); lower.setMonth(lower.getMonth() - 18);
    return lactations.filter((item) => {
      const start=String(item.fecha_inicio??'').slice(0,10);
      const end=String(item.fecha_fin??'').slice(0,10);
      return Boolean(item.activa)&&Boolean(item.en_ordeno)&&start<=date&&start>=lower.toISOString().slice(0,10)&&(!end||end>=date)&&!registered.has(String(item.id_vaca));
    }).map((item) => ({
      id_animal: String(item.id_vaca), nombre: String(item.animal ?? ''), codigo_arete: item.codigo_arete ? String(item.codigo_arete) : null,
      id_lactancia: String(item.id_lactancia), fecha_inicio: String(item.fecha_inicio),
    }));
  }
  if (path.startsWith('/registros/lactancias/vacas-disponibles')) {
    const cachedAnimals = await getOfflineCache<unknown>(userId, '/animales?limit=100');
    const cachedBirths = await getOfflineCache<unknown>(userId, '/partos');
    const cachedLactations = await getOfflineCache<unknown>(userId, '/registros/lactancias');
    if (cachedAnimals === null || cachedBirths === null || cachedLactations === null) return null;
    const animals = dataArray<Animal>(cachedAnimals);
    const births = dataArray<Birth>(cachedBirths);
    const lactations = dataArray<GenericRecord>(cachedLactations);
    const editingId = new URLSearchParams(path.includes('?') ? path.split('?')[1] : '').get('id_lactancia');
    const mothers = new Set(births.map((birth) => birth.id_madre));
    const unavailable = new Set(lactations.filter((item) => Boolean(item.activa) && String(item.id_lactancia) !== editingId).map((item) => String(item.id_vaca)));
    return animals.filter((animal) => animal.sexo === 'HEMBRA' && animal.estado === 'ACTIVO' && mothers.has(animal.id_animal) && !unavailable.has(animal.id_animal)).map((animal) => ({
      id_animal: animal.id_animal, nombre: animal.nombre, codigo_arete: animal.codigo_arete, tiene_lactancia_actual: lactations.some((item) => String(item.id_vaca) === animal.id_animal && Boolean(item.activa)),
    }));
  }
  if (path.startsWith('/registros/lactancias/partos?')) {
    const cachedBirths = await getOfflineCache<unknown>(userId, '/partos');
    const cachedLactations = await getOfflineCache<unknown>(userId, '/registros/lactancias');
    if (cachedBirths === null || cachedLactations === null) return null;
    const births = dataArray<Birth>(cachedBirths);
    const lactations = dataArray<GenericRecord>(cachedLactations);
    const query = new URLSearchParams(path.split('?')[1]);
    const cowId = query.get('id_vaca');
    const editingId = query.get('id_lactancia');
    return births.filter((birth) => birth.id_madre === cowId).map((birth) => ({
      id_parto: birth.id_parto, fecha_parto: birth.fecha_parto, total_crias: birth.crias.length,
      ya_relacionado: lactations.some((item) => String(item.id_parto) === birth.id_parto && String(item.id_lactancia) !== editingId),
    }));
  }
  if (path.startsWith('/registros/producciones/resumen/diario?')) {
    const cachedProductions = await getOfflineCache<unknown>(userId, '/registros/producciones');
    const cachedTanks = await getOfflineCache<unknown>(userId, '/registros/produccion-tanque');
    if (cachedProductions === null || cachedTanks === null) return null;
    const productions = dataArray<GenericRecord>(cachedProductions);
    const tanks = dataArray<TankProduction>(cachedTanks);
    const date = new URLSearchParams(path.split('?')[1]).get('fecha') ?? '';
    const rows = productions.filter((item) => String(item.fecha_produccion ?? '').slice(0, 10) === date);
    const tankRows = tanks.filter((item) => String(item.fecha_produccion).slice(0, 10) === date);
    const totalCows = rows.reduce((sum, item) => sum + Number(item.litros ?? 0), 0);
    const totalTank = tankRows.reduce((sum, item) => sum + Number(item.litros ?? 0), 0);
    return { fecha: date, total_vacas: totalCows, total_tanque: totalTank, diferencia: totalTank - totalCows, vacas_registradas: rows.length };
  }
  return null;
}

async function offlineCollection(userId: string, path: string): Promise<{ data: unknown[]; total: number; page: number; limit: number } | null> {
  const query = new URLSearchParams(path.includes('?') ? path.slice(path.indexOf('?') + 1) : '');
  let values: unknown[] | null = null;
  if (path.startsWith('/animales?')) {
    const animals = await loadOfflineAnimals(userId);
    if (!animals) return null;
    values = animals.filter((animal) => {
      const equal = (key: string, actual: string | null | undefined) => !query.get(key) || query.get(key) === actual;
      if (!equal('sexo', animal.sexo) || !equal('estado', animal.estado) || !equal('id_categoria_animal', animal.id_categoria_animal) || !equal('id_especie', animal.id_especie) || !equal('id_grupo', animal.id_grupo_actual) || !equal('id_ubicacion', animal.id_ubicacion_actual) || !equal('id_marquilla', animal.id_marquilla)) return false;
      if (query.get('categoria_codigo') && query.get('categoria_codigo') !== animal.categoria_codigo) return false;
      if (query.get('clasificacion') && query.get('clasificacion') !== animal.clasificacion_codigo) return false;
      if (query.get('propiedad_principal') === 'true' && animal.propiedad_es_principal === false) return false;
      if (query.get('id_propietario') && !animal.propietarios?.some((owner) => owner.id_usuario === query.get('id_propietario'))) return false;
      if (query.get('id_raza') && !animal.razas?.some((item) => item.id_raza === query.get('id_raza'))) return false;
      if (query.get('id_color') && !animal.colores?.some((item) => item.id_color === query.get('id_color'))) return false;
      if (query.get('nacimiento_desde') && (!animal.fecha_nacimiento || animal.fecha_nacimiento < query.get('nacimiento_desde')!)) return false;
      if (query.get('nacimiento_hasta') && (!animal.fecha_nacimiento || animal.fecha_nacimiento > query.get('nacimiento_hasta')!)) return false;
      const term = query.get('q')?.trim().toLowerCase();
      const owners=[animal.propietario_principal,...(animal.propietarios??[]).flatMap((owner)=>[owner.nombre,owner.correo])].filter(Boolean).join(' ');
      return !term || `${animal.nombre} ${animal.codigo_arete ?? ''} ${animal.descripcion ?? ''} ${animal.grupo ?? ''} ${animal.ubicacion ?? ''} ${animal.propiedad ?? ''} ${animal.origen ?? ''} ${animal.marquilla ?? ''} ${animal.marquilla_codigo ?? ''} ${animal.marquilla_usuario ?? ''} ${animal.clasificacion_codigo ?? ''} ${owners}`.toLowerCase().includes(term);
    });
  } else if (path.startsWith('/grupos?')) {
    const cachedGroups = await getOfflineCache<unknown>(userId, '/grupos?limit=100');
    if (cachedGroups === null) return null;
    const groups = dataArray<Group>(cachedGroups);
    const term = query.get('q')?.trim().toLowerCase();
    values = !term ? groups : groups.filter((group) => `${group.nombre} ${group.codigo ?? ''} ${group.ubicacion ?? ''} ${group.propiedad ?? ''}`.toLowerCase().includes(term));
  } else if (path.startsWith('/imagenes/multimedia?')) {
    const cachedMedia = await getOfflineCache<unknown>(userId, '/imagenes/multimedia?page=1&limit=100');
    if (cachedMedia === null) return null;
    const media = dataArray<MultimediaItem>(cachedMedia);
    values = media.filter((item) => {
      const equal = (key: string, actual: string | null | undefined) => !query.get(key) || query.get(key) === actual;
      if (!equal('categoria', item.categoria) || !equal('id_grupo', item.id_grupo) || !equal('id_ubicacion', item.id_ubicacion) || !equal('id_ubicacion_origen', item.id_ubicacion_origen) || !equal('id_ubicacion_destino', item.id_ubicacion_destino) || !equal('id_tipo_actividad', item.id_tipo_actividad) || !equal('lado', item.lado)) return false;
      if (query.get('tipo') && query.get('tipo') !== item.tipo_archivo) return false;
      if (query.get('perfil') && (query.get('perfil') === 'SI') !== item.es_perfil) return false;
      if (query.get('id_animal') && !item.animales?.some((animal) => animal.id_animal === query.get('id_animal'))) return false;
      if (query.get('sexo') && !item.animales?.some((animal) => animal.sexo === query.get('sexo'))) return false;
      if (query.get('id_etiqueta') && !item.etiquetas?.some((tag) => tag.id_etiqueta === query.get('id_etiqueta'))) return false;
      if (query.get('fecha_desde') && item.fecha_toma < query.get('fecha_desde')!) return false;
      if (query.get('fecha_hasta') && item.fecha_toma > query.get('fecha_hasta')!) return false;
      const term = query.get('q')?.trim().toLowerCase();
      return !term || `${item.titulo} ${item.subtitulo ?? ''} ${item.subcategoria}`.toLowerCase().includes(term);
    });
    const order = query.get('orden');
    (values as MultimediaItem[]).sort((left, right) => {
      if (order === 'AZ' || order === 'ZA') {
        const compared = left.titulo.localeCompare(right.titulo, 'es', { sensitivity: 'base' });
        return order === 'ZA' ? -compared : compared;
      }
      return order === 'OLDEST' ? left.fecha_toma.localeCompare(right.fecha_toma) : right.fecha_toma.localeCompare(left.fecha_toma);
    });
  }
  if (!values) return null;
  const total = values.length;
  const page = Math.max(1, Number(query.get('page') ?? 1));
  const limit = Math.max(1, Number(query.get('limit') ?? (total || 100)));
  return { data: await materializeLocalMedia(values.slice((page - 1) * limit, page * limit)) as unknown[], total, page, limit };
}

async function offlineAnimalPreview(body: unknown): Promise<SelectableAnimal[]> {
  const session = loadSession();
  if (!session?.user) throw new ApiError(0, 'OFFLINE_NO_SESSION', 'Inicia sesión con conexión antes de usar el modo sin conexión.');
  const animals = await loadOfflineAnimals(session.user.id);
  const groups = dataArray<Group>(await getOfflineCache<unknown>(session.user.id, '/grupos?limit=100'));
  const locations = dataArray<Location>(await getOfflineCache<unknown>(session.user.id, '/ubicaciones'));
  if (!animals) throw new ApiError(0, 'OFFLINE_NOT_DOWNLOADED', 'Descarga el módulo Animales antes de realizar selecciones sin conexión.');
  const request = (body ?? {}) as { modo?: string; id_grupo?: string | null; ids?: string[]; filtros?: { excluir_id_ubicacion?: string; situacion_propiedad?: string; propiedad_origen?: string } };
  const groupMap = new Map(groups.map((group) => [group.id_grupo, group]));
  const locationMap = new Map(locations.map((location) => [location.id_ubicacion, location]));
  return animals.filter((animal) => {
    if (animal.estado && animal.estado !== 'ACTIVO') return false;
    if (request.modo === 'GRUPO' && request.id_grupo && animal.id_grupo_actual !== request.id_grupo) return false;
    if (request.modo === 'SELECCION_MANUAL' && request.ids?.length && !request.ids.includes(animal.id_animal)) return false;
    if (request.filtros?.excluir_id_ubicacion && animal.id_ubicacion_actual === request.filtros.excluir_id_ubicacion) return false;
    const group = animal.id_grupo_actual ? groupMap.get(animal.id_grupo_actual) : undefined;
    const location = animal.id_ubicacion_actual ? locationMap.get(animal.id_ubicacion_actual) : undefined;
    const categoryCode = animal.categoria_codigo ?? group?.categoria_codigo ?? location?.categoria_codigo;
    if (request.filtros?.situacion_propiedad === 'EN_PROPIEDAD' && categoryCode !== 'EN_PROPIEDAD') return false;
    if (request.filtros?.situacion_propiedad === 'FUERA_PROPIEDAD' && categoryCode === 'EN_PROPIEDAD') return false;
    if (request.filtros?.propiedad_origen) {
      const property = group?.propiedad_es_principal || location?.propiedad_es_principal ? 'PROPIEDAD_PRINCIPAL' : group?.id_propiedad ?? location?.id_propiedad;
      if (property !== request.filtros.propiedad_origen) return false;
    }
    return true;
  }).map((animal) => ({
    id_animal: animal.id_animal, codigo_arete: animal.codigo_arete, nombre: animal.nombre, sexo: animal.sexo,
    id_categoria_animal: animal.id_categoria_animal, categoria: animal.categoria ?? 'Sin categoría',
    id_grupo_actual: animal.id_grupo_actual, grupo: animal.grupo, id_ubicacion_actual: animal.id_ubicacion_actual,
    ubicacion: animal.ubicacion, seleccionado: false,
  }));
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (isAndroidOfflineEnabled() && getConnectionQuality() !== 'stable') {
    if (path === '/selecciones/animales/preview') return offlineAnimalPreview(options.body) as Promise<T>;
    return methodOf(options) === 'GET' ? offlineFallback<T>(path) : queueOfflineMutation<T>(path, options);
  }
  try {
    const response = await networkResponse(path, options);
    if (!response.ok) throw await responseError(response);
    const payload = await parseResponse<T>(response);
    const data = unwrapApiData(payload?.data) as T;
    const session = loadSession();
    if (isAndroidOfflineEnabled() && session?.user && shouldCache(path, options)) {
      await putOfflineCache(session.user.id, path, data);
      await rememberAnimalsProgressively(session.user.id, path, data);
      await reapplyPendingMutations(session.user.id);
      const overlaid = await getOfflineCache<unknown>(session.user.id, path);
      if (overlaid !== null) {
        const normalized = unwrapApiData(overlaid);
        if (normalized !== overlaid) await putOfflineCache(session.user.id, path, normalized);
        return await prepareOfflinePayload(path, normalized) as T;
      }
    }
    return data;
  } catch (error) {
    if (!isAndroidOfflineEnabled() || !isNetworkFailure(error)) throw error;
    if (path === '/selecciones/animales/preview') return offlineAnimalPreview(options.body) as Promise<T>;
    return methodOf(options) === 'GET' ? offlineFallback<T>(path) : queueOfflineMutation<T>(path, options);
  }
}

export async function apiRequestWithMeta<T>(path: string, options: RequestOptions = {}) {
  if (isAndroidOfflineEnabled() && getConnectionQuality() !== 'stable') {
    const session = loadSession();
    if (session?.user) {
      const collection = await offlineCollection(session.user.id, path);
      if (collection) return { ok: true, data: collection.data as T, meta: { total: collection.total, page: collection.page, limit: collection.limit } } as ApiSuccess<T>;
    }
    const data = await offlineFallback<T>(path);
    return { ok: true, data, meta: { total: Array.isArray(data) ? data.length : 1, page: 1, limit: Array.isArray(data) ? data.length : 1 } } as ApiSuccess<T>;
  }
  try {
    const response = await networkResponse(path, options);
    if (!response.ok) throw await responseError(response);
    const payload = (await response.json()) as ApiSuccess<T>;
    const networkData = unwrapApiData(payload.data) as T;
    const normalizedPayload = { ...payload, data: networkData } as ApiSuccess<T>;
    const session = loadSession();
    if (isAndroidOfflineEnabled() && session?.user && shouldCache(path, options)) {
      await putOfflineCache(session.user.id, path, networkData);
      await rememberAnimalsProgressively(session.user.id, path, networkData);
      await reapplyPendingMutations(session.user.id);
      const overlaid = await getOfflineCache<unknown>(session.user.id, path);
      if (overlaid !== null) return { ...normalizedPayload, data: await prepareOfflinePayload(path, overlaid) as T };
    }
    return normalizedPayload;
  } catch (error) {
    if (!isAndroidOfflineEnabled() || !isNetworkFailure(error)) throw error;
    const session = loadSession();
    if (session?.user) {
      const collection = await offlineCollection(session.user.id, path);
      if (collection) return { ok: true, data: collection.data as T, meta: { total: collection.total, page: collection.page, limit: collection.limit } } as ApiSuccess<T>;
    }
    const data = await offlineFallback<T>(path);
    return { ok: true, data, meta: { total: Array.isArray(data) ? data.length : 1, page: 1, limit: Array.isArray(data) ? data.length : 1 } } as ApiSuccess<T>;
  }
}

export async function apiRequestAllPages<T>(path: string, pageSize = 100): Promise<ApiSuccess<T[]>> {
  const [pathname, rawQuery = ''] = path.split('?');
  const query = new URLSearchParams(rawQuery);
  const data: T[] = [];
  let page = 1;
  let total = 0;
  do {
    query.set('page', String(page));
    query.set('limit', String(pageSize));
    const response = await apiRequestWithMeta<T[]>(`${pathname}?${query}`);
    data.push(...dataArray<T>(response.data));
    total = Math.max(data.length, Number(response.meta?.total ?? data.length));
    page += 1;
  } while (data.length < total && page <= 100);
  return { ok: true, data, meta: { total: data.length, page: 1, limit: data.length || pageSize } };
}

export async function refreshOfflineCoreCache() {
  const session = loadSession();
  if (!isAndroidOfflineEnabled() || !session?.user || serverReachable !== true) return;
  await Promise.allSettled([
    apiRequest<Animal[]>('/animales?limit=100'),
    apiRequest<AnimalFilterOptions>('/animales/opciones/filtros'),
    apiRequest<OwnerOption[]>('/animales/opciones/propietarios'),
  ]);
}

interface CatalogCache<T> { etag: string | null; data: T }

export async function cachedCatalogRequest<T>(catalog: string): Promise<T> {
  const session = loadSession();
  const key = `mm.catalog.${session?.user.id ?? 'anon'}.${catalog}`;
  let cached: CatalogCache<T> | null = null;
  try {
    const raw = localStorage.getItem(key);
    cached = raw ? (JSON.parse(raw) as CatalogCache<T>) : null;
  } catch { localStorage.removeItem(key); }
  if (cached) {
    const normalized = unwrapApiData(cached.data) as T;
    if (normalized !== cached.data) {
      cached = { ...cached, data: normalized };
      localStorage.setItem(key, JSON.stringify(cached));
    }
  }
  const headers = new Headers();
  if (session?.accessToken) headers.set('Authorization', `Bearer ${session.accessToken}`);
  if (cached?.etag) headers.set('If-None-Match', cached.etag);
  if (isAndroidOfflineEnabled() && getConnectionQuality() !== 'stable') {
    const local = session?.user ? await getOfflineCache<unknown>(session.user.id, `/catalogos/${catalog}`) : null;
    if (local !== null) {
      const normalized = unwrapApiData(local);
      if (session?.user && normalized !== local) await putOfflineCache(session.user.id, `/catalogos/${catalog}`, normalized);
      return await materializeLocalMedia(normalized) as T;
    }
    if (cached) return cached.data;
    return offlineFallback<T>(`/catalogos/${catalog}`);
  }
  try {
    let response = await fetchWithTimeout(`${API_URL}/catalogos/${catalog}`, { headers }, REQUEST_TIMEOUT_MS);
    updateServerReachability(true);
    if (response.status === 401) {
      const refreshed = await refreshSession();
      if (refreshed) {
        headers.set('Authorization', `Bearer ${refreshed.accessToken}`);
        response = await fetchWithTimeout(`${API_URL}/catalogos/${catalog}`, { headers }, REQUEST_TIMEOUT_MS);
      }
    }
    if (response.status === 304 && cached) {
      if (isAndroidOfflineEnabled() && session?.user) {
        await putOfflineCache(session.user.id, `/catalogos/${catalog}`, cached.data);
        await reapplyPendingMutations(session.user.id);
        const overlaid = await getOfflineCache<unknown>(session.user.id, `/catalogos/${catalog}`);
        if (overlaid !== null) {
          const normalized = unwrapApiData(overlaid) as T;
          if (normalized !== overlaid) await putOfflineCache(session.user.id, `/catalogos/${catalog}`, normalized);
          localStorage.setItem(key, JSON.stringify({ etag: cached.etag, data: normalized }));
          return await materializeLocalMedia(normalized) as T;
        }
      }
      return cached.data;
    }
    if (!response.ok) throw await responseError(response);
    const payload = (await response.json()) as ApiSuccess<T>;
    const next: CatalogCache<T> = { etag: response.headers.get('etag'), data: payload.data };
    localStorage.setItem(key, JSON.stringify(next));
    if (isAndroidOfflineEnabled() && session?.user) {
      await putOfflineCache(session.user.id, `/catalogos/${catalog}`, payload.data);
      await reapplyPendingMutations(session.user.id);
      const overlaid = await getOfflineCache<unknown>(session.user.id, `/catalogos/${catalog}`);
      if (overlaid !== null) {
        const normalized = unwrapApiData(overlaid) as T;
        if (normalized !== overlaid) await putOfflineCache(session.user.id, `/catalogos/${catalog}`, normalized);
        localStorage.setItem(key, JSON.stringify({ etag: next.etag, data: normalized }));
        return await materializeLocalMedia(normalized) as T;
      }
    }
    return payload.data;
  } catch (error) {
    if (isAndroidOfflineEnabled() && isNetworkFailure(error)) {
      if (hasDeviceNetworkConnection()) updateConnectionQuality('unstable');
      const local = session?.user ? await getOfflineCache<unknown>(session.user.id, `/catalogos/${catalog}`) : null;
      if (local !== null) {
        const normalized = unwrapApiData(local);
        if (session?.user && normalized !== local) await putOfflineCache(session.user.id, `/catalogos/${catalog}`, normalized);
        return await materializeLocalMedia(normalized) as T;
      }
      if (cached) return cached.data;
      return offlineFallback<T>(`/catalogos/${catalog}`);
    }
    throw error;
  }
}

function replaceTemporaryIds(value: unknown, map: Record<string, string>): unknown {
  if (typeof value === 'string') return map[value] ?? value;
  if (Array.isArray(value)) return value.map((item) => replaceTemporaryIds(item, map));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, replaceTemporaryIds(item, map)]));
  }
  return value;
}

async function rebuildBody(mutation: OfflineMutation, map: Record<string, string>): Promise<unknown> {
  if (mutation.bodyType === 'none') return undefined;
  if (mutation.bodyType === 'json') return replaceTemporaryIds(mutation.jsonBody, map);
  const form = new FormData();
  for (const entry of mutation.formEntries ?? []) {
    if (typeof entry.value === 'string') form.append(entry.key, map[entry.value] ?? entry.value);
    else if (entry.localMediaId) {
      const media = await getLocalMedia(entry.localMediaId);
      if (!media) throw new ApiError(400, 'OFFLINE_MEDIA_MISSING', `No se encuentra el archivo local “${entry.filename ?? 'sin nombre'}”.`);
      const optimized = media.optimizedAt ? { blob: media.blob, filename: media.filename, optimized: false } : await optimizeImage(media.blob, media.filename);
      if (optimized.optimized) {
        await putLocalMedia({ ...media, blob: optimized.blob, filename: optimized.filename, mimeType: optimized.blob.type || media.mimeType, optimizedAt: Date.now(), originalBytes: media.originalBytes ?? media.blob.size });
      }
      form.append(entry.key, optimized.blob, optimized.filename);
    } else if (entry.value instanceof Blob) form.append(entry.key, entry.value, entry.filename);
  }
  return form;
}

function collectRemoteMediaUrls(value: unknown, result: string[] = []): string[] {
  if (typeof value === 'string' && /^https?:\/\//i.test(value) && (/\/(?:image|video)\/upload\//i.test(value) || /\.(?:jpe?g|png|webp|gif|mp4|mov)(?:[?#]|$)/i.test(value))) result.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectRemoteMediaUrls(item, result));
  else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach((item) => collectRemoteMediaUrls(item, result));
  return [...new Set(result)];
}

function findCreatedId(value: unknown, idField: string | null): string | null {
  if (!idField) return null;
  if (!value || typeof value !== 'object') return null;
  const child = (value as Record<string, unknown>)[idField];
  return typeof child === 'string' ? child : null;
}

function withoutSyncMarkers(value: Record<string, unknown>) {
  const result = { ...value };
  delete result.__offline;
  delete result.__sync_state;
  delete result.__sync_error;
  delete result.__mutation_id;
  return result;
}

function replaceSyncedEntity(payload: unknown, idField: string, temporaryId: string, actual: Record<string, unknown>): unknown {
  if (Array.isArray(payload)) {
    const withoutTemporary = payload.filter((item) => !matchesEntityId(item, idField, temporaryId));
    const existingIndex = withoutTemporary.findIndex((item) => matchesEntityId(item, idField, String(actual[idField])));
    if (existingIndex >= 0) return withoutTemporary.map((item, index) => index === existingIndex ? { ...(item as Record<string, unknown>), ...actual } : item);
    const temporaryIndex = payload.findIndex((item) => matchesEntityId(item, idField, temporaryId));
    if (temporaryIndex < 0) return payload;
    return [actual, ...withoutTemporary];
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if ('ok' in record && 'data' in record) return { ...record, data: replaceSyncedEntity(record.data, idField, temporaryId, actual) };
    if (matchesEntityId(record, idField, temporaryId)) return actual;
  }
  return payload;
}

async function reconcileSyncedCreation(userId: string, mutation: OfflineMutation, serverData: unknown, actualId: string) {
  if (!mutation.temporaryId || !serverData || typeof serverData !== 'object' || Array.isArray(serverData)) return;
  const root = endpointRoot(mutation.path);
  const idField = temporaryIdField(root);
  if (!idField) return;
  const actual = await normalizeOptimisticEntity(userId, root, withoutSyncMarkers({ ...(serverData as Record<string, unknown>), [idField]: actualId }));
  if (root === '/animales') await rememberAnimalIdentities(userId, [actual as unknown as Animal]);
  for (const entry of await listOfflineCacheEntries(userId)) {
    if (!isEntityCollectionPath(root, entry.path)) continue;
    await putOfflineCache(userId, entry.path, replaceSyncedEntity(entry.payload, idField, mutation.temporaryId, actual));
  }
  await removeOfflineCache(userId, `${root}/${mutation.temporaryId}`);
  await putOfflineCache(userId, `${root}/${actualId}`, actual);
  await mirrorCatalogCache(userId, root);
}

export async function syncOfflineMutations(force = false): Promise<{ synced: number; failed: number }> {
  if (synchronizationPromise) return synchronizationPromise;
  synchronizationPromise = (async () => {
    const session = loadSession();
    if (!force && Date.now() < nextAutomaticSyncAt) return { synced: 0, failed: 0 };
    if (!session?.user || !(await verifyServerConnection(true))) return { synced: 0, failed: 0 };
    const queue = await listOfflineMutations(session.user.id);
    if (!queue.length) {
      transientSyncFailures = 0;
      nextAutomaticSyncAt = 0;
      return { synced: 0, failed: 0 };
    }
    showLocalNotification('sync', 'Sincronizando SGB', `${queue.length} cambio(s) en orden de registro.`, SYNC_NOTIFICATION_ID, true);
    const mapKey = `temporaryIds:${session.user.id}`;
    const temporaryIds = (await getOfflineSetting<Record<string, string>>(mapKey)) ?? {};
    let synced = 0;
    let failed = 0;
    let transientMessage: string | null = null;
    const emitProgress = async (current: number, mutation: OfflineMutation | null) => {
      const remaining = await listOfflineMutations(session.user.id);
      emitOfflineChange();
      window.SGBAndroid?.setPendingMutations?.(remaining.length);
      window.dispatchEvent(new CustomEvent('sgb-sync-progress', { detail: {
        current,
        total: queue.length,
        completed: synced,
        remaining: remaining.length,
        description: mutation?.description ?? null,
      } }));
    };
    await emitProgress(0, queue[0] ?? null);
    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
      const mutation = queue[queueIndex];
      await emitProgress(queueIndex + 1, mutation);
      if (mutation.state === 'FAILED') {
        failed += 1;
        break;
      }
      if (!userHasPermission(session.user, mutation.permission)) {
        await updateOfflineMutation({ ...mutation, state: 'FAILED', attempts: mutation.attempts + 1, lastError: 'El permiso requerido ya no está disponible.', errorStatus: 403, errorCode: 'FORBIDDEN', failedAt: Date.now() });
        failed += 1;
        break;
      }
      try {
        const path = Object.entries(temporaryIds).reduce((result, [temporary, actual]) => result.replaceAll(temporary, actual), mutation.path);
        const response = await networkResponse(path, { method: mutation.method, body: await rebuildBody(mutation, temporaryIds) });
        if (!response.ok) {
          const error = await responseError(response);
          if (response.status >= 500) throw error;
          await updateOfflineMutation({
            ...mutation,
            state: 'FAILED',
            attempts: mutation.attempts + 1,
            lastError: error.message,
            errorStatus: error.status,
            errorCode: error.code,
            errorDetails: error.details,
            requestId: error.requestId,
            failedAt: Date.now(),
          });
          failed += 1;
          break;
        }
        const payload = await parseResponse<unknown>(response);
        const createdId = findCreatedId(payload?.data, temporaryIdField(mutation.path));
        if (mutation.temporaryId && createdId) {
          temporaryIds[mutation.temporaryId] = createdId;
          await putOfflineSetting(mapKey, temporaryIds);
          await reconcileSyncedCreation(session.user.id, mutation, payload?.data, createdId);
        }
        if (mutation.temporaryChildren?.length && payload?.data && typeof payload.data === 'object') {
          const children = (payload.data as { crias?: Array<{ id_cria?: string }> }).crias ?? [];
          mutation.temporaryChildren.forEach((temporary, index) => {
            const actual = children[index]?.id_cria;
            if (actual) temporaryIds[temporary] = actual;
          });
          await putOfflineSetting(mapKey, temporaryIds);
        }
        const remoteUrls = collectRemoteMediaUrls(payload?.data);
        for (let index = 0; index < (mutation.localMediaIds?.length ?? 0); index += 1) {
          const remoteUrl = remoteUrls[index];
          if (remoteUrl) await linkLocalMediaToRemote(mutation.localMediaIds![index], remoteUrl);
        }
        await removeOfflineMutation(mutation.id);
        synced += 1;
        transientSyncFailures = 0;
        nextAutomaticSyncAt = 0;
        await emitProgress(queueIndex + 1, queue[queueIndex + 1] ?? null);
      } catch (error) {
        if (isNetworkFailure(error)) {
          transientSyncFailures += 1;
          const delay = Math.min(5 * 60_000, 30_000 * 2 ** Math.min(transientSyncFailures - 1, 4));
          nextAutomaticSyncAt = Date.now() + delay;
          transientMessage = error instanceof Error ? error.message : 'La conexión se interrumpió durante la sincronización.';
          await updateOfflineMutation({
            ...mutation,
            state: 'PENDING',
            attempts: mutation.attempts + 1,
            lastError: `${transientMessage} Próximo intento automático después de ${Math.ceil(delay / 1000)} s.`,
          });
          if (hasDeviceNetworkConnection()) updateConnectionQuality('unstable');
          break;
        }
        const apiError = error instanceof ApiError ? error : null;
        await updateOfflineMutation({
          ...mutation,
          state: apiError && apiError.status > 0 && apiError.status < 500 ? 'FAILED' : 'PENDING',
          attempts: mutation.attempts + 1,
          lastError: error instanceof Error ? error.message : 'No se pudo sincronizar.',
          errorStatus: apiError?.status,
          errorCode: apiError?.code,
          errorDetails: apiError?.details,
          requestId: apiError?.requestId,
          failedAt: apiError ? Date.now() : mutation.failedAt,
        });
        if (apiError && apiError.status > 0 && apiError.status < 500) failed += 1;
        break;
      }
    }
    await reapplyPendingMutations(session.user.id);
    await putOfflineSetting(`lastSync:${session.user.id}`, Date.now());
    emitOfflineChange();
    const remaining = await listOfflineMutations(session.user.id);
    window.dispatchEvent(new CustomEvent('sgb-sync-complete', { detail: { synced, failed, transient: Boolean(transientMessage), retryAt: nextAutomaticSyncAt || null } }));
    window.dispatchEvent(new CustomEvent('sgb-sync-progress', { detail: null }));
    window.SGBAndroid?.setPendingMutations?.(remaining.length);
    if (failed) showLocalNotification('sync', 'Sincronización requiere revisión', 'Hay un cambio rechazado por validación o permisos. Revisa Descargas.', SYNC_NOTIFICATION_ID);
    else if (transientMessage) showLocalNotification('sync', 'Sincronización pausada', `${transientMessage} SGB reintentará sin perder los datos.`, SYNC_NOTIFICATION_ID);
    else showLocalNotification('sync', 'Sincronización completada', `${synced} cambio(s) enviados correctamente.`, SYNC_NOTIFICATION_ID);
    return { synced, failed };
  })().finally(() => { synchronizationPromise = null; });
  return synchronizationPromise;
}
