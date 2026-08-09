import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, noContent, ok } from '../../core/http.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { requirePermission } from '../../middleware/permission.js';
import { paginationSchema, offset } from '../../core/pagination.js';
import { buildInsert, buildUpdate, pick } from '../shared/sql.js';
const schema = z.object({
    codigo: z.string().max(50).nullable().optional(),
    nombre: z.string().trim().min(2).max(120),
    id_tipo_grupo: z.string().uuid(),
    id_propiedad: z.string().uuid(),
    id_ubicacion_actual: z.string().uuid().nullable().optional(),
    id_especie: z.string().uuid().nullable().optional(),
    descripcion: z.string().max(300).nullable().optional(),
    capacidad: z.number().int().positive().nullable().optional(),
    activo: z.boolean().optional(),
});
const columns = ['codigo', 'nombre', 'id_tipo_grupo', 'id_propiedad', 'id_ubicacion_actual', 'id_especie', 'descripcion', 'capacidad', 'activo'];
async function validateGroupLocation(propertyId, locationId, allowLegacy = false) {
    if (!locationId)
        throw new ValidationError('Seleccione el potrero, corral o propiedad donde permanece el grupo.');
    const location = (await pool.query(`SELECT id_propiedad,tipo FROM ubicacion
     WHERE id_ubicacion=$1 AND deleted_at IS NULL AND activo=TRUE`, [locationId])).rows[0];
    if (!location)
        throw new ValidationError('La ubicación seleccionada no está disponible.');
    if (location.id_propiedad !== propertyId) {
        throw new ValidationError('El potrero o corral del grupo debe pertenecer a la propiedad seleccionada.');
    }
    if (!allowLegacy && !['POTRERO', 'CORRAL'].includes(location.tipo)) {
        throw new ValidationError('Seleccione un potrero o corral de la propiedad.');
    }
}
export const groupsRouter = Router();
groupsRouter.get('/', requirePermission('GRUPO_CONSULTAR'), asyncHandler(async (req, res) => {
    const pagination = paginationSchema.parse(req.query);
    const propertyId = typeof req.query.id_propiedad === 'string' ? req.query.id_propiedad : null;
    const params = [pagination.limit, offset(pagination.page, pagination.limit)];
    const filters = ['g.deleted_at IS NULL'];
    if (pagination.q) {
        params.push(`%${pagination.q}%`);
        filters.push(`(g.nombre ILIKE $${params.length} OR g.codigo ILIKE $${params.length})`);
    }
    if (propertyId) {
        params.push(propertyId);
        filters.push(`g.id_propiedad=$${params.length}`);
    }
    const result = await pool.query(`SELECT g.*,tg.nombre tipo_grupo,e.nombre especie,ca.nombre categoria,ca.codigo categoria_codigo,
       pg.nombre propiedad,pg.es_principal propiedad_principal,
       u.nombre ubicacion,u.tipo ubicacion_tipo,
       (SELECT COUNT(*)::int FROM animal a
        WHERE a.id_grupo_actual=g.id_grupo AND a.deleted_at IS NULL AND a.estado='ACTIVO') total_animales,
       COUNT(*) OVER()::int total
     FROM grupo g
     JOIN tipo_grupo tg ON tg.id_tipo_grupo=g.id_tipo_grupo
     JOIN categoria_animal ca ON ca.id_categoria_animal=g.id_categoria_animal
     JOIN propiedad_ganadera pg ON pg.id_propiedad=g.id_propiedad
     LEFT JOIN ubicacion u ON u.id_ubicacion=g.id_ubicacion_actual
     LEFT JOIN especie e ON e.id_especie=g.id_especie
     WHERE ${filters.join(' AND ')}
     ORDER BY g.activo DESC,pg.es_principal DESC,pg.nombre,g.nombre
     LIMIT $1 OFFSET $2`, params);
    return ok(res, result.rows, { page: pagination.page, limit: pagination.limit, total: result.rows[0]?.total ?? 0 });
}));
groupsRouter.post('/', requirePermission('GRUPO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const data = schema.parse(req.body);
    await validateGroupLocation(data.id_propiedad, data.id_ubicacion_actual);
    return created(res, (await pool.query(buildInsert('grupo', data))).rows[0]);
}));
groupsRouter.patch('/:id', requirePermission('GRUPO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, 'id');
    const data = schema.partial().parse(req.body);
    const current = (await pool.query(`SELECT id_propiedad,id_ubicacion_actual FROM grupo
     WHERE id_grupo=$1 AND deleted_at IS NULL`, [id])).rows[0];
    if (!current)
        throw new NotFoundError();
    const nextProperty = data.id_propiedad ?? current.id_propiedad;
    const nextLocation = data.id_ubicacion_actual === undefined ? current.id_ubicacion_actual : data.id_ubicacion_actual;
    await validateGroupLocation(nextProperty, nextLocation, nextLocation === current.id_ubicacion_actual);
    if (nextLocation !== current.id_ubicacion_actual || nextProperty !== current.id_propiedad) {
        const members = await pool.query(`SELECT 1 FROM animal WHERE id_grupo_actual=$1 AND estado='ACTIVO' AND deleted_at IS NULL LIMIT 1`, [id]);
        if (members.rowCount)
            throw new ConflictError('Un grupo con animales solo puede cambiar de potrero o corral mediante un movimiento del grupo completo.');
    }
    const row = (await pool.query(buildUpdate('grupo', 'id_grupo', id, pick(data, columns)))).rows[0];
    if (!row)
        throw new NotFoundError();
    return ok(res, row);
}));
groupsRouter.delete('/:id', requirePermission('GRUPO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const result = await pool.query('UPDATE grupo SET deleted_at=NOW(),activo=FALSE WHERE id_grupo=$1 AND deleted_at IS NULL', [routeParam(req.params.id, 'id')]);
    if (!result.rowCount)
        throw new NotFoundError();
    return noContent(res);
}));
//# sourceMappingURL=groups.routes.js.map