import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/async-handler.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../core/errors.js';
import { created, noContent, ok } from '../../core/http.js';
import { routeParam } from '../../core/route-param.js';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { hasPermission } from '../../middleware/permission.js';
import { assertAnimalOperationAllowed } from '../../services/animal-operation-policy.js';
import { assertMedicationApplication } from '../../services/medication-policy.js';
import { notifyRecordCreated } from '../notifications/business-notifications.service.js';
import { emitNotification } from '../notifications/notifications.service.js';
import { scheduleNotificationPushDispatch } from '../notifications/notifications.push.js';
import { buildInsert } from '../shared/sql.js';

const activityTypes=['TRATAMIENTO','MOVIMIENTO','LIMPIEZA_POTRERO','HERRAJE','PESAJE','INSEMINACION_ARTIFICIAL','TRANSFERENCIA_EMBRIONES','DESCORNE','PERSONALIZADA'] as const;
const itemSchema=z.object({
  clase:z.enum(['TAREA','EVENTO']),tipo_actividad:z.enum(activityTypes),titulo:z.string().trim().min(2).max(180),
  instrucciones:z.string().trim().max(5000).nullable().optional(),programado_para:z.string().datetime({offset:true}),
  recordatorio_para:z.string().datetime({offset:true}).nullable().optional(),visibilidad:z.enum(['PRIVADO','SELECCIONADOS','TODOS']).default('SELECCIONADOS'),
  asignacion_seguimiento:z.enum(['MISMO_ASIGNADO','TODOS','SELECCIONADOS']).default('SELECCIONADOS'),
  id_usuarios:z.array(z.string().uuid()).default([]),id_animales:z.array(z.string().uuid()).default([]),
  datos:z.record(z.unknown()).default({}),campos_editables:z.array(z.string().trim().min(1).max(80)).default([]),
}).superRefine((value,context)=>{
  if(value.clase==='TAREA'&&!value.id_usuarios.length)context.addIssue({code:z.ZodIssueCode.custom,path:['id_usuarios'],message:'Asigna la tarea al menos a un usuario.'});
  if(value.clase==='EVENTO'&&value.visibilidad==='SELECCIONADOS'&&!value.id_usuarios.length)context.addIssue({code:z.ZodIssueCode.custom,path:['id_usuarios'],message:'Selecciona quién puede ver el evento.'});
  if(value.recordatorio_para&&value.recordatorio_para>value.programado_para)context.addIssue({code:z.ZodIssueCode.custom,path:['recordatorio_para'],message:'El recordatorio debe ser anterior a la actividad.'});
  if(value.tipo_actividad==='TRATAMIENTO'&&!value.id_animales.length)context.addIssue({code:z.ZodIssueCode.custom,path:['id_animales'],message:'Relaciona al menos un animal con el tratamiento.'});
});
const treatmentSchema=z.object({
  id_tipo_tratamiento:z.string().uuid(),id_medicamento:z.string().uuid(),id_via_administracion:z.string().uuid(),
  dosis:z.coerce.number().positive(),id_unidad_dosis:z.string().uuid(),fecha_aplicacion:z.string().date(),
  proxima_aplicacion:z.string().date().nullable().optional(),aplicado_por:z.string().trim().max(200).nullable().optional(),
  descripcion:z.string().trim().max(500).nullable().optional(),observaciones:z.string().trim().max(3000).nullable().optional(),
});

const selectItems=`SELECT i.*,CONCAT(c.nombres,' ',c.apellidos) creado_por_nombre,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id_usuario',u.id_usuario,'nombre',CONCAT(u.nombres,' ',u.apellidos),'foto_perfil_url',u.foto_perfil_url,'rol',au.rol,'respuesta',au.respuesta,'respondido_at',au.respondido_at) ORDER BY u.nombres,u.apellidos) FROM agenda_usuario au JOIN usuario u ON u.id_usuario=au.id_usuario WHERE au.id_agenda_item=i.id_agenda_item),'[]') usuarios,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id_animal',a.id_animal,'nombre',a.nombre,'codigo_arete',a.codigo_arete,'foto_perfil',(SELECT ai.secure_url FROM animal_imagen ai WHERE ai.id_animal=a.id_animal AND ai.deleted_at IS NULL ORDER BY ai.es_perfil DESC,ai.created_at DESC LIMIT 1)) ORDER BY a.nombre) FROM agenda_animal aa JOIN animal a ON a.id_animal=aa.id_animal WHERE aa.id_agenda_item=i.id_agenda_item),'[]') animales,
 (SELECT au.respuesta FROM agenda_usuario au WHERE au.id_agenda_item=i.id_agenda_item AND au.id_usuario=$1 AND au.rol='ASIGNADO') mi_respuesta
 FROM agenda_item i JOIN usuario c ON c.id_usuario=i.creado_por`;

async function configuration(){return(await pool.query(`SELECT tareas_habilitadas,eventos_habilitados,updated_at FROM configuracion_agenda WHERE id_configuracion=1`)).rows[0]??{tareas_habilitadas:true,eventos_habilitados:true,updated_at:null};}
export const agendaRouter=Router();

agendaRouter.get('/configuracion',asyncHandler(async(_req,res)=>ok(res,await configuration())));
agendaRouter.get('/opciones',asyncHandler(async(_req,res)=>{
  const [users,animals,config]=await Promise.all([
    pool.query(`SELECT id_usuario,CONCAT(nombres,' ',apellidos) nombre,foto_perfil_url FROM usuario WHERE activo=TRUE AND deleted_at IS NULL ORDER BY nombres,apellidos`),
    pool.query(`SELECT a.id_animal,a.nombre,a.codigo_arete,a.sexo,a.estado,(SELECT ai.secure_url FROM animal_imagen ai WHERE ai.id_animal=a.id_animal AND ai.deleted_at IS NULL ORDER BY ai.es_perfil DESC,ai.created_at DESC LIMIT 1) foto_perfil FROM animal a WHERE a.deleted_at IS NULL AND a.estado='ACTIVO' ORDER BY a.nombre,a.codigo_arete`),configuration(),
  ]);return ok(res,{usuarios:users.rows,animales:animals.rows,configuracion:config});
}));
agendaRouter.get('/',asyncHandler(async(req,res)=>ok(res,(await pool.query(`${selectItems} WHERE i.deleted_at IS NULL AND (i.creado_por=$1 OR i.visibilidad='TODOS' OR EXISTS(SELECT 1 FROM agenda_usuario au WHERE au.id_agenda_item=i.id_agenda_item AND au.id_usuario=$1)) ORDER BY CASE i.estado WHEN 'PENDIENTE' THEN 0 WHEN 'ACEPTADA' THEN 1 ELSE 2 END,i.programado_para`,[req.user!.id])).rows)));
agendaRouter.get('/:id',asyncHandler(async(req,res)=>{const item=(await pool.query(`${selectItems} WHERE i.id_agenda_item=$2 AND i.deleted_at IS NULL AND (i.creado_por=$1 OR i.visibilidad='TODOS' OR EXISTS(SELECT 1 FROM agenda_usuario au WHERE au.id_agenda_item=i.id_agenda_item AND au.id_usuario=$1))`,[req.user!.id,routeParam(req.params.id,'id')])).rows[0];if(!item)throw new NotFoundError('Tarea o evento no encontrado.');return ok(res,item);}));

