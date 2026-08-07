import { randomUUID } from 'node:crypto';
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
import { deleteCloudinaryImage, uploadAnimalImage } from '../../services/cloudinary.service.js';
import { buildInsert, buildUpdate } from '../shared/sql.js';

const relation = z.object({
  id: z.string().uuid(),
  porcentaje: z.number().min(0).max(100).nullable().optional(),
  principal: z.boolean().optional(),
});

const ownerRelation = z.object({
  id: z.string().uuid(),
  porcentaje: z.number().min(0).max(100).nullable().optional(),
  principal: z.boolean().optional(),
});

const schema = z.object({
  codigo_arete: z.string().max(60).nullable().optional(),
  nombre: z.string().trim().min(1).max(120),
  descripcion: z.string().max(300).nullable().optional(),
  id_especie: z.string().uuid(),
  sexo: z.enum(['MACHO', 'HEMBRA']),
  fecha_nacimiento: z.string().date().nullable().optional(),
  id_madre: z.string().uuid().nullable().optional(),
  id_padre: z.string().uuid().nullable().optional(),
  id_origen: z.string().uuid(),
  id_grupo_actual: z.string().uuid().nullable().optional(),
  id_ubicacion_actual: z.string().uuid().nullable().optional(),
  fecha_ingreso: z.string().date().nullable().optional(),
  estado: z.enum(['ACTIVO', 'MUERTO', 'VENDIDO', 'TRASLADADO', 'DESAPARECIDO', 'INACTIVO']).optional(),
  colores: z.array(relation).default([]),
  razas: z.array(relation).default([]),
  propietarios: z.array(ownerRelation).default([]).superRefine((items, ctx) => {
    if (items.filter((item) => item.principal).length > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Solo un propietario puede ser principal.' });
    }
    const total = items.reduce((sum, item) => sum + (item.porcentaje ?? 0), 0);
    if (total > 100.001) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La suma de porcentajes no puede superar 100%.' });
  }),
});

const createSchema = schema.extend({
  peso_inicial_kg: z.number().positive().max(5000).nullable().optional(),
  fecha_pesaje_inicial: z.string().min(1).nullable().optional(),
  metodo_pesaje_inicial: z.string().trim().max(80).nullable().optional(),
  observaciones_pesaje_inicial: z.string().trim().max(300).nullable().optional(),
  descripcion_foto_perfil: z.string().trim().max(300).nullable().optional(),
});

const createUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_IMAGE_MB * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.startsWith('image/')) {
      callback(new ValidationError('La foto de perfil debe ser una imagen.'));
      return;
    }
    callback(null, true);
  },
});

function createPayload(body: unknown) {
  if (typeof body === 'object' && body !== null && 'data' in body) {
    const raw = (body as { data?: unknown }).data;
    if (typeof raw !== 'string') throw new ValidationError('Los datos del animal no son válidos.');
    try {
      return createSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (error instanceof SyntaxError) throw new ValidationError('Los datos del animal no contienen un JSON válido.');
      throw error;
    }
  }
  return createSchema.parse(body);
}

export const animalsRouter = Router();

