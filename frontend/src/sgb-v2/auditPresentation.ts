import {formatDate} from '../utils';
import type {AuditRecord} from './api';

const actions:Record<string,string>={
  PROPERTY_INFORMATION_UPDATED:'Actualizó la información de la propiedad',
  MOVEMENT_DRAFT_EXPIRED:'Eliminó un borrador de traslado tras 24 horas',HEALTH_CAMPAIGN_DRAFT_EXPIRED:'Eliminó un borrador de tratamiento tras 24 horas',
  CLEANING_DRAFT_EXPIRED:'Eliminó un borrador de limpieza tras 24 horas',ACTIVITY_DRAFT_EXPIRED:'Eliminó un borrador de actividad tras 24 horas',
  ACCOUNT_CREATED:'Creó una cuenta',ACCOUNT_REGISTERED:'Registró una cuenta',
  ANIMAL_CREATED:'Registró un animal',ANIMAL_DESCRIPTION_UPDATED:'Editó la descripción del animal',
  ANIMAL_STATUS_CHANGED:'Cambió el estado del animal',ANIMAL_MOVED_TO_TRASH:'Movió un animal a la papelera',ANIMAL_RESTORED:'Restauró un animal',
  ANIMAL_BRANDS_UPDATED:'Cambió las marquillas del animal',ANIMAL_CATALOGS_UPDATED:'Cambió la raza o el color del animal',
  ANIMAL_GROUP_CHANGED:'Cambió el animal de grupo',ANIMAL_OWNERS_UPDATED:'Cambió los propietarios del animal',
  ANIMAL_PARENTS_UPDATED:'Actualizó los padres del animal',BRAND_OWNERS_UPDATED:'Cambió los propietarios de una marquilla',
  AUTH_LOGIN:'Inició sesión',AUTH_LOGOUT:'Cerró sesión',SESSION_CONTEXT_CHANGED:'Cambió de propiedad o rol',
  LOCATION_CREATED:'Creó un potrero o corral',LOCATION_UPDATED:'Editó un potrero o corral',
  GROUP_CREATED:'Creó un grupo',GROUP_UPDATED:'Editó un grupo',GROUP_LOCATION_CHANGED:'Trasladó un grupo',
  GROUP_STATE_CHANGED:'Cambió el estado de un grupo',OWNER_CREATED:'Registró un propietario',
  LIVESTOCK_BRAND_CREATED:'Creó una marquilla',LIVESTOCK_BRAND_STATE_CHANGED:'Activó o desactivó una marquilla',
  CATALOG_ITEM_CREATED:'Añadió una opción al catálogo',CATALOG_ITEM_STATE_CHANGED:'Activó o desactivó una opción del catálogo',
  CATALOG_ITEM_UPDATED:'Editó una opción del catálogo',CLEANING_PRODUCT_UPDATED:'Editó un producto de limpieza',
  CLASSIFICATION_POLICY_UPDATED:'Cambió la clasificación de los animales',
  MOVEMENT_DRAFT_CREATED:'Preparó un traslado',MOVEMENT_DRAFT_UPDATED:'Editó un traslado pendiente',
  MOVEMENT_COMPLETED:'Completó un traslado',MOVEMENT_CANCELLED:'Anuló un traslado',
  HEALTH_MEDICINE_CREATED:'Registró un medicamento',HEALTH_MEDICINE_UPDATED:'Editó un medicamento',HEALTH_CONDITION_CREATED:'Registró una condición de salud',
  HEALTH_CONDITION_UPDATED:'Editó una condición de salud',HEALTH_CAMPAIGN_DRAFT_CREATED:'Preparó un tratamiento',
  HEALTH_CAMPAIGN_DRAFT_UPDATED:'Editó un tratamiento pendiente',HEALTH_CAMPAIGN_COMPLETED:'Completó un tratamiento',
  HEALTH_CAMPAIGN_CANCELLED:'Anuló un tratamiento',CLEANING_PRODUCT_CREATED:'Registró un producto de limpieza',
  CLEANING_DRAFT_CREATED:'Preparó una limpieza de potrero',CLEANING_DRAFT_UPDATED:'Editó una limpieza pendiente',
  CLEANING_COMPLETED:'Completó una limpieza de potrero',CLEANING_CANCELLED:'Anuló una limpieza de potrero',
  ACTIVITY_DRAFT_CREATED:'Preparó una actividad',ACTIVITY_DRAFT_UPDATED:'Editó una actividad pendiente',
  ACTIVITY_COMPLETED:'Completó una actividad',ACTIVITY_CANCELLED:'Anuló una actividad',
  AGENDA_CREATED:'Agendó una tarea o evento',AGENDA_COMPLETED:'Completó una tarea',AGENDA_CANCELLED:'Canceló una tarea o evento',
  WEIGHING_CREATED:'Registró un pesaje',WEIGHING_UPDATED:'Corrigió un pesaje',WEIGHING_VOIDED:'Anuló un pesaje',
  COMMERCE_CREATED:'Registró una compra o venta',COMMERCE_CANCELLED:'Anuló una compra o venta',
  FINANCE_ACCOUNT_CREATED:'Creó una cuenta de dinero',FINANCE_ACCOUNT_UPDATED:'Editó una cuenta de dinero',
  FINANCE_MOVEMENT_CREATED:'Registró un ingreso o egreso',FINANCE_MOVEMENT_CANCELLED:'Anuló un ingreso o egreso',
  REPRODUCTION_HEAT_CREATED:'Registró un celo',REPRODUCTION_HEAT_CANCELLED:'Anuló un celo',
  REPRODUCTION_SERVICE_CREATED:'Registró un servicio reproductivo',REPRODUCTION_SERVICE_CANCELLED:'Anuló un servicio reproductivo',
  REPRODUCTION_PREGNANCY_CREATED:'Registró una preñez',REPRODUCTION_PREGNANCY_CANCELLED:'Anuló una preñez',
  REPRODUCTION_BIRTH_REGISTERED:'Registró un parto',REPRODUCTION_LOSS_REGISTERED:'Registró una pérdida gestacional',
  REPRODUCTION_SETTINGS_UPDATED:'Cambió las opciones de reproducción',COW_MILKING_CHANGED:'Cambió el estado de ordeño',
  MILK_LACTATION_CREATED:'Registró una lactancia',MILK_LACTATION_MILKING_CHANGED:'Cambió el ordeño de una lactancia',
  MILK_PRODUCTION_CREATED:'Registró producción de leche',MILK_TANK_PRODUCTION_CREATED:'Registró leche en tanque',
  MEDIA_UPLOADED:'Añadió una foto o archivo',MEDIA_OBJECT_CHANGED:'Cambió una foto o archivo',
  MEDIA_METADATA_UPDATED:'Editó los datos de una foto o archivo',MEDIA_RELATIONS_CHANGED:'Cambió las fotos o archivos asociados',
  MEDIA_RELATIONS_REMOVED:'Quitó una foto o archivo de un registro',PROPERTY_CREATED:'Creó una propiedad',
  PROPERTY_MODULE_UPDATED:'Activó o desactivó una función',PROPERTY_INVITATION_CREATED:'Invitó a un colaborador',
  PROPERTY_INVITATION_ACCEPTED:'Aceptó una invitación',PROPERTY_INVITATION_REVOKED:'Canceló una invitación',
  PROPERTY_MEMBERSHIP_STATUS_CHANGED:'Cambió el acceso de un colaborador',EMAIL_VERIFIED:'Verificó su correo',
  EMAIL_VERIFICATION_REQUESTED:'Solicitó verificar su correo',PASSWORD_RESET_REQUESTED:'Solicitó recuperar su contraseña',
  PASSWORD_RESET_COMPLETED:'Restableció su contraseña',USER_PASSWORD_CHANGED:'Cambió su contraseña',
  USER_PROFILE_UPDATED:'Editó su perfil',SUPERADMIN_ACCOUNT_UPDATED:'Actualizó una cuenta',
  USER_EMAIL_CHANGE_REQUESTED:'Solicitó cambiar su correo',USER_EMAIL_CHANGED:'Cambió su correo',USER_SESSIONS_REVOKED:'Cerró sesiones de su cuenta',
  SUPERADMIN_QUOTA_UPDATED:'Cambió los límites de una cuenta',SUPERADMIN_MODULE_UPDATED:'Cambió las funciones de una cuenta',
  SYSTEM_CATALOG_CREATED:'Añadió una opción del sistema',SYSTEM_CATALOG_UPDATED:'Editó una opción del sistema',
};
const entities:Record<string,string>={ANIMAL:'Animal',ANIMAL_WEIGHING:'Pesaje',APP_USER:'Usuario',
  PHYSICAL_LOCATION:'Potrero o corral',LIVESTOCK_GROUP:'Grupo',LIVESTOCK_MOVEMENT:'Traslado',
  LIVESTOCK_BRAND:'Marquilla',LIVESTOCK_OWNER:'Propietario',HEALTH_MEDICINE:'Medicamento',
  HEALTH_CONDITION:'Condición de salud',HEALTH_CAMPAIGN:'Tratamiento',CLEANING:'Limpieza de potrero',
  PASTURE_CLEANING:'Limpieza de potrero',LIVESTOCK_ACTIVITY:'Actividad',REPRODUCTION_HEAT:'Celo',
  REPRODUCTION_SERVICE:'Servicio reproductivo',REPRODUCTION_PREGNANCY:'Preñez',REPRODUCTION_BIRTH:'Parto',
  REPRODUCTION_LOSS:'Pérdida gestacional',MILK_LACTATION:'Lactancia',MILK_PRODUCTION:'Producción de leche',
  MILK_TANK_PRODUCTION:'Leche en tanque',MEDIA_OBJECT:'Foto o archivo',PROPERTY:'Propiedad',
  PROPERTY_MODULE:'Función de la propiedad',PROPERTY_MEMBERSHIP:'Colaborador',PROPERTY_INVITATION:'Invitación',
  CATALOG_ITEM:'Opción del catálogo',ADMINISTRATIVE_ACCOUNT:'Cuenta',USER_SESSION:'Sesión',
  COMMERCE:'Compra o venta',FINANCE_ACCOUNT:'Cuenta de dinero',FINANCE_MOVEMENT:'Ingreso o egreso'};
