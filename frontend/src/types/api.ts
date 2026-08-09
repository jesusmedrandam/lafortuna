export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

export interface AuthUser {
  id: string;
  correo: string;
  nombres: string;
  apellidos: string;
  fotoPerfilUrl: string | null;
  roles: string[];
  permissions: string[];
  sessionVersion: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInMinutes: number;
  user: AuthUser;
}

export interface Profile {
  id_usuario: string;
  nombres: string;
  apellidos: string;
  telefono: string | null;
  correo: string;
  fecha_nacimiento: string | null;
  foto_perfil_url: string | null;
  ultimo_acceso: string | null;
  created_at: string;
  auth: AuthUser | null;
}

export interface DashboardSummary {
  animales: { en_propiedad: number; fuera_propiedad: number; activos: number; inactivos: number };
  ingresos: { semana: string | number; mes: string | number; anio: string | number };
  ventas: { semana: number; mes: number; anio: number };
  produccion: { hoy: string | number; semana: string | number; mes: string | number };
  tratamientos: { hoy: number; semana: number; mes: number };
  traslados: { semana: number; mes: number; anio: number };
  potreros: { total: number; ocupados: number; descanso: number };
  grupos: { total: number; con_animales: number; animales_agrupados: number };
  reproduccion: { celos_abiertos: number; preneces_confirmadas: number; proximos_partos: number; partos_mes: number };
  sexo: { hembras: number; machos: number };
}

export interface CatalogItem {
  [key: string]: unknown;
  codigo?: string | null;
  nombre?: string;
  descripcion?: string | null;
  activo?: boolean;
  es_sistema?: boolean;
}

export interface Animal {
  id_animal: string;
  codigo_arete: string | null;
  nombre: string;
  descripcion: string | null;
  id_especie: string;
  especie: string;
  sexo: 'MACHO' | 'HEMBRA';
  fecha_nacimiento: string | null;
  id_madre: string | null;
  madre?: string | null;
  id_padre: string | null;
  padre?: string | null;
  id_origen: string;
  id_categoria_animal: string;
  categoria?: string;
  categoria_codigo?: string;
  id_marquilla: string | null;
  marquilla?: string | null;
  marquilla_codigo?: string | null;
  marquilla_foto?: string | null;
  marquilla_usuario?: string | null;
  id_grupo_actual: string | null;
  grupo: string | null;
  id_ubicacion_actual: string | null;
  ubicacion: string | null;
  fecha_ingreso: string | null;
  estado: string;
  condicion?: string;
  foto_perfil: string | null;
  propietario_principal?: string | null;
  propietarios?: AnimalOwner[];
  ultimo_pesaje?: { id_pesaje?: string; peso_kg: string | number; fecha: string; metodo?: string | null } | null;
  ultimo_tratamiento?: {
    id_tratamiento: string;
    fecha: string;
    tipo: string;
    medicamento: string;
    via: string;
    dosis: string | number;
    unidad: string | null;
    descripcion: string | null;
    observaciones: string | null;
  } | null;
  ultimo_movimiento?: {
    id_movimiento: string;
    fecha: string;
    ubicacion_origen: string | null;
    ubicacion_destino: string | null;
    grupo_origen: string | null;
    grupo_destino: string | null;
    motivo: string | null;
  } | null;
  eventos_condicion?: AnimalConditionEvent[];
  imagenes?: AnimalImage[];
  colores?: { id_color: string; nombre: string; es_principal: boolean }[];
  razas?: { id_raza: string; nombre: string; porcentaje: number | null }[];
  total?: number;
}

export interface AnimalConditionEvent {
  id_evento: string;
  tipo_evento: 'DESACTIVAR' | 'REACTIVAR' | 'REPORTAR_DESAPARICION' | 'REGISTRAR_HALLAZGO';
  estado_anterior: string;
  estado_nuevo: string;
  fecha_evento: string;
  observaciones: string | null;
  ubicacion: string | null;
  grupo: string | null;
}

export interface Mark {
  id_marquilla: string;
  id_usuario?: string | null;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  secure_url: string | null;
  public_id?: string | null;
  activo: boolean;
  usuario: string;
  correo?: string | null;
  usuarios: OwnerOption[];
  total_animales?: number;
}


export interface AnimalOwner {
  id_usuario: string;
  nombre: string;
  correo: string;
  porcentaje: number | string | null;
  es_principal: boolean;
}

export interface OwnerOption {
  id_usuario: string;
  nombre: string;
  correo: string;
}

