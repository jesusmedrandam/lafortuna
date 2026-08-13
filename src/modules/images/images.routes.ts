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

imagesRouter.get('/multimedia',requirePermission('IMAGEN_CONSULTAR'),asyncHandler(async(req,res)=>{
  const filters=paginationSchema.extend({
    categoria:z.enum(['ANIMALES','MOVIMIENTOS','PARTOS','ACTIVIDADES','LIMPIEZAS']).optional(),
    tipo:z.enum(['IMAGEN','VIDEO']).optional(),id_animal:z.string().uuid().optional(),
    id_grupo:z.string().uuid().optional(),id_ubicacion:z.string().uuid().optional(),
    id_ubicacion_origen:z.string().uuid().optional(),id_ubicacion_destino:z.string().uuid().optional(),
    id_tipo_actividad:z.string().uuid().optional(),id_etiqueta:z.string().uuid().optional(),
    lado:z.enum(['ORIGEN','DESTINO']).optional(),sexo:z.enum(['MACHO','HEMBRA']).optional(),
    fecha_desde:z.string().date().optional(),fecha_hasta:z.string().date().optional(),
    orden:z.enum(['NEWEST','OLDEST','AZ','ZA']).default('NEWEST'),
  }).parse(req.query);
  const params:unknown[]=[];
  const where=['TRUE'];
  const add=(condition:string,value:unknown)=>{params.push(value);where.push(condition.replaceAll('?',`$${params.length}`));};
  if(filters.categoria)add('m.categoria=?',filters.categoria);
  if(filters.tipo)add('m.tipo_archivo=?',filters.tipo);
  if(filters.fecha_desde)add('m.fecha_toma>=?::date',filters.fecha_desde);
  if(filters.fecha_hasta)add('m.fecha_toma<=?::date',filters.fecha_hasta);
  if(filters.id_animal)add('?::uuid=ANY(m.animal_ids)',filters.id_animal);
  if(filters.id_grupo)add('m.id_grupo=?::uuid',filters.id_grupo);
  if(filters.id_ubicacion)add('m.id_ubicacion=?::uuid',filters.id_ubicacion);
  if(filters.id_ubicacion_origen)add('m.id_ubicacion_origen=?::uuid',filters.id_ubicacion_origen);
  if(filters.id_ubicacion_destino)add('m.id_ubicacion_destino=?::uuid',filters.id_ubicacion_destino);
  if(filters.id_tipo_actividad)add('m.id_tipo_actividad=?::uuid',filters.id_tipo_actividad);
  if(filters.lado)add('m.lado=?',filters.lado);
  if(filters.id_etiqueta)add(`EXISTS(
    SELECT 1 FROM jsonb_array_elements(m.etiquetas) etiqueta
    WHERE etiqueta->>'id_etiqueta'=?
  )`,filters.id_etiqueta);
  if(filters.sexo)add(`EXISTS(
    SELECT 1 FROM jsonb_array_elements(m.animales) animal
    WHERE animal->>'sexo'=?
  )`,filters.sexo);
  if(filters.q){
    params.push(`%${filters.q}%`);
    where.push(`(m.titulo ILIKE $${params.length} OR COALESCE(m.subtitulo,'') ILIKE $${params.length}
      OR COALESCE(m.descripcion,'') ILIKE $${params.length} OR COALESCE(m.nombre_original,'') ILIKE $${params.length})`);
  }
  const orderBy={
    NEWEST:'m.fecha_toma DESC,m.created_at DESC',OLDEST:'m.fecha_toma ASC,m.created_at ASC',
    AZ:'m.titulo ASC,m.fecha_toma DESC',ZA:'m.titulo DESC,m.fecha_toma DESC',
  }[filters.orden];
  params.push(filters.limit,offset(filters.page,filters.limit));
  const rows=(await pool.query(`
    WITH media AS (
      SELECT
        'ANIMAL:'||i.id_imagen::text id_multimedia,i.id_imagen id_origen,
        CASE WHEN i.id_parto IS NULL THEN 'ANIMALES' ELSE 'PARTOS' END categoria,
        CASE WHEN i.id_parto IS NULL THEN 'Animal' ELSE 'Parto' END subcategoria,
        CASE WHEN i.id_parto IS NULL
          THEN COALESCE((SELECT string_agg(a2.nombre,', ' ORDER BY a2.nombre)
            FROM animal_imagen_relacion r2 JOIN animal a2 ON a2.id_animal=r2.id_animal AND a2.deleted_at IS NULL
            WHERE r2.id_imagen=i.id_imagen AND r2.deleted_at IS NULL),a.nombre,'Archivo de animal')
          ELSE 'Parto de '||COALESCE(madre.nombre,'animal sin nombre') END titulo,
        CASE WHEN i.id_parto IS NULL
          THEN CONCAT_WS(' · ',NULLIF(a.codigo_arete,''),g.nombre,u.nombre)
          ELSE CONCAT_WS(' · ','Cría: '||a.nombre,'Fecha: '||TO_CHAR(p.fecha_parto,'DD/MM/YYYY')) END subtitulo,
        i.secure_url,i.public_id,i.nombre_original,i.descripcion,i.fecha_toma,i.created_at,
        COALESCE(i.tipo_archivo,'IMAGEN') tipo_archivo,i.es_perfil,
        ARRAY(SELECT DISTINCT r3.id_animal FROM animal_imagen_relacion r3
          WHERE r3.id_imagen=i.id_imagen AND r3.deleted_at IS NULL)::uuid[] animal_ids,
        a.id_grupo_actual id_grupo,a.id_ubicacion_actual id_ubicacion,
        NULL::uuid id_ubicacion_origen,NULL::uuid id_ubicacion_destino,NULL::uuid id_tipo_actividad,
        NULL::text lado,i.id_parto,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id_animal',a3.id_animal,'nombre',a3.nombre,'codigo_arete',a3.codigo_arete,'sexo',a3.sexo
        ) ORDER BY a3.nombre) FROM animal_imagen_relacion r3
          JOIN animal a3 ON a3.id_animal=r3.id_animal AND a3.deleted_at IS NULL
          WHERE r3.id_imagen=i.id_imagen AND r3.deleted_at IS NULL),'[]'::jsonb) animales,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id_etiqueta',e.id_etiqueta,'codigo',e.codigo,'nombre',e.nombre
        ) ORDER BY e.nombre) FROM animal_imagen_etiqueta ie
          JOIN etiqueta_multimedia e ON e.id_etiqueta=ie.id_etiqueta AND e.deleted_at IS NULL
          WHERE ie.id_imagen=i.id_imagen AND ie.deleted_at IS NULL),'[]'::jsonb) etiquetas,
        TRUE editable
      FROM animal_imagen i
      LEFT JOIN animal a ON a.id_animal=i.id_animal
      LEFT JOIN grupo g ON g.id_grupo=a.id_grupo_actual
      LEFT JOIN ubicacion u ON u.id_ubicacion=a.id_ubicacion_actual
      LEFT JOIN parto p ON p.id_parto=i.id_parto
      LEFT JOIN animal madre ON madre.id_animal=p.id_madre
      WHERE i.deleted_at IS NULL

      UNION ALL

      SELECT
        'MOVIMIENTO:'||mi.id_movimiento_imagen::text,mi.id_movimiento_imagen,'MOVIMIENTOS',
        CASE mi.lado WHEN 'ORIGEN' THEN 'Potrero de origen' ELSE 'Potrero de destino' END,
        COALESCE(mm.nombre,m.motivo,'Movimiento de animales'),
        CONCAT_WS(' · ','Origen: '||COALESCE(uo.nombre,'Sin registrar'),'Destino: '||COALESCE(ud.nombre,'Sin registrar')),
        mi.secure_url,mi.public_id,mi.nombre_original,mi.descripcion,m.fecha_movimiento,mi.created_at,
        'IMAGEN',FALSE,
        ARRAY(SELECT DISTINCT md.id_animal FROM movimiento_animal_detalle md
          WHERE md.id_movimiento=m.id_movimiento AND md.seleccionado=TRUE AND md.deleted_at IS NULL)::uuid[],
        COALESCE(m.id_grupo_origen,m.id_grupo_filtro),
        CASE mi.lado WHEN 'ORIGEN' THEN m.id_ubicacion_origen ELSE m.id_ubicacion_destino END,
        m.id_ubicacion_origen,m.id_ubicacion_destino,NULL::uuid,mi.lado,NULL::uuid,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id_animal',ma.id_animal,'nombre',ma.nombre,'codigo_arete',ma.codigo_arete,'sexo',ma.sexo
        ) ORDER BY ma.nombre) FROM movimiento_animal_detalle md
          JOIN animal ma ON ma.id_animal=md.id_animal AND ma.deleted_at IS NULL
          WHERE md.id_movimiento=m.id_movimiento AND md.seleccionado=TRUE AND md.deleted_at IS NULL),'[]'::jsonb),
        '[]'::jsonb,FALSE
      FROM movimiento_imagen mi
      JOIN movimiento_animal m ON m.id_movimiento=mi.id_movimiento AND m.deleted_at IS NULL
      LEFT JOIN motivo_movimiento mm ON mm.id_motivo_movimiento=m.id_motivo_movimiento
      LEFT JOIN ubicacion uo ON uo.id_ubicacion=m.id_ubicacion_origen
      LEFT JOIN ubicacion ud ON ud.id_ubicacion=m.id_ubicacion_destino
      WHERE mi.deleted_at IS NULL

      UNION ALL

      SELECT
        'ACTIVIDAD:'||ai.id_actividad_imagen::text,ai.id_actividad_imagen,'ACTIVIDADES',ta.nombre,
        ta.nombre,
        COALESCE((SELECT string_agg(aa2.nombre,', ' ORDER BY aa2.nombre)
          FROM actividad_animal aar2 JOIN animal aa2 ON aa2.id_animal=aar2.id_animal AND aa2.deleted_at IS NULL
          WHERE aar2.id_actividad=ac.id_actividad AND aar2.deleted_at IS NULL),'Sin animales relacionados'),
        ai.secure_url,ai.public_id,ai.nombre_original,COALESCE(ai.descripcion,ac.descripcion),ac.fecha,ai.created_at,
        'IMAGEN',FALSE,
        ARRAY(SELECT DISTINCT aar.id_animal FROM actividad_animal aar
          WHERE aar.id_actividad=ac.id_actividad AND aar.deleted_at IS NULL)::uuid[],
        NULL::uuid,NULL::uuid,NULL::uuid,NULL::uuid,ac.id_tipo_actividad,NULL::text,NULL::uuid,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id_animal',aa3.id_animal,'nombre',aa3.nombre,'codigo_arete',aa3.codigo_arete,'sexo',aa3.sexo
        ) ORDER BY aa3.nombre) FROM actividad_animal aar3
          JOIN animal aa3 ON aa3.id_animal=aar3.id_animal AND aa3.deleted_at IS NULL
          WHERE aar3.id_actividad=ac.id_actividad AND aar3.deleted_at IS NULL),'[]'::jsonb),
        '[]'::jsonb,FALSE
      FROM actividad_imagen ai
      JOIN actividad ac ON ac.id_actividad=ai.id_actividad AND ac.deleted_at IS NULL
      JOIN tipo_actividad ta ON ta.id_tipo_actividad=ac.id_tipo_actividad
      WHERE ai.deleted_at IS NULL

      UNION ALL

      SELECT
        'LIMPIEZA:'||li.id_limpieza_imagen::text,li.id_limpieza_imagen,'LIMPIEZAS','Limpieza de potrero',
        'Limpieza de '||u.nombre,
        COALESCE((SELECT string_agg(tl.nombre,', ' ORDER BY tl.nombre)
          FROM limpieza_potrero_actividad la
          JOIN tipo_limpieza_potrero tl ON tl.id_tipo_limpieza=la.id_tipo_limpieza
          WHERE la.id_limpieza=l.id_limpieza AND la.deleted_at IS NULL),'Actividad de limpieza'),
        li.secure_url,li.public_id,li.nombre_original,COALESCE(li.descripcion,l.observaciones),l.fecha_inicio,li.created_at,
        'IMAGEN',FALSE,ARRAY[]::uuid[],NULL::uuid,u.id_ubicacion,NULL::uuid,NULL::uuid,NULL::uuid,NULL::text,NULL::uuid,
        '[]'::jsonb,'[]'::jsonb,FALSE
      FROM limpieza_potrero_imagen li
      JOIN limpieza_potrero l ON l.id_limpieza=li.id_limpieza AND l.deleted_at IS NULL
      JOIN potrero po ON po.id_potrero=l.id_potrero
      JOIN ubicacion u ON u.id_ubicacion=po.id_ubicacion
      WHERE li.deleted_at IS NULL
    )
    SELECT m.*,COUNT(*) OVER()::int total
    FROM media m
    WHERE ${where.join(' AND ')}
    ORDER BY ${orderBy},m.id_multimedia
    LIMIT $${params.length-1} OFFSET $${params.length}`,
    params,
  )).rows;
  return ok(res,rows,{page:filters.page,limit:filters.limit,total:rows[0]?.total??0});
}));

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
