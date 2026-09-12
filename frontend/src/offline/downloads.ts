import { apiRequest, apiRequestWithMeta, cachedCatalogRequest, getConnectionQuality, verifyServerConnection } from '../api/client';
import type { Animal, AuthUser } from '../types/api';
import { getOfflineCache, getOfflineSetting, listOfflineMutations, offlineTransferMediaCategoryForContext, putOfflineCache, putOfflineSetting, type OfflineTransferMediaCategory } from './database';
import { userHasPermission } from './permissions';
import { DOWNLOAD_NOTIFICATION_ID, isWifiConnected, showLocalNotification } from './native';
import { optimizedCloudinaryMediaUrl, type MediaType } from '../media';

export interface DownloadModule {
  id: string;
  label: string;
  description: string;
  permissions: string[];
  endpoints: string[];
  catalogs?: readonly string[];
}

export const catalogNames = [
  'compradores', 'productos-venta', 'unidades', 'tipos-producto-compra', 'tipos-actividad', 'etiquetas-multimedia',
  'categorias-animales', 'condiciones-animales', 'especies', 'origenes', 'colores', 'razas', 'tipos-grupo',
  'pastos', 'usos-potrero', 'tipos-corral', 'motivos-movimiento', 'tipos-limpieza', 'categorias-agroquimicos',
  'agroquimicos', 'tipos-tratamiento', 'tipos-condicion-salud', 'vias', 'medicamentos',
] as const;

export const downloadModules: DownloadModule[] = [
  { id: 'panel', label: 'Panel', description: 'Indicadores, preferencias y reglas visibles.', permissions: ['DASHBOARD_CONSULTAR'], endpoints: ['/dashboard/resumen', '/dashboard/preferencias', '/configuracion/finca', '/configuracion/operaciones-visibles'] },
  { id: 'animales', label: 'Animales', description: 'Listado, perfiles, novedades, filtros y fotografías vinculadas.', permissions: ['ANIMAL_CONSULTAR'], endpoints: ['/animales?limit=100', '/animales/opciones/filtros', '/animales/opciones/propietarios', '/animales/novedades'], catalogs: ['categorias-animales', 'condiciones-animales', 'especies', 'origenes', 'colores', 'razas'] },
  { id: 'multimedia', label: 'Multimedia', description: 'Fotos, videos, filtros, animales y etiquetas relacionadas.', permissions: ['IMAGEN_CONSULTAR'], endpoints: ['/imagenes/multimedia?page=1&limit=100', '/animales?limit=100', '/animales/opciones/filtros'], catalogs: ['etiquetas-multimedia', 'tipos-actividad'] },
  { id: 'lugares', label: 'Grupos y ubicaciones', description: 'Grupos, potreros, corrales, propiedades y opciones de edición.', permissions: ['GRUPO_CONSULTAR', 'POTRERO_CONSULTAR', 'CORRAL_CONSULTAR', 'UBICACION_CONSULTAR'], endpoints: ['/grupos?limit=100', '/ubicaciones', '/potreros', '/corrales', '/configuracion/operaciones-visibles'], catalogs: ['tipos-grupo', 'categorias-animales', 'especies', 'pastos', 'usos-potrero', 'tipos-corral', 'unidades'] },
  { id: 'movimientos', label: 'Movimientos', description: 'Traslados, detalles, animales, lugares y fotografías.', permissions: ['MOVIMIENTO_CONSULTAR'], endpoints: ['/movimientos', '/animales?limit=100', '/grupos?limit=100', '/ubicaciones', '/configuracion/operaciones-visibles'], catalogs: ['motivos-movimiento'] },
  { id: 'sanidad', label: 'Sanidad', description: 'Condiciones, tratamientos, jornadas, animales y opciones.', permissions: ['SANIDAD_CONSULTAR'], endpoints: ['/jornadas-sanitarias', '/registros/tratamientos', '/condiciones-salud', '/animales?limit=100'], catalogs: ['tipos-tratamiento', 'tipos-condicion-salud', 'medicamentos', 'vias', 'unidades'] },
  { id: 'limpiezas', label: 'Limpieza de potreros', description: 'Actividades, productos, operadores, potreros y fotografías.', permissions: ['LIMPIEZA_CONSULTAR'], endpoints: ['/limpiezas-potrero', '/operadores', '/potreros'], catalogs: ['tipos-limpieza', 'categorias-agroquimicos', 'agroquimicos', 'unidades'] },
  { id: 'reproduccion', label: 'Reproducción', description: 'Eventos, reglas, animales, grupos, lugares y opciones relacionadas.', permissions: ['PARTO_CONSULTAR', 'ABORTO_CONSULTAR'], endpoints: ['/reproduccion/opciones', '/reproduccion/celos', '/reproduccion/servicios', '/reproduccion/preneces', '/reproduccion/proximos-partos', '/partos', '/registros/abortos', '/configuracion/finca', '/configuracion/operaciones-visibles', '/animales?limit=100', '/animales/opciones/propietarios', '/grupos?limit=100', '/ubicaciones'], catalogs: ['especies', 'origenes', 'colores', 'razas'] },
  { id: 'produccion', label: 'Producción', description: 'Lactancias, ordeño y producción de tanque.', permissions: ['PRODUCCION_CONSULTAR', 'LACTANCIA_CONSULTAR'], endpoints: ['/registros/lactancias', '/registros/producciones', '/registros/produccion-tanque', '/partos', '/animales?limit=100'] },
  { id: 'registros', label: 'Pesajes y novedades', description: 'Pesajes, desapariciones, recuperaciones, muertes y animales.', permissions: ['PESAJE_CONSULTAR', 'MUERTE_CONSULTAR'], endpoints: ['/registros/pesajes', '/registros/muertes', '/animales/novedades', '/animales?limit=100'] },
  { id: 'comercio', label: 'Ventas y compras', description: 'Ventas, productos, compradores, egresos y datos relacionados.', permissions: ['VENTA_CONSULTAR', 'COMPRA_CONSULTAR'], endpoints: ['/ventas', '/ventas/productos', '/compras', '/animales?limit=100', '/grupos?limit=100', '/ubicaciones'], catalogs: ['compradores', 'productos-venta', 'unidades', 'tipos-producto-compra', 'categorias-animales', 'especies', 'origenes'] },
  { id: 'actividades', label: 'Otras actividades', description: 'Herrajes, descornes, animales, fierros y fotografías.', permissions: ['ACTIVIDAD_CONSULTAR'], endpoints: ['/actividades', '/marquillas', '/animales?limit=100'], catalogs: ['tipos-actividad'] },
  { id: 'catalogos', label: 'Catálogos', description: 'Opciones necesarias para formularios sin conexión.', permissions: ['CATALOGO_CONSULTAR'], endpoints: [] },
];

