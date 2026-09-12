import { getOfflineCache } from './database';
import type { Animal, MultimediaItem } from '../types/api';

function objectBody(body: unknown): Record<string, unknown> {
  if (body instanceof FormData) {
    const result: Record<string, unknown> = {};
    const data = body.get('data');
    if (typeof data === 'string') {
      try { Object.assign(result, JSON.parse(data) as Record<string, unknown>); } catch { /* Formulario sin JSON. */ }
    }
    body.forEach((value, key) => { if (typeof value === 'string' && key !== 'data') result[key] = value; });
    return result;
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

async function animalName(userId: string, id: unknown) {
  if (typeof id !== 'string' || !id) return null;
  const detail = await getOfflineCache<Animal>(userId, `/animales/${id}`);
  if (detail?.id_animal === id && detail.nombre) return detail.nombre;
  const animals = await getOfflineCache<Animal[]>(userId, '/animales?limit=100');
  return animals?.find((animal) => animal.id_animal === id)?.nombre ?? null;
}

async function imageAnimalName(userId: string, imageId: string) {
  const media = await getOfflineCache<MultimediaItem[]>(userId, '/imagenes/multimedia?page=1&limit=100');
  const image = media?.find((item) => item.id_origen === imageId || item.id_multimedia === imageId);
  return image?.animales?.[0]?.nombre ?? null;
}

function quoted(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? ` “${text}”` : '';
}

export async function describeOfflineMutation(userId: string, path: string, method: string, rawBody: unknown): Promise<string> {
  const body = objectBody(rawBody);
  const animalMatch = path.match(/^\/animales\/([^/]+)/);
  const directAnimalId = body.id_animal ?? animalMatch?.[1];
  const animal = await animalName(userId, directAnimalId);
  const action = method === 'DELETE' ? 'Eliminación' : method === 'PATCH' || method === 'PUT' ? 'Actualización' : 'Registro';

  if (path === '/animales' && method === 'POST') return `Registro del animal${quoted(body.nombre)}`;
  if (/^\/animales\/[^/]+$/.test(path)) return `${action} del animal${quoted(animal)}`;
  if (/^\/animales\/[^/]+\/imagenes/.test(path)) return `${method === 'DELETE' ? 'Eliminación' : 'Carga'} de imagen del animal${quoted(animal)}`;
  if (/^\/imagenes\/[^/]+$/.test(path)) {
    const imageId = path.split('/').at(-1) ?? '';
    const relatedAnimal = await imageAnimalName(userId, imageId);
    return `${method === 'DELETE' ? 'Eliminación' : 'Actualización'} de imagen${relatedAnimal ? ` del animal “${relatedAnimal}”` : ''}`;
  }
  if (/^\/movimientos\/imagenes\//.test(path)) return 'Eliminación de fotografía de movimiento';
  if (/^\/movimientos\/[^/]+\/imagenes\//.test(path)) return 'Carga de fotografía de movimiento';
  if (path === '/movimientos' && method === 'POST') return `Registro de movimiento${quoted(body.motivo ?? body.tipo_movimiento)}`;
  if (/\/movimientos\/[^/]+\/aplicar$/.test(path)) return 'Aplicación de movimiento pendiente';
  if (/\/movimientos\/[^/]+\/cancelar$/.test(path)) return 'Cancelación de movimiento';
  if (/^\/movimientos\//.test(path)) return `${action} de movimiento`;
  if (/^\/condiciones-salud/.test(path)) return `${path.endsWith('/resolver') ? 'Resolución' : action} de condición de salud${quoted(animal)}`;
  if (/^\/registros\/tratamientos/.test(path)) return `${action} de tratamiento${quoted(animal)}`;
  if (/^\/jornadas-sanitarias/.test(path)) return `${path.endsWith('/aplicar') ? 'Aplicación' : action} de jornada sanitaria`;
  if (/^\/partos/.test(path)) return `${action} de parto${quoted(await animalName(userId, body.id_madre))}`;
  if (/^\/reproduccion\/celos/.test(path)) return `${action} de celo${quoted(await animalName(userId, body.id_vaca))}`;
  if (/^\/reproduccion\/preneces/.test(path)) return `${action} de preñez${quoted(await animalName(userId, body.id_vaca))}`;
  if (/^\/registros\/abortos/.test(path)) return `${action} de aborto${quoted(animal)}`;
  if (/^\/actividades\/imagenes\//.test(path)) return 'Eliminación de fotografía de actividad';
  if (/^\/actividades/.test(path)) return `${action} de actividad${quoted(body.descripcion)}`;
  if (/^\/limpiezas-potrero\/imagenes\//.test(path)) return 'Eliminación de fotografía de limpieza de potrero';
  if (/^\/limpiezas-potrero/.test(path)) return `${path.includes('/imagenes') ? 'Carga de fotografía' : action} de limpieza de potrero`;
  if (/^\/registros\/lactancias/.test(path)) return `${action} de lactancia${quoted(await animalName(userId, body.id_vaca))}`;
  if (/^\/registros\/producciones/.test(path)) return `${action} de producción${quoted(await animalName(userId, body.id_vaca))}`;
  if (/^\/registros\/(pesajes|muertes)/.test(path)) return `${action} de ${path.includes('/pesajes') ? 'pesaje' : 'baja'}${quoted(animal)}`;
  if (/^\/ventas/.test(path)) return `${action} de venta`;
  if (/^\/compras/.test(path)) return `${action} de compra${quoted(body.producto)}`;
  const catalog = path.match(/^\/catalogos\/([^/]+)/)?.[1]?.replaceAll('-', ' ');
  if (catalog) return `${action} de ${catalog}${quoted(body.nombre ?? body.nombre_comercial)}`;
  if (/^\/grupos/.test(path)) return `${action} de grupo${quoted(body.nombre)}`;
  if (/^\/(potreros|corrales|ubicaciones)/.test(path)) return `${action} de ubicación${quoted(body.nombre)}`;
  return `${action} de registro`;
}