export interface AnimalFilterOptions {
  especies: { id_especie: string; nombre: string }[];
  categorias: { id_categoria_animal: string; codigo: string; nombre: string }[];
  condiciones: { id_condicion_animal: string; codigo: string; nombre: string; activo: boolean }[];
  grupos: { id_grupo: string; nombre: string }[];
  ubicaciones: { id_ubicacion: string; nombre: string; tipo: Location['tipo']; id_categoria_animal: string }[];
  propietarios: { id_usuario: string; nombre: string }[];
  razas: { id_raza: string; nombre: string; id_especie: string | null }[];
  colores: { id_color: string; nombre: string }[];
  marquillas: { id_marquilla: string; nombre: string; codigo: string }[];
}

export interface AnimalImage {
  id_imagen: string;
  id_animal?: string;
  secure_url: string;
  url?: string;
  public_id?: string;
  es_perfil: boolean;
  descripcion: string | null;
  orden: number | null;
  created_at?: string;
  tipo_archivo?: 'IMAGEN' | 'VIDEO';
  mime_type?: string | null;
  nombre_original?: string | null;
  animales?: Array<{
    id_animal: string;
    nombre: string;
    codigo_arete: string | null;
    sexo?: Animal['sexo'];
    id_grupo?: string | null;
    grupo?: string | null;
    id_ubicacion?: string | null;
    ubicacion?: string | null;
  }>;
  total?: number;
}

export interface Group {
  id_grupo: string;
  codigo: string | null;
  nombre: string;
  id_tipo_grupo: string;
  tipo_grupo: string;
  id_categoria_animal: string;
  categoria: string;
  categoria_codigo: string;
  id_ubicacion_actual: string | null;
  ubicacion: string | null;
  ubicacion_tipo: Location['tipo'] | null;
  id_propiedad_padre: string | null;
  id_propiedad: string | null;
  propiedad: string | null;
  id_especie: string | null;
  especie: string | null;
  descripcion: string | null;
  capacidad: number | null;
  activo: boolean;
  total_animales: number;
  total?: number;
}

export interface Location {
  id_ubicacion: string;
  codigo: string | null;
  nombre: string;
  tipo: 'POTRERO' | 'CORRAL' | 'OTRO';
  id_categoria_animal: string;
  id_propiedad_padre: string | null;
  propiedad: string | null;
  categoria: string;
  categoria_codigo: string;
  descripcion: string | null;
  latitud: number | null;
  longitud: number | null;
  activo: boolean;
  total_animales: number;
}

export interface PastureGrass {
  id_potrero_pasto?: string;
  id_tipo_pasto: string;
  pasto?: string;
  porcentaje_estimado: number | null;
  area_estimada: number | null;
  id_unidad_area: string | null;
  fecha_siembra: string | null;
  observaciones: string | null;
}

export interface Pasture {
  id_potrero: string;
  id_ubicacion: string;
  id_categoria_animal: string;
  id_propiedad_padre: string | null;
  propiedad: string | null;
  nombre: string;
  codigo: string | null;
  descripcion: string | null;
  activo: boolean;
  area: number | null;
  id_unidad_area: string | null;
  id_tipo_uso_potrero: string;
  tipo_uso: string;
  capacidad_estimada: number | null;
  disponibilidad_agua: boolean | null;
  fecha_ultimo_descanso: string | null;
  observaciones: string | null;
  unidad_area?: string | null;
  total_animales: number;
  pastos: PastureGrass[];
  estado_ocupacion: 'OCUPADO' | 'DESCANSO';
  fecha_estado_desde: string | null;
  dias_ocupacion: number | null;
  dias_descanso: number | null;
}

export interface PastureOccupationPeriod {
  inicio: string;
  fin: string | null;
  total_animales: number;
  descanso_previo_desde: string | null;
  dias_ocupacion: number;
  dias_descanso_previo: number | null;
}

export interface PastureDetail extends Pasture {
  ocupacion: {
    estado: 'OCUPADO' | 'DESCANSO';
    fecha_ultima_ocupacion: string | null;
    dias_ultima_ocupacion: number | null;
    fecha_ultimo_descanso: string | null;
    dias_descanso: number | null;
    total_animales: number;
  };
  historial_ocupaciones: PastureOccupationPeriod[];
}

export interface Corral {
  id_corral: string;
  id_ubicacion: string;
  id_categoria_animal: string;
  id_propiedad_padre: string | null;
  propiedad: string | null;
  nombre: string;
  codigo: string | null;
  descripcion: string | null;
  activo: boolean;
  id_tipo_corral: string;
  tipo_corral: string;
  area: number | null;
  id_unidad_area: string | null;
  capacidad: number | null;
  material_piso: string | null;
  cubierto: boolean | null;
  disponibilidad_agua: boolean | null;
  observaciones: string | null;
  total_animales: number;
}

export interface DataVersion {
  modulo: string;
  version: number;
  updated_at: string;
}

export interface UserRoleSummary {
  id_rol: string;
  codigo: string;
  nombre: string;
}