animalsRouter.get('/', requirePermission('ANIMAL_CONSULTAR'), asyncHandler(async (req, res) => {
  const p = paginationSchema.extend({
    sexo: z.enum(['MACHO', 'HEMBRA']).optional(),
    estado: z.enum(['ACTIVO', 'MUERTO', 'VENDIDO', 'TRASLADADO', 'DESAPARECIDO', 'INACTIVO']).optional(),
    id_grupo: z.string().uuid().optional(),
    id_ubicacion: z.string().uuid().optional(),
    id_especie: z.string().uuid().optional(),
    id_propietario: z.string().uuid().optional(),
    id_raza: z.string().uuid().optional(),
    id_color: z.string().uuid().optional(),
    nacimiento_desde: z.string().date().optional(),
    nacimiento_hasta: z.string().date().optional(),
  }).superRefine((filters, ctx) => {
    if (filters.nacimiento_desde && filters.nacimiento_hasta && filters.nacimiento_desde > filters.nacimiento_hasta) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fecha inicial de nacimiento no puede ser posterior a la fecha final.' });
    }
  }).parse(req.query);
  const params: unknown[] = [];
  const where = ['a.deleted_at IS NULL'];
  const add = (condition: string, value: unknown) => {
    params.push(value);
    where.push(condition.replace('?', `$${params.length}`));
  };
  if (p.q) {
    params.push(`%${p.q}%`);
    where.push(`(a.nombre ILIKE $${params.length} OR a.codigo_arete ILIKE $${params.length} OR COALESCE(a.descripcion,'') ILIKE $${params.length})`);
  }
  if (p.sexo) add('a.sexo=?', p.sexo);
  if (p.estado) add('a.estado=?', p.estado);
  if (p.id_grupo) add('a.id_grupo_actual=?', p.id_grupo);
  if (p.id_ubicacion) add('a.id_ubicacion_actual=?', p.id_ubicacion);
  if (p.id_especie) add('a.id_especie=?', p.id_especie);
  if (p.id_propietario) add(`EXISTS (
    SELECT 1 FROM animal_propietario apf
    WHERE apf.id_animal=a.id_animal AND apf.id_usuario=?
      AND apf.fecha_hasta IS NULL AND apf.deleted_at IS NULL
  )`, p.id_propietario);
  if (p.id_raza) add(`EXISTS (
    SELECT 1 FROM animal_raza arf
    WHERE arf.id_animal=a.id_animal AND arf.id_raza=? AND arf.deleted_at IS NULL
  )`, p.id_raza);
  if (p.id_color) add(`EXISTS (
    SELECT 1 FROM animal_color acf
    WHERE acf.id_animal=a.id_animal AND acf.id_color=? AND acf.deleted_at IS NULL
  )`, p.id_color);
  if (p.nacimiento_desde) add('a.fecha_nacimiento>=?', p.nacimiento_desde);
  if (p.nacimiento_hasta) add('a.fecha_nacimiento<=?', p.nacimiento_hasta);
  params.push(p.limit, offset(p.page, p.limit));
  const limitIndex = params.length - 1;
  const offsetIndex = params.length;
  const result = await pool.query(
    `SELECT a.*,e.nombre especie,g.nombre grupo,u.nombre ubicacion,im.secure_url foto_perfil,
      (SELECT TRIM(CONCAT(up.nombres,' ',up.apellidos))
       FROM animal_propietario ap
       JOIN usuario up ON up.id_usuario=ap.id_usuario
       WHERE ap.id_animal=a.id_animal AND ap.fecha_hasta IS NULL AND ap.deleted_at IS NULL
       ORDER BY ap.es_principal DESC,up.nombres,up.apellidos LIMIT 1) propietario_principal,
      (SELECT jsonb_build_object('peso_kg',p.peso_kg,'fecha',p.fecha_pesaje)
       FROM pesaje p
       WHERE p.id_animal=a.id_animal AND p.deleted_at IS NULL
       ORDER BY p.fecha_pesaje DESC LIMIT 1) ultimo_pesaje,
      COUNT(*) OVER()::int total
     FROM animal a
     JOIN especie e ON e.id_especie=a.id_especie
     LEFT JOIN grupo g ON g.id_grupo=a.id_grupo_actual
     LEFT JOIN ubicacion u ON u.id_ubicacion=a.id_ubicacion_actual
     LEFT JOIN animal_imagen im ON im.id_animal=a.id_animal AND im.es_perfil AND im.deleted_at IS NULL
     WHERE ${where.join(' AND ')}
     ORDER BY a.nombre
     LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    params,
  );
  return ok(res, result.rows, { page: p.page, limit: p.limit, total: result.rows[0]?.total ?? 0 });
}));

animalsRouter.get('/opciones/filtros', requirePermission('ANIMAL_CONSULTAR'), asyncHandler(async (_req, res) => {
  const [especies, grupos, ubicaciones, propietarios, razas, colores] = await Promise.all([
    pool.query(`SELECT id_especie,nombre FROM especie WHERE deleted_at IS NULL AND activo=TRUE ORDER BY nombre`),
    pool.query(`SELECT id_grupo,nombre FROM grupo WHERE deleted_at IS NULL AND activo=TRUE ORDER BY nombre`),
    pool.query(`SELECT id_ubicacion,nombre,tipo FROM ubicacion WHERE deleted_at IS NULL AND activo=TRUE ORDER BY tipo,nombre`),
    pool.query(`SELECT DISTINCT u.id_usuario,TRIM(CONCAT(u.nombres,' ',u.apellidos)) nombre
      FROM animal_propietario ap
      JOIN usuario u ON u.id_usuario=ap.id_usuario
      WHERE ap.deleted_at IS NULL AND ap.fecha_hasta IS NULL AND u.deleted_at IS NULL
      ORDER BY nombre`),
    pool.query(`SELECT id_raza,nombre,id_especie FROM raza_animal WHERE deleted_at IS NULL AND activo=TRUE ORDER BY nombre`),
    pool.query(`SELECT id_color,nombre FROM color_animal WHERE deleted_at IS NULL AND activo=TRUE ORDER BY nombre`),
  ]);
  return ok(res, {
    especies: especies.rows,
    grupos: grupos.rows,
    ubicaciones: ubicaciones.rows,
    propietarios: propietarios.rows,
    razas: razas.rows,
    colores: colores.rows,
  });
}));

animalsRouter.get('/opciones/propietarios', requirePermission('ANIMAL_CONSULTAR', 'ANIMAL_CREAR', 'ANIMAL_MODIFICAR'), asyncHandler(async (_req, res) => {
  const rows = (await pool.query(
    `SELECT id_usuario,TRIM(CONCAT(nombres,' ',apellidos)) nombre,correo
     FROM usuario
     WHERE deleted_at IS NULL AND activo=TRUE AND correo_verificado=TRUE
     ORDER BY nombres,apellidos`,
  )).rows;
  return ok(res, rows);
}));

animalsRouter.get('/:id', requirePermission('ANIMAL_CONSULTAR'), asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT a.*,e.nombre especie,g.nombre grupo,u.nombre ubicacion,m.nombre madre,p.nombre padre,
      (SELECT ip.secure_url FROM animal_imagen ip
       WHERE ip.id_animal=a.id_animal AND ip.es_perfil=TRUE AND ip.deleted_at IS NULL
       ORDER BY ip.created_at DESC LIMIT 1) foto_perfil,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id_imagen',i.id_imagen,'secure_url',i.secure_url,'url',i.url,'public_id',i.public_id,
        'es_perfil',i.es_perfil,'descripcion',i.descripcion,'orden',i.orden,'created_at',i.created_at,
        'tipo_archivo',i.tipo_archivo,'mime_type',i.mime_type,'nombre_original',i.nombre_original,
        'animales',COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id_animal',ar_a.id_animal,'nombre',ar_a.nombre,'codigo_arete',ar_a.codigo_arete
        ) ORDER BY ar_a.nombre)
        FROM animal_imagen_relacion ar JOIN animal ar_a ON ar_a.id_animal=ar.id_animal AND ar_a.deleted_at IS NULL
        WHERE ar.id_imagen=i.id_imagen AND ar.deleted_at IS NULL),'[]'::jsonb)
      ) ORDER BY i.es_perfil DESC,i.created_at DESC,i.orden DESC)
      FROM animal_imagen i WHERE i.deleted_at IS NULL AND (i.id_animal=a.id_animal OR EXISTS(
        SELECT 1 FROM animal_imagen_relacion air
        WHERE air.id_imagen=i.id_imagen AND air.id_animal=a.id_animal AND air.deleted_at IS NULL
      ))),'[]') imagenes,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id_usuario',ap.id_usuario,'nombre',TRIM(CONCAT(up.nombres,' ',up.apellidos)),
        'correo',up.correo,'porcentaje',ap.porcentaje_propiedad,'es_principal',ap.es_principal
      ) ORDER BY ap.es_principal DESC,up.nombres,up.apellidos)
      FROM animal_propietario ap JOIN usuario up ON up.id_usuario=ap.id_usuario
      WHERE ap.id_animal=a.id_animal AND ap.fecha_hasta IS NULL AND ap.deleted_at IS NULL),'[]') propietarios,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id_color',c.id_color,'nombre',c.nombre,'es_principal',ac.es_principal
      )) FROM animal_color ac JOIN color_animal c ON c.id_color=ac.id_color
      WHERE ac.id_animal=a.id_animal AND ac.deleted_at IS NULL),'[]') colores,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id_raza',r.id_raza,'nombre',r.nombre,'porcentaje',ar.porcentaje
      )) FROM animal_raza ar JOIN raza_animal r ON r.id_raza=ar.id_raza
      WHERE ar.id_animal=a.id_animal AND ar.deleted_at IS NULL),'[]') razas,
      (SELECT jsonb_build_object('id_pesaje',pe.id_pesaje,'peso_kg',pe.peso_kg,'fecha',pe.fecha_pesaje,'metodo',pe.metodo)
       FROM pesaje pe WHERE pe.id_animal=a.id_animal AND pe.deleted_at IS NULL
       ORDER BY pe.fecha_pesaje DESC LIMIT 1) ultimo_pesaje,
      (SELECT jsonb_build_object(
        'id_tratamiento',ta.id_tratamiento,'fecha',ta.fecha_aplicacion,
        'tipo',tt.nombre,'medicamento',me.nombre_comercial,'via',va.nombre,
        'dosis',ta.dosis,'unidad',COALESCE(um.simbolo,um.nombre),
        'descripcion',ta.descripcion,'observaciones',ta.observaciones
       )
       FROM tratamiento_animal ta
       JOIN tipo_tratamiento tt ON tt.id_tipo_tratamiento=ta.id_tipo_tratamiento
       JOIN medicamento me ON me.id_medicamento=ta.id_medicamento
       JOIN via_administracion va ON va.id_via_administracion=ta.id_via_administracion
       JOIN unidad_medida um ON um.id_unidad=ta.id_unidad_dosis
       WHERE ta.id_animal=a.id_animal AND ta.deleted_at IS NULL
       ORDER BY ta.fecha_aplicacion DESC LIMIT 1) ultimo_tratamiento,
      (SELECT jsonb_build_object(
        'id_movimiento',mv.id_movimiento,
        'fecha',COALESCE(md.aplicado_en,mv.aplicado_en,mv.fecha_movimiento),
        'ubicacion_origen',uo.nombre,'ubicacion_destino',ud.nombre,
        'grupo_origen',go.nombre,'grupo_destino',gd.nombre,
        'motivo',mv.motivo
       )
       FROM movimiento_animal_detalle md
       JOIN movimiento_animal mv ON mv.id_movimiento=md.id_movimiento
       LEFT JOIN ubicacion uo ON uo.id_ubicacion=COALESCE(md.id_ubicacion_anterior,mv.id_ubicacion_origen)
       LEFT JOIN ubicacion ud ON ud.id_ubicacion=COALESCE(md.id_ubicacion_destino,mv.id_ubicacion_destino)
       LEFT JOIN grupo go ON go.id_grupo=COALESCE(md.id_grupo_anterior,mv.id_grupo_origen)
       LEFT JOIN grupo gd ON gd.id_grupo=COALESCE(md.id_grupo_destino,mv.id_grupo_destino)
       WHERE md.id_animal=a.id_animal
         AND md.seleccionado=TRUE
         AND md.estado='APLICADO'
         AND md.deleted_at IS NULL
         AND mv.estado='COMPLETADO'
         AND mv.deleted_at IS NULL
       ORDER BY COALESCE(md.aplicado_en,mv.aplicado_en,mv.fecha_movimiento) DESC LIMIT 1) ultimo_movimiento
     FROM animal a
     JOIN especie e ON e.id_especie=a.id_especie
     LEFT JOIN grupo g ON g.id_grupo=a.id_grupo_actual
     LEFT JOIN ubicacion u ON u.id_ubicacion=a.id_ubicacion_actual
     LEFT JOIN animal m ON m.id_animal=a.id_madre
     LEFT JOIN animal p ON p.id_animal=a.id_padre
     WHERE a.id_animal=$1 AND a.deleted_at IS NULL`,
    [routeParam(req.params.id, 'id')],
  );
  if (!result.rows[0]) throw new NotFoundError();
  return ok(res, result.rows[0]);
}));

