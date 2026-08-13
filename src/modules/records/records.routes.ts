import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { env } from '../../config/env.js';
import { transaction } from '../../database/transaction.js';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, noContent, ok } from '../../core/http.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { assertPermission, requirePermission } from '../../middleware/permission.js';
import { buildInsert, buildUpdate } from '../shared/sql.js';
import { deleteCloudinaryImage, uploadAnimalImage } from '../../services/cloudinary.service.js';
import { assertAnimalOperationAllowed, type AnimalOperationCode } from '../../services/animal-operation-policy.js';

type Def = {
  table: string;
  id: string;
  animalColumn: 'id_animal' | 'id_vaca';
  read: string;
  write: string;
  columns: string[];
  order: string;
  operation: AnimalOperationCode;
};

const defs: Record<string, Def> = {
  abortos: { table: 'aborto', id: 'id_aborto', animalColumn: 'id_vaca', read: 'ABORTO_CONSULTAR', write: 'ABORTO_ADMINISTRAR', operation: 'ABORTO', columns: ['id_vaca','id_prenez','fecha','causa','meses_gestacion','descripcion'], order: 'fecha DESC NULLS LAST' },
  lactancias: { table: 'lactancia', id: 'id_lactancia', animalColumn: 'id_vaca', read: 'LACTANCIA_CONSULTAR', write: 'LACTANCIA_ADMINISTRAR', operation: 'LACTANCIA', columns: ['id_vaca','id_parto','fecha_inicio','fecha_fin','activa','en_ordeno','observaciones'], order: 'fecha_inicio DESC' },
  producciones: { table: 'produccion_leche', id: 'id_produccion', animalColumn: 'id_vaca', read: 'PRODUCCION_CONSULTAR', write: 'PRODUCCION_ADMINISTRAR', operation: 'PRODUCCION_LECHE', columns: ['id_vaca','fecha_produccion','turno','litros','observaciones','fuente','referencia_externa'], order: 'fecha_produccion DESC' },
  pesajes: { table: 'pesaje', id: 'id_pesaje', animalColumn: 'id_animal', read: 'PESAJE_CONSULTAR', write: 'PESAJE_ADMINISTRAR', operation: 'PESAJE', columns: ['id_animal','fecha_pesaje','peso_kg','metodo','observaciones'], order: 'fecha_pesaje DESC' },
  muertes: { table: 'muerte', id: 'id_muerte', animalColumn: 'id_animal', read: 'MUERTE_CONSULTAR', write: 'MUERTE_ADMINISTRAR', operation: 'MUERTE', columns: ['id_animal','fecha','causa','descripcion'], order: 'fecha DESC' },
  tratamientos: { table: 'tratamiento_animal', id: 'id_tratamiento', animalColumn: 'id_animal', read: 'SANIDAD_CONSULTAR', write: 'SANIDAD_ADMINISTRAR', operation: 'TRATAMIENTO', columns: ['id_animal','id_condicion_salud','id_tipo_tratamiento','id_medicamento','id_via_administracion','dosis','id_unidad_dosis','fecha_aplicacion','proxima_aplicacion','aplicado_por','descripcion','observaciones'], order: 'fecha_aplicacion DESC' }
};

function definition(moduleName: string | undefined) {
  const value = moduleName ? defs[moduleName] : undefined;
  if (!value) throw new NotFoundError('Módulo no encontrado.');
  return value;
}
function allowedBody(body: Record<string, unknown>, columns: string[]) {
  const data = Object.fromEntries(Object.entries(body).filter(([key]) => columns.includes(key)));
  if (!Object.keys(data).length) throw new ValidationError('No hay campos válidos para guardar.');
  return data;
}

export const recordsRouter = Router();

const lactationSchema=z.object({
  id_vaca:z.string().uuid(),
  id_parto:z.string().uuid(),
  fecha_fin:z.string().date().nullable().optional(),
  activa:z.boolean().default(true),
  en_ordeno:z.boolean().default(false),
  observaciones:z.string().trim().max(2000).nullable().optional(),
}).superRefine((value,ctx)=>{
  if(!value.activa&&!value.fecha_fin)ctx.addIssue({code:z.ZodIssueCode.custom,path:['fecha_fin'],message:'Ingresa la fecha de cierre.'});
  if(!value.activa&&value.en_ordeno)ctx.addIssue({code:z.ZodIssueCode.custom,path:['en_ordeno'],message:'Solo una lactancia activa puede estar en ordeño.'});
});

type LactationInput=z.infer<typeof lactationSchema>;
type TransactionClient=Parameters<Parameters<typeof transaction>[0]>[0];

async function validateLactation(client:TransactionClient,input:LactationInput,excludeId?:string) {
  await assertAnimalOperationAllowed(client,input.id_vaca,'LACTANCIA');
  const cow=(await client.query(
    `SELECT sexo FROM animal WHERE id_animal=$1 AND deleted_at IS NULL FOR UPDATE`,[input.id_vaca],
  )).rows[0] as {sexo:string}|undefined;
  if(!cow)throw new NotFoundError('Vaca no encontrada.');
  if(cow.sexo!=='HEMBRA')throw new ValidationError('Solo se puede registrar una lactancia para una hembra.');

  const birth=(await client.query(
    `SELECT id_madre,fecha_parto::text AS fecha_parto FROM parto
     WHERE id_parto=$1 AND deleted_at IS NULL FOR SHARE`,[input.id_parto],
  )).rows[0] as {id_madre:string;fecha_parto:string}|undefined;
  if(!birth)throw new NotFoundError('El parto relacionado no existe.');
  if(birth.id_madre!==input.id_vaca)throw new ValidationError('El parto seleccionado no pertenece a la vaca.');
  const startDate=birth.fecha_parto;
  if(input.fecha_fin&&input.fecha_fin<startDate)throw new ValidationError('La fecha de cierre no puede ser anterior al parto.');
  const linked=(await client.query(
    `SELECT id_lactancia FROM lactancia
     WHERE id_parto=$1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR id_lactancia<>$2::uuid)
     LIMIT 1 FOR SHARE`,[input.id_parto,excludeId??null],
  )).rows[0];
  if(linked)throw new ValidationError('Este parto ya está relacionado con otra lactancia.');

  const overlap=(await client.query(
    `SELECT id_lactancia FROM lactancia
     WHERE id_vaca=$1 AND deleted_at IS NULL
       AND ($4::uuid IS NULL OR id_lactancia<>$4::uuid)
       AND daterange(fecha_inicio,COALESCE(fecha_fin,'infinity'::date),'[]')
           && daterange($2::date,COALESCE($3::date,'infinity'::date),'[]')
     LIMIT 1 FOR SHARE`,
    [input.id_vaca,startDate,input.activa?null:(input.fecha_fin??null),excludeId??null],
  )).rows[0];
  if(overlap)throw new ValidationError('La vaca ya tiene otra lactancia que coincide con esas fechas.');
  return startDate;
}