export interface AutomaticDownloadPreferences {
  enabled: boolean;
  wifiOnly: boolean;
}

let automaticDownloadPromise: Promise<ReturnType<typeof downloadSelectedContent> extends Promise<infer T> ? T | null : null> | null = null;

export async function getAutomaticDownloadPreferences(userId: string): Promise<AutomaticDownloadPreferences> {
  return {
    enabled: (await getOfflineSetting<boolean>(`autoDownloadEnabled:${userId}`)) ?? false,
    wifiOnly: (await getOfflineSetting<boolean>(`autoDownloadWifiOnly:${userId}`)) ?? true,
  };
}

export async function saveAutomaticDownloadPreferences(userId: string, value: AutomaticDownloadPreferences) {
  await putOfflineSetting(`autoDownloadEnabled:${userId}`, value.enabled);
  await putOfflineSetting(`autoDownloadWifiOnly:${userId}`, value.wifiOnly);
}

export async function runAutomaticDownloadIfEnabled(user: AuthUser) {
  if (automaticDownloadPromise) return automaticDownloadPromise;
  automaticDownloadPromise = (async () => {
    const preferences = await getAutomaticDownloadPreferences(user.id);
    if (!preferences.enabled || getConnectionQuality() !== 'stable') return null;
    if ((await listOfflineMutations(user.id)).length) return null;
    if (preferences.wifiOnly && !isWifiConnected()) return null;
    const lastAttempt = (await getOfflineSetting<number>(`lastAutoDownloadAttempt:${user.id}`)) ?? 0;
    if (Date.now() - lastAttempt < 15 * 60_000) return null;
    const selected = (await getOfflineSetting<string[]>(`downloadModules:${user.id}`)) ?? availableDownloadModules(user).map((module) => module.id);
    const selectedMedia=(await getOfflineSetting<OfflineTransferMediaCategory[]>(`downloadMediaCategories:${user.id}`))??['perfiles','partos','movimientos','sanidad','potreros','actividades','otros'];
    if (!selected.length) return null;
    await putOfflineSetting(`lastAutoDownloadAttempt:${user.id}`, Date.now());
    try {
      return await downloadSelectedContent(user, selected, () => undefined,selectedMedia);
    } catch (error) {
      showLocalNotification('downloads', 'Descarga automática pausada', error instanceof Error ? error.message : 'No se pudo actualizar el contenido sin conexión.', DOWNLOAD_NOTIFICATION_ID);
      return null;
    }
  })().finally(() => { automaticDownloadPromise = null; });
  return automaticDownloadPromise;
}

