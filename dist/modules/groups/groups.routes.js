import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, noContent, ok } from '../../core/http.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { requirePermission } from '../../middleware/permission.js';
import { paginationSchema, offset } from '../../core/pagination.js';
import { buildInsert, buildUpdate, pick } from '../shared/sql.js';
const schema = z.object({
    codigo: z.string().trim().max(50).nullable().optional(),
    nombre: z.string().trim().min(2).max(120),
    id_tipo_grupo: z.string().uuid(),
    id_categoria_animal: z.string().uuid(),
    id_propiedad: z.string().uuid().optional(),
    id_ubicacion_actual: z.string().uuid().nullable().optional(),
    id_especie: z.string().uuid().nullable().optional(),
    descripcion: z.string().max(300).nullable().optional(),
    capacidad: z.number().int().positive().nullable().optional(),
    activo: z.boolean().optional(),
});
const columns = ['codigo', 'nombre', 'id_tipo_grupo', 'id_categoria_animal', 'id_propiedad', 'id_ubicacion_actual', 'id_especie', 'descripcion', 'capacidad', 'activo'];
async function validateGroupLocation(database, locationId) {
    if (!locationId)
        throw new ValidationError('Seleccione el potrero, corral o propiedad donde permanece el grupo.');
    const location = (await database.query(`SELECT u.id_propiedad,
       CASE WHEN p.es_principal
         THEN '00000000-0000-4000-8000-000000000101'::uuid
         ELSE '00000000-0000-4000-8000-000000000102'::uuid END id_categoria_animal
     FROM ubicacion u
     JOIN propiedad_ganadera p ON p.id_propiedad=u.id_propiedad
     WHERE u.id_ubicacion=$1 AND u.deleted_at IS NULL AND u.activo=TRUE
       AND p.deleted_at IS NULL AND p.activa=TRUE`, [locationId])).rows[0];
    if (!location)
        throw new ValidationError('La ubicación seleccionada no está disponible.');
    return location;
}
function groupCodeBase(name) {
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 50) || 'GRUPO';
}
async function completeGroupCode(database, code, name, propertyId, excludeId) {
    const explicit = code?.trim();
    if (explicit)
        return explicit;
    const base = groupCodeBase(name);
    for (let attempt = 1; attempt <= 999; attempt += 1) {
        const suffix = attempt === 1 ? '' : `_${attempt}`;
        const candidate = `${base.slice(0, 50 - suffix.length)}${suffix}`;
        const existing = await database.query(`SELECT 1 FROM grupo
       WHERE UPPER(codigo)=UPPER($1)
         AND id_propiedad=$2
         AND ($3::uuid IS NULL OR id_grupo<>$3)
         AND deleted_at IS NULL
       LIMIT 1`, [candidate, propertyId, excludeId ?? null]);
        if (!existing.rowCount)
            return candidate;
    }
    throw new ConflictError('No fue posible generar un código único para el grupo. Ingrese uno manualmente.');
}
export const groupsRouter = Router();
groupsRouter.get('/', requirePermission('GRUPO_CONSULTAR'), asyncHandler(async (req, res) => {
    const pagination = paginationSchema.parse(req.query);
    const categoryId = typeof req.query.id_categoria_animal === 'string' ? req.query.id_categoria_animal : null;
    const params = [pagination.limit, offset(pagination.page, pagination.limit)];
    const filters = ['g.deleted_at IS NULL'];
    if (pagination.q) {
        params.push(`%${pagination.q}%`);
        filters.push(`(g.nombre ILIKE $${params.length} OR g.codigo ILIKE $${params.length})`);
    }
    if (categoryId) {
        params.push(categoryId);
        filters.push(`g.id_categoria_animal=$${params.length}`);
    }
    const result = await pool.query(`SELECT g.*,tg.nombre tipo_grupo,e.nombre especie,ca.nombre categoria,ca.codigo categoria_codigo,
       u.nombre ubicacion,u.tipo ubicacion_tipo,
       propiedad.nombre propiedad,propiedad.es_principal propiedad_es_principal,
       (SELECT COUNT(*)::int FROM animal ac
        WHERE ac.id_grupo_actual=g.id_grupo AND ac.deleted_at IS NULL AND ac.estado='ACTIVO') total_animales,
       (SELECT COUNT(*)::int FROM animal a
        WHERE a.id_grupo_actual=g.id_grupo AND a.deleted_at IS NULL AND a.estado='ACTIVO') total_animales,
       COUNT(*) OVER()::int total
     FROM grupo g
     JOIN tipo_grupo tg ON tg.id_tipo_grupo=g.id_tipo_grupo
     JOIN categoria_animal ca ON ca.id_categoria_animal=g.id_categoria_animal
     LEFT JOIN ubicacion u ON u.id_ubicacion=g.id_ubicacion_actual
     JOIN propiedad_ganadera propiedad ON propiedad.id_propiedad=g.id_propiedad AND propiedad.deleted_at IS NULL
     LEFT JOIN especie e ON e.id_especie=g.id_especie
     WHERE ${filters.join(' AND ')}
     ORDER BY g.activo DESC,ca.nombre,g.nombre
     LIMIT $1 OFFSET $2`, params);
    return ok(res, result.rows, { page: pagination.page, limit: pagination.limit, total: result.rows[0]?.total ?? 0 });
}));
groupsRouter.get('/:id', requirePermission('GRUPO_CONSULTAR'), asyncHandler(async (req, res) => {
    const row = (await pool.query(`SELECT g.*,tg.nombre tipo_grupo,e.nombre especie,ca.nombre categoria,ca.codigo categoria_codigo,
       u.nombre ubicacion,u.tipo ubicacion_tipo,
       propiedad.nombre propiedad,propiedad.es_principal propiedad_es_principal,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'id_animal',a.id_animal,'nombre',a.nombre,'codigo_arete',a.codigo_arete,
         'sexo',a.sexo,'estado',a.estado
       ) ORDER BY a.nombre)
       FROM animal a
       WHERE a.id_grupo_actual=g.id_grupo AND a.deleted_at IS NULL AND a.estado='ACTIVO'),'[]'::jsonb) animales,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'id_movimiento',m.id_movimiento,'fecha',m.fecha_movimiento,'estado',m.estado,
         'tipo_movimiento',m.tipo_movimiento,'motivo',COALESCE(mm.nombre,m.motivo),
         'ubicacion_origen',uo.nombre,'ubicacion_destino',ud.nombre,
         'grupo_origen',go.nombre,'grupo_destino',gd.nombre,
         'total_animales',(SELECT COUNT(*)::int FROM movimiento_animal_detalle md
           WHERE md.id_movimiento=m.id_movimiento AND md.seleccionado=TRUE AND md.deleted_at IS NULL)
       ) ORDER BY m.fecha_movimiento DESC,m.created_at DESC)
       FROM movimiento_animal m
       LEFT JOIN motivo_movimiento mm ON mm.id_motivo_movimiento=m.id_motivo_movimiento
       LEFT JOIN ubicacion uo ON uo.id_ubicacion=m.id_ubicacion_origen
       LEFT JOIN ubicacion ud ON ud.id_ubicacion=m.id_ubicacion_destino
       LEFT JOIN grupo go ON go.id_grupo=m.id_grupo_origen
       LEFT JOIN grupo gd ON gd.id_grupo=m.id_grupo_destino
       WHERE m.deleted_at IS NULL AND (
         m.id_grupo_filtro=g.id_grupo OR m.id_grupo_origen=g.id_grupo OR m.id_grupo_destino=g.id_grupo
         OR EXISTS(SELECT 1 FROM movimiento_animal_detalle md2
           WHERE md2.id_movimiento=m.id_movimiento AND md2.deleted_at IS NULL
             AND (md2.id_grupo_anterior=g.id_grupo OR md2.id_grupo_destino=g.id_grupo))
       )),'[]'::jsonb) historial_movimientos
     FROM grupo g
     JOIN tipo_grupo tg ON tg.id_tipo_grupo=g.id_tipo_grupo
     JOIN categoria_animal ca ON ca.id_categoria_animal=g.id_categoria_animal
     LEFT JOIN ubicacion u ON u.id_ubicacion=g.id_ubicacion_actual
     JOIN propiedad_ganadera propiedad ON propiedad.id_propiedad=g.id_propiedad
     LEFT JOIN especie e ON e.id_especie=g.id_especie
     WHERE g.id_grupo=$1 AND g.deleted_at IS NULL`, [routeParam(req.params.id, 'id')])).rows[0];
    if (!row)
        throw new NotFoundError('Grupo no encontrado.');
    return ok(res, row);
}));
groupsRouter.post('/', requirePermission('GRUPO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const data = schema.parse(req.body);
    const row = await transaction(async (client) => {
        const placement = await validateGroupLocation(client, data.id_ubicacion_actual);
        const codigo = await completeGroupCode(client, data.codigo, data.nombre, placement.id_propiedad);
        return (await client.query(buildInsert('grupo', { ...data, codigo, id_propiedad: placement.id_propiedad, id_categoria_animal: placement.id_categoria_animal }))).rows[0];
    }, req.user.id);
    return created(res, row);
}));
groupsRouter.patch('/:id', requirePermission('GRUPO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, 'id');
    const data = schema.partial().parse(req.body);
    const current = (await pool.query(`SELECT id_categoria_animal,id_propiedad,id_ubicacion_actual FROM grupo
     WHERE id_grupo=$1 AND deleted_at IS NULL`, [id])).rows[0];
    if (!current)
        throw new NotFoundError();
    const nextLocation = data.id_ubicacion_actual === undefined ? current.id_ubicacion_actual : data.id_ubicacion_actual;
    const placement = await validateGroupLocation(pool, nextLocation);
    if (nextLocation !== current.id_ubicacion_actual) {
        const members = await pool.query(`SELECT 1 FROM animal WHERE id_grupo_actual=$1 AND estado='ACTIVO' AND deleted_at IS NULL LIMIT 1`, [id]);
        if (members.rowCount)
            throw new ConflictError('Un grupo con animales debe cambiar de potrero, corral o propiedad mediante un movimiento de grupo completo.');
    }
    if (placement.id_categoria_animal !== current.id_categoria_animal) {
        const incompatible = await pool.query(`SELECT 1 FROM animal
       WHERE id_grupo_actual=$1 AND id_categoria_animal<>$2 AND deleted_at IS NULL
       LIMIT 1`, [id, placement.id_categoria_animal]);
        if (incompatible.rowCount) {
            throw new ConflictError('No puede cambiar la situación del grupo mientras contenga animales de otra categoría. Trasládelos primero.');
        }
    }
    const row = (await pool.query(buildUpdate('grupo', 'id_grupo', id, pick({ ...data, id_propiedad: placement.id_propiedad, id_categoria_animal: placement.id_categoria_animal }, columns)))).rows[0];
    if (!row)
        throw new NotFoundError();
    return ok(res, row);
}));
groupsRouter.delete('/:id', requirePermission('GRUPO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, 'id');
    await transaction(async (client) => {
        const group = await client.query('SELECT id_grupo FROM grupo WHERE id_grupo=$1 AND deleted_at IS NULL FOR UPDATE', [id]);
        if (!group.rowCount)
            throw new NotFoundError();
        const members = await client.query(`SELECT 1 FROM animal
       WHERE id_grupo_actual=$1 AND estado='ACTIVO' AND deleted_at IS NULL LIMIT 1`, [id]);
        if (members.rowCount)
            throw new ConflictError('No puede eliminar un grupo que todavía contiene animales activos. Trasládelos primero.');
        await client.query('UPDATE grupo SET deleted_at=NOW(),activo=FALSE WHERE id_grupo=$1', [id]);
    }, req.user.id);
    return noContent(res);
}));
//# sourceMappingURL=groups.routes.js.map