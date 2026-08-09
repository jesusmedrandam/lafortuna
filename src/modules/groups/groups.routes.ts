import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, noContent, ok } from '../../core/http.js';
import { ConflictError, NotFoundError } from '../../core/errors.js';
import { requirePermission } from '../../middleware/permission.js';
import { paginationSchema, offset } from '../../core/pagination.js';
import { buildInsert, buildUpdate, pick } from '../shared/sql.js';

const schema = z.object({
  codigo: z.string().max(50).nullable().optional(),
  nombre: z.string().trim().min(2).max(120),
  id_tipo_grupo: z.string().uuid(),
  id_categoria_animal: z.string().uuid(),
  id_especie: z.string().uuid().nullable().optional(),
  descripcion: z.string().max(300).nullable().optional(),
  capacidad: z.number().int().positive().nullable().optional(),
  activo: z.boolean().optional(),
});

const columns = ['codigo', 'nombre', 'id_tipo_grupo', 'id_categoria_animal', 'id_especie', 'descripcion', 'capacidad', 'activo'] as const;

export const groupsRouter = Router();

groupsRouter.get('/', requirePermission('GRUPO_CONSULTAR'), asyncHandler(async (req, res) => {
  const pagination = paginationSchema.parse(req.query);
  const categoryId = typeof req.query.id_categoria_animal === 'string' ? req.query.id_categoria_animal : null;
  const params: unknown[] = [pagination.limit, offset(pagination.page, pagination.limit)];
  const filters = ['g.deleted_at IS NULL'];

  if (pagination.q) {
    params.push(`%${pagination.q}%`);
    filters.push(`(g.nombre ILIKE $${params.length} OR g.codigo ILIKE $${params.length})`);
  }
  if (categoryId) {
    params.push(categoryId);
    filters.push(`g.id_categoria_animal=$${params.length}`);
  }

  const result = await pool.query(
    `SELECT g.*,tg.nombre tipo_grupo,e.nombre especie,ca.nombre categoria,ca.codigo categoria_codigo,
       (SELECT COUNT(*)::int FROM animal a
        WHERE a.id_grupo_actual=g.id_grupo AND a.deleted_at IS NULL AND a.estado='ACTIVO') total_animales,
       COUNT(*) OVER()::int total
     FROM grupo g
     JOIN tipo_grupo tg ON tg.id_tipo_grupo=g.id_tipo_grupo
     JOIN categoria_animal ca ON ca.id_categoria_animal=g.id_categoria_animal
     LEFT JOIN especie e ON e.id_especie=g.id_especie
     WHERE ${filters.join(' AND ')}
     ORDER BY g.activo DESC,ca.nombre,g.nombre
     LIMIT $1 OFFSET $2`,
    params,
  );
  return ok(res, result.rows, { page: pagination.page, limit: pagination.limit, total: result.rows[0]?.total ?? 0 });
}));

groupsRouter.post('/', requirePermission('GRUPO_ADMINISTRAR'), asyncHandler(async (req, res) => {
  return created(res, (await pool.query(buildInsert('grupo', schema.parse(req.body)))).rows[0]);
}));

groupsRouter.patch('/:id', requirePermission('GRUPO_ADMINISTRAR'), asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, 'id');
  const data = schema.partial().parse(req.body);
  if (data.id_categoria_animal) {
    const incompatible = await pool.query(
      `SELECT 1 FROM animal
       WHERE id_grupo_actual=$1 AND id_categoria_animal<>$2 AND deleted_at IS NULL
       LIMIT 1`,
      [id, data.id_categoria_animal],
    );
    if (incompatible.rowCount) {
      throw new ConflictError('No puede cambiar la situación del grupo mientras contenga animales de otra categoría. Trasládelos primero.');
    }
  }
  const row = (await pool.query(buildUpdate('grupo', 'id_grupo', id, pick(data, columns)))).rows[0];
  if (!row) throw new NotFoundError();
  return ok(res, row);
}));

groupsRouter.delete('/:id', requirePermission('GRUPO_ADMINISTRAR'), asyncHandler(async (req, res) => {
  const result = await pool.query(
    'UPDATE grupo SET deleted_at=NOW(),activo=FALSE WHERE id_grupo=$1 AND deleted_at IS NULL',
    [routeParam(req.params.id, 'id')],
  );
  if (!result.rowCount) throw new NotFoundError();
  return noContent(res);
}));
