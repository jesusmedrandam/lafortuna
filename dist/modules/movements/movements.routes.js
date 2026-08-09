import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, ok } from '../../core/http.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { requirePermission } from '../../middleware/permission.js';
import { assertAnimalOperationAllowed } from '../../services/animal-operation-policy.js';
import { buildInsert } from '../shared/sql.js';
const movementKind = z.enum(['UBICACION', 'GRUPO', 'PROPIEDAD', 'COMBINADO']);
const movementAnimal = z.object({
    id_animal: z.string().uuid(),
    seleccionado: z.boolean().default(true),
    id_ubicacion_destino: z.string().uuid().nullable().optional(),
    id_grupo_destino: z.string().uuid().nullable().optional(),
    observaciones: z.string().max(300).nullable().optional(),
});
const movement = z.object({
    tipo_movimiento: movementKind,
    modo_seleccion: z.enum(['TODOS', 'GRUPO', 'SELECCION_MANUAL']),
    id_grupo_filtro: z.string().uuid().nullable().optional(),
    id_ubicacion_origen: z.string().uuid().nullable().optional(),
    id_ubicacion_destino: z.string().uuid().nullable().optional(),
    id_grupo_origen: z.string().uuid().nullable().optional(),
    id_grupo_destino: z.string().uuid().nullable().optional(),
    id_motivo_movimiento: z.string().uuid(),
    fecha_movimiento: z.string().date(),
    motivo: z.string().max(300).nullable().optional(),
    observaciones: z.string().nullable().optional(),
    animales: z.array(movementAnimal).min(1),
});
async function movementReason(database, id) {
    const reason = (await database.query(`SELECT id_motivo_movimiento,nombre FROM motivo_movimiento
     WHERE id_motivo_movimiento=$1 AND deleted_at IS NULL`, [id])).rows[0];
    if (!reason)
        throw new ValidationError('El motivo de movimiento seleccionado no está disponible.');
    return reason;
}
async function validateMovementSelection(database, input) {
    const selected = input.animales.filter((item) => item.seleccionado);
    if (!selected.length)
        throw new ValidationError('Seleccione al menos un animal.');
    if (!input.id_grupo_destino)
        throw new ValidationError('Seleccione el grupo de destino.');
    const group = (await database.query(`SELECT id_grupo,id_categoria_animal,id_ubicacion_actual
     FROM grupo WHERE id_grupo=$1 AND deleted_at IS NULL AND activo=TRUE`, [input.id_grupo_destino])).rows[0];
    if (!group)
        throw new ValidationError('El grupo de destino no está disponible.');
    const effectiveLocationId = input.id_ubicacion_destino ?? group.id_ubicacion_actual;
    if (!effectiveLocationId)
        throw new ValidationError('Seleccione la ubicación de destino del grupo.');
    const location = (await database.query(`SELECT u.tipo,u.id_categoria_animal,ca.codigo categoria_codigo
     FROM ubicacion u JOIN categoria_animal ca ON ca.id_categoria_animal=u.id_categoria_animal
     WHERE u.id_ubicacion=$1 AND u.deleted_at IS NULL AND u.activo=TRUE`, [effectiveLocationId])).rows[0];
    if (!location)
        throw new ValidationError('La ubicación de destino no está disponible.');
    if (location.id_categoria_animal !== group.id_categoria_animal) {
        throw new ValidationError('El grupo de destino debe pertenecer a la misma situación de propiedad que la ubicación.');
    }
    if (input.tipo_movimiento === 'UBICACION' && location.tipo === 'OTRO') {
        throw new ValidationError('Para una propiedad externa utilice el traslado entre propiedades.');
    }
    const animalIds = selected.map((item) => item.id_animal);
    const currentAnimals = (await database.query(`SELECT id_animal,id_categoria_animal,id_grupo_actual,id_ubicacion_actual
     FROM animal WHERE id_animal=ANY($1::uuid[]) AND deleted_at IS NULL AND estado='ACTIVO' FOR SHARE`, [animalIds])).rows;
    if (currentAnimals.length !== animalIds.length)
        throw new ValidationError('Uno o más animales ya no están activos o disponibles.');
    let relocateGroupId = null;
    const movesTheSelectedGroup = input.modo_seleccion === 'GRUPO'
        && Boolean(input.id_grupo_filtro)
        && input.id_grupo_filtro === input.id_grupo_destino
        && group.id_ubicacion_actual !== effectiveLocationId;
    if (movesTheSelectedGroup) {
        const groupMembers = (await database.query(`SELECT id_animal FROM animal
       WHERE id_grupo_actual=$1 AND estado='ACTIVO' AND deleted_at IS NULL FOR SHARE`, [input.id_grupo_destino])).rows;
        const selectedIds = new Set(animalIds);
        if (groupMembers.length !== selectedIds.size || groupMembers.some((item) => !selectedIds.has(item.id_animal))) {
            throw new ValidationError('Para cambiar la ubicación fija del grupo debe incluir todos sus animales activos.');
        }
        relocateGroupId = group.id_grupo;
    }
    else if (group.id_ubicacion_actual !== effectiveLocationId) {
        throw new ValidationError('El grupo de destino pertenece a otra ubicación. Seleccione un grupo de la ubicación elegida.');
    }
    const operations = input.tipo_movimiento === 'UBICACION'
        ? ['MOVIMIENTO_UBICACION', 'MOVIMIENTO_GRUPO']
        : input.tipo_movimiento === 'GRUPO'
            ? ['MOVIMIENTO_GRUPO']
            : input.tipo_movimiento === 'PROPIEDAD'
                ? ['MOVIMIENTO_PROPIEDAD', 'MOVIMIENTO_GRUPO']
                : [location?.tipo === 'OTRO' ? 'MOVIMIENTO_PROPIEDAD' : 'MOVIMIENTO_UBICACION', 'MOVIMIENTO_GRUPO'];
    for (const animal of selected) {
        for (const operation of operations)
            await assertAnimalOperationAllowed(database, animal.id_animal, operation);
        const current = currentAnimals.find((item) => item.id_animal === animal.id_animal);
        if (current.id_categoria_animal !== group.id_categoria_animal && input.tipo_movimiento !== 'PROPIEDAD') {
            throw new ValidationError('El grupo de destino debe tener la misma situación de propiedad que el animal.');
        }
        if (current.id_categoria_animal !== group.id_categoria_animal && location.categoria_codigo === 'EN_PROPIEDAD') {
            throw new ValidationError('Un animal de fuera de la propiedad no puede trasladarse a un grupo interno.');
        }
        if (input.tipo_movimiento === 'GRUPO' && current.id_ubicacion_actual !== effectiveLocationId) {
            throw new ValidationError('El cambio de grupo solo puede hacerse entre grupos de la misma ubicación.');
        }
        if (input.tipo_movimiento === 'PROPIEDAD' && current.id_ubicacion_actual === effectiveLocationId) {
            throw new ValidationError('No puede trasladar un animal desde y hacia la misma propiedad.');
        }
    }
    return { effectiveLocationId, relocateGroupId };
}
async function loadMovementForValidation(database, id) {
    const head = (await database.query('SELECT * FROM movimiento_animal WHERE id_movimiento=$1 AND deleted_at IS NULL', [id])).rows[0];
    if (!head)
        throw new NotFoundError('Movimiento no encontrado.');
    const animals = (await database.query(`SELECT id_animal,seleccionado,id_ubicacion_destino,id_grupo_destino,observaciones
     FROM movimiento_animal_detalle WHERE id_movimiento=$1 AND deleted_at IS NULL`, [id])).rows;
    return movement.parse({ ...head, fecha_movimiento: String(head.fecha_movimiento).slice(0, 10), animales: animals });
}
export const movementsRouter = Router();
movementsRouter.get('/', requirePermission('MOVIMIENTO_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, (await pool.query(`SELECT m.*,COALESCE(mm.nombre,m.motivo) motivo_catalogo,
    u1.nombre ubicacion_origen,u2.nombre ubicacion_destino,g1.nombre grupo_origen,g2.nombre grupo_destino,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id_detalle',d.id_movimiento_detalle,'id_animal',a.id_animal,'animal',a.nombre,'nombre',a.nombre,
      'arete',a.codigo_arete,'codigo_arete',a.codigo_arete,'sexo',a.sexo,
      'id_categoria_animal',a.id_categoria_animal,'categoria',ca.nombre,
      'id_grupo_actual',a.id_grupo_actual,'grupo',ga.nombre,'id_ubicacion_actual',a.id_ubicacion_actual,'ubicacion',ua.nombre,
      'seleccionado',d.seleccionado,'estado',d.estado,'mensaje_error',d.mensaje_error,'observaciones',d.observaciones))
      FROM movimiento_animal_detalle d
      JOIN animal a ON a.id_animal=d.id_animal
      JOIN categoria_animal ca ON ca.id_categoria_animal=a.id_categoria_animal
      LEFT JOIN grupo ga ON ga.id_grupo=a.id_grupo_actual
      LEFT JOIN ubicacion ua ON ua.id_ubicacion=a.id_ubicacion_actual
      WHERE d.id_movimiento=m.id_movimiento AND d.deleted_at IS NULL),'[]') detalles
   FROM movimiento_animal m
   LEFT JOIN ubicacion u1 ON u1.id_ubicacion=m.id_ubicacion_origen
   LEFT JOIN ubicacion u2 ON u2.id_ubicacion=m.id_ubicacion_destino
   LEFT JOIN grupo g1 ON g1.id_grupo=m.id_grupo_origen
   LEFT JOIN grupo g2 ON g2.id_grupo=m.id_grupo_destino
   LEFT JOIN motivo_movimiento mm ON mm.id_motivo_movimiento=m.id_motivo_movimiento
   WHERE m.deleted_at IS NULL ORDER BY m.fecha_movimiento DESC`)).rows)));
movementsRouter.post('/', requirePermission('MOVIMIENTO_CREAR'), asyncHandler(async (req, res) => {
    const input = movement.parse(req.body);
    const result = await transaction(async (client) => {
        const validation = await validateMovementSelection(client, input);
        const reason = await movementReason(client, input.id_motivo_movimiento);
        const { animales, ...head } = input;
        const row = (await client.query(buildInsert('movimiento_animal', {
            ...head,
            id_ubicacion_destino: validation.effectiveLocationId,
            motivo: reason.nombre,
            estado: 'BORRADOR',
            total_candidatos: animales.length,
            total_seleccionados: animales.filter((animal) => animal.seleccionado).length,
            registrado_por: req.user.id,
        }))).rows[0];
        for (const animal of animales)
            await client.query(buildInsert('movimiento_animal_detalle', {
                ...animal,
                id_ubicacion_destino: validation.effectiveLocationId,
                id_grupo_destino: input.id_grupo_destino,
                id_movimiento: row.id_movimiento,
            }));
        return row;
    }, req.user.id);
    return created(res, result);
}));
movementsRouter.patch('/:id', requirePermission('MOVIMIENTO_CREAR'), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, 'id');
    const input = movement.omit({ animales: true }).partial().parse(req.body);
    const row = await transaction(async (client) => {
        const found = (await client.query('SELECT * FROM movimiento_animal WHERE id_movimiento=$1 AND deleted_at IS NULL FOR UPDATE', [id])).rows[0];
        if (!found)
            throw new NotFoundError('Movimiento no encontrado.');
        if (found.estado === 'CANCELADO')
            throw new ConflictError('Un movimiento cancelado no puede modificarse.');
        const nextReasonId = input.id_motivo_movimiento ?? found.id_motivo_movimiento;
        const reason = await movementReason(client, nextReasonId);
        if (found.estado === 'BORRADOR') {
            return (await client.query(`UPDATE movimiento_animal SET tipo_movimiento=$2,modo_seleccion=$3,id_grupo_filtro=$4,id_ubicacion_origen=$5,
          id_ubicacion_destino=$6,id_grupo_origen=$7,id_grupo_destino=$8,fecha_movimiento=$9,
          id_motivo_movimiento=$10,motivo=$11,observaciones=$12,updated_at=NOW()
         WHERE id_movimiento=$1 RETURNING *`, [id, input.tipo_movimiento ?? found.tipo_movimiento, input.modo_seleccion ?? found.modo_seleccion,
                input.id_grupo_filtro === undefined ? found.id_grupo_filtro : input.id_grupo_filtro,
                input.id_ubicacion_origen === undefined ? found.id_ubicacion_origen : input.id_ubicacion_origen,
                input.id_ubicacion_destino === undefined ? found.id_ubicacion_destino : input.id_ubicacion_destino,
                input.id_grupo_origen === undefined ? found.id_grupo_origen : input.id_grupo_origen,
                input.id_grupo_destino === undefined ? found.id_grupo_destino : input.id_grupo_destino,
                input.fecha_movimiento ?? found.fecha_movimiento, nextReasonId, reason.nombre,
                input.observaciones === undefined ? found.observaciones : input.observaciones])).rows[0];
        }
        return (await client.query(`UPDATE movimiento_animal SET fecha_movimiento=$2,id_motivo_movimiento=$3,motivo=$4,observaciones=$5,updated_at=NOW()
       WHERE id_movimiento=$1 RETURNING *`, [id, input.fecha_movimiento ?? found.fecha_movimiento, nextReasonId, reason.nombre,
            input.observaciones === undefined ? found.observaciones : input.observaciones])).rows[0];
    }, req.user.id);
    return ok(res, row);
}));
movementsRouter.put('/:id/seleccion', requirePermission('MOVIMIENTO_CREAR'), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, 'id');
    const items = z.array(movementAnimal).parse(req.body.animales);
    await transaction(async (client) => {
        const found = (await client.query('SELECT * FROM movimiento_animal WHERE id_movimiento=$1 AND deleted_at IS NULL FOR UPDATE', [id])).rows[0];
        if (!found)
            throw new NotFoundError();
        if (found.estado !== 'BORRADOR')
            throw new ConflictError('Solo puede editarse un movimiento en borrador.');
        const validation = await validateMovementSelection(client, movement.parse({ ...found, fecha_movimiento: String(found.fecha_movimiento).slice(0, 10), animales: items }));
        await client.query('DELETE FROM movimiento_animal_detalle WHERE id_movimiento=$1', [id]);
        for (const animal of items)
            await client.query(buildInsert('movimiento_animal_detalle', {
                ...animal,
                id_ubicacion_destino: validation.effectiveLocationId,
                id_grupo_destino: found.id_grupo_destino,
                id_movimiento: id,
            }));
        await client.query('UPDATE movimiento_animal SET id_ubicacion_destino=$2 WHERE id_movimiento=$1', [id, validation.effectiveLocationId]);
        await client.query('UPDATE movimiento_animal SET total_candidatos=$2,total_seleccionados=$3 WHERE id_movimiento=$1', [id, items.length, items.filter((item) => item.seleccionado).length]);
    }, req.user.id);
    return ok(res, { message: 'Selección actualizada.' });
}));
movementsRouter.post('/:id/aplicar', requirePermission('MOVIMIENTO_CREAR'), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, 'id');
    const row = await transaction(async (client) => {
        const validation = await validateMovementSelection(client, await loadMovementForValidation(client, id));
        const result = (await client.query('SELECT aplicar_movimiento_animales($1,$2) cantidad', [id, req.user.id])).rows[0];
        if (validation.relocateGroupId) {
            await client.query('UPDATE grupo SET id_ubicacion_actual=$2,updated_at=NOW() WHERE id_grupo=$1', [validation.relocateGroupId, validation.effectiveLocationId]);
        }
        return result;
    }, req.user.id);
    return ok(res, row);
}));
movementsRouter.post('/:id/cancelar', requirePermission('MOVIMIENTO_ANULAR'), asyncHandler(async (req, res) => {
    const row = (await pool.query("UPDATE movimiento_animal SET estado='CANCELADO' WHERE id_movimiento=$1 AND estado NOT IN('COMPLETADO','CANCELADO') AND deleted_at IS NULL RETURNING *", [routeParam(req.params.id, 'id')])).rows[0];
    if (!row)
        throw new NotFoundError();
    return ok(res, row);
}));
//# sourceMappingURL=movements.routes.js.map