import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, noContent, ok } from '../../core/http.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { requirePermission } from '../../middleware/permission.js';
import { buildInsert } from '../shared/sql.js';
import { notifyHealthCondition } from '../notifications/business-notifications.service.js';
const schema = z.object({
    id_animal: z.string().uuid(),
    id_tipo_condicion_salud: z.string().uuid().nullable().optional(),
    fecha_deteccion: z.string().date(),
    descripcion: z.string().trim().min(1).max(2000),
});
async function assertReferences(database, animalId, typeId) {
    const animal = await database.query("SELECT 1 FROM animal WHERE id_animal=$1 AND estado='ACTIVO' AND deleted_at IS NULL", [animalId]);
    if (!animal.rowCount)
        throw new ValidationError('El animal no está activo o disponible.');
    if (typeId) {
        const type = await database.query('SELECT 1 FROM tipo_condicion_salud WHERE id_tipo_condicion_salud=$1 AND activo=TRUE AND deleted_at IS NULL', [typeId]);
        if (!type.rowCount)
            throw new ValidationError('El tipo de condición no está disponible.');
    }
}
export const healthRouter = Router();
healthRouter.get('/', requirePermission('SANIDAD_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, (await pool.query(`SELECT c.*,a.nombre animal,a.codigo_arete,ca.codigo categoria_codigo,ca.nombre categoria,t.nombre tipo_condicion,
    COUNT(tr.id_tratamiento)::int total_tratamientos
   FROM condicion_salud c
   JOIN animal a ON a.id_animal=c.id_animal
   JOIN categoria_animal ca ON ca.id_categoria_animal=a.id_categoria_animal
   LEFT JOIN tipo_condicion_salud t ON t.id_tipo_condicion_salud=c.id_tipo_condicion_salud
   LEFT JOIN tratamiento_animal tr ON tr.id_condicion_salud=c.id_condicion_salud AND tr.deleted_at IS NULL
   WHERE c.deleted_at IS NULL
   GROUP BY c.id_condicion_salud,a.nombre,a.codigo_arete,ca.codigo,ca.nombre,t.nombre
   ORDER BY CASE c.estado WHEN 'POR_RESOLVER' THEN 1 WHEN 'EN_TRATAMIENTO' THEN 2 ELSE 3 END,c.fecha_deteccion DESC`)).rows)));
healthRouter.post('/', requirePermission('SANIDAD_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const input = schema.parse(req.body);
    const row = await transaction(async (client) => {
        await assertReferences(client, input.id_animal, input.id_tipo_condicion_salud);
        const saved = (await client.query(buildInsert('condicion_salud', {
            ...input, id_tipo_condicion_salud: input.id_tipo_condicion_salud ?? null, estado: 'POR_RESOLVER', registrado_por: req.user.id,
        }))).rows[0];
        await notifyHealthCondition(client, saved, req.user.id);
        return saved;
    }, req.user.id);
    return created(res, row);
}));
healthRouter.patch('/:id', requirePermission('SANIDAD_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, 'id');
    const input = schema.parse(req.body);
    const row = await transaction(async (client) => {
        await assertReferences(client, input.id_animal, input.id_tipo_condicion_salud);
        const current = (await client.query(`SELECT c.id_animal,c.estado,EXISTS(
         SELECT 1 FROM tratamiento_animal t
         WHERE t.id_condicion_salud=c.id_condicion_salud AND t.deleted_at IS NULL
       ) tiene_tratamientos
       FROM condicion_salud c WHERE c.id_condicion_salud=$1 AND c.deleted_at IS NULL FOR UPDATE`, [id])).rows[0];
        if (!current || current.estado === 'RESUELTA')
            throw new NotFoundError('Condición no encontrada o ya resuelta.');
        if (current.tiene_tratamientos && current.id_animal !== input.id_animal) {
            throw new ValidationError('No se puede cambiar el animal de una condición que ya tiene tratamientos relacionados.');
        }
        return (await client.query(`UPDATE condicion_salud SET id_animal=$2,id_tipo_condicion_salud=$3,fecha_deteccion=$4,descripcion=$5,updated_at=NOW()
       WHERE id_condicion_salud=$1 RETURNING *`, [id, input.id_animal, input.id_tipo_condicion_salud ?? null, input.fecha_deteccion, input.descripcion])).rows[0];
    }, req.user.id);
    return ok(res, row);
}));
healthRouter.patch('/:id/resolver', requirePermission('SANIDAD_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const input = z.object({ fecha_resolucion: z.string().date() }).parse(req.body);
    const row = await transaction(async (client) => {
        const saved = (await client.query(`UPDATE condicion_salud SET estado='RESUELTA',fecha_resolucion=$2,updated_at=NOW()
       WHERE id_condicion_salud=$1 AND deleted_at IS NULL AND estado<>'RESUELTA' AND $2::date>=fecha_deteccion RETURNING *`, [routeParam(req.params.id, 'id'), input.fecha_resolucion])).rows[0];
        if (!saved)
            throw new ValidationError('La fecha de resolución debe ser posterior a la detección.');
        await notifyHealthCondition(client, saved, req.user.id, true);
        return saved;
    }, req.user.id);
    return ok(res, row);
}));
healthRouter.delete('/:id', requirePermission('SANIDAD_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const result = await pool.query(`UPDATE condicion_salud SET deleted_at=NOW(),updated_at=NOW()
     WHERE id_condicion_salud=$1 AND deleted_at IS NULL AND NOT EXISTS(
       SELECT 1 FROM tratamiento_animal t WHERE t.id_condicion_salud=condicion_salud.id_condicion_salud AND t.deleted_at IS NULL
     )`, [routeParam(req.params.id, 'id')]);
    if (!result.rowCount)
        throw new ValidationError('No se puede eliminar una condición que ya tiene tratamientos relacionados.');
    return noContent(res);
}));
//# sourceMappingURL=health.routes.js.map