async function activeLactation(client:Parameters<Parameters<typeof transaction>[0]>[0],animalId:string,date:string) {
  const rows=(await client.query(
    `SELECT id_lactancia FROM lactancia
     WHERE id_vaca=$1 AND deleted_at IS NULL AND activa=TRUE AND en_ordeno=TRUE
       AND fecha_inicio<=$2::date AND fecha_inicio + INTERVAL '18 months'>=$2::date
       AND (fecha_fin IS NULL OR fecha_fin>=$2::date)
     ORDER BY fecha_inicio DESC FOR SHARE`,[animalId,date],
  )).rows as Array<{id_lactancia:string}>;
  if(!rows.length)throw new ValidationError('La vaca debe tener una lactancia activa, marcada en ordeño y con no más de 18 meses en la fecha seleccionada.');
  if(rows.length>1)throw new ValidationError('La vaca tiene más de una lactancia activa. Cierra el registro duplicado antes de continuar.');
  return rows[0].id_lactancia;
}

async function linkedHealthCondition(client:Parameters<Parameters<typeof transaction>[0]>[0],conditionId:string|null|undefined,animalId:string) {
  if(!conditionId)return null;
  const row=(await client.query(
    `SELECT id_condicion_salud,estado FROM condicion_salud
     WHERE id_condicion_salud=$1 AND id_animal=$2 AND deleted_at IS NULL AND estado<>'RESUELTA' FOR UPDATE`,
    [conditionId,animalId],
  )).rows[0] as {id_condicion_salud:string;estado:string}|undefined;
  if(!row)throw new ValidationError('La condición seleccionada no pertenece al animal o ya está resuelta.');
  return row;
}

const tankSchema=z.object({
  fecha_produccion:z.string().date(),turno:z.enum(['MANANA','TARDE','NOCHE','UNICO']).default('UNICO'),
  litros:z.number().min(0),fuente:z.enum(['MANUAL','SENSOR']).default('MANUAL'),
  referencia_externa:z.string().trim().max(160).nullable().optional(),observaciones:z.string().nullable().optional(),
});

recordsRouter.get('/producciones/vacas-activas',requirePermission('PRODUCCION_CONSULTAR'),asyncHandler(async(req,res)=>{
  const date=z.string().date().catch(new Date().toISOString().slice(0,10)).parse(req.query.fecha);
  return ok(res,(await pool.query(
    `SELECT a.id_animal,a.nombre,a.codigo_arete,l.id_lactancia,l.fecha_inicio
     FROM lactancia l JOIN animal a ON a.id_animal=l.id_vaca AND a.deleted_at IS NULL AND a.estado='ACTIVO'
     WHERE l.deleted_at IS NULL AND l.activa=TRUE AND l.en_ordeno=TRUE
       AND l.fecha_inicio<=$1::date AND l.fecha_inicio + INTERVAL '18 months'>=$1::date
       AND (l.fecha_fin IS NULL OR l.fecha_fin>=$1::date)
     ORDER BY a.nombre,a.codigo_arete`,[date],
  )).rows);
}));

recordsRouter.get('/lactancias/vacas-disponibles',requirePermission('LACTANCIA_CONSULTAR'),asyncHandler(async(req,res)=>{
  const lactationId=z.string().uuid().optional().parse(req.query.id_lactancia);
  return ok(res,(await pool.query(
    `SELECT a.id_animal,a.nombre,a.codigo_arete,FALSE tiene_lactancia_actual
     FROM animal a
     WHERE a.deleted_at IS NULL AND a.estado='ACTIVO' AND a.sexo='HEMBRA'
       AND EXISTS(SELECT 1 FROM parto p WHERE p.id_madre=a.id_animal AND p.deleted_at IS NULL)
       AND NOT EXISTS(
         SELECT 1 FROM lactancia l
         WHERE l.id_vaca=a.id_animal AND l.deleted_at IS NULL AND l.activa=TRUE
           AND ($1::uuid IS NULL OR l.id_lactancia<>$1::uuid)
       )
       AND COALESCE((
         SELECT policy.permitido
         FROM operacion_categoria_animal policy
         WHERE policy.id_categoria_animal=a.id_categoria_animal
           AND policy.codigo_operacion='LACTANCIA'
           AND policy.deleted_at IS NULL
         LIMIT 1
       ),TRUE)=TRUE
     ORDER BY a.nombre,a.codigo_arete`,[lactationId??null]
  )).rows);
}));

