import { Router } from 'express';
import type { PoolClient } from 'pg';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, noContent, ok } from '../../core/http.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { paginationSchema, offset } from '../../core/pagination.js';
import { requirePermission } from '../../middleware/permission.js';
import { deleteCloudinaryMedia, uploadAnimalImage, uploadAnimalMedia } from '../../services/cloudinary.service.js';
import { buildInsert } from '../shared/sql.js';

const mediaUpload=multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:env.MAX_MEDIA_MB*1024*1024,files:1},
  fileFilter:(_req,file,cb)=>(file.mimetype.startsWith('image/')||file.mimetype.startsWith('video/'))
    ? cb(null,true)
    : cb(new ValidationError('Solo se permiten imágenes o videos.')),
});

function uploadedFile(req: Parameters<Parameters<typeof asyncHandler>[0]>[0]) {
  return Array.isArray(req.files) ? req.files[0] : req.file;
}

function animalIds(value: unknown, primary?: string) {
  let parsed: unknown=value;
  if(typeof value==='string') {
    try { parsed=JSON.parse(value); } catch { parsed=value.split(',').map((item)=>item.trim()).filter(Boolean); }
  }
  const ids=z.array(z.string().uuid()).max(100).catch([]).parse(parsed);
  return [...new Set(primary ? [primary,...ids] : ids)];
}

function tagIds(value: unknown) {
  let parsed:unknown=value;
  if(typeof value==='string') {
    try { parsed=JSON.parse(value); } catch { parsed=value.split(',').map((item)=>item.trim()).filter(Boolean); }
  }
  return [...new Set(z.array(z.string().uuid()).max(30).catch([]).parse(parsed))];
}

async function assertAnimals(client: PoolClient, ids: string[]) {
  if(!ids.length) throw new ValidationError('Relaciona el archivo con al menos un animal.');
  const result=await client.query('SELECT id_animal FROM animal WHERE id_animal=ANY($1::uuid[]) AND deleted_at IS NULL',[ids]);
  if(result.rowCount!==ids.length) throw new ValidationError('Uno o más animales seleccionados ya no están disponibles.');
}

async function replaceRelations(client: PoolClient, imageId: string, ids: string[], userId: string) {
  await assertAnimals(client,ids);
  await client.query('UPDATE animal_imagen_relacion SET deleted_at=NOW() WHERE id_imagen=$1 AND deleted_at IS NULL',[imageId]);
  for(const id of ids) {
    await client.query(buildInsert('animal_imagen_relacion',{id_imagen:imageId,id_animal:id,registrado_por:userId}));
  }
}

async function replaceTags(client:PoolClient,imageId:string,ids:string[],userId:string) {
  if(ids.length) {
    const valid=await client.query(
      'SELECT id_etiqueta FROM etiqueta_multimedia WHERE id_etiqueta=ANY($1::uuid[]) AND activo=TRUE AND deleted_at IS NULL',
      [ids],
    );
    if(valid.rowCount!==ids.length)throw new ValidationError('Una o más etiquetas ya no están disponibles.');
  }
  await client.query('UPDATE animal_imagen_etiqueta SET deleted_at=NOW() WHERE id_imagen=$1 AND deleted_at IS NULL',[imageId]);
  for(const id of ids)await client.query(buildInsert('animal_imagen_etiqueta',{id_imagen:imageId,id_etiqueta:id,registrado_por:userId}));
}

async function imageWithAnimals(client: PoolClient, imageId: string) {
  return (await client.query(
    `SELECT i.*,COALESCE((SELECT jsonb_agg(jsonb_build_object(
       'id_animal',a.id_animal,'nombre',a.nombre,'codigo_arete',a.codigo_arete,'sexo',a.sexo,
       'grupo',g.nombre,'ubicacion',u.nombre
     ) ORDER BY a.nombre)
     FROM animal_imagen_relacion r
     JOIN animal a ON a.id_animal=r.id_animal AND a.deleted_at IS NULL
     LEFT JOIN grupo g ON g.id_grupo=a.id_grupo_actual
     LEFT JOIN ubicacion u ON u.id_ubicacion=a.id_ubicacion_actual
     WHERE r.id_imagen=i.id_imagen AND r.deleted_at IS NULL),'[]') animales,
     COALESCE((SELECT jsonb_agg(jsonb_build_object(
       'id_etiqueta',e.id_etiqueta,'codigo',e.codigo,'nombre',e.nombre
     ) ORDER BY e.nombre)
     FROM animal_imagen_etiqueta ie JOIN etiqueta_multimedia e ON e.id_etiqueta=ie.id_etiqueta AND e.deleted_at IS NULL
     WHERE ie.id_imagen=i.id_imagen AND ie.deleted_at IS NULL),'[]') etiquetas
     FROM animal_imagen i WHERE i.id_imagen=$1 AND i.deleted_at IS NULL`,[imageId],
  )).rows[0];
}