const fields:Record<string,string>={ownerName:'Propietario',areaValue:'Extensión',address:'Ubicación',expiredAt:'Eliminación automática',name:'Nombre',displayName:'Nombre',description:'Descripción',notes:'Notas',
  previousEmail:'Correo anterior',newEmail:'Nuevo correo',sessionCount:'Sesiones cerradas',currentSessionClosed:'Cerró este dispositivo',
  activeIngredient:'Principio activo',defaultUnitCode:'Unidad de dosis',doseAmount:'Cantidad de referencia',doseWeight:'Peso de referencia',
  doseWeightUnitCode:'Unidad de peso',administrationRoutes:'Vías de administración',doseClassificationRanges:'Rangos por clasificación',
  indications:'Indicaciones',suggestedDose:'Referencia de dosis',withdrawalMilkDays:'Retiro de leche (días)',withdrawalMeatDays:'Retiro de carne (días)',
  reason:'Motivo',email:'Correo',earTagCode:'Identificación del animal',birthDate:'Nacimiento',entryDate:'Ingreso',
  sex:'Sexo',availabilityStatusCode:'Estado del animal',fromStatus:'Estado anterior',toStatus:'Estado actual',recordStatus:'Estado del registro',
  group:'Grupo',location:'Ubicación',classification:'Clasificación',
  breeds:'Razas',colors:'Colores',brands:'Marquillas',owners:'Propietarios',mother:'Madre',father:'Padre',
  weight:'Peso',unitCode:'Unidad',weighedOn:'Fecha del pesaje',method:'Método de pesaje',
  kind:'Tipo',area:'Área',areaUnitCode:'Unidad de área',pastureUse:'Uso del potrero',capacityEstimate:'Capacidad estimada',
  waterAvailable:'Agua disponible',lastRestDate:'Inicio del descanso',floorMaterial:'Material del piso',covered:'Cubierto',
  grasses:'Pastos',active:'Activo',enabled:'Habilitado',inMilking:'En ordeño',hasProfilePhoto:'Tiene foto de perfil',
  profilePhotoChanged:'Foto de perfil actualizada',status:'Estado',startsOn:'Fecha de inicio',endsOn:'Fecha de fin',
  startedOn:'Inicio',endedOn:'Fin',occurredOn:'Fecha',movementOn:'Fecha del traslado',producedOn:'Fecha de producción',
  amount:'Cantidad',total:'Total',price:'Precio',quantity:'Cantidad',liters:'Litros',animals:'Animales',
  initialWeight:'Peso inicial',initialWeightUnitCode:'Unidad del peso inicial',
  groupId:'Grupo asignado',locationId:'Ubicación asignada',destinationGroupId:'Grupo de destino',
  destinationLocationId:'Ubicación de destino',animalId:'Animal',cowId:'Vaca',motherId:'Madre',fatherId:'Padre',
  moduleCode:'Función',enabledModules:'Funciones habilitadas',isFalse:'Celo falso',voidedAt:'Anulación',
  cancelledAt:'Cancelación',completedAt:'Finalización',maxProperties:'Límite de propiedades'};