recordsRouter.get('/lactancias/partos',requirePermission('LACTANCIA_CONSULTAR'),asyncHandler(async(req,res)=>{
  const cowId=z.string().uuid().parse(req.query.id_vaca);
  const lactationId=z.string().uuid().optional().parse(req.query.id_lactancia);
  return ok(res,(await pool.query(
    `SELECT p.id_parto,p.fecha_parto,
      (SELECT COUNT(*)::int FROM parto_cria pc WHERE pc.id_parto=p.id_parto AND pc.deleted_at IS NULL) total_crias,
      EXISTS(
        SELECT 1 FROM lactancia l
        WHERE l.id_parto=p.id_parto AND l.deleted_at IS NULL
          AND ($2::uuid IS NULL OR l.id_lactancia<>$2::uuid)
      ) ya_relacionado
     FROM parto p
     WHERE p.id_madre=$1 AND p.deleted_at IS NULL
       AND NOT EXISTS(
         SELECT 1 FROM lactancia l
         WHERE l.id_parto=p.id_parto AND l.deleted_at IS NULL
           AND ($2::uuid IS NULL OR l.id_lactancia<>$2::uuid)
       )
     ORDER BY p.fecha_parto DESC,p.created_at DESC`,[cowId,lactationId??null],
  )).rows);
}));

recordsRouter.get('/producciones/resumen/diario',requirePermission('PRODUCCION_CONSULTAR'),asyncHandler(async(req,res)=>{
  const date=z.string().date().catch(new Date().toISOString().slice(0,10)).parse(req.query.fecha);
  const row=(await pool.query(
    `SELECT
      (SELECT COALESCE(SUM(litros),0) FROM produccion_leche WHERE fecha_produccion=$1::date AND deleted_at IS NULL) total_vacas,
      (SELECT COALESCE(SUM(litros),0) FROM produccion_tanque WHERE fecha_produccion=$1::date AND deleted_at IS NULL) total_tanque,
      (SELECT COUNT(DISTINCT id_vaca)::int FROM produccion_leche WHERE fecha_produccion=$1::date AND deleted_at IS NULL) vacas_registradas`,
    [date],
  )).rows[0];
  return ok(res,{fecha:date,total_vacas:row.total_vacas,total_tanque:row.total_tanque,
    diferencia:Number(row.total_tanque)-Number(row.total_vacas),vacas_registradas:row.vacas_registradas});
}));

recordsRouter.get('/produccion-tanque',requirePermission('PRODUCCION_CONSULTAR'),asyncHandler(async(_req,res)=>ok(res,(await pool.query(
  `SELECT * FROM produccion_tanque WHERE deleted_at IS NULL ORDER BY fecha_produccion DESC,created_at DESC`
)).rows)));

recordsRouter.post('/produccion-tanque',requirePermission('PRODUCCION_ADMINISTRAR'),asyncHandler(async(req,res)=>{
  const input=tankSchema.parse(req.body);
  return created(res,(await pool.query(buildInsert('produccion_tanque',{...input,referencia_externa:input.referencia_externa??null,observaciones:input.observaciones??null,registrado_por:req.user!.id}))).rows[0]);
}));

recordsRouter.patch('/produccion-tanque/:id',requirePermission('PRODUCCION_ADMINISTRAR'),asyncHandler(async(req,res)=>{
  const input=tankSchema.parse(req.body);
  const row=(await pool.query(buildUpdate('produccion_tanque','id_produccion_tanque',routeParam(req.params.id,'id'),input))).rows[0];
  if(!row)throw new NotFoundError('Medición del tanque no encontrada.');
  return ok(res,row);
}));

recordsRouter.delete('/produccion-tanque/:id',requirePermission('PRODUCCION_ADMINISTRAR'),asyncHandler(async(req,res)=>{
  const result=await pool.query('UPDATE produccion_tanque SET deleted_at=NOW(),updated_at=NOW() WHERE id_produccion_tanque=$1 AND deleted_at IS NULL',[routeParam(req.params.id,'id')]);
  if(!result.rowCount)throw new NotFoundError('Medición del tanque no encontrada.');
  return noContent(res);
}));

