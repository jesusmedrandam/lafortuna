import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, noContent, ok } from '../../core/http.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { requirePermission } from '../../middleware/permission.js';
import { buildInsert, buildUpdate, pick, type Queryable } from '../shared/sql.js';
const locationSchema=z.object({codigo:z.string().max(50).nullable().optional(),nombre:z.string().trim().min(2).max(120),tipo:z.enum(['POTRERO','CORRAL','OTRO']),id_categoria_animal:z.string().uuid(),id_propiedad:z.string().uuid().nullable().optional(),id_propiedad_padre:z.string().uuid().nullable().optional(),descripcion:z.string().max(300).nullable().optional(),latitud:z.number().min(-90).max(90).nullable().optional(),longitud:z.number().min(-180).max(180).nullable().optional(),activo:z.boolean().optional()});
const externalLocationSchema=locationSchema.omit({id_propiedad:true,id_propiedad_padre:true}).extend({tipo:z.literal('OTRO')});
const propertyLocationSchema=locationSchema.omit({tipo:true,id_categoria_animal:true});
const pastureSchema=z.object({ubicacion:propertyLocationSchema,area:z.number().positive().nullable().optional(),id_unidad_area:z.string().uuid().nullable().optional(),id_tipo_uso_potrero:z.string().uuid(),capacidad_estimada:z.number().int().min(0).nullable().optional(),disponibilidad_agua:z.boolean().nullable().optional(),fecha_ultimo_descanso:z.string().date().nullable().optional(),observaciones:z.string().nullable().optional(),pastos:z.array(z.object({id_tipo_pasto:z.string().uuid(),porcentaje_estimado:z.number().min(0).max(100).nullable().optional(),area_estimada:z.number().positive().nullable().optional(),id_unidad_area:z.string().uuid().nullable().optional(),fecha_siembra:z.string().date().nullable().optional(),observaciones:z.string().max(300).nullable().optional()})).default([])});
const corralSchema=z.object({ubicacion:propertyLocationSchema,id_tipo_corral:z.string().uuid(),area:z.number().positive().nullable().optional(),id_unidad_area:z.string().uuid().nullable().optional(),capacidad:z.number().int().min(0).nullable().optional(),material_piso:z.string().max(100).nullable().optional(),cubierto:z.boolean().nullable().optional(),disponibilidad_agua:z.boolean().nullable().optional(),observaciones:z.string().nullable().optional()});

async function productiveLocation(database: Queryable, input: z.infer<typeof propertyLocationSchema>) {
  const selectedPropertyId=input.id_propiedad??input.id_propiedad_padre??null;
  const property=(await database.query(
    `SELECT p.id_propiedad,p.es_principal,
       CASE WHEN p.es_principal
         THEN '00000000-0000-4000-8000-000000000101'::uuid
         ELSE '00000000-0000-4000-8000-000000000102'::uuid END id_categoria_animal
     FROM propiedad_ganadera p
     WHERE p.deleted_at IS NULL AND p.activa=TRUE
       AND (${selectedPropertyId ? 'p.id_propiedad=$1' : 'p.es_principal=TRUE'})
     LIMIT 1`,
    selectedPropertyId?[selectedPropertyId]:[],
  )).rows[0] as { id_propiedad: string; es_principal: boolean; id_categoria_animal: string } | undefined;
  if(!property)throw new ValidationError('La propiedad seleccionada no está disponible.');
  const {id_propiedad:_property,id_propiedad_padre:_legacyParent,...location}=input;
  return {...location,id_propiedad:property.id_propiedad,id_propiedad_padre:null,id_categoria_animal:property.id_categoria_animal};
}

