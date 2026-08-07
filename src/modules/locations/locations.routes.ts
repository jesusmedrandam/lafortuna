import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, noContent, ok } from '../../core/http.js';
import { NotFoundError } from '../../core/errors.js';
import { requirePermission } from '../../middleware/permission.js';
import { buildInsert, buildUpdate } from '../shared/sql.js';
const locationSchema=z.object({codigo:z.string().max(50).nullable().optional(),nombre:z.string().trim().min(2).max(120),tipo:z.enum(['POTRERO','CORRAL','OTRO']),descripcion:z.string().max(300).nullable().optional(),latitud:z.number().min(-90).max(90).nullable().optional(),longitud:z.number().min(-180).max(180).nullable().optional(),activo:z.boolean().optional()});
const pastureSchema=z.object({ubicacion:locationSchema.omit({tipo:true}),area:z.number().positive().nullable().optional(),id_unidad_area:z.string().uuid().nullable().optional(),id_tipo_uso_potrero:z.string().uuid(),capacidad_estimada:z.number().int().min(0).nullable().optional(),disponibilidad_agua:z.boolean().nullable().optional(),fecha_ultimo_descanso:z.string().date().nullable().optional(),observaciones:z.string().nullable().optional(),pastos:z.array(z.object({id_tipo_pasto:z.string().uuid(),porcentaje_estimado:z.number().min(0).max(100).nullable().optional(),area_estimada:z.number().positive().nullable().optional(),id_unidad_area:z.string().uuid().nullable().optional(),fecha_siembra:z.string().date().nullable().optional(),observaciones:z.string().max(300).nullable().optional()})).default([])});
const corralSchema=z.object({ubicacion:locationSchema.omit({tipo:true}),id_tipo_corral:z.string().uuid(),area:z.number().positive().nullable().optional(),id_unidad_area:z.string().uuid().nullable().optional(),capacidad:z.number().int().min(0).nullable().optional(),material_piso:z.string().max(100).nullable().optional(),cubierto:z.boolean().nullable().optional(),disponibilidad_agua:z.boolean().nullable().optional(),observaciones:z.string().nullable().optional()});
export const locationsRouter=Router();
locationsRouter.get('/',requirePermission('UBICACION_CONSULTAR'),asyncHandler(async(req,res)=>{const tipo=req.query.tipo;const params:any[]=[];let filter='u.deleted_at IS NULL';if(tipo){params.push(tipo);filter+=' AND u.tipo=$1';}return ok(res,(await pool.query(`SELECT u.*,(SELECT COUNT(*)::int FROM animal a WHERE a.id_ubicacion_actual=u.id_ubicacion AND a.deleted_at IS NULL AND a.estado='ACTIVO') total_animales FROM ubicacion u WHERE ${filter} ORDER BY u.activo DESC,u.nombre`,params)).rows);}));
locationsRouter.post('/',requirePermission('UBICACION_ADMINISTRAR'),asyncHandler(async(req,res)=>created(res,(await pool.query(buildInsert('ubicacion',locationSchema.parse(req.body)))).rows[0])));
locationsRouter.patch('/:id',requirePermission('UBICACION_ADMINISTRAR'),asyncHandler(async(req,res)=>{const row=(await pool.query(buildUpdate('ubicacion','id_ubicacion',routeParam(req.params.id, 'id'),locationSchema.partial().parse(req.body)))).rows[0];if(!row)throw new NotFoundError();return ok(res,row);}));
locationsRouter.delete('/:id',requirePermission('UBICACION_ADMINISTRAR'),asyncHandler(async(req,res)=>{const r=await pool.query('UPDATE ubicacion SET deleted_at=NOW(),activo=FALSE WHERE id_ubicacion=$1 AND deleted_at IS NULL',[routeParam(req.params.id, 'id')]);if(!r.rowCount)throw new NotFoundError();return noContent(res);}));