recordsRouter.get('/:module', asyncHandler(async (req, res) => {
  const d = definition(routeParam(req.params.module, 'module'));
  assertPermission(req.user, d.read);
  const treatmentSelect=d.table==='tratamiento_animal' ? ',cs.estado condicion_estado,cs.descripcion condicion_descripcion,tcs.nombre condicion_tipo' : '';
  const abortionSelect=d.table==='aborto' ? ',pr.fecha_confirmacion prenez_fecha,pr.estado prenez_estado' : '';
  const treatmentJoins=d.table==='tratamiento_animal'
    ? 'LEFT JOIN condicion_salud cs ON cs.id_condicion_salud=r.id_condicion_salud LEFT JOIN tipo_condicion_salud tcs ON tcs.id_tipo_condicion_salud=cs.id_tipo_condicion_salud'
    : '';
  const abortionJoins=d.table==='aborto' ? 'LEFT JOIN prenez pr ON pr.id_prenez=r.id_prenez' : '';
  const rows = (await pool.query(
    `SELECT r.*, a.nombre animal, a.codigo_arete,a.id_categoria_animal,
      ca.codigo categoria_codigo,ca.nombre categoria ${treatmentSelect}${abortionSelect}
     FROM ${d.table} r
     LEFT JOIN animal a ON a.id_animal = r.${d.animalColumn}
     LEFT JOIN categoria_animal ca ON ca.id_categoria_animal=a.id_categoria_animal
     ${treatmentJoins}
     ${abortionJoins}
     WHERE r.deleted_at IS NULL
     ORDER BY r.${d.order}`
  )).rows;
  return ok(res, rows);
}));
recordsRouter.post('/:module', asyncHandler(async (req, res) => {
  const d = definition(routeParam(req.params.module, 'module'));
  assertPermission(req.user, d.write);
  if(d.table==='lactancia') {
    const parsed=lactationSchema.parse(req.body);
    const input={...parsed,id_parto:parsed.id_parto??null,fecha_fin:parsed.activa?null:(parsed.fecha_fin??null),observaciones:parsed.observaciones??null};
    const row=await transaction(async client=>{
      const fechaInicio=await validateLactation(client,input);
      return (await client.query(buildInsert('lactancia',{...input,fecha_inicio:fechaInicio,registrado_por:req.user!.id}))).rows[0];
    },req.user!.id);
    return created(res,row);
  }
  const data = allowedBody(req.body as Record<string, unknown>, d.columns);
  if(d.table==='aborto'&&typeof data.id_prenez==='string') {
    const pregnancy=(await pool.query(
      `SELECT id_vaca,estado FROM prenez WHERE id_prenez=$1 AND deleted_at IS NULL`,[data.id_prenez],
    )).rows[0] as {id_vaca:string;estado:string}|undefined;
    if(!pregnancy||pregnancy.estado!=='CONFIRMADA')throw new ValidationError('La preñez seleccionada no está confirmada o ya fue finalizada.');
    if(data.id_vaca&&data.id_vaca!==pregnancy.id_vaca)throw new ValidationError('La preñez seleccionada no pertenece a la vaca.');
    data.id_vaca=pregnancy.id_vaca;
  }
  const animalId = data[d.animalColumn];
  if (typeof animalId !== 'string') throw new ValidationError('Selecciona un animal.');
  await assertAnimalOperationAllowed(pool, animalId, d.operation);
  if(d.table==='aborto') {
    const row=await transaction(async client=>{
      const saved=(await client.query(buildInsert(d.table,{...data,id_prenez:data.id_prenez??null,registrado_por:req.user!.id}))).rows[0];
      if(data.id_prenez) {
        await client.query("UPDATE prenez SET estado='CANCELADA',updated_at=NOW() WHERE id_prenez=$1",[data.id_prenez]);
        await client.query("UPDATE proximo_parto SET estado='CANCELADO',updated_at=NOW() WHERE id_prenez=$1 AND deleted_at IS NULL",[data.id_prenez]);
      }
      return saved;
    },req.user!.id);
    return created(res,row);
  }
  if(d.table==='produccion_leche') {
    const date=String(data.fecha_produccion??'');
    if(!date)throw new ValidationError('Selecciona la fecha de producción.');
    const row=await transaction(async client=>{
      const lactationId=await activeLactation(client,animalId,date);
      return (await client.query(buildInsert(d.table,{...data,id_lactancia:lactationId,fuente:data.fuente??'MANUAL',registrado_por:req.user!.id}))).rows[0];
    },req.user!.id);
    return created(res,row);
  }
  if(d.table==='tratamiento_animal') {
    const row=await transaction(async client=>{
      const condition=await linkedHealthCondition(client,data.id_condicion_salud as string|null|undefined,animalId);
      const saved=(await client.query(buildInsert(d.table,{...data,id_condicion_salud:data.id_condicion_salud??null,registrado_por:req.user!.id}))).rows[0];
      if(condition)await client.query("UPDATE condicion_salud SET estado='EN_TRATAMIENTO',updated_at=NOW() WHERE id_condicion_salud=$1",[condition.id_condicion_salud]);
      return saved;
    },req.user!.id);
    return created(res,row);
  }
  const row = (await pool.query(buildInsert(d.table, { ...data, registrado_por: req.user!.id }))).rows[0];
  return created(res, row);
}));
recordsRouter.patch('/:module/:id', asyncHandler(async (req, res) => {
  const d = definition(routeParam(req.params.module, 'module'));
  assertPermission(req.user, d.write);
  if(d.table==='lactancia') {
    const id=routeParam(req.params.id,'id');
    const parsed=lactationSchema.parse(req.body);
    const input={...parsed,id_parto:parsed.id_parto??null,fecha_fin:parsed.activa?null:(parsed.fecha_fin??null),observaciones:parsed.observaciones??null};
    const row=await transaction(async client=>{
      const current=(await client.query(
        'SELECT id_lactancia FROM lactancia WHERE id_lactancia=$1 AND deleted_at IS NULL FOR UPDATE',[id],
      )).rows[0];
      if(!current)throw new NotFoundError('Lactancia no encontrada.');
      const fechaInicio=await validateLactation(client,input,id);
      return (await client.query(buildUpdate('lactancia','id_lactancia',id,{...input,fecha_inicio:fechaInicio}))).rows[0];
    },req.user!.id);
    return ok(res,row);
  }
  const data = allowedBody(req.body as Record<string, unknown>, d.columns);
  if(d.table==='aborto') {
    const id=routeParam(req.params.id,'id');
    const row=await transaction(async client=>{
      const current=(await client.query('SELECT * FROM aborto WHERE id_aborto=$1 AND deleted_at IS NULL FOR UPDATE',[id])).rows[0];
      if(!current)throw new NotFoundError('Aborto no encontrado.');
      const pregnancyId=(Object.prototype.hasOwnProperty.call(data,'id_prenez')?data.id_prenez:current.id_prenez) as string|null|undefined;
      let animalId=String(data.id_vaca??current.id_vaca);
      if(pregnancyId) {
        const pregnancy=(await client.query('SELECT id_vaca,estado FROM prenez WHERE id_prenez=$1 AND deleted_at IS NULL',[pregnancyId])).rows[0] as {id_vaca:string;estado:string}|undefined;
        if(!pregnancy)throw new ValidationError('La preñez seleccionada no existe.');
        if(pregnancyId!==current.id_prenez&&pregnancy.estado!=='CONFIRMADA')throw new ValidationError('La preñez seleccionada ya fue finalizada.');
        animalId=pregnancy.id_vaca;
        if(pregnancy.estado==='CONFIRMADA') {
          await client.query("UPDATE prenez SET estado='CANCELADA',updated_at=NOW() WHERE id_prenez=$1",[pregnancyId]);
          await client.query("UPDATE proximo_parto SET estado='CANCELADO',updated_at=NOW() WHERE id_prenez=$1 AND deleted_at IS NULL",[pregnancyId]);
        }
      }
      await assertAnimalOperationAllowed(client,animalId,d.operation);
      return (await client.query(buildUpdate(d.table,d.id,id,{...data,id_vaca:animalId,id_prenez:pregnancyId??null}))).rows[0];
    },req.user!.id);
    return ok(res,row);
  }
  if(d.table==='produccion_leche') {
    const id=routeParam(req.params.id,'id');
    const row=await transaction(async client=>{
      const current=(await client.query(
        `SELECT id_vaca,fecha_produccion::text AS fecha_produccion
         FROM produccion_leche WHERE id_produccion=$1 AND deleted_at IS NULL FOR UPDATE`,[id],
      )).rows[0];
      if(!current)throw new NotFoundError();
      const animalId=String(data.id_vaca??current.id_vaca);
      const date=String(data.fecha_produccion??current.fecha_produccion);
      await assertAnimalOperationAllowed(client,animalId,d.operation);
      const lactationId=await activeLactation(client,animalId,date);
      return (await client.query(buildUpdate(d.table,d.id,id,{...data,id_vaca:animalId,id_lactancia:lactationId}))).rows[0];
    },req.user!.id);
    return ok(res,row);
  }
  if(d.table==='tratamiento_animal') {
    const id=routeParam(req.params.id,'id');
    const row=await transaction(async client=>{
      const current=(await client.query('SELECT * FROM tratamiento_animal WHERE id_tratamiento=$1 AND deleted_at IS NULL FOR UPDATE',[id])).rows[0];
      if(!current)throw new NotFoundError();
      const animalId=String(data.id_animal??current.id_animal);
      const conditionId=(Object.prototype.hasOwnProperty.call(data,'id_condicion_salud')?data.id_condicion_salud:current.id_condicion_salud) as string|null|undefined;
      await assertAnimalOperationAllowed(client,animalId,d.operation);
      const condition=await linkedHealthCondition(client,conditionId,animalId);
      const saved=(await client.query(buildUpdate(d.table,d.id,id,{...data,id_animal:animalId,id_condicion_salud:conditionId??null}))).rows[0];
      if(condition)await client.query("UPDATE condicion_salud SET estado='EN_TRATAMIENTO',updated_at=NOW() WHERE id_condicion_salud=$1",[condition.id_condicion_salud]);
      return saved;
    },req.user!.id);
    return ok(res,row);
  }
  const row = (await pool.query(buildUpdate(d.table, d.id, routeParam(req.params.id, 'id'), data))).rows[0];
  if (!row) throw new NotFoundError();
  return ok(res, row);
}));
recordsRouter.delete('/:module/:id', asyncHandler(async (req, res) => {
  const d = definition(routeParam(req.params.module, 'module'));
  assertPermission(req.user, d.write);
  const result = await pool.query(`UPDATE ${d.table} SET deleted_at=NOW() WHERE ${d.id}=$1 AND deleted_at IS NULL`, [routeParam(req.params.id, 'id')]);
  if (!result.rowCount) throw new NotFoundError();
  return noContent(res);
}));