const values:Record<string,string>={BORRADOR:'Borrador',COMPLETADO:'Completado',COMPLETADA:'Completada',CANCELADO:'Cancelado',CANCELADA:'Cancelada',ACTIVE:'Activo',INACTIVE:'Inactivo',MISSING:'Desaparecido',DEAD:'Fallecido',
  MILLIGRAM:'mg',GRAM:'g',MILLILITER:'ml',LITER:'l',UNIT:'unidad',DOSE:'dosis',
  VACUNA:'Vacuna',DESPARASITACION:'Desparasitación',ENFERMEDAD:'Tratamiento de enfermedad',OTRO:'Otro tratamiento',
  ORAL:'Oral',INTRAMUSCULAR:'Intramuscular',SUBCUTANEA:'Subcutánea',INTRAVENOSA:'Intravenosa',TOPICA:'Tópica',OTRA:'Otra',
  EXITED:'Fuera de la propiedad',FEMALE:'Hembra',MALE:'Macho',KILOGRAM:'kg',POUND:'lb',PASTURE:'Potrero',CORRAL:'Corral',
  CURRENT:'Activo',TRASHED:'En la papelera',PURGED:'Eliminado',
  HECTARE:'ha',SQUARE_METER:'m²',SALE:'Venta',PURCHASE:'Compra',DRAFT:'Pendiente',COMPLETED:'Completado',
  CANCELLED:'Anulado',CONFIRMED:'Confirmado',OPEN:'Abierto',CLOSED:'Cerrado',INCOME:'Ingreso',EXPENSE:'Egreso',
  GRAZING:'Pastoreo',CUTTING:'Corte',MIXED:'Mixto',CORE:'Gestión principal',PASTURES:'Potreros',CORRALS:'Corrales',
  HEALTH:'Sanidad',REPRODUCTION:'Reproducción',PRODUCTION:'Producción',WEIGHING:'Pesajes',MOVEMENTS:'Traslados',
  MULTIMEDIA:'Fotos y archivos',SALES_PURCHASES:'Compras y ventas',TASKS:'Actividades',EVENTS:'Eventos',
  PROPERTY_FINANCE:'Ingresos y egresos',PERSONAL_FINANCE:'Mis finanzas',PASTURE_CLEANING:'Limpieza de potreros'};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)
  ?Object.fromEntries(Object.entries(value).map(([key,entry])=>[key.replace(/_([a-z])/g,(_,letter:string)=>letter.toUpperCase()),entry])):{};
