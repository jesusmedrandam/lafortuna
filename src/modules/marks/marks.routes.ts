import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, noContent, ok } from '../../core/http.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { requirePermission } from '../../middleware/permission.js';
import { deleteCloudinaryImage, uploadMarkImage } from '../../services/cloudinary.service.js';
import { buildInsert, buildUpdate } from '../shared/sql.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_IMAGE_MB * 1024 * 1024 },
  fileFilter: (_req, file, callback) => file.mimetype.startsWith('image/')
    ? callback(null, true)
    : callback(new ValidationError('La foto del fierro debe ser una imagen.')),
});

const createSchema = z.object({
  id_usuarios: z.array(z.string().uuid()).min(1, 'Selecciona al menos un usuario.').max(100),
  codigo: z.string().trim().min(1).max(80),
  nombre: z.string().trim().min(1).max(140),
  descripcion: z.string().trim().max(300).nullable().optional(),
  activo: z.boolean().default(true),
});
const updateSchema = createSchema.partial().refine((value) => Object.keys(value).length > 0, 'No hay cambios.');

function payload(body: unknown, partial = false) {
  let value = body;
  if (typeof body === 'object' && body !== null && 'data' in body) {
    try {
      value = JSON.parse(String((body as { data: unknown }).data));
    } catch {
      throw new ValidationError('Los datos del fierro no son válidos.');
    }
  }
  return partial ? updateSchema.parse(value) : createSchema.parse(value);
}

async function replaceUsers(client: import('pg').PoolClient, markId: string, userIds: string[], registeredBy: string) {
  const uniqueIds = [...new Set(userIds)];
  const found = await client.query(
    `SELECT id_usuario FROM usuario
     WHERE id_usuario=ANY($1::uuid[]) AND deleted_at IS NULL AND activo=TRUE`,
    [uniqueIds],
  );
  if (found.rowCount !== uniqueIds.length) throw new ValidationError('Uno o más usuarios seleccionados no están disponibles.');
  await client.query('UPDATE marquilla_usuario SET deleted_at=NOW() WHERE id_marquilla=$1 AND deleted_at IS NULL', [markId]);
  for (let index = 0; index < uniqueIds.length; index += 1) {
    await client.query(buildInsert('marquilla_usuario', {
      id_marquilla: markId,
      id_usuario: uniqueIds[index],
      es_principal: index === 0,
      registrado_por: registeredBy,
    }));
  }
}

export const marksRouter = Router();

marksRouter.get('/usuarios', requirePermission('CATALOGO_CONSULTAR', 'ANIMAL_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, (await pool.query(
  `SELECT id_usuario,TRIM(CONCAT(nombres,' ',apellidos)) nombre,correo
   FROM usuario WHERE deleted_at IS NULL AND activo=TRUE AND correo_verificado=TRUE ORDER BY nombres,apellidos`,
)).rows)));

marksRouter.get('/', requirePermission('CATALOGO_CONSULTAR', 'ANIMAL_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, (await pool.query(
  `SELECT m.*,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id_usuario',u.id_usuario,'nombre',TRIM(CONCAT(u.nombres,' ',u.apellidos)),'correo',u.correo
    ) ORDER BY mu.es_principal DESC,u.nombres,u.apellidos)
    FROM marquilla_usuario mu JOIN usuario u ON u.id_usuario=mu.id_usuario AND u.deleted_at IS NULL
    WHERE mu.id_marquilla=m.id_marquilla AND mu.deleted_at IS NULL),'[]'::jsonb) usuarios,
    COALESCE((SELECT string_agg(TRIM(CONCAT(u.nombres,' ',u.apellidos)),', ' ORDER BY mu.es_principal DESC,u.nombres,u.apellidos)
    FROM marquilla_usuario mu JOIN usuario u ON u.id_usuario=mu.id_usuario AND u.deleted_at IS NULL
    WHERE mu.id_marquilla=m.id_marquilla AND mu.deleted_at IS NULL),'Sin usuarios') usuario,
    (SELECT COUNT(*)::int FROM animal a WHERE a.id_marquilla=m.id_marquilla AND a.deleted_at IS NULL) total_animales
   FROM marquilla m WHERE m.deleted_at IS NULL ORDER BY m.activo DESC,m.nombre,m.codigo`,
)).rows)));

marksRouter.post('/', requirePermission('CATALOGO_ADMINISTRAR'), upload.single('foto'), asyncHandler(async (req, res) => {
  const data = payload(req.body) as z.infer<typeof createSchema>;
  const id = randomUUID();
  const cloud = req.file ? await uploadMarkImage(req.file.buffer, id) : null;
  try {
    const row = await transaction(async (client) => {
      const { id_usuarios, ...mark } = data;
      const createdMark = (await client.query(buildInsert('marquilla', {
        id_marquilla: id,
        id_usuario: null,
        ...mark,
        public_id: cloud?.public_id ?? null,
        url: cloud?.url ?? null,
        secure_url: cloud?.secure_url ?? null,
        formato: cloud?.format ?? null,
        ancho: cloud?.width ?? null,
        alto: cloud?.height ?? null,
        bytes: cloud?.bytes ?? null,
        registrado_por: req.user!.id,
      }))).rows[0];
      await replaceUsers(client, id, id_usuarios, req.user!.id);
      return createdMark;
    }, req.user!.id);
    return created(res, row);
  } catch (error) {
    if (cloud?.public_id) await deleteCloudinaryImage(cloud.public_id).catch(() => undefined);
    throw error;
  }
}));

marksRouter.patch('/:id', requirePermission('CATALOGO_ADMINISTRAR'), upload.single('foto'), asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, 'id');
  const current = (await pool.query('SELECT * FROM marquilla WHERE id_marquilla=$1 AND deleted_at IS NULL', [id])).rows[0];
  if (!current) throw new NotFoundError('Fierro no encontrado.');
  const data = payload(req.body, true) as z.infer<typeof updateSchema>;
  const cloud = req.file ? await uploadMarkImage(req.file.buffer, id) : null;
  try {
    const row = await transaction(async (client) => {
      const { id_usuarios, ...mark } = data;
      const changes = {
        ...mark,
        ...(cloud ? {
          public_id: cloud.public_id, url: cloud.url, secure_url: cloud.secure_url,
          formato: cloud.format, ancho: cloud.width, alto: cloud.height, bytes: cloud.bytes,
        } : {}),
      };
      const updated = Object.keys(changes).length
        ? (await client.query(buildUpdate('marquilla', 'id_marquilla', id, changes))).rows[0]
        : current;
      if (id_usuarios) await replaceUsers(client, id, id_usuarios, req.user!.id);
      return updated;
    }, req.user!.id);
    if (cloud && current.public_id && current.public_id !== cloud.public_id) {
      await deleteCloudinaryImage(current.public_id).catch(() => undefined);
    }
    return ok(res, row);
  } catch (error) {
    if (cloud?.public_id) await deleteCloudinaryImage(cloud.public_id).catch(() => undefined);
    throw error;
  }
}));

marksRouter.delete('/:id', requirePermission('CATALOGO_ADMINISTRAR'), asyncHandler(async (req, res) => {
  const result = await pool.query(
    'UPDATE marquilla SET activo=FALSE,updated_at=NOW() WHERE id_marquilla=$1 AND deleted_at IS NULL',
    [routeParam(req.params.id, 'id')],
  );
  if (!result.rowCount) throw new NotFoundError('Fierro no encontrado.');
  return noContent(res);
}));
