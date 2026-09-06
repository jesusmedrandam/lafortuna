import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/async-handler.js';
import { NotFoundError } from '../../core/errors.js';
import { ok } from '../../core/http.js';
import { routeParam } from '../../core/route-param.js';
import { pool } from '../../database/pool.js';

export const publicAnimalsRouter = Router();

// Esta ruta no requiere sesión. El UUID del enlace funciona como credencial
// pública revocable y la consulta excluye ubicaciones, movimientos, propietarios,
// tratamientos y cualquier otra información interna de la finca.
publicAnimalsRouter.get('/:token', asyncHandler(async (req, res) => {
  const token = z.string().uuid().parse(routeParam(req.params.token, 'token'));
  const result = await pool.query(
    `SELECT a.id_animal,a.nombre,a.codigo_arete,a.descripcion,a.sexo,
       a.fecha_nacimiento,a.estado,e.nombre especie,oa.nombre origen,
       m.nombre madre,p.nombre padre,mq.codigo marquilla_codigo,
       (SELECT ai.secure_url FROM animal_imagen ai
        WHERE ai.id_animal=a.id_animal AND ai.es_perfil=TRUE AND ai.deleted_at IS NULL
        ORDER BY ai.created_at DESC LIMIT 1) foto_perfil,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'id_imagen',gallery.id_imagen,
         'secure_url',COALESCE(gallery.secure_url,gallery.url),
         'descripcion',gallery.descripcion,
         'fecha_toma',gallery.fecha_toma
       ) ORDER BY gallery.fecha_toma DESC NULLS LAST,gallery.created_at DESC)
       FROM animal_imagen gallery
       WHERE gallery.deleted_at IS NULL
         AND COALESCE(gallery.es_perfil,FALSE)=FALSE
         AND UPPER(COALESCE(gallery.tipo_archivo,'IMAGEN'))<>'VIDEO'
         AND LOWER(COALESCE(gallery.mime_type,'image/legacy')) NOT LIKE 'video/%'
         AND COALESCE(gallery.secure_url,gallery.url) IS NOT NULL
         AND (gallery.id_animal=a.id_animal OR EXISTS(
           SELECT 1 FROM animal_imagen_relacion relation
           WHERE relation.id_imagen=gallery.id_imagen
             AND relation.id_animal=a.id_animal
             AND relation.deleted_at IS NULL
         ))),'[]'::jsonb) fotos_portada,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'nombre',r.nombre,'porcentaje',ar.porcentaje
       ) ORDER BY ar.porcentaje DESC NULLS LAST,r.nombre)
       FROM animal_raza ar JOIN raza_animal r ON r.id_raza=ar.id_raza
       WHERE ar.id_animal=a.id_animal AND ar.deleted_at IS NULL),'[]'::jsonb) razas,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'nombre',c.nombre,'es_principal',ac.es_principal
       ) ORDER BY ac.es_principal DESC,c.nombre)
       FROM animal_color ac JOIN color_animal c ON c.id_color=ac.id_color
       WHERE ac.id_animal=a.id_animal AND ac.deleted_at IS NULL),'[]'::jsonb) colores,
       (SELECT jsonb_build_object('peso_kg',pe.peso_kg,'fecha',pe.fecha_pesaje)
        FROM pesaje pe WHERE pe.id_animal=a.id_animal AND pe.deleted_at IS NULL
        ORDER BY pe.fecha_pesaje DESC,pe.created_at DESC LIMIT 1) ultimo_pesaje,
       CASE WHEN a.sexo='HEMBRA' THEN (SELECT COUNT(*)::int FROM parto pa
         WHERE pa.id_madre=a.id_animal AND pa.deleted_at IS NULL) ELSE 0 END total_partos,
       (SELECT COUNT(*)::int FROM animal cria
        WHERE cria.deleted_at IS NULL
          AND (CASE WHEN a.sexo='HEMBRA' THEN cria.id_madre=a.id_animal ELSE cria.id_padre=a.id_animal END)) total_crias,
       EXISTS(SELECT 1 FROM prenez pr
         WHERE pr.id_vaca=a.id_animal AND pr.estado='CONFIRMADA' AND pr.deleted_at IS NULL) prenez_confirmada,
       ac.created_at compartido_desde
     FROM animal_compartido ac
     JOIN animal a ON a.id_animal=ac.id_animal AND a.deleted_at IS NULL
     JOIN especie e ON e.id_especie=a.id_especie
     JOIN origen_animal oa ON oa.id_origen=a.id_origen
     LEFT JOIN animal m ON m.id_animal=a.id_madre AND m.deleted_at IS NULL
     LEFT JOIN animal p ON p.id_animal=a.id_padre AND p.deleted_at IS NULL
     LEFT JOIN marquilla mq ON mq.id_marquilla=a.id_marquilla AND mq.deleted_at IS NULL
     WHERE ac.token=$1 AND ac.activo=TRUE AND ac.revocado_at IS NULL
     LIMIT 1`,
    [token],
  );
  if (!result.rows[0]) throw new NotFoundError('Esta ficha pública no existe o dejó de estar disponible.');
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  return ok(res, result.rows[0]);
}));
