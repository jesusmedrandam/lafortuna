import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, noContent, ok } from '../../core/http.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { requirePermission } from '../../middleware/permission.js';
import { deleteCloudinaryImage } from '../../services/cloudinary.service.js';
import { buildInsert } from '../shared/sql.js';
import { deleteRecordImage, recordImageUpload, requestFiles, saveRecordImages } from '../shared/record-images.js';

const schema=z.object({
  id_tipo_actividad:z.string().uuid(),
  fecha:z.string().date(),
  descripcion:z.string().nullable().optional(),
  id_animales:z.array(z.string().uuid()).min(1).max(500),
});

const imageDefinition={table:'actividad_imagen',idColumn:'id_actividad_imagen',parentColumn:'id_actividad',parentTable:'actividad',parentIdColumn:'id_actividad',moduleName:'actividades'};

async function replaceAnimals(client:Parameters<Parameters<typeof transaction>[0]>[0],activityId:string,ids:string[]) {
  const unique=[...new Set(ids)];
  const available=await client.query(
    `SELECT id_animal FROM animal WHERE id_animal=ANY($1::uuid[]) AND estado='ACTIVO' AND deleted_at IS NULL`,[unique],
  );
  if(available.rowCount!==unique.length)throw new ValidationError('Uno o más animales no están activos o disponibles.');
  await client.query('UPDATE actividad_animal SET deleted_at=NOW() WHERE id_actividad=$1 AND deleted_at IS NULL',[activityId]);
  for(const id of unique)await client.query(buildInsert('actividad_animal',{id_actividad:activityId,id_animal:id}));
}

export const activitiesRouter=Router();

activitiesRouter.get('/',requirePermission('ACTIVIDAD_CONSULTAR'),asyncHandler(async(_req,res)=>ok(res,(await pool.query(
  `SELECT ac.*,ta.nombre tipo_actividad,ta.codigo tipo_actividad_codigo,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id_animal',a.id_animal,'nombre',a.nombre,'codigo_arete',a.codigo_arete) ORDER BY a.nombre)
      FROM actividad_animal aa JOIN animal a ON a.id_animal=aa.id_animal AND a.deleted_at IS NULL
      WHERE aa.id_actividad=ac.id_actividad AND aa.deleted_at IS NULL),'[]') animales,
    COALESCE((SELECT jsonb_agg(to_jsonb(ai) ORDER BY ai.created_at)
      FROM actividad_imagen ai WHERE ai.id_actividad=ac.id_actividad AND ai.deleted_at IS NULL),'[]') imagenes
   FROM actividad ac JOIN tipo_actividad ta ON ta.id_tipo_actividad=ac.id_tipo_actividad
   WHERE ac.deleted_at IS NULL ORDER BY ac.fecha DESC,ac.created_at DESC`
)).rows)));

activitiesRouter.post('/',requirePermission('ACTIVIDAD_ADMINISTRAR'),asyncHandler(async(req,res)=>{
  const input=schema.parse(req.body);
  const row=await transaction(async client=>{
    const type=await client.query('SELECT 1 FROM tipo_actividad WHERE id_tipo_actividad=$1 AND activo=TRUE AND deleted_at IS NULL',[input.id_tipo_actividad]);
    if(!type.rowCount)throw new ValidationError('El tipo de actividad no está disponible.');
    const activity=(await client.query(buildInsert('actividad',{
      id_tipo_actividad:input.id_tipo_actividad,fecha:input.fecha,descripcion:input.descripcion??null,registrado_por:req.user!.id,
    }))).rows[0];
    await replaceAnimals(client,activity.id_actividad,input.id_animales);
    return activity;
  },req.user!.id);
  return created(res,row);
}));

activitiesRouter.patch('/:id',requirePermission('ACTIVIDAD_ADMINISTRAR'),asyncHandler(async(req,res)=>{
  const id=routeParam(req.params.id,'id');
  const input=schema.parse(req.body);
  const row=await transaction(async client=>{
    const type=await client.query('SELECT 1 FROM tipo_actividad WHERE id_tipo_actividad=$1 AND activo=TRUE AND deleted_at IS NULL',[input.id_tipo_actividad]);
    if(!type.rowCount)throw new ValidationError('El tipo de actividad no está disponible.');
    const updated=(await client.query(
      `UPDATE actividad SET id_tipo_actividad=$2,fecha=$3,descripcion=$4,updated_at=NOW()
       WHERE id_actividad=$1 AND deleted_at IS NULL RETURNING *`,
      [id,input.id_tipo_actividad,input.fecha,input.descripcion??null],
    )).rows[0];
    if(!updated)throw new NotFoundError('Actividad no encontrada.');
    await replaceAnimals(client,id,input.id_animales);
    return updated;
  },req.user!.id);
  return ok(res,row);
}));

activitiesRouter.delete('/:id',requirePermission('ACTIVIDAD_ADMINISTRAR'),asyncHandler(async(req,res)=>{
  const id=routeParam(req.params.id,'id');
  const result=await transaction(async client=>{
    const row=await client.query('UPDATE actividad SET deleted_at=NOW(),updated_at=NOW() WHERE id_actividad=$1 AND deleted_at IS NULL RETURNING id_actividad',[id]);
    if(!row.rowCount)throw new NotFoundError('Actividad no encontrada.');
    await client.query('UPDATE actividad_animal SET deleted_at=NOW() WHERE id_actividad=$1 AND deleted_at IS NULL',[id]);
    return row.rows[0];
  },req.user!.id);
  return noContent(res);
}));

activitiesRouter.post('/:id/imagenes',requirePermission('ACTIVIDAD_ADMINISTRAR'),recordImageUpload.array('imagenes',3),asyncHandler(async(req,res)=>{
  const rows=await transaction(client=>saveRecordImages(client,imageDefinition,routeParam(req.params.id,'id'),requestFiles(req),req.user!.id),req.user!.id);
  return created(res,rows);
}));

activitiesRouter.delete('/imagenes/:imageId',requirePermission('ACTIVIDAD_ADMINISTRAR'),asyncHandler(async(req,res)=>{
  const image=await transaction(client=>deleteRecordImage(client,imageDefinition,routeParam(req.params.imageId,'imageId')),req.user!.id);
  await deleteCloudinaryImage(image.public_id);
  return noContent(res);
}));