agendaRouter.post('/',asyncHandler(async(req,res)=>{
  const input=itemSchema.parse(req.body),config=await configuration();
  if(input.clase==='TAREA'&&!config.tareas_habilitadas)throw new ConflictError('Las tareas están desactivadas en Configuración.');
  if(input.clase==='EVENTO'&&!config.eventos_habilitados)throw new ConflictError('Los eventos están desactivados en Configuración.');
  const item=await transaction(async client=>{
    const users=[...new Set(input.id_usuarios)],animals=[...new Set(input.id_animales)];
    if(users.length&&(await client.query(`SELECT 1 FROM usuario WHERE id_usuario=ANY($1::uuid[]) AND activo=TRUE AND deleted_at IS NULL`,[users])).rowCount!==users.length)throw new ValidationError('Uno de los usuarios seleccionados ya no está disponible.');
    if(animals.length&&(await client.query(`SELECT 1 FROM animal WHERE id_animal=ANY($1::uuid[]) AND deleted_at IS NULL`,[animals])).rowCount!==animals.length)throw new ValidationError('Uno de los animales seleccionados ya no está disponible.');
    if(input.tipo_actividad==='TRATAMIENTO')treatmentSchema.parse(input.datos);
    const saved=(await client.query(buildInsert('agenda_item',{clase:input.clase,tipo_actividad:input.tipo_actividad,titulo:input.titulo,instrucciones:input.instrucciones??null,programado_para:input.programado_para,recordatorio_para:input.recordatorio_para??null,visibilidad:input.visibilidad,datos:JSON.stringify(input.datos),campos_editables:input.campos_editables,asignacion_seguimiento:input.asignacion_seguimiento,creado_por:req.user!.id}))).rows[0];
    for(const userId of users)await client.query(`INSERT INTO agenda_usuario(id_agenda_item,id_usuario,rol) VALUES($1,$2,$3)`,[saved.id_agenda_item,userId,input.clase==='TAREA'?'ASIGNADO':'VISOR']);
    for(const animalId of animals)await client.query(`INSERT INTO agenda_animal(id_agenda_item,id_animal) VALUES($1,$2)`,[saved.id_agenda_item,animalId]);
    const recipients=input.clase==='TAREA'?users:input.visibilidad==='TODOS'?(await client.query(`SELECT id_usuario FROM usuario WHERE activo=TRUE AND deleted_at IS NULL AND id_usuario<>$1`,[req.user!.id])).rows.map(row=>String(row.id_usuario)):input.visibilidad==='SELECCIONADOS'?users:[];
    if(recipients.length)await emitNotification(client,{tipo:input.clase==='TAREA'?'TAREA_ASIGNADA':'EVENTO_CREADO',categoria:'ACTIVIDADES',prioridad:'IMPORTANTE',titulo:input.clase==='TAREA'?'Nueva tarea asignada':'Nuevo evento',mensaje:`${input.titulo} · ${new Intl.DateTimeFormat('es-EC',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Guayaquil'}).format(new Date(input.programado_para))}.`,entidadTipo:'AGENDA',entidadId:saved.id_agenda_item,ruta:`/agenda?item=${saved.id_agenda_item}`,usuarios:recipients,creadoPor:req.user!.id,datos:{clase:input.clase,programado_para:input.programado_para,recordatorio_para:input.recordatorio_para??null},claveDedupe:`AGENDA:CREADA:${saved.id_agenda_item}`});
    return saved;
  },req.user!.id);scheduleNotificationPushDispatch();return created(res,item);
}));

agendaRouter.post('/:id/responder',asyncHandler(async(req,res)=>{
  const id=routeParam(req.params.id,'id'),input=z.object({respuesta:z.enum(['ACEPTADA','RECHAZADA'])}).parse(req.body);
  const result=await transaction(async client=>{
    const item=(await client.query(`SELECT * FROM agenda_item WHERE id_agenda_item=$1 AND clase='TAREA' AND deleted_at IS NULL FOR UPDATE`,[id])).rows[0];
    if(!item)throw new NotFoundError('Tarea no encontrada.');if(['COMPLETADA','CANCELADA'].includes(item.estado))throw new ConflictError('Esta tarea ya está cerrada.');
    const assigned=await client.query(`UPDATE agenda_usuario SET respuesta=$3,respondido_at=NOW() WHERE id_agenda_item=$1 AND id_usuario=$2 AND rol='ASIGNADO' RETURNING *`,[id,req.user!.id,input.respuesta]);
    if(!assigned.rowCount)throw new ForbiddenError('Esta tarea no está asignada a tu usuario.');
    if(input.respuesta==='ACEPTADA')await client.query(`UPDATE agenda_item SET estado='ACEPTADA',updated_at=NOW() WHERE id_agenda_item=$1`,[id]);
    else await client.query(`UPDATE agenda_item SET estado=CASE WHEN EXISTS(SELECT 1 FROM agenda_usuario WHERE id_agenda_item=$1 AND rol='ASIGNADO' AND respuesta<>'RECHAZADA') THEN estado ELSE 'RECHAZADA' END,updated_at=NOW() WHERE id_agenda_item=$1`,[id]);
    await emitNotification(client,{tipo:'TAREA_RESPONDIDA',categoria:'ACTIVIDADES',titulo:`Tarea ${input.respuesta==='ACEPTADA'?'aceptada':'rechazada'}`,mensaje:String(item.titulo),entidadTipo:'AGENDA',entidadId:id,ruta:`/agenda?item=${id}`,usuarios:[String(item.creado_por)],claveDedupe:`AGENDA:RESPUESTA:${id}:${req.user!.id}:${input.respuesta}`});return assigned.rows[0];
  },req.user!.id);scheduleNotificationPushDispatch();return ok(res,result);
}));