export function availableDownloadModules(user: AuthUser) {
  return downloadModules.filter((module) => module.permissions.some((permission) => userHasPermission(user, permission)));
}

function collectMediaUrls(value: unknown, result = new Map<string,OfflineTransferMediaCategory>(), context='otros'): Map<string,OfflineTransferMediaCategory> {
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value) && (/\.(?:jpe?g|png|webp|gif|avif|mp4|mov)(?:[?#]|$)/i.test(value) || /\/(?:image|video)\/upload\//i.test(value))) result.set(value,offlineTransferMediaCategoryForContext(context));
    return result;
  }
  if (Array.isArray(value)) value.forEach((item,index) => collectMediaUrls(item, result,`${context} ${index}`));
  else if (value && typeof value === 'object') {
    const record=value as Record<string,unknown>;
    const hints=['tipo_entidad','entidad_tipo','tipo','modulo','categoria','descripcion','etiquetas'].map((key)=>record[key]).filter(Boolean).join(' ');
    Object.entries(record).forEach(([key,item])=>{
      if(key==='thumbnail_url'||key==='display_url'||key==='download_url')return;
      if(key==='url'&&typeof record.secure_url==='string')return;
      collectMediaUrls(item,result,`${context} ${key} ${hints}`);
    });
  }
  return result;
}

function mediaTypeForUrl(url:string):MediaType{
  return /\/video\/upload\/|\.(?:mp4|mov)(?:[?#]|$)/i.test(url)?'VIDEO':'IMAGEN';
}

function idList(value: unknown, field: string): string[] {
  const data = Array.isArray(value) ? value : value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data) ? (value as { data: unknown[] }).data : [];
  return [...new Set(data.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const id = (item as Record<string, unknown>)[field];
    return id == null || String(id).trim()==='' ? [] : [String(id)];
  }))];
}

async function requestWithRetry<T>(path:string, attempts=3):Promise<T>{
  let lastError:unknown;
  for(let attempt=0;attempt<attempts;attempt+=1){
    try{return await apiRequest<T>(path);}catch(error){lastError=error;if(attempt+1<attempts)await new Promise((resolve)=>window.setTimeout(resolve,350*(attempt+1)));}
  }
  throw lastError;
}

function dataList<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) return (value as { data: T[] }).data;
  return [];
}

function changeMarker(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of ['version', 'updated_at', 'created_at', 'fecha_actualizacion']) {
    if (record[key] != null) return `${key}:${String(record[key])}`;
  }
  return null;
}

function recordById(value: unknown, field: string, id: string) {
  return dataList<Record<string, unknown>>(value).find((item) => String(item[field] ?? '') === id);
}

async function downloadPagedCollection(userId: string, path: string, cachePath: string) {
  const [pathname, rawQuery = ''] = path.split('?');
  const query = new URLSearchParams(rawQuery);
  const limit = 100;
  let page = 1;
  let total = 0;
  const result: unknown[] = [];
  do {
    query.set('page', String(page));
    query.set('limit', String(limit));
    const response = await apiRequestWithMeta<unknown[]>(`${pathname}?${query}`);
    result.push(...response.data);
    total = Math.max(result.length, Number(response.meta?.total ?? result.length));
    page += 1;
  } while (result.length < total && page <= 100);
  await putOfflineCache(userId, cachePath, result);
  return result;
}

interface NativeMediaInfo { count?: number; bytes?: number; pending?: number; failed?: number }