async function saveRelations(client: PoolClient, id: string, input: {
  colores?: Array<z.infer<typeof relation>>;
  razas?: Array<z.infer<typeof relation>>;
  propietarios?: Array<z.infer<typeof ownerRelation>>;
  registrado_por: string;
}) {
  if (input.colores) {
    await client.query('UPDATE animal_color SET deleted_at=NOW() WHERE id_animal=$1 AND deleted_at IS NULL', [id]);
    for (const item of input.colores) {
      await client.query(buildInsert('animal_color', {
        id_animal: id,
        id_color: item.id,
        es_principal: item.principal ?? false,
        registrado_por: input.registrado_por,
      }));
    }
  }
  if (input.razas) {
    await client.query('UPDATE animal_raza SET deleted_at=NOW() WHERE id_animal=$1 AND deleted_at IS NULL', [id]);
    for (const item of input.razas) {
      await client.query(buildInsert('animal_raza', {
        id_animal: id,
        id_raza: item.id,
        porcentaje: item.porcentaje ?? null,
        registrado_por: input.registrado_por,
      }));
    }
  }
  if (input.propietarios) {
    await client.query(
      'UPDATE animal_propietario SET fecha_hasta=CURRENT_DATE WHERE id_animal=$1 AND fecha_hasta IS NULL AND deleted_at IS NULL',
      [id],
    );
    for (const item of input.propietarios) {
      await client.query(buildInsert('animal_propietario', {
        id_animal: id,
        id_usuario: item.id,
        porcentaje_propiedad: item.porcentaje ?? null,
        es_principal: item.principal ?? false,
        fecha_desde: new Date().toISOString().slice(0, 10),
        registrado_por: input.registrado_por,
      }));
    }
  }
}