export interface AdminUser {
  id_usuario: string;
  nombres: string;
  apellidos: string;
  telefono: string | null;
  correo: string;
  fecha_nacimiento: string | null;
  foto_perfil_url: string | null;
  activo: boolean;
  correo_verificado: boolean;
  ultimo_acceso: string | null;
  created_at: string;
  roles: UserRoleSummary[];
}

export interface PermissionItem {
  id_permiso: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  modulo: string;
  activo: boolean;
}

export interface RoleItem {
  id_rol: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  protegido: boolean;
  permisos: PermissionItem[];
}

export type SelectionMode = 'TODOS' | 'GRUPO' | 'SELECCION_MANUAL';

export interface SelectableAnimal {
  id_animal: string;
  codigo_arete: string | null;
  nombre: string;
  sexo: 'MACHO' | 'HEMBRA';
  id_categoria_animal: string;
  categoria: string;
  id_grupo_actual: string | null;
  grupo: string | null;
  id_ubicacion_actual: string | null;
  ubicacion: string | null;
  seleccionado: boolean;
  observaciones?: string | null;
  dosis_aplicada?: number | null;
  id_unidad_dosis?: string | null;
}

export interface MovementDetail {
  id_detalle: string;
  id_animal: string;
  animal: string;
  arete: string | null;
  seleccionado: boolean;
  estado: string;
  mensaje_error: string | null;
  nombre?: string;
  codigo_arete?: string | null;
  sexo?: 'MACHO' | 'HEMBRA';
  id_categoria_animal?: string;
  categoria?: string;
  id_grupo_actual?: string | null;
  grupo?: string | null;
  id_ubicacion_actual?: string | null;
  ubicacion?: string | null;
  observaciones?: string | null;
}

export interface Movement {
  id_movimiento: string;
  tipo_movimiento: 'UBICACION' | 'GRUPO' | 'PROPIEDAD' | 'COMBINADO';
  modo_seleccion: SelectionMode;
  id_grupo_filtro: string | null;
  id_ubicacion_origen: string | null;
  id_ubicacion_destino: string | null;
  id_grupo_origen: string | null;
  id_grupo_destino: string | null;
  id_motivo_movimiento: string;
  ubicacion_origen: string | null;
  ubicacion_destino: string | null;
  grupo_origen: string | null;
  grupo_destino: string | null;
  fecha_movimiento: string;
  motivo: string | null;
  motivo_catalogo: string | null;
  observaciones: string | null;
  estado: string;
  total_candidatos: number;
  total_seleccionados: number;
  aplicado_en: string | null;
  detalles: MovementDetail[];
}

export interface SanitaryDetail {
  id_detalle: string;
  id_animal: string;
  animal: string;
  seleccionado: boolean;
  dosis_aplicada: number | string | null;
  estado: string;
  nombre?: string;
  codigo_arete?: string | null;
  sexo?: 'MACHO' | 'HEMBRA';
  id_categoria_animal?: string;
  categoria?: string;
  categoria_codigo?: string;
  id_grupo_actual?: string | null;
  grupo?: string | null;
  id_ubicacion_actual?: string | null;
  ubicacion?: string | null;
  id_unidad_dosis?: string | null;
  observaciones?: string | null;
}

export interface SanitaryCampaign {
  id_jornada: string;
  id_tipo_tratamiento: string;
  id_medicamento: string;
  id_via_administracion: string;
  dosis_general: number | string;
  id_unidad_dosis: string;
  tipo_tratamiento: string;
  medicamento: string;
  via: string;
  unidad: string;
  modo_seleccion: SelectionMode;
  id_grupo_filtro: string | null;
  fecha_aplicacion: string;
  responsable: string | null;
  observaciones: string | null;
  estado: string;
  total_candidatos: number;
  total_seleccionados: number;
  aplicado_en: string | null;
  detalles: SanitaryDetail[];
}

export interface CleaningProduct {
  id_producto: string;
  producto: string;
  cantidad_total: number | string;
  id_unidad: string;
  unidad: string;
  cantidad_por_tanque: number | string | null;
  observaciones: string | null;
}

export interface CleaningOperator {
  id_operador: string;
  nombre: string;
  funcion: string | null;
  observaciones: string | null;
}

export interface PastureCleaning {
  id_limpieza: string;
  id_potrero: string;
  id_tipo_limpieza: string;
  potrero: string;
  tipo_limpieza: string;
  fecha_inicio: string;
  fecha_finalizacion: string | null;
  unidad_aplicacion: 'TANQUES' | 'BOMBADAS' | null;
  cantidad_tanques: number | string | null;
  capacidad_tanque_litros: number | string | null;
  tipo_area_intervenida: 'TOTAL' | 'PARCIAL';
  area_intervenida: number | string | null;
  id_unidad_area: string | null;
  unidad_area: string | null;
  estado: string;
  observaciones: string | null;
  productos: CleaningProduct[];
  operadores: CleaningOperator[];
}