agendaRouter.post('/:id/completar',asyncHandler(async(req,res)=>{
  const id=routeParam(req.params.id,'id'),input=z.object({datos:z.record(z.unknown()).default({})}).parse(req.body);
  const result=await transaction(async client=>{
    const item=(await client.query(`SELECT * FROM agenda_item WHERE id_agenda_item=$1 AND clase='TAREA' AND deleted_at IS NULL FOR UPDATE`,[id])).rows[0];
    if(!item)throw new NotFoundError('Tarea no encontrada.');if(item.estado==='COMPLETADA')throw new ConflictError('Esta tarea ya fue realizada.');if(['CANCELADA','RECHAZADA'].includes(item.estado))throw new ConflictError('Esta tarea está cerrada.');
    const assigned=(await client.query(`SELECT respuesta FROM agenda_usuario WHERE id_agenda_item=$1 AND id_usuario=$2 AND rol='ASIGNADO'`,[id,req.user!.id])).rows[0];
    if(!assigned&&item.creado_por!==req.user!.id&&!hasPermission(req.user,'ACTIVIDAD_ADMINISTRAR'))throw new ForbiddenError('Esta tarea no está asignada a tu usuario.');if(assigned?.respuesta==='RECHAZADA')throw new ConflictError('Rechazaste esta tarea y ya no puedes completarla.');
    const original=item.datos as Record<string,unknown>,actual={...original},editable=new Set<string>(item.campos_editables??[]);for(const [key,value] of Object.entries(input.datos))if(editable.has(key))actual[key]=value;
    if(item.tipo_actividad==='TRATAMIENTO'){
      const treatment=treatmentSchema.parse(actual),animals=(await client.query(`SELECT id_animal FROM agenda_animal WHERE id_agenda_item=$1`,[id])).rows;if(!animals.length)throw new ValidationError('La tarea no tiene animales relacionados.');
      for(const animal of animals){await assertAnimalOperationAllowed(client,animal.id_animal,'TRATAMIENTO');await assertMedicationApplication(client,treatment.id_medicamento,treatment.id_via_administracion,treatment.id_unidad_dosis,treatment.id_tipo_tratamiento);const saved=(await client.query(buildInsert('tratamiento_animal',{...treatment,id_animal:animal.id_animal,id_condicion_salud:null,registrado_por:req.user!.id}))).rows[0];await notifyRecordCreated(client,'tratamientos',saved,req.user!.id);}
    }
    const updated=(await client.query(`UPDATE agenda_item SET estado='COMPLETADA',datos_realizados=$2::jsonb,completado_por=$3,completado_at=NOW(),updated_at=NOW() WHERE id_agenda_item=$1 RETURNING *`,[id,JSON.stringify(actual),req.user!.id])).rows[0];
    await client.query(`UPDATE agenda_usuario SET respuesta='ACEPTADA',respondido_at=COALESCE(respondido_at,NOW()) WHERE id_agenda_item=$1 AND id_usuario=$2 AND rol='ASIGNADO'`,[id,req.user!.id]);
    if(item.creado_por!==req.user!.id)await emitNotification(client,{tipo:'TAREA_COMPLETADA',categoria:'ACTIVIDADES',titulo:'Tarea completada',mensaje:String(item.titulo),entidadTipo:'AGENDA',entidadId:id,ruta:`/agenda?item=${id}`,usuarios:[String(item.creado_por)],claveDedupe:`AGENDA:COMPLETADA:${id}`});return updated;
  },req.user!.id);scheduleNotificationPushDispatch();return ok(res,result);
}));

agendaRouter.delete('/:id',asyncHandler(async(req,res)=>{const result=await pool.query(`UPDATE agenda_item SET estado='CANCELADA',deleted_at=NOW(),updated_at=NOW() WHERE id_agenda_item=$1 AND creado_por=$2 AND deleted_at IS NULL`,[routeParam(req.params.id,'id'),req.user!.id]);if(!result.rowCount)throw new NotFoundError('Tarea o evento no encontrado, o no eres quien lo creó.');return noContent(res);}));