animalsRouter.post(
  '/',
  requirePermission('ANIMAL_CREAR'),
  createUpload.single('foto_perfil'),
  asyncHandler(async (req, res) => {
    const input = createPayload(req.body);
    const idAnimal = randomUUID();
    const profilePhoto = req.file;
    let cloud: Awaited<ReturnType<typeof uploadAnimalImage>> | null = null;

    if (profilePhoto) cloud = await uploadAnimalImage(profilePhoto.buffer, idAnimal);

    try {
      const result = await transaction(async (client) => {
        const {
          colores,
          razas,
          propietarios,
          peso_inicial_kg,
          fecha_pesaje_inicial,
          metodo_pesaje_inicial,
          observaciones_pesaje_inicial,
          descripcion_foto_perfil,
          ...animal
        } = input;

        const row = (await client.query(buildInsert('animal', {
          id_animal: idAnimal,
          ...animal,
          registrado_por: req.user!.id,
        }))).rows[0];

        await saveRelations(client, idAnimal, {
          colores,
          razas,
          propietarios,
          registrado_por: req.user!.id,
        });

        let initialWeight: { peso_kg: unknown; fecha_pesaje: unknown } | null = null;
        if (peso_inicial_kg !== null && peso_inicial_kg !== undefined) {
          initialWeight = (await client.query(buildInsert('pesaje', {
            id_animal: idAnimal,
            fecha_pesaje: fecha_pesaje_inicial || new Date().toISOString(),
            peso_kg: peso_inicial_kg,
            metodo: metodo_pesaje_inicial || null,
            observaciones: observaciones_pesaje_inicial || 'Peso inicial registrado al crear el animal.',
            registrado_por: req.user!.id,
          }))).rows[0];
        }

        let profileImage: { secure_url?: string } | null = null;
        if (cloud) {
          profileImage = (await client.query(buildInsert('animal_imagen', {
            id_animal: idAnimal,
            public_id: cloud.public_id,
            url: cloud.url,
            secure_url: cloud.secure_url,
            formato: cloud.format,
            ancho: cloud.width,
            alto: cloud.height,
            bytes: cloud.bytes,
            tipo_archivo: 'IMAGEN',
            mime_type: profilePhoto?.mimetype ?? 'image/jpeg',
            nombre_original: profilePhoto?.originalname ?? null,
            es_perfil: true,
            descripcion: descripcion_foto_perfil || 'Foto de perfil registrada al crear el animal.',
            registrado_por: req.user!.id,
          }))).rows[0];
          await client.query(buildInsert('animal_imagen_relacion', {
            id_imagen: (profileImage as { id_imagen: string }).id_imagen,
            id_animal: idAnimal,
            registrado_por: req.user!.id,
          }));
        }

        return {
          ...row,
          foto_perfil: profileImage?.secure_url ?? null,
          ultimo_pesaje: initialWeight
            ? { peso_kg: initialWeight.peso_kg, fecha: initialWeight.fecha_pesaje }
            : null,
        };
      }, req.user!.id);

      return created(res, result);
    } catch (error) {
      if (cloud?.public_id) {
        await deleteCloudinaryImage(cloud.public_id).catch(() => undefined);
      }
      throw error;
    }
  }),
);