const partoSchema = z.object({
  id_prenez: z.string().uuid(),
  fecha_parto: z.string().date(),
  fecha_parto_local: z.string().date().optional(),
  tipo_parto: z.enum(['NORMAL','ASISTIDO','CESAREA','DESCONOCIDO']).default('NORMAL'),
  observaciones: z.string().nullable().optional(),
  crias: z.array(z.object({
    animal: z.object({
      codigo_arete: z.string().max(60).nullable().optional(),
      nombre: z.string().trim().min(1).max(120),
      id_especie: z.string().uuid(),
      sexo: z.enum(['MACHO','HEMBRA']),
      id_origen: z.string().uuid(),
      id_grupo_actual: z.string().uuid().nullable().optional(),
      id_ubicacion_actual: z.string().uuid().nullable().optional(),
      estado: z.enum(['ACTIVO','MUERTO']).default('ACTIVO'),
      colores: z.array(z.object({
        id: z.string().uuid(),
        principal: z.boolean().optional(),
      })).default([]),
      razas: z.array(z.object({
        id: z.string().uuid(),
        porcentaje: z.number().min(0).max(100).nullable().optional(),
      })).default([]),
      propietarios: z.array(z.object({
        id: z.string().uuid(),
        porcentaje: z.number().min(0).max(100).nullable().optional(),
        principal: z.boolean().optional(),
      })).default([]).superRefine((owners,ctx)=>{
        if(owners.filter((owner)=>owner.principal).length>1)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Solo un propietario puede ser principal.'});
        if(owners.reduce((sum,owner)=>sum+(owner.porcentaje??0),0)>100.001)ctx.addIssue({code:z.ZodIssueCode.custom,message:'La suma de porcentajes de propiedad no puede superar 100%.'});
      }),
    }),
    estado_nacimiento: z.enum(['VIVA','MUERTA','DEBIL','DESCONOCIDO']).default('VIVA'),
    peso_nacimiento_kg: z.number().positive().nullable().optional(),
    observaciones: z.string().max(300).nullable().optional()
  })).min(1)
});
const partoUpdateSchema = z.object({
  fecha_parto: z.string().date(),
  tipo_parto: z.enum(['NORMAL','ASISTIDO','CESAREA','DESCONOCIDO']),
  observaciones: z.string().nullable().optional(),
});

const birthImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_IMAGE_MB * 1024 * 1024 },
  fileFilter: (_req, file, callback) => file.mimetype.startsWith('image/')
    ? callback(null, true)
    : callback(new ValidationError('Solo se permiten imágenes.')),
});