export const animalImagesRouter=Router({mergeParams:true});

animalImagesRouter.get('/',requirePermission('IMAGEN_CONSULTAR'),asyncHandler(async(req,res)=>{
  const id=routeParam(req.params.id,'id');
  const rows=(await pool.query(
    `SELECT i.*,COALESCE((SELECT jsonb_agg(jsonb_build_object(
       'id_animal',a.id_animal,'nombre',a.nombre,'codigo_arete',a.codigo_arete
     ) ORDER BY a.nombre)
     FROM animal_imagen_relacion ar
     JOIN animal a ON a.id_animal=ar.id_animal AND a.deleted_at IS NULL
     WHERE ar.id_imagen=i.id_imagen AND ar.deleted_at IS NULL),'[]') animales,
     COALESCE((SELECT jsonb_agg(jsonb_build_object('id_etiqueta',e.id_etiqueta,'codigo',e.codigo,'nombre',e.nombre) ORDER BY e.nombre)
       FROM animal_imagen_etiqueta ie JOIN etiqueta_multimedia e ON e.id_etiqueta=ie.id_etiqueta AND e.deleted_at IS NULL
       WHERE ie.id_imagen=i.id_imagen AND ie.deleted_at IS NULL),'[]') etiquetas
     FROM animal_imagen i
     WHERE i.deleted_at IS NULL AND (i.id_animal=$1 OR EXISTS(
       SELECT 1 FROM animal_imagen_relacion r WHERE r.id_imagen=i.id_imagen AND r.id_animal=$1 AND r.deleted_at IS NULL
     )) ORDER BY i.es_perfil DESC,i.orden,i.fecha_toma DESC,i.created_at DESC`,[id],
  )).rows;
  return ok(res,rows);
}));

animalImagesRouter.post('/',requirePermission('IMAGEN_ADMINISTRAR'),mediaUpload.any(),asyncHandler(async(req,res)=>{
  const file=uploadedFile(req);
  if(!file) throw new ValidationError('Debes enviar el archivo en el campo archivo o imagen.');
  const primary=routeParam(req.params.id,'id');
  const profile=req.body.es_perfil==='true'||req.body.es_perfil===true;
  if(profile&&!file.mimetype.startsWith('image/')) throw new ValidationError('La foto de perfil debe ser una imagen.');
  const ids=profile?[primary]:animalIds(req.body.id_animales,primary);
  const cloud=profile ? await uploadAnimalImage(file.buffer,primary) : await uploadAnimalMedia(file.buffer,primary);
  try {
    const row=await transaction(async client=>{
      await assertAnimals(client,ids);
      if(profile) await client.query('UPDATE animal_imagen SET es_perfil=FALSE WHERE id_animal=$1 AND deleted_at IS NULL',[primary]);
      const image=(await client.query(buildInsert('animal_imagen',{
        id_animal:primary,public_id:cloud.public_id,url:cloud.url,secure_url:cloud.secure_url,
        formato:cloud.format,ancho:cloud.width,alto:cloud.height,bytes:cloud.bytes,
        tipo_archivo:file.mimetype.startsWith('video/')?'VIDEO':'IMAGEN',mime_type:file.mimetype,
        nombre_original:file.originalname,es_perfil:profile,descripcion:req.body.descripcion||null,
        fecha_toma:z.string().date().catch(new Date().toISOString().slice(0,10)).parse(req.body.fecha_toma),
        registrado_por:req.user!.id,
      }))).rows[0];
      await replaceRelations(client,image.id_imagen,ids,req.user!.id);
      await replaceTags(client,image.id_imagen,tagIds(req.body.id_etiquetas),req.user!.id);
      return imageWithAnimals(client,image.id_imagen);
    },req.user!.id);
    return created(res,row);
  } catch(error) {
    await deleteCloudinaryMedia(cloud.public_id,cloud.resource_type==='video'?'video':'image');
    throw error;
  }
}));

export const imagesRouter=Router();