export const pasturesRouter=Router();
pasturesRouter.get('/',requirePermission('POTRERO_CONSULTAR'),asyncHandler(async(_req,res)=>ok(res,(await pool.query(`
  SELECT p.*,u.nombre,u.codigo,u.descripcion,u.activo,tu.nombre tipo_uso,um.simbolo unidad_area,
    (SELECT COUNT(*)::int FROM animal a
      WHERE a.id_ubicacion_actual=u.id_ubicacion AND a.deleted_at IS NULL AND a.estado='ACTIVO') total_animales,
    COALESCE(jsonb_agg(jsonb_build_object(
      'id_potrero_pasto',pp.id_potrero_pasto,'id_tipo_pasto',tp.id_tipo_pasto,'pasto',tp.nombre,
      'porcentaje_estimado',pp.porcentaje_estimado,'area_estimada',pp.area_estimada,
      'id_unidad_area',pp.id_unidad_area,'fecha_siembra',pp.fecha_siembra,'observaciones',pp.observaciones
    )) FILTER(WHERE pp.id_potrero_pasto IS NOT NULL),'[]') pastos
  FROM potrero p
  JOIN ubicacion u ON u.id_ubicacion=p.id_ubicacion
  JOIN tipo_uso_potrero tu ON tu.id_tipo_uso_potrero=p.id_tipo_uso_potrero
  LEFT JOIN unidad_medida um ON um.id_unidad=p.id_unidad_area
  LEFT JOIN potrero_pasto pp ON pp.id_potrero=p.id_potrero AND pp.deleted_at IS NULL
  LEFT JOIN tipo_pasto tp ON tp.id_tipo_pasto=pp.id_tipo_pasto
  WHERE p.deleted_at IS NULL AND u.deleted_at IS NULL
  GROUP BY p.id_potrero,u.id_ubicacion,tu.nombre,um.simbolo
  ORDER BY u.nombre
`)).rows)));

pasturesRouter.get('/:id/resumen',requirePermission('POTRERO_CONSULTAR'),asyncHandler(async(req,res)=>{
  const id=routeParam(req.params.id,'id');
  const pasture=(await pool.query(`
    SELECT p.*,u.nombre,u.codigo,u.descripcion,u.activo,tu.nombre tipo_uso,um.simbolo unidad_area,
      (SELECT COUNT(*)::int FROM animal a
        WHERE a.id_ubicacion_actual=u.id_ubicacion AND a.deleted_at IS NULL AND a.estado='ACTIVO') total_animales,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id_potrero_pasto',pp.id_potrero_pasto,'id_tipo_pasto',tp.id_tipo_pasto,'pasto',tp.nombre,
        'porcentaje_estimado',pp.porcentaje_estimado,'area_estimada',pp.area_estimada,
        'id_unidad_area',pp.id_unidad_area,'fecha_siembra',pp.fecha_siembra,'observaciones',pp.observaciones
      ) ORDER BY tp.nombre)
      FROM potrero_pasto pp JOIN tipo_pasto tp ON tp.id_tipo_pasto=pp.id_tipo_pasto
      WHERE pp.id_potrero=p.id_potrero AND pp.deleted_at IS NULL),'[]') pastos
    FROM potrero p
    JOIN ubicacion u ON u.id_ubicacion=p.id_ubicacion
    JOIN tipo_uso_potrero tu ON tu.id_tipo_uso_potrero=p.id_tipo_uso_potrero
    LEFT JOIN unidad_medida um ON um.id_unidad=p.id_unidad_area
    WHERE p.id_potrero=$1 AND p.deleted_at IS NULL AND u.deleted_at IS NULL
  `,[id])).rows[0];
  if(!pasture)throw new NotFoundError('Potrero no encontrado.');

  const history=(await pool.query(`
    WITH raw AS (
      SELECT h.id_animal,h.fecha_desde,h.fecha_hasta
      FROM animal_ubicacion_historial h
      WHERE h.id_ubicacion=$1 AND h.deleted_at IS NULL
    ), ordered AS (
      SELECT raw.*,
        MAX(COALESCE(fecha_hasta,NOW())) OVER (
          ORDER BY fecha_desde,id_animal
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ) cobertura_previa
      FROM raw
    ), marked AS (
      SELECT ordered.*,
        CASE WHEN cobertura_previa IS NULL OR fecha_desde>cobertura_previa THEN 1 ELSE 0 END nuevo_periodo
      FROM ordered
    ), islands AS (
      SELECT marked.*,
        SUM(nuevo_periodo) OVER (ORDER BY fecha_desde,id_animal) periodo
      FROM marked
    ), periods AS (
      SELECT periodo,MIN(fecha_desde) inicio,
        CASE WHEN BOOL_OR(fecha_hasta IS NULL) THEN NULL ELSE MAX(fecha_hasta) END fin,
        COUNT(DISTINCT id_animal)::int total_animales
      FROM islands GROUP BY periodo
    ), rested AS (
      SELECT periods.*,LAG(fin) OVER (ORDER BY inicio) descanso_previo_desde
      FROM periods
    )
    SELECT inicio,fin,total_animales,descanso_previo_desde,
      GREATEST(0,(COALESCE(fin,NOW())::date-inicio::date))::int dias_ocupacion,
      CASE WHEN descanso_previo_desde IS NULL THEN NULL
        ELSE GREATEST(0,(inicio::date-descanso_previo_desde::date))::int END dias_descanso_previo
    FROM rested ORDER BY inicio DESC
  `,[pasture.id_ubicacion])).rows;

  const latest=history[0];
  const occupied=Number(pasture.total_animales)>0;
  const restStart=occupied
    ? (latest?.descanso_previo_desde??pasture.fecha_ultimo_descanso)
    : (latest?.fin??pasture.fecha_ultimo_descanso);
  const currentRestDays=!occupied&&restStart
    ? Math.max(0,Math.floor((Date.now()-new Date(restStart).getTime())/86_400_000))
    : null;
  return ok(res,{
    ...pasture,
    ocupacion:{
      estado:occupied?'OCUPADO':'DESCANSO',
      fecha_ultima_ocupacion:latest?.inicio??null,
      dias_ultima_ocupacion:latest?.dias_ocupacion??null,
      fecha_ultimo_descanso:restStart??null,
      dias_descanso:occupied?(latest?.dias_descanso_previo??null):currentRestDays,
      total_animales:Number(pasture.total_animales),
    },
    historial_ocupaciones:history,
  });
}));
pasturesRouter.post('/',requirePermission('POTRERO_ADMINISTRAR'),asyncHandler(async(req,res)=>{const input=pastureSchema.parse(req.body);const result=await transaction(async c=>{const u=(await c.query(buildInsert('ubicacion',{...input.ubicacion,tipo:'POTRERO'}))).rows[0];const {ubicacion,pastos,...rest}=input;const p=(await c.query(buildInsert('potrero',{...rest,id_ubicacion:u.id_ubicacion}))).rows[0];for(const item of pastos)await c.query(buildInsert('potrero_pasto',{...item,id_potrero:p.id_potrero}));return {...p,ubicacion:u,pastos};},req.user!.id);return created(res,result);}));
pasturesRouter.patch('/:id',requirePermission('POTRERO_ADMINISTRAR'),asyncHandler(async(req,res)=>{const input=pastureSchema.partial().parse(req.body);const result=await transaction(async c=>{const found=await c.query('SELECT id_ubicacion FROM potrero WHERE id_potrero=$1 AND deleted_at IS NULL',[routeParam(req.params.id, 'id')]);if(!found.rows[0])throw new NotFoundError();if(input.ubicacion)await c.query(buildUpdate('ubicacion','id_ubicacion',found.rows[0].id_ubicacion,input.ubicacion));const {ubicacion,pastos,...rest}=input;if(Object.keys(rest).length)await c.query(buildUpdate('potrero','id_potrero',routeParam(req.params.id, 'id'),rest));if(pastos){await c.query('UPDATE potrero_pasto SET deleted_at=NOW() WHERE id_potrero=$1 AND deleted_at IS NULL',[routeParam(req.params.id, 'id')]);for(const item of pastos)await c.query(buildInsert('potrero_pasto',{...item,id_potrero:routeParam(req.params.id, 'id')}));}return {id_potrero:routeParam(req.params.id, 'id')};},req.user!.id);return ok(res,result);}));

