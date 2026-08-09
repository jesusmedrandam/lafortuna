import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, noContent, ok } from '../../core/http.js';
import { NotFoundError } from '../../core/errors.js';
import { requirePermission } from '../../middleware/permission.js';
import { paginationSchema, offset } from '../../core/pagination.js';
import { buildInsert, buildUpdate, pick } from '../shared/sql.js';
const schema = z.object({ codigo: z.string().max(50).nullable().optional(), nombre: z.string().trim().min(2).max(120), id_tipo_grupo: z.string().uuid(), id_especie: z.string().uuid().nullable().optional(), descripcion: z.string().max(300).nullable().optional(), capacidad: z.number().int().positive().nullable().optional(), activo: z.boolean().optional() });
const columns = ['codigo', 'nombre', 'id_tipo_grupo', 'id_especie', 'descripcion', 'capacidad', 'activo'];
export const groupsRouter = Router();
groupsRouter.get('/', requirePermission('GRUPO_CONSULTAR'), asyncHandler(async (req, res) => { const p = paginationSchema.parse(req.query); const params = [p.limit, offset(p.page, p.limit)]; let filter = 'g.deleted_at IS NULL'; if (p.q) {
    params.push(`%${p.q}%`);
    filter += ` AND (g.nombre ILIKE $3 OR g.codigo ILIKE $3)`;
} const result = await pool.query(`SELECT g.*,tg.nombre tipo_grupo,e.nombre especie,(SELECT COUNT(*)::int FROM animal a WHERE a.id_grupo_actual=g.id_grupo AND a.deleted_at IS NULL AND a.estado='ACTIVO') total_animales,COUNT(*) OVER()::int total FROM grupo g JOIN tipo_grupo tg ON tg.id_tipo_grupo=g.id_tipo_grupo LEFT JOIN especie e ON e.id_especie=g.id_especie WHERE ${filter} ORDER BY g.activo DESC,g.nombre LIMIT $1 OFFSET $2`, params); return ok(res, result.rows, { page: p.page, limit: p.limit, total: result.rows[0]?.total ?? 0 }); }));
groupsRouter.post('/', requirePermission('GRUPO_ADMINISTRAR'), asyncHandler(async (req, res) => created(res, (await pool.query(buildInsert('grupo', schema.parse(req.body)))).rows[0])));
groupsRouter.patch('/:id', requirePermission('GRUPO_ADMINISTRAR'), asyncHandler(async (req, res) => { const data = schema.partial().parse(req.body); const row = (await pool.query(buildUpdate('grupo', 'id_grupo', routeParam(req.params.id, 'id'), pick(data, columns)))).rows[0]; if (!row)
    throw new NotFoundError(); return ok(res, row); }));
groupsRouter.delete('/:id', requirePermission('GRUPO_ADMINISTRAR'), asyncHandler(async (req, res) => { const r = await pool.query('UPDATE grupo SET deleted_at=NOW(),activo=FALSE WHERE id_grupo=$1 AND deleted_at IS NULL', [routeParam(req.params.id, 'id')]); if (!r.rowCount)
    throw new NotFoundError(); return noContent(res); }));
//# sourceMappingURL=groups.routes.js.map