export const birthsRouter = Router();
birthsRouter.get('/', requirePermission('PARTO_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, (await pool.query(
  `SELECT p.*, m.nombre madre,m.codigo_arete madre_arete,pa.nombre padre,pa.codigo_arete padre_arete,pr.fecha_confirmacion,pr.fecha_parto_tentativa,
   ca.codigo categoria_codigo,ca.nombre categoria,
   COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id_parto_cria',pc.id_parto_cria,'id_cria',c.id_animal,'cria',c.nombre,
      'codigo_arete',c.codigo_arete,'sexo',c.sexo,'estado_nacimiento',pc.estado_nacimiento,
      'peso_nacimiento_kg',pc.peso_nacimiento_kg,'orden_nacimiento',pc.orden_nacimiento,
      'foto_perfil',(SELECT ai.secure_url FROM animal_imagen ai WHERE ai.id_animal=c.id_animal AND ai.deleted_at IS NULL ORDER BY ai.es_perfil DESC,ai.created_at DESC LIMIT 1)
   ) ORDER BY pc.orden_nacimiento)
   FROM parto_cria pc JOIN animal c ON c.id_animal=pc.id_cria
   WHERE pc.id_parto=p.id_parto AND pc.deleted_at IS NULL),'[]') crias,
   COALESCE((SELECT jsonb_agg(jsonb_build_object(
     'id_imagen',bi.id_imagen,'secure_url',bi.secure_url,'url',bi.url,
     'public_id',bi.public_id,'nombre_original',bi.nombre_original,
     'descripcion',bi.descripcion,'fecha_toma',bi.fecha_toma,
     'created_at',bi.created_at,'tipo_archivo',bi.tipo_archivo,'es_perfil',bi.es_perfil,
     'etiquetas',COALESCE((SELECT jsonb_agg(jsonb_build_object(
       'id_etiqueta',bem.id_etiqueta,'codigo',bem.codigo,'nombre',bem.nombre
     ) ORDER BY bem.nombre) FROM animal_imagen_etiqueta bie
       JOIN etiqueta_multimedia bem ON bem.id_etiqueta=bie.id_etiqueta AND bem.deleted_at IS NULL
       WHERE bie.id_imagen=bi.id_imagen AND bie.deleted_at IS NULL),'[]'::jsonb)
   ) ORDER BY bi.fecha_toma DESC,bi.created_at DESC)
   FROM animal_imagen bi
   WHERE bi.id_parto=p.id_parto AND bi.es_perfil=FALSE AND bi.deleted_at IS NULL),'[]') imagenes
   FROM parto p JOIN animal m ON m.id_animal=p.id_madre
   JOIN categoria_animal ca ON ca.id_categoria_animal=m.id_categoria_animal
   LEFT JOIN animal pa ON pa.id_animal=p.id_padre
   LEFT JOIN prenez pr ON pr.id_prenez=p.id_prenez
   WHERE p.deleted_at IS NULL ORDER BY p.fecha_parto DESC`
)).rows)));

birthsRouter.patch('/:id', requirePermission('PARTO_ADMINISTRAR'), asyncHandler(async (req, res) => {
  const id=routeParam(req.params.id,'id');
  const input=partoUpdateSchema.parse(req.body);
  const row=(await pool.query(
    `UPDATE parto SET fecha_parto=$2,tipo_parto=$3,observaciones=$4,updated_at=NOW()
     WHERE id_parto=$1 AND deleted_at IS NULL RETURNING *`,
    [id,input.fecha_parto,input.tipo_parto,input.observaciones??null],
  )).rows[0];
  if(!row)throw new NotFoundError('Parto no encontrado.');
  return ok(res,row);
}));