export const corralsRouter=Router();
corralsRouter.get('/',requirePermission('CORRAL_CONSULTAR'),asyncHandler(async(_req,res)=>ok(res,(await pool.query(`SELECT c.*,u.nombre,u.codigo,u.descripcion,u.activo,tc.nombre tipo_corral FROM corral c JOIN ubicacion u ON u.id_ubicacion=c.id_ubicacion JOIN tipo_corral tc ON tc.id_tipo_corral=c.id_tipo_corral WHERE c.deleted_at IS NULL AND u.deleted_at IS NULL ORDER BY u.nombre`)).rows)));
corralsRouter.post('/',requirePermission('CORRAL_ADMINISTRAR'),asyncHandler(async(req,res)=>{const input=corralSchema.parse(req.body);const result=await transaction(async c=>{const u=(await c.query(buildInsert('ubicacion',{...input.ubicacion,tipo:'CORRAL'}))).rows[0];const {ubicacion,...rest}=input;const corral=(await c.query(buildInsert('corral',{...rest,id_ubicacion:u.id_ubicacion}))).rows[0];return {...corral,ubicacion:u};},req.user!.id);return created(res,result);}));
corralsRouter.patch('/:id',requirePermission('CORRAL_ADMINISTRAR'),asyncHandler(async(req,res)=>{const input=corralSchema.partial().parse(req.body);const result=await transaction(async c=>{const found=await c.query('SELECT id_ubicacion FROM corral WHERE id_corral=$1 AND deleted_at IS NULL',[routeParam(req.params.id, 'id')]);if(!found.rows[0])throw new NotFoundError();if(input.ubicacion)await c.query(buildUpdate('ubicacion','id_ubicacion',found.rows[0].id_ubicacion,input.ubicacion));const {ubicacion,...rest}=input;if(Object.keys(rest).length)await c.query(buildUpdate('corral','id_corral',routeParam(req.params.id, 'id'),rest));return {id_corral:routeParam(req.params.id, 'id')};},req.user!.id);return ok(res,result);}));
