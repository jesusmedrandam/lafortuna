export interface OfflineValidationResult {
  errors: string[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isIdentifier(value: unknown) {
  return typeof value === 'string' && (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) || value.startsWith('offline-'));
}

function validDate(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function payloadFrom(body: unknown) {
  if (!(body instanceof FormData)) return body;
  const raw = body.get('data');
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw) as unknown; } catch { return null; }
}

function validateDateFields(value: Record<string, unknown>, errors: string[]) {
  for (const [key, field] of Object.entries(value)) {
    if (!key.startsWith('fecha_') || field == null || field === '') continue;
    if (!validDate(field)) errors.push(`La fecha “${key.replaceAll('_', ' ')}” no tiene un formato válido.`);
  }
}

function validateAnimal(path: string, method: string, value: Record<string, unknown>, errors: string[]) {
  const creating = path === '/animales' && method === 'POST';
  if ((creating || 'nombre' in value) && (typeof value.nombre !== 'string' || !value.nombre.trim())) errors.push('El nombre del animal es obligatorio.');
  if ((creating || 'sexo' in value) && !['MACHO', 'HEMBRA'].includes(String(value.sexo ?? ''))) errors.push('El sexo del animal no es válido.');
  for (const field of creating ? ['id_especie', 'id_origen', 'id_categoria_animal'] : ['id_especie', 'id_origen']) {
    if ((creating || field in value) && !isIdentifier(value[field])) errors.push(`El campo “${field.replaceAll('_', ' ')}” no contiene una selección válida.`);
  }
  for (const field of ['id_madre', 'id_padre', 'id_marquilla']) {
    if (value[field] != null && value[field] !== '' && !isIdentifier(value[field])) errors.push(`El campo “${field.replaceAll('_', ' ')}” no es válido.`);
  }
  for (const relation of ['colores', 'razas', 'propietarios']) {
    if (!(relation in value)) continue;
    if (!Array.isArray(value[relation])) errors.push(`La lista de ${relation} no es válida.`);
  }
  const owners = Array.isArray(value.propietarios) ? value.propietarios.filter(isRecord) : [];
  if (owners.filter((owner) => owner.principal === true).length > 1) errors.push('Solo un propietario puede ser principal.');
  const total = owners.reduce((sum, owner) => sum + (owner.porcentaje == null ? 0 : Number(owner.porcentaje)), 0);
  if (!Number.isFinite(total) || total > 100.001) errors.push('La suma de porcentajes de propietarios no puede superar el 100 %.');
}

function validateMovement(value: Record<string, unknown>, errors: string[]) {
  const kind = String(value.tipo_movimiento ?? '');
  const mode = String(value.modo_seleccion ?? '');
  if (!['UBICACION', 'GRUPO', 'PROPIEDAD', 'COMBINADO'].includes(kind)) errors.push('Selecciona un tipo de movimiento válido.');
  if (!['TODOS', 'GRUPO', 'SELECCION_MANUAL'].includes(mode)) errors.push('La forma de seleccionar los animales no es válida.');
  if (!value.propiedad_origen) errors.push('Selecciona la propiedad de origen.');
  if (!validDate(value.fecha_movimiento)) errors.push('Selecciona una fecha válida para el movimiento.');
  const animals = Array.isArray(value.animales) ? value.animales.filter(isRecord) : [];
  if (!animals.some((animal) => animal.seleccionado !== false)) errors.push('Selecciona al menos un animal o un grupo con animales.');
  if (kind === 'UBICACION') {
    if (mode !== 'GRUPO') errors.push('El cambio de potrero o corral se realiza con un grupo completo.');
    if (!isIdentifier(value.id_grupo_filtro)) errors.push('Selecciona el grupo que será trasladado.');
    if (!isIdentifier(value.id_ubicacion_destino)) errors.push('Selecciona el potrero o corral de destino.');
    if (value.id_grupo_destino !== value.id_grupo_filtro) errors.push('Al cambiar de potrero, el grupo debe conservarse.');
  }
  if (kind === 'GRUPO' && !isIdentifier(value.id_grupo_destino)) errors.push('Selecciona el grupo de destino.');
  if (kind === 'GRUPO' && value.id_grupo_destino === value.id_grupo_filtro) errors.push('El grupo de destino debe ser diferente del grupo de origen.');
  if (kind === 'PROPIEDAD' && !isIdentifier(value.id_ubicacion_destino)) errors.push('Selecciona la propiedad o ubicación de destino.');
}

function validateFiles(path: string, body: FormData, errors: string[]) {
  const files: File[] = [];
  body.forEach((value) => { if (value instanceof File) files.push(value); });
  if (path.includes('/imagenes') && !files.length) errors.push('Selecciona al menos una fotografía.');
  for (const file of files) {
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) errors.push(`“${file.name}” no es una imagen o video compatible.`);
    if (file.size <= 0) errors.push(`“${file.name}” está vacío.`);
    if (file.size > 40 * 1024 * 1024) errors.push(`“${file.name}” supera el límite de 40 MB.`);
  }
}

function validateCatalog(method: string, value: Record<string, unknown>, errors: string[]) {
  if (method === 'DELETE') return;
  const hasName = [value.nombre, value.nombre_comercial].some((field) => typeof field === 'string' && field.trim());
  if (!hasName) errors.push('El nombre del elemento de catálogo es obligatorio.');
  if ('codigo' in value && (typeof value.codigo !== 'string' || !value.codigo.trim())) errors.push('El código del elemento de catálogo es obligatorio.');
}

export function validateOfflineMutation(path: string, method: string, body: unknown): OfflineValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (body instanceof FormData) validateFiles(path, body, errors);
  const payload = payloadFrom(body);
  if (payload != null && !isRecord(payload)) errors.push('Los datos del formulario no tienen una estructura válida.');
  if (isRecord(payload)) {
    validateDateFields(payload, errors);
    if (/^\/animales(?:\/[^/]+)?$/.test(path)) validateAnimal(path, method, payload, errors);
    if (path === '/movimientos' && method === 'POST') validateMovement(payload, errors);
    if (/^\/catalogos\/[^/]+(?:\/[^/]+)?$/.test(path)) validateCatalog(method, payload, errors);
  }
  if (!errors.length) warnings.push('Se validaron los campos disponibles sin conexión; las reglas que dependen del servidor se comprobarán al sincronizar.');
  return { errors: [...new Set(errors)], warnings };
}