export interface Operator {
  id_operador: string;
  id_usuario: string | null;
  nombres: string;
  apellidos: string | null;
  telefono: string | null;
  especialidad: string | null;
  activo: boolean;
}

export interface BirthChild {
  id_parto_cria: string;
  id_cria: string;
  cria: string;
  codigo_arete: string | null;
  sexo: 'MACHO' | 'HEMBRA';
  estado_nacimiento: string;
  peso_nacimiento_kg: number | string | null;
  orden_nacimiento: number;
  foto_perfil: string | null;
}

export interface Birth {
  id_parto: string;
  id_prenez: string | null;
  id_madre: string;
  id_padre: string | null;
  madre: string;
  madre_arete: string | null;
  categoria_codigo: string;
  categoria: string;
  padre: string | null;
  padre_arete: string | null;
  fecha_parto: string;
  tipo_parto: string;
  observaciones: string | null;
  crias: BirthChild[];
}

export interface HeatRecord {
  id_celo: string;
  id_vaca: string;
  id_toro: string | null;
  vaca: string;
  codigo_arete: string | null;
  toro: string | null;
  toro_arete: string | null;
  fecha_inicio: string;
  fecha_fin: string | null;
  observaciones: string | null;
  tiene_prenez: boolean;
  categoria_codigo: string;
  categoria: string;
}

export interface PregnancyRecord {
  id_prenez: string;
  id_vaca: string;
  id_celo: string | null;
  id_padre: string | null;
  vaca: string;
  codigo_arete: string | null;
  id_especie: string;
  id_categoria_animal: string;
  categoria_codigo: string;
  categoria: string;
  padre: string | null;
  celo_inicio: string | null;
  metodo_embarazo: string;
  metodo_confirmacion: string;
  fecha_confirmacion: string;
  dias_gestacion_confirmacion: number | null;
  fecha_inicio_estimada: string | null;
  fecha_parto_tentativa: string | null;
  estado: 'CONFIRMADA' | 'FINALIZADA' | 'CANCELADA';
  observaciones: string | null;
}

export interface UpcomingBirth {
  id_proximo_parto: string;
  id_prenez: string;
  id_vaca: string;
  vaca: string;
  codigo_arete: string | null;
  padre: string | null;
  fecha_tentativa: string | null;
  fecha_confirmacion: string;
  metodo_embarazo: string;
  metodo_confirmacion: string;
  dias_gestacion_confirmacion: number | null;
  estado: 'PENDIENTE' | 'REGISTRADO' | 'CANCELADO';
  categoria_codigo: string;
  categoria: string;
}

export interface GenericRecord {
  [key: string]: unknown;
  animal?: string | null;
  codigo_arete?: string | null;
  categoria_codigo?: string | null;
  categoria?: string | null;
}

export interface SaleAnimalDetail {
  id_venta_detalle: string;
  id_animal: string;
  animal: string;
  codigo_arete: string | null;
  precio_individual: number | string | null;
  observaciones: string | null;
}

export interface AnimalSale {
  id_venta: string;
  id_comprador: string | null;
  fecha_venta: string;
  comprador_nombre: string;
  comprador_contacto: string | null;
  destino: string | null;
  precio_total: number | string | null;
  moneda: string;
  observaciones: string | null;
  estado: 'COMPLETADA' | 'ANULADA';
  anulado_en: string | null;
  registrado_por_nombre: string;
  animales: SaleAnimalDetail[];
}

export interface SaleProductDetail {
  id_venta_producto_detalle: string;
  id_producto_venta: string;
  producto: string;
  unidad: string;
  cantidad: number | string;
  precio_unitario: number | string;
  subtotal: number | string;
  observaciones: string | null;
}

export interface ProductSale {
  id_venta_producto: string;
  id_comprador: string | null;
  fecha_venta: string;
  periodicidad: 'DIARIA' | 'SEMANAL';
  comprador_nombre: string;
  comprador_contacto: string | null;
  destino: string | null;
  precio_total: number | string;
  moneda: string;
  observaciones: string | null;
  estado: 'COMPLETADA' | 'ANULADA';
  anulado_en: string | null;
  registrado_por_nombre: string;
  productos: SaleProductDetail[];
}

export interface AuditEntry {
  id_auditoria: number;
  id_usuario: string | null;
  usuario: string | null;
  tabla_afectada: string;
  id_registro: string | null;
  accion: string;
  datos_anteriores: Record<string, unknown> | null;
  datos_nuevos: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}