async function sendNativeMedia(urls: string[]) {
  if (!urls.length || !window.SGBAndroid?.downloadMedia) return 0;
  let failed = 0;
  const batchSize = 40;
  for (let index = 0; index < urls.length; index += batchSize) {
    const batch = urls.slice(index, index + batchSize);
    window.SGBAndroid.downloadMedia(JSON.stringify(batch.map((source)=>({
      source,
      url:optimizedCloudinaryMediaUrl(source,mediaTypeForUrl(source),'offline'),
    }))));
    failed += (await waitForNativeMedia(batch.length, () => undefined)).failed;
  }
  return failed;
}

async function waitForNativeMedia(total: number, onProgress: (remaining: number) => void) {
  if (!total || !window.SGBAndroid?.getMediaCacheInfo) return { failed: 0 };
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    let info: NativeMediaInfo = {};
    try { info = JSON.parse(window.SGBAndroid.getMediaCacheInfo()) as NativeMediaInfo; } catch { return { failed: 0 }; }
    const pending = Number(info.pending ?? 0);
    onProgress(pending);
    if (pending <= 0) return { failed: Number(info.failed ?? 0) };
    await new Promise((resolve) => window.setTimeout(resolve, 300));
  }
  throw new Error('La descarga de fotografías tardó demasiado. Intenta actualizar nuevamente el contenido.');
}