birthsRouter.post('/', requirePermission('PARTO_ADMINISTRAR'), asyncHandler(async (req, res) => {
  const input = partoSchema.parse(req.body);
  try {
    const result = await transaction(async (client) => {
      const pregnancy = (await client.query(
        `SELECT p.id_prenez,p.id_vaca,p.id_padre,p.estado,
          v.id_animal,v.id_especie,v.id_categoria_animal,v.sexo,v.estado animal_estado
         FROM prenez p JOIN animal v ON v.id_animal=p.id_vaca AND v.deleted_at IS NULL
         WHERE p.id_prenez=$1 AND p.deleted_at IS NULL FOR UPDATE OF p`,
        [input.id_prenez],
      )).rows[0] as {
        id_prenez: string; id_vaca: string; id_padre: string | null; estado: string;
        id_animal: string; id_especie: string; id_categoria_animal: string; sexo: string; animal_estado: string;
      } | undefined;
      if (!pregnancy || pregnancy.estado !== 'CONFIRMADA') {
        throw new ValidationError('El parto debe registrarse desde una preñez confirmada y pendiente.');
      }
      const mother = {
        id_animal: pregnancy.id_animal,
        id_especie: pregnancy.id_especie,
        id_categoria_animal: pregnancy.id_categoria_animal,
        sexo: pregnancy.sexo,
        estado: pregnancy.animal_estado,
      };
      const motherId = pregnancy.id_vaca;
      const fatherId = pregnancy.id_padre;

      if (!mother || mother.sexo !== 'HEMBRA') {
        throw new ValidationError('La madre seleccionada no existe o no es hembra.');
      }
      if (mother.estado !== 'ACTIVO') {
        throw new ValidationError('La madre debe estar activa para registrar el parto.');
      }
      await assertAnimalOperationAllowed(client, motherId, 'PARTO');

      if (fatherId) {
        const father = (await client.query(
          `SELECT id_animal,id_especie,sexo,estado
           FROM animal
           WHERE id_animal=$1 AND deleted_at IS NULL
           FOR SHARE`,
          [fatherId],
        )).rows[0] as { id_animal: string; id_especie: string; sexo: string; estado: string } | undefined;
        if (!father || father.sexo !== 'MACHO') {
          throw new ValidationError('El padre seleccionado no existe o no es macho.');
        }
        if (father.id_especie !== mother.id_especie) {
          throw new ValidationError('El padre y la madre deben pertenecer a la misma especie.');
        }
      }

      const birthDate = new Date(input.fecha_parto);
      if (Number.isNaN(birthDate.getTime())) throw new ValidationError('La fecha del parto no es válida.');
      const birthDay = input.fecha_parto_local ?? new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(birthDate);
      await client.query("SELECT set_config('app.fecha_movimiento', $1, true)", [input.fecha_parto]);
      await client.query("SELECT set_config('app.motivo_cambio', 'Nacimiento', true)");
      const { crias, fecha_parto_local: _fechaPartoLocal, ...head } = input;
      const parto = (await client.query(buildInsert('parto', {
        ...head,
        id_madre: motherId,
        id_padre: fatherId,
        registrado_por: req.user!.id,
      }))).rows[0];

      const createdChildren: Array<Record<string, unknown>> = [];
      let order = 1;
      for (const item of crias) {
        if (item.animal.id_especie !== mother.id_especie) {
          throw new ValidationError(`La especie de la cría ${order} debe coincidir con la de la madre.`);
        }

        if (item.animal.id_grupo_actual) {
          const group = (await client.query(
            `SELECT id_especie,id_categoria_animal,id_ubicacion_actual,activo FROM grupo WHERE id_grupo=$1 AND deleted_at IS NULL`,
            [item.animal.id_grupo_actual],
          )).rows[0] as { id_especie: string | null; id_categoria_animal: string; id_ubicacion_actual: string | null; activo: boolean } | undefined;
          if (!group || !group.activo) throw new ValidationError(`El grupo de la cría ${order} no está disponible.`);
          if (group.id_especie && group.id_especie !== mother.id_especie) {
            throw new ValidationError(`El grupo de la cría ${order} no corresponde a su especie.`);
          }
          if (group.id_categoria_animal !== mother.id_categoria_animal) {
            throw new ValidationError(`El grupo de la cría ${order} no coincide con la situación de propiedad de la madre.`);
          }
          if (!group.id_ubicacion_actual || group.id_ubicacion_actual !== (item.animal.id_ubicacion_actual ?? null)) {
            throw new ValidationError(`La ubicación de la cría ${order} debe coincidir con la ubicación de su grupo.`);
          }
        }

        if (item.animal.id_ubicacion_actual) {
          const location = (await client.query(
            `SELECT activo,id_categoria_animal FROM ubicacion WHERE id_ubicacion=$1 AND deleted_at IS NULL`,
            [item.animal.id_ubicacion_actual],
          )).rows[0] as { activo: boolean; id_categoria_animal: string } | undefined;
          if (!location || !location.activo) throw new ValidationError(`El corral o potrero de la cría ${order} no está disponible.`);
          if (location.id_categoria_animal !== mother.id_categoria_animal) throw new ValidationError(`La ubicación de la cría ${order} no coincide con la categoría de la madre.`);
        }

        const { colores,razas,propietarios,...animalData }=item.animal;
        const childState = item.estado_nacimiento === 'MUERTA' ? 'MUERTO' : animalData.estado;
        const cria = (await client.query(buildInsert('animal', {
          ...animalData,
          id_especie: mother.id_especie,
          id_categoria_animal: mother.id_categoria_animal,
          estado: childState,
          fecha_nacimiento: birthDay,
          id_madre: motherId,
          id_padre: fatherId,
          registrado_por: req.user!.id,
        }))).rows[0];

        for(const color of colores)await client.query(buildInsert('animal_color',{
          id_animal:cria.id_animal,id_color:color.id,es_principal:color.principal??false,registrado_por:req.user!.id,
        }));
        for(const breed of razas)await client.query(buildInsert('animal_raza',{
          id_animal:cria.id_animal,id_raza:breed.id,porcentaje:breed.porcentaje??null,registrado_por:req.user!.id,
        }));
        for(const owner of propietarios)await client.query(buildInsert('animal_propietario',{
          id_animal:cria.id_animal,id_usuario:owner.id,porcentaje_propiedad:owner.porcentaje??null,
          es_principal:owner.principal??false,fecha_desde:birthDay,registrado_por:req.user!.id,
        }));

        const partoCria = (await client.query(buildInsert('parto_cria', {
          id_parto: parto.id_parto,
          id_cria: cria.id_animal,
          estado_nacimiento: item.estado_nacimiento,
          peso_nacimiento_kg: item.peso_nacimiento_kg ?? null,
          orden_nacimiento: order,
          observaciones: item.observaciones ?? null,
        }))).rows[0];

        if (item.peso_nacimiento_kg) {
          await client.query(buildInsert('pesaje', {
            id_animal: cria.id_animal,
            fecha_pesaje: input.fecha_parto,
            peso_kg: item.peso_nacimiento_kg,
            metodo: 'PESO_AL_NACER',
            observaciones: item.observaciones ?? null,
            registrado_por: req.user!.id,
          }));
        }



        createdChildren.push({
          id_parto_cria: partoCria.id_parto_cria,
          id_cria: cria.id_animal,
          cria: cria.nombre,
          sexo: cria.sexo,
          estado_nacimiento: item.estado_nacimiento,
          peso_nacimiento_kg: item.peso_nacimiento_kg ?? null,
          orden_nacimiento: order,
        });
        order += 1;
      }

      await client.query(
        `UPDATE prenez SET estado='FINALIZADA',updated_at=NOW() WHERE id_prenez=$1`,
        [pregnancy.id_prenez],
      );
      await client.query(
        `UPDATE proximo_parto SET estado='REGISTRADO',updated_at=NOW()
         WHERE id_prenez=$1 AND deleted_at IS NULL`,
        [pregnancy.id_prenez],
      );

      return { ...parto, crias: createdChildren };
    }, req.user!.id);
    return created(res, result);
  } catch (error) {
    const databaseError = error as { code?: string; message?: string };
    if (databaseError.code === 'P0001') {
      throw new ValidationError(databaseError.message || 'El parto no cumple las reglas del sistema.');
    }
    throw error;
  }
}));