imagesRouter.get('/',requirePermission('IMAGEN_CONSULTAR'),asyncHandler(async(req,res)=>{
  const filters=paginationSchema.extend({
    tipo:z.enum(['IMAGEN','VIDEO']).optional(),id_animal:z.string().uuid().optional(),
    id_grupo:z.string().uuid().optional(),id_ubicacion:z.string().uuid().optional(),id_etiqueta:z.string().uuid().optional(),
    sexo:z.enum(['MACHO','HEMBRA']).optional(),fecha_desde:z.string().date().optional(),fecha_hasta:z.string().date().optional(),
    orden:z.enum(['NEWEST','OLDEST','AZ','ZA']).default('NEWEST'),
  }).parse(req.query);
  const params:unknown[]=[];
  const where=['i.deleted_at IS NULL'];
  const add=(condition:string,value:unknown)=>{params.push(value);where.push(condition.replaceAll('?',`$${params.length}`));};
  if(filters.tipo) add('i.tipo_archivo=?',filters.tipo);
  if(filters.fecha_desde) add('i.fecha_toma>=?::date',filters.fecha_desde);
  if(filters.fecha_hasta) add('i.fecha_toma<=?::date',filters.fecha_hasta);
  if(filters.id_etiqueta)add('EXISTS(SELECT 1 FROM animal_imagen_etiqueta iet WHERE iet.id_imagen=i.id_imagen AND iet.id_etiqueta=? AND iet.deleted_at IS NULL)',filters.id_etiqueta);
  if(filters.q){params.push(`%${filters.q}%`);where.push(`(COALESCE(i.descripcion,'') ILIKE $${params.length} OR COALESCE(i.nombre_original,'') ILIKE $${params.length} OR EXISTS(
    SELECT 1 FROM animal_imagen_relacion rq JOIN animal aq ON aq.id_animal=rq.id_animal
    WHERE rq.id_imagen=i.id_imagen AND rq.deleted_at IS NULL AND aq.deleted_at IS NULL
      AND (aq.nombre ILIKE $${params.length} OR COALESCE(aq.codigo_arete,'') ILIKE $${params.length})
  ))`);}
  const animalConditions:string[]=[];
  if(filters.id_animal){params.push(filters.id_animal);animalConditions.push(`af.id_animal=$${params.length}`);}
  if(filters.id_grupo){params.push(filters.id_grupo);animalConditions.push(`af.id_grupo_actual=$${params.length}`);}
  if(filters.id_ubicacion){params.push(filters.id_ubicacion);animalConditions.push(`af.id_ubicacion_actual=$${params.length}`);}
  if(filters.sexo){params.push(filters.sexo);animalConditions.push(`af.sexo=$${params.length}`);}
  if(animalConditions.length) where.push(`EXISTS(SELECT 1 FROM animal_imagen_relacion rf JOIN animal af ON af.id_animal=rf.id_animal WHERE rf.id_imagen=i.id_imagen AND rf.deleted_at IS NULL AND af.deleted_at IS NULL AND ${animalConditions.join(' AND ')})`);
  const orderBy={NEWEST:'i.fecha_toma DESC,i.created_at DESC',OLDEST:'i.fecha_toma ASC,i.created_at ASC',AZ:"COALESCE(i.nombre_original,'') ASC",ZA:"COALESCE(i.nombre_original,'') DESC"}[filters.orden];
  params.push(filters.limit,offset(filters.page,filters.limit));
  const rows=(await pool.query(
    `SELECT i.*,COALESCE((SELECT jsonb_agg(jsonb_build_object(
       'id_animal',a.id_animal,'nombre',a.nombre,'codigo_arete',a.codigo_arete,'sexo',a.sexo,
       'id_grupo',a.id_grupo_actual,'grupo',g.nombre,'id_ubicacion',a.id_ubicacion_actual,'ubicacion',u.nombre
     ) ORDER BY a.nombre)
     FROM animal_imagen_relacion r JOIN animal a ON a.id_animal=r.id_animal AND a.deleted_at IS NULL
     LEFT JOIN grupo g ON g.id_grupo=a.id_grupo_actual LEFT JOIN ubicacion u ON u.id_ubicacion=a.id_ubicacion_actual
     WHERE r.id_imagen=i.id_imagen AND r.deleted_at IS NULL),'[]') animales,
     COALESCE((SELECT jsonb_agg(jsonb_build_object('id_etiqueta',e.id_etiqueta,'codigo',e.codigo,'nombre',e.nombre) ORDER BY e.nombre)
       FROM animal_imagen_etiqueta ie JOIN etiqueta_multimedia e ON e.id_etiqueta=ie.id_etiqueta AND e.deleted_at IS NULL
       WHERE ie.id_imagen=i.id_imagen AND ie.deleted_at IS NULL),'[]') etiquetas,
     COUNT(*) OVER()::int total
     FROM animal_imagen i WHERE ${where.join(' AND ')}
     ORDER BY ${orderBy},i.id_imagen LIMIT $${params.length-1} OFFSET $${params.length}`,
    params,
  )).rows;
  return ok(res,rows,{page:filters.page,limit:filters.limit,total:rows[0]?.total??0});
}));