const isId=(value:string)=>/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
export const auditAction=(action:string)=>actions[action]??'Guardó un cambio';
export const auditEntity=(type:string)=>entities[type]??'Registro';
export function auditRecordName(item:AuditRecord){
  const data={...object(item.beforeData),...object(item.afterData)};
  const name=[data.name,data.animalName,data.cowName,data.motherName,data.displayName,data.title,data.locationName,data.groupName]
    .find(value=>typeof value==='string'&&value.trim()&&!isId(value));
  return typeof name==='string'?name:auditEntity(item.entityType);
}
export const auditActor=(item:AuditRecord)=>item.superadminAccess
  ?`Equipo de soporte${item.actorDisplayName?' · '+item.actorDisplayName:''}`:item.actorName||'Sistema';
function valueText(value:unknown,key:string,data:Record<string,unknown>):string{
  if(value==null||value==='')return 'Sin información';
  if(typeof value==='boolean')return value?'Sí':'No';
  if(typeof value==='number')return value.toLocaleString('es');
  if(Array.isArray(value)){
    const names=value.map(entry=>valueText(entry,key,data)).filter(text=>text!=='Selección guardada'&&text!=='Datos guardados');
    return names.length?names.join(', '):`${value.length} ${key==='animals'?'animales':'elementos'}`;
  }
  if(typeof value==='object'){
    const named=object(value);return String(named.name??named.displayName??named.animalName??'Datos guardados');
  }
  const text=String(value);
  if(key.endsWith('Id')||isId(text)){
    const name=data[key.replace(/Id$/,'Name')];return typeof name==='string'?name:'Selección guardada';
  }
  if(/^\d{4}-\d{2}-\d{2}(T|$)/.test(text))return formatDate(text.slice(0,10));
  return values[text]??(/^[A-Z][A-Z_]+$/.test(text)?'Opción guardada':text);
}
export function auditChanges(item:AuditRecord){
  const before=object(item.beforeData),after=object(item.afterData);
  return Object.keys({...before,...after}).filter(key=>fields[key]&&JSON.stringify(before[key])!==JSON.stringify(after[key]))
    .map(key=>({label:fields[key]!,before:valueText(before[key],key,before),after:valueText(after[key],key,after)}));
}