birthsRouter.post(
  '/:id/imagenes',
  requirePermission('PARTO_ADMINISTRAR'),
  birthImageUpload.array('imagenes', 10),
  asyncHandler(async (req, res) => {
    const birthId=routeParam(req.params.id,'id');
    const files=req.files as Express.Multer.File[]|undefined;
    if(!files?.length)throw new ValidationError('Debes seleccionar al menos una imagen.');
    const birth=(await pool.query(
      'SELECT id_madre,fecha_parto::text AS fecha_parto FROM parto WHERE id_parto=$1 AND deleted_at IS NULL',[birthId],
    )).rows[0] as {id_madre:string;fecha_parto:string}|undefined;
    if(!birth)throw new NotFoundError('Parto no encontrado.');
    const uploaded:Array<{public_id:string;url:string;secure_url:string;format:string;width:number;height:number;bytes:number}>=[];
    try {
      for(const file of files)uploaded.push(await uploadAnimalImage(file.buffer,birth.id_madre));
      const rows=await transaction(async client=>{
        const saved=[];
        for(let index=0;index<files.length;index+=1) {
          const file=files[index];const cloud=uploaded[index];
          if(!file||!cloud)continue;
          const image=(await client.query(buildInsert('animal_imagen',{
            id_animal:birth.id_madre,id_parto:birthId,public_id:cloud.public_id,url:cloud.url,
            secure_url:cloud.secure_url,formato:cloud.format,ancho:cloud.width,alto:cloud.height,
            bytes:cloud.bytes,tipo_archivo:'IMAGEN',mime_type:file.mimetype,nombre_original:file.originalname,
            es_perfil:false,fecha_toma:birth.fecha_parto,registrado_por:req.user!.id,
          }))).rows[0];
          await client.query(buildInsert('animal_imagen_relacion',{id_imagen:image.id_imagen,id_animal:birth.id_madre,registrado_por:req.user!.id}));
          await client.query(
            `INSERT INTO animal_imagen_etiqueta(id_imagen,id_etiqueta,registrado_por)
             SELECT $1,id_etiqueta,$2 FROM etiqueta_multimedia
             WHERE codigo='PARTO' AND activo=TRUE AND deleted_at IS NULL ON CONFLICT DO NOTHING`,
            [image.id_imagen,req.user!.id],
          );
          saved.push(image);
        }
        return saved;
      },req.user!.id);
      return created(res,rows);
    } catch(error) {
      await Promise.all(uploaded.map((image)=>deleteCloudinaryImage(image.public_id).catch(()=>undefined)));
      throw error;
    }
  }),
);

birthsRouter.post(
  '/:id/crias/:childId/imagenes',
  requirePermission('PARTO_ADMINISTRAR'),
  birthImageUpload.single('imagen'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ValidationError('Debes seleccionar una imagen.');
    const birthId = routeParam(req.params.id, 'id');
    const childId = routeParam(req.params.childId, 'childId');
    const relation = await pool.query(
      `SELECT p.id_madre,p.fecha_parto::text AS fecha_parto
       FROM parto_cria pc
       JOIN parto p ON p.id_parto=pc.id_parto AND p.deleted_at IS NULL
       JOIN animal a ON a.id_animal=pc.id_cria AND a.deleted_at IS NULL
       WHERE pc.id_parto=$1 AND pc.id_cria=$2 AND pc.deleted_at IS NULL`,
      [birthId, childId],
    );
    if (!relation.rowCount) throw new NotFoundError('La cría no pertenece al parto indicado.');

    const cloud = await uploadAnimalImage(req.file.buffer, childId);
    try {
      const profile = req.body.es_perfil === 'true' || req.body.es_perfil === true;
      const row = await transaction(async (client) => {
        if (profile) {
          await client.query(
            'UPDATE animal_imagen SET es_perfil=FALSE WHERE id_animal=$1 AND deleted_at IS NULL',
            [childId],
          );
        }
        const image=(await client.query(buildInsert('animal_imagen', {
          id_animal: childId,
          id_parto: birthId,
          public_id: cloud.public_id,
          url: cloud.url,
          secure_url: cloud.secure_url,
          formato: cloud.format,
          ancho: cloud.width,
          alto: cloud.height,
          bytes: cloud.bytes,
          tipo_archivo: 'IMAGEN',
          mime_type: req.file!.mimetype,
          nombre_original: req.file!.originalname,
          es_perfil: profile,
          fecha_toma: relation.rows[0].fecha_parto,
          descripcion: req.body.descripcion || null,
          registrado_por: req.user!.id,
        }))).rows[0];
        const relatedIds=profile ? [childId] : [...new Set([childId,relation.rows[0].id_madre])];
        for(const relatedId of relatedIds) {
          await client.query(buildInsert('animal_imagen_relacion', {
            id_imagen:image.id_imagen,id_animal:relatedId,registrado_por:req.user!.id,
          }));
        }
        if(!profile)await client.query(
          `INSERT INTO animal_imagen_etiqueta(id_imagen,id_etiqueta,registrado_por)
           SELECT $1,id_etiqueta,$2 FROM etiqueta_multimedia
           WHERE codigo='PARTO' AND activo=TRUE AND deleted_at IS NULL
           ON CONFLICT DO NOTHING`,
          [image.id_imagen,req.user!.id],
        );
        return image;
      }, req.user!.id);
      return created(res, row);
    } catch (error) {
      await deleteCloudinaryImage(cloud.public_id);
      throw error;
    }
  }),
);