animalsRouter.patch('/:id', requirePermission('ANIMAL_MODIFICAR'), asyncHandler(async (req, res) => {
  const input = schema.partial().parse(req.body);
  const id = routeParam(req.params.id, 'id');
  const result = await transaction(async (client) => {
    const { colores, razas, propietarios, ...animal } = input;
    let row;
    if (Object.keys(animal).length) {
      row = (await client.query(buildUpdate('animal', 'id_animal', id, animal))).rows[0];
      if (!row) throw new NotFoundError();
    } else {
      const query = await client.query('SELECT * FROM animal WHERE id_animal=$1 AND deleted_at IS NULL', [id]);
      row = query.rows[0];
      if (!row) throw new NotFoundError();
    }
    await saveRelations(client, id, { colores, razas, propietarios, registrado_por: req.user!.id });
    return row;
  }, req.user!.id);
  return ok(res, result);
}));

animalsRouter.delete('/:id', requirePermission('ANIMAL_ELIMINAR'), asyncHandler(async (req, res) => {
  const result = await pool.query(
    "UPDATE animal SET deleted_at=NOW(),estado='INACTIVO' WHERE id_animal=$1 AND deleted_at IS NULL",
    [routeParam(req.params.id, 'id')],
  );
  if (!result.rowCount) throw new NotFoundError();
  return noContent(res);
}));