export async function downloadSelectedContent(
  user: AuthUser,
  selected: string[],
  onProgress: (completed: number, total: number, label: string) => void,
  selectedMediaCategories:OfflineTransferMediaCategory[]=['perfiles','partos','movimientos','sanidad','potreros','actividades','otros'],
) {
  if (!(await verifyServerConnection(true))) throw new Error('No fue posible conectar con el servidor de SGB. Revisa la red e intenta nuevamente.');
  showLocalNotification('downloads', 'Actualizando contenido de SGB', 'Se descargarán únicamente datos y archivos faltantes o modificados.', DOWNLOAD_NOTIFICATION_ID, true);
  const modules = availableDownloadModules(user).filter((module) => selected.includes(module.id));
  const endpointJobs = [...new Map(modules
    .flatMap((module) => module.endpoints.map((path) => ({ module, path })))
    .map((job) => [job.path, job])).values()];
  const catalogJobs = modules.some((module) => module.id === 'catalogos')
    ? [...catalogNames]
    : [...new Set(modules.flatMap((module) => module.catalogs ?? []))];
  let completed = 0;
  const total = endpointJobs.length + catalogJobs.length;
  const media = new Map<string,OfflineTransferMediaCategory>();
  const details: Array<{ label: string; path: string }> = [];
  let reusedDetails = 0;
  let failedDetails = 0;
  let downloadedAnimals: Animal[] = [];
  const animalDetails = new Map<string, Animal>();

  for (const job of endpointJobs) {
    onProgress(completed, total, job.module.label);
    const cachePath = job.path === '/animales?limit=100' ? '/animales?limit=100' : job.path === '/imagenes/multimedia?page=1&limit=100' ? '/imagenes/multimedia?page=1&limit=100' : job.path;
    const previousData = await getOfflineCache<unknown>(user.id, cachePath);
    const data = job.path === '/animales?limit=100'
      ? await downloadPagedCollection(user.id, job.path, '/animales?limit=100')
      : job.path === '/imagenes/multimedia?page=1&limit=100'
        ? await downloadPagedCollection(user.id, job.path, '/imagenes/multimedia?page=1&limit=100')
        : await apiRequest<unknown>(job.path);
    collectMediaUrls(data, media,job.path);
    const descriptor = job.path === '/animales?limit=100'
      ? { field: 'id_animal', label: 'Perfiles de animales', base: '/animales', suffix: '' }
      : job.path === '/grupos?limit=100'
        ? { field: 'id_grupo', label: 'Detalles de grupos', base: '/grupos', suffix: '' }
        : job.path === '/potreros'
          ? { field: 'id_potrero', label: 'Ocupaciones y animales de potreros', base: '/potreros', suffix: '/resumen' }
        : job.path === '/movimientos'
          ? { field: 'id_movimiento', label: 'Detalles de movimientos', base: '/movimientos', suffix: '' }
          : job.path === '/limpiezas-potrero'
            ? { field: 'id_limpieza', label: 'Detalles de limpiezas', base: '/limpiezas-potrero', suffix: '' }
            : job.path === '/partos'
              ? { field: 'id_parto', label: 'Fotografías y detalles de partos', base: '/partos', suffix: '' }
              : job.path === '/actividades'
                ? { field: 'id_actividad', label: 'Fotografías y detalles de actividades', base: '/actividades', suffix: '' }
                : null;
    if (descriptor) {
      for (const id of idList(data, descriptor.field)) {
        const detailPath = `${descriptor.base}/${id}${descriptor.suffix}`;
        const cachedDetail = await getOfflineCache<unknown>(user.id, detailPath);
        const currentSummary = recordById(data, descriptor.field, id);
        const previousSummary = recordById(previousData, descriptor.field, id);
        const currentMarker = changeMarker(currentSummary);
        const previousMarker = changeMarker(previousSummary);
        const changed = !cachedDetail || !previousSummary || (currentMarker && previousMarker ? currentMarker !== previousMarker : JSON.stringify(currentSummary) !== JSON.stringify(previousSummary));
        if (descriptor.base === '/animales' || changed) details.push({ label: descriptor.label, path: detailPath });
        else {
          reusedDetails += 1;
          collectMediaUrls(cachedDetail, media,detailPath);
          if (descriptor.base === '/animales' && cachedDetail && typeof cachedDetail === 'object') animalDetails.set(id, cachedDetail as Animal);
        }
      }
    }
    if (job.path === '/animales?limit=100') {
      downloadedAnimals = dataList<Animal>(data);
    }
    completed += 1;
  }
  for (const catalog of catalogJobs) {
    onProgress(completed, total, 'Catálogos');
    collectMediaUrls(await cachedCatalogRequest<unknown>(catalog), media,`catalogo ${catalog}`);
    completed += 1;
  }
  let detailCompleted = 0;
  for (const detail of details) {
    onProgress(completed + detailCompleted, total + details.length, detail.label);
    try {
      const data = await requestWithRetry<unknown>(detail.path);
      collectMediaUrls(data, media,detail.path);
      if (detail.path.startsWith('/animales/') && data && typeof data === 'object') {
        const animal = data as Animal;
        if (animal.id_animal) animalDetails.set(animal.id_animal, animal);
      }
    } catch { failedDetails += 1; /* El resumen sigue disponible, pero se informará el detalle pendiente. */ }
    detailCompleted += 1;
  }
  if (downloadedAnimals.length) {
    await putOfflineCache(user.id, '/animales?limit=100', downloadedAnimals.map((animal) => ({ ...animal, ...(animalDetails.get(animal.id_animal) ?? {}) })));
  }
  let failedMedia = 0;
  const urls=[...media].filter(([,category])=>selectedMediaCategories.includes(category)).map(([url])=>url);
  if (urls.length && window.SGBAndroid?.downloadMedia) {
    const batchSize = 40;
    for (let index = 0; index < urls.length; index += batchSize) {
      const batch = urls.slice(index, index + batchSize);
      onProgress(total + details.length, total + details.length + 1, `Guardando fotografías · ${Math.min(index + batch.length, urls.length)} de ${urls.length}`);
      failedMedia += await sendNativeMedia(batch);
    }
  }
  await putOfflineSetting(`lastDownload:${user.id}`, Date.now());
  await putOfflineSetting(`downloadModules:${user.id}`, selected);
  await putOfflineSetting(`downloadMediaCategories:${user.id}`,selectedMediaCategories);
  window.dispatchEvent(new CustomEvent('sgb-offline-change'));
  onProgress(total + details.length, total + details.length, 'Contenido listo');
  const result = { requests: total + details.length, media: urls.length - failedMedia, failedMedia, failedDetails, reusedDetails };
  showLocalNotification('downloads', failedMedia||failedDetails ? 'Actualización completada con avisos' : 'Contenido sin conexión actualizado', failedMedia||failedDetails
    ? `${result.media} archivo(s) listos; ${failedMedia} archivo(s) y ${failedDetails} perfil(es) pendientes para el próximo intento.`
    : `${result.requests} consultas revisadas y ${result.media} archivo(s) disponibles.`, DOWNLOAD_NOTIFICATION_ID);
  return result;
}