async function ensurePropertyCanChange(database: Queryable, locationId: string, currentPropertyId: string | null, nextPropertyId?: string | null) {
  if (nextPropertyId === undefined || nextPropertyId === currentPropertyId) return;
  const usage=(await database.query(
    `SELECT
       EXISTS(SELECT 1 FROM animal WHERE id_ubicacion_actual=$1 AND estado='ACTIVO' AND deleted_at IS NULL) has_animals,
       EXISTS(SELECT 1 FROM grupo WHERE id_ubicacion_actual=$1 AND activo=TRUE AND deleted_at IS NULL) has_groups`,
    [locationId],
  )).rows[0] as { has_animals: boolean; has_groups: boolean };
  if (usage.has_animals || usage.has_groups) {
    throw new ConflictError('No puede cambiar la propiedad de un potrero o corral que tenga grupos o animales. Trasládelos primero.');
  }
}
export const locationsRouter=Router();
locationsRouter.get('/',requirePermission('UBICACION_CONSULTAR'),asyncHandler(async(req,res)=>{const tipo=req.query.tipo;const categoria=req.query.id_categoria_animal;const params:any[]=[];const filters=['u.deleted_at IS NULL'];if(tipo){params.push(tipo);filters.push(`u.tipo=$${params.length}`);}if(categoria){params.push(categoria);filters.push(`u.id_categoria_animal=$${params.length}`);}return ok(res,(await pool.query(`SELECT u.*,ca.nombre categoria,ca.codigo categoria_codigo,p.nombre propiedad,p.es_principal propiedad_es_principal,(SELECT COUNT(*)::int FROM animal a WHERE a.id_ubicacion_actual=u.id_ubicacion AND a.deleted_at IS NULL AND a.estado='ACTIVO') total_animales FROM ubicacion u JOIN categoria_animal ca ON ca.id_categoria_animal=u.id_categoria_animal JOIN propiedad_ganadera p ON p.id_propiedad=u.id_propiedad AND p.deleted_at IS NULL WHERE ${filters.join(' AND ')} ORDER BY u.activo DESC,p.es_principal DESC,p.nombre,u.tipo,u.nombre`,params)).rows);}));
locationsRouter.post('/',requirePermission('UBICACION_ADMINISTRAR'),asyncHandler(async(req,res)=>{const input=externalLocationSchema.parse(req.body);const result=await transaction(async client=>{const id=randomUUID();const property=(await client.query(buildInsert('propiedad_ganadera',{id_propiedad:id,codigo:input.codigo,nombre:input.nombre,descripcion:input.descripcion,latitud:input.latitud,longitud:input.longitud,es_principal:false,activa:input.activo??true}))).rows[0];const location=(await client.query(buildInsert('ubicacion',{...input,id_ubicacion:id,id_propiedad:id,id_propiedad_padre:null}))).rows[0];return {...location,propiedad:property.nombre,propiedad_es_principal:false};},req.user!.id);return created(res,result);}));
locationsRouter.patch('/:id',requirePermission('UBICACION_ADMINISTRAR'),asyncHandler(async(req,res)=>{
  const id=routeParam(req.params.id,'id');
  const data=externalLocationSchema.partial().parse(req.body);
  const row=await transaction(async client=>{
    const current=(await client.query(
      `SELECT u.id_propiedad FROM ubicacion u
       JOIN propiedad_ganadera p ON p.id_propiedad=u.id_propiedad
       WHERE u.id_ubicacion=$1 AND u.tipo='OTRO' AND u.deleted_at IS NULL
         AND p.es_principal=FALSE AND p.deleted_at IS NULL`,
      [id],
    )).rows[0] as {id_propiedad:string}|undefined;
    if(!current)throw new NotFoundError();
    if(data.activo===false){
      const usage=(await client.query(
        `SELECT
          EXISTS(SELECT 1 FROM ubicacion WHERE id_propiedad=$1 AND id_ubicacion<>$1 AND deleted_at IS NULL AND activo=TRUE) has_locations,
          EXISTS(SELECT 1 FROM grupo WHERE id_propiedad=$1 AND activo=TRUE AND deleted_at IS NULL) has_groups,
          EXISTS(SELECT 1 FROM animal a JOIN ubicacion u ON u.id_ubicacion=a.id_ubicacion_actual
            WHERE u.id_propiedad=$1 AND a.estado='ACTIVO' AND a.deleted_at IS NULL) has_animals`,
        [current.id_propiedad],
      )).rows[0] as {has_locations:boolean;has_groups:boolean;has_animals:boolean};
      if(usage.has_locations||usage.has_groups||usage.has_animals){
        throw new ConflictError('No puede desactivar una propiedad que tenga potreros, corrales, grupos o animales activos.');
      }
    }
    const locationData=pick(data,['codigo','nombre','descripcion','latitud','longitud','activo']);
    const propertyData={...pick(data,['codigo','nombre','descripcion','latitud','longitud']),...(data.activo===undefined?{}:{activa:data.activo})};
    if(Object.keys(propertyData).length)await client.query(buildUpdate('propiedad_ganadera','id_propiedad',current.id_propiedad,propertyData));
    if(Object.keys(locationData).length){
      return (await client.query(buildUpdate('ubicacion','id_ubicacion',id,locationData))).rows[0];
    }
    return (await client.query('SELECT * FROM ubicacion WHERE id_ubicacion=$1',[id])).rows[0];
  },req.user!.id);
  return ok(res,row);
}));
locationsRouter.delete('/:id',requirePermission('UBICACION_ADMINISTRAR'),asyncHandler(async(req,res)=>{const id=routeParam(req.params.id,'id');await transaction(async client=>{const property=(await client.query(`SELECT id_propiedad FROM propiedad_ganadera WHERE id_propiedad=$1 AND es_principal=FALSE AND deleted_at IS NULL`,[id])).rows[0] as {id_propiedad:string}|undefined;if(!property)throw new NotFoundError();const usage=(await client.query(`SELECT EXISTS(SELECT 1 FROM ubicacion WHERE id_propiedad=$1 AND id_ubicacion<>$1 AND deleted_at IS NULL) has_locations,EXISTS(SELECT 1 FROM grupo WHERE id_propiedad=$1 AND activo=TRUE AND deleted_at IS NULL) has_groups,EXISTS(SELECT 1 FROM animal a JOIN ubicacion u ON u.id_ubicacion=a.id_ubicacion_actual WHERE u.id_propiedad=$1 AND a.estado='ACTIVO' AND a.deleted_at IS NULL) has_animals`,[id])).rows[0];if(usage.has_locations||usage.has_groups||usage.has_animals)throw new ConflictError('No puede desactivar una propiedad que tenga potreros, corrales, grupos o animales activos.');await client.query('UPDATE ubicacion SET deleted_at=NOW(),activo=FALSE WHERE id_propiedad=$1 AND deleted_at IS NULL',[id]);await client.query('UPDATE propiedad_ganadera SET deleted_at=NOW(),activa=FALSE WHERE id_propiedad=$1 AND deleted_at IS NULL',[id]);},req.user!.id);return noContent(res);}));

export const pasturesRouter=Router();
pasturesRouter.get('/',requirePermission('POTRERO_CONSULTAR'),asyncHandler(async(_req,res)=>ok(res,(await pool.query(`
  WITH base AS (
    SELECT p.*,u.nombre,u.codigo,u.descripcion,u.activo,u.id_categoria_animal,u.id_propiedad,u.id_propiedad_padre,
      propiedad.nombre propiedad,propiedad.es_principal propiedad_es_principal,tu.nombre tipo_uso,um.simbolo unidad_area,
      (SELECT COUNT(*)::int FROM animal a
        WHERE a.id_ubicacion_actual=u.id_ubicacion AND a.deleted_at IS NULL AND a.estado='ACTIVO') total_animales,
      COALESCE(jsonb_agg(jsonb_build_object(
        'id_potrero_pasto',pp.id_potrero_pasto,'id_tipo_pasto',tp.id_tipo_pasto,'pasto',tp.nombre,
        'porcentaje_estimado',pp.porcentaje_estimado,'area_estimada',pp.area_estimada,
        'id_unidad_area',pp.id_unidad_area,'fecha_siembra',pp.fecha_siembra,'observaciones',pp.observaciones
      )) FILTER(WHERE pp.id_potrero_pasto IS NOT NULL),'[]') pastos
    FROM potrero p
    JOIN ubicacion u ON u.id_ubicacion=p.id_ubicacion
    JOIN propiedad_ganadera propiedad ON propiedad.id_propiedad=u.id_propiedad AND propiedad.deleted_at IS NULL
    JOIN tipo_uso_potrero tu ON tu.id_tipo_uso_potrero=p.id_tipo_uso_potrero
    LEFT JOIN unidad_medida um ON um.id_unidad=p.id_unidad_area
    LEFT JOIN potrero_pasto pp ON pp.id_potrero=p.id_potrero AND pp.deleted_at IS NULL
    LEFT JOIN tipo_pasto tp ON tp.id_tipo_pasto=pp.id_tipo_pasto
    WHERE p.deleted_at IS NULL AND u.deleted_at IS NULL
    GROUP BY p.id_potrero,u.id_ubicacion,propiedad.id_propiedad,tu.nombre,um.simbolo
  )
  SELECT base.*,
    CASE WHEN base.total_animales>0 THEN 'OCUPADO' ELSE 'DESCANSO' END estado_ocupacion,
    CASE WHEN base.total_animales>0
      THEN COALESCE(open_history.inicio,latest_closed.fecha_desde)
      ELSE COALESCE(latest_closed.fecha_hasta,base.fecha_ultimo_descanso::timestamptz) END fecha_estado_desde,
    CASE WHEN base.total_animales>0 AND open_history.inicio IS NOT NULL
      THEN GREATEST(0,CURRENT_DATE-open_history.inicio::date)::int
      WHEN base.total_animales=0 AND latest_closed.fecha_desde IS NOT NULL
      THEN GREATEST(0,latest_closed.fecha_hasta::date-latest_closed.fecha_desde::date)::int
      ELSE NULL END dias_ocupacion,
    CASE WHEN base.total_animales=0 AND COALESCE(latest_closed.fecha_hasta,base.fecha_ultimo_descanso::timestamptz) IS NOT NULL
      THEN GREATEST(0,CURRENT_DATE-COALESCE(latest_closed.fecha_hasta,base.fecha_ultimo_descanso::timestamptz)::date)::int
      WHEN base.total_animales>0 AND open_history.inicio IS NOT NULL AND previous_end.fecha_hasta IS NOT NULL
      THEN GREATEST(0,open_history.inicio::date-previous_end.fecha_hasta::date)::int
      ELSE NULL END dias_descanso
  FROM base
  LEFT JOIN LATERAL (
    SELECT MIN(h.fecha_desde) inicio FROM animal_ubicacion_historial h
    JOIN animal a ON a.id_animal=h.id_animal AND a.deleted_at IS NULL AND a.estado='ACTIVO'
      AND a.id_ubicacion_actual=base.id_ubicacion
    WHERE h.id_ubicacion=base.id_ubicacion AND h.fecha_hasta IS NULL AND h.deleted_at IS NULL
  ) open_history ON TRUE
  LEFT JOIN LATERAL (
    SELECT h.fecha_desde,h.fecha_hasta FROM animal_ubicacion_historial h
    WHERE h.id_ubicacion=base.id_ubicacion AND h.fecha_hasta IS NOT NULL AND h.deleted_at IS NULL
    ORDER BY h.fecha_hasta DESC LIMIT 1
  ) latest_closed ON TRUE
  LEFT JOIN LATERAL (
    SELECT MAX(h.fecha_hasta) fecha_hasta FROM animal_ubicacion_historial h
    WHERE h.id_ubicacion=base.id_ubicacion AND h.fecha_hasta IS NOT NULL AND h.deleted_at IS NULL
      AND (open_history.inicio IS NULL OR h.fecha_hasta<=open_history.inicio)
  ) previous_end ON TRUE
  ORDER BY base.nombre
`)).rows)));