imagesRouter.patch('/:id/perfil',requirePermission('IMAGEN_ADMINISTRAR'),asyncHandler(async(req,res)=>{
  const row=await transaction(async client=>{
    const found=await client.query('SELECT * FROM animal_imagen WHERE id_imagen=$1 AND deleted_at IS NULL FOR UPDATE',[routeParam(req.params.id,'id')]);
    if(!found.rows[0]) throw new NotFoundError();
    if(found.rows[0].tipo_archivo==='VIDEO') throw new ValidationError('Un video no puede utilizarse como foto de perfil.');
    await client.query('UPDATE animal_imagen SET es_perfil=FALSE WHERE id_animal=$1 AND deleted_at IS NULL',[found.rows[0].id_animal]);
    await client.query('UPDATE animal_imagen SET es_perfil=TRUE WHERE id_imagen=$1',[routeParam(req.params.id,'id')]);
    await replaceRelations(client,found.rows[0].id_imagen,[found.rows[0].id_animal],req.user!.id);
    return imageWithAnimals(client,found.rows[0].id_imagen);
  },req.user!.id);
  return ok(res,row);
}));

imagesRouter.patch('/:id',requirePermission('IMAGEN_ADMINISTRAR'),asyncHandler(async(req,res)=>{
  const id=routeParam(req.params.id,'id');
  const row=await transaction(async client=>{
    const found=(await client.query('SELECT * FROM animal_imagen WHERE id_imagen=$1 AND deleted_at IS NULL FOR UPDATE',[id])).rows[0];
    if(!found) throw new NotFoundError();
    if(Object.prototype.hasOwnProperty.call(req.body,'id_animales')) {
      if(found.es_perfil) throw new ValidationError('La foto de perfil solo puede pertenecer a su animal principal.');
      await replaceRelations(client,id,animalIds(req.body.id_animales),req.user!.id);
    }
    if(Object.prototype.hasOwnProperty.call(req.body,'id_etiquetas'))await replaceTags(client,id,tagIds(req.body.id_etiquetas),req.user!.id);
    const date=Object.prototype.hasOwnProperty.call(req.body,'fecha_toma')
      ? z.string().date().parse(req.body.fecha_toma)
      : found.fecha_toma;
    await client.query('UPDATE animal_imagen SET descripcion=$2,orden=COALESCE($3,orden),fecha_toma=$4,updated_at=NOW() WHERE id_imagen=$1',[id,req.body.descripcion??found.descripcion,req.body.orden,date]);
    return imageWithAnimals(client,id);
  },req.user!.id);
  return ok(res,row);
}));

imagesRouter.delete('/:id',requirePermission('IMAGEN_ADMINISTRAR'),asyncHandler(async(req,res)=>{
  const row=await transaction(async client=>{
    const image=(await client.query('UPDATE animal_imagen SET deleted_at=NOW(),es_perfil=FALSE WHERE id_imagen=$1 AND deleted_at IS NULL RETURNING public_id,tipo_archivo',[routeParam(req.params.id,'id')])).rows[0];
    if(!image) throw new NotFoundError();
    await client.query('UPDATE animal_imagen_relacion SET deleted_at=NOW() WHERE id_imagen=$1 AND deleted_at IS NULL',[routeParam(req.params.id,'id')]);
    await client.query('UPDATE animal_imagen_etiqueta SET deleted_at=NOW() WHERE id_imagen=$1 AND deleted_at IS NULL',[routeParam(req.params.id,'id')]);
    return image;
  },req.user!.id);
  await deleteCloudinaryMedia(row.public_id,row.tipo_archivo==='VIDEO'?'video':'image');
  return noContent(res);
}));