pasturesRouter.get('/:id/resumen',requirePermission('POTRERO_CONSULTAR'),asyncHandler(async(req,res)=>{
  const id=routeParam(req.params.id,'id');
  const pasture=(await pool.query(`
    SELECT p.*,u.nombre,u.codigo,u.descripcion,u.activo,u.id_categoria_animal,u.id_propiedad,u.id_propiedad_padre,
      propiedad.nombre propiedad,propiedad.es_principal propiedad_es_principal,tu.nombre tipo_uso,um.simbolo unidad_area,
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
    JOIN propiedad_ganadera propiedad ON propiedad.id_propiedad=u.id_propiedad AND propiedad.deleted_at IS NULL
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
pasturesRouter.post('/',requirePermission('POTRERO_ADMINISTRAR'),asyncHandler(async(req,res)=>{const input=pastureSchema.parse(req.body);const result=await transaction(async c=>{const location=await productiveLocation(c,input.ubicacion);const u=(await c.query(buildInsert('ubicacion',{...location,tipo:'POTRERO'}))).rows[0];const {ubicacion,pastos,...rest}=input;const p=(await c.query(buildInsert('potrero',{...rest,id_ubicacion:u.id_ubicacion}))).rows[0];for(const item of pastos)await c.query(buildInsert('potrero_pasto',{...item,id_potrero:p.id_potrero}));return {...p,ubicacion:u,pastos};},req.user!.id);return created(res,result);}));
pasturesRouter.patch('/:id',requirePermission('POTRERO_ADMINISTRAR'),asyncHandler(async(req,res)=>{const input=pastureSchema.partial().parse(req.body);const result=await transaction(async c=>{const found=await c.query('SELECT p.id_ubicacion,u.id_propiedad FROM potrero p JOIN ubicacion u ON u.id_ubicacion=p.id_ubicacion WHERE p.id_potrero=$1 AND p.deleted_at IS NULL',[routeParam(req.params.id, 'id')]);if(!found.rows[0])throw new NotFoundError();if(input.ubicacion){const location=await productiveLocation(c,input.ubicacion);await ensurePropertyCanChange(c,found.rows[0].id_ubicacion,found.rows[0].id_propiedad,location.id_propiedad);await c.query(buildUpdate('ubicacion','id_ubicacion',found.rows[0].id_ubicacion,location));}const {ubicacion,pastos,...rest}=input;if(Object.keys(rest).length)await c.query(buildUpdate('potrero','id_potrero',routeParam(req.params.id, 'id'),rest));if(pastos){await c.query('UPDATE potrero_pasto SET deleted_at=NOW() WHERE id_potrero=$1 AND deleted_at IS NULL',[routeParam(req.params.id, 'id')]);for(const item of pastos)await c.query(buildInsert('potrero_pasto',{...item,id_potrero:routeParam(req.params.id, 'id')}));}return {id_potrero:routeParam(req.params.id, 'id')};},req.user!.id);return ok(res,result);}));

export const corralsRouter=Router();
corralsRouter.get('/',requirePermission('CORRAL_CONSULTAR'),asyncHandler(async(_req,res)=>ok(res,(await pool.query(`SELECT c.*,u.nombre,u.codigo,u.descripcion,u.activo,u.id_categoria_animal,u.id_propiedad,u.id_propiedad_padre,p.nombre propiedad,p.es_principal propiedad_es_principal,tc.nombre tipo_corral,(SELECT COUNT(*)::int FROM animal a WHERE a.id_ubicacion_actual=u.id_ubicacion AND a.estado='ACTIVO' AND a.deleted_at IS NULL) total_animales FROM corral c JOIN ubicacion u ON u.id_ubicacion=c.id_ubicacion JOIN propiedad_ganadera p ON p.id_propiedad=u.id_propiedad AND p.deleted_at IS NULL JOIN tipo_corral tc ON tc.id_tipo_corral=c.id_tipo_corral WHERE c.deleted_at IS NULL AND u.deleted_at IS NULL ORDER BY p.es_principal DESC,p.nombre,u.nombre`)).rows)));
corralsRouter.post('/',requirePermission('CORRAL_ADMINISTRAR'),asyncHandler(async(req,res)=>{const input=corralSchema.parse(req.body);const result=await transaction(async c=>{const location=await productiveLocation(c,input.ubicacion);const u=(await c.query(buildInsert('ubicacion',{...location,tipo:'CORRAL'}))).rows[0];const {ubicacion,...rest}=input;const corral=(await c.query(buildInsert('corral',{...rest,id_ubicacion:u.id_ubicacion}))).rows[0];return {...corral,ubicacion:u};},req.user!.id);return created(res,result);}));
corralsRouter.patch('/:id',requirePermission('CORRAL_ADMINISTRAR'),asyncHandler(async(req,res)=>{const input=corralSchema.partial().parse(req.body);const result=await transaction(async c=>{const found=await c.query('SELECT c.id_ubicacion,u.id_propiedad FROM corral c JOIN ubicacion u ON u.id_ubicacion=c.id_ubicacion WHERE c.id_corral=$1 AND c.deleted_at IS NULL',[routeParam(req.params.id, 'id')]);if(!found.rows[0])throw new NotFoundError();if(input.ubicacion){const location=await productiveLocation(c,input.ubicacion);await ensurePropertyCanChange(c,found.rows[0].id_ubicacion,found.rows[0].id_propiedad,location.id_propiedad);await c.query(buildUpdate('ubicacion','id_ubicacion',found.rows[0].id_ubicacion,location));}const {ubicacion,...rest}=input;if(Object.keys(rest).length)await c.query(buildUpdate('corral','id_corral',routeParam(req.params.id, 'id'),rest));return {id_corral:routeParam(req.params.id, 'id')};},req.user!.id);return ok(res,result);}));
