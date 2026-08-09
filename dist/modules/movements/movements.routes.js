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
    id_motivo_movimiento: z.string().uuid().nullable().optional(),
    fecha_movimiento: z.string().date(),
    motivo: z.string().max(300).nullable().optional(),
    observaciones: z.string().nullable().optional(),
    animales: z.array(movementAnimal).default([]),
});
function validateMovementMode(kind, mode, groupFilterId, destinationGroupId) {
    if (kind !== 'UBICACION')
        return;
    if (mode !== 'GRUPO') {
        throw new ValidationError('El cambio de potrero o corral se realiza únicamente con un grupo completo.');
    }
    if (groupFilterId && destinationGroupId && groupFilterId !== destinationGroupId) {
        throw new ValidationError('El grupo debe conservarse al cambiar de potrero o corral.');
    }
}
function defaultReasonCode(kind) {
    if (kind === 'UBICACION')
        return 'ROTACION_POTRERO';
    if (kind === 'GRUPO')
        return 'CAMBIO_GRUPO';
    if (kind === 'PROPIEDAD')
        return 'TRASLADO_PROPIEDAD';
    return 'REORGANIZACION';
}
async function movementReason(database, id, kind) {
    const value = id ?? (kind ? defaultReasonCode(kind) : null);
    if (!value)
        throw new ValidationError('Seleccione el motivo del movimiento.');
    const reason = (await database.query(`SELECT id_motivo_movimiento,nombre FROM motivo_movimiento
     WHERE ${id ? 'id_motivo_movimiento=$1' : 'codigo=$1'} AND deleted_at IS NULL`, [value])).rows[0];
    if (!reason)
        throw new ValidationError('El motivo de movimiento seleccionado no está disponible.');
    return reason;
}
async function completeGroupAnimals(database, groupId, provided, destinationLocationId, destinationGroupId) {
    const observations = new Map(provided.map((item) => [item.id_animal, item.observaciones ?? null]));
    const members = (await database.query(`SELECT id_animal FROM animal
     WHERE id_grupo_actual=$1 AND estado='ACTIVO' AND deleted_at IS NULL
     ORDER BY nombre,id_animal`, [groupId])).rows;
    return members.map((member) => ({
        id_animal: member.id_animal,
        seleccionado: true,
        id_ubicacion_destino: destinationLocationId ?? null,
        id_grupo_destino: destinationGroupId ?? groupId,
        observaciones: observations.get(member.id_animal) ?? null,
    }));
}
async function validateMovementSelection(database, input) {
    validateMovementMode(input.tipo_movimiento, input.modo_seleccion, input.id_grupo_filtro, input.id_grupo_destino);
    if (input.tipo_movimiento === 'UBICACION' && !input.id_grupo_filtro) {
        throw new ValidationError('Seleccione el grupo completo que cambiará de potrero o corral.');
    }
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
    const location = (await database.query(`SELECT u.tipo,u.id_categoria_animal,u.id_propiedad_padre,ca.codigo categoria_codigo
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
    const currentAnimals = (await database.query(`SELECT a.id_animal,a.id_categoria_animal,a.id_grupo_actual,a.id_ubicacion_actual,
       u.tipo ubicacion_tipo,u.id_propiedad_padre
     FROM animal a LEFT JOIN ubicacion u ON u.id_ubicacion=a.id_ubicacion_actual
     WHERE a.id_animal=ANY($1::uuid[]) AND a.deleted_at IS NULL AND a.estado='ACTIVO' FOR SHARE OF a`, [animalIds])).rows;
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
        if (input.tipo_movimiento === 'PROPIEDAD') {
            const destinationPropertyId = location.tipo === 'OTRO' ? effectiveLocationId : location.id_propiedad_padre;
            const currentPropertyId = current.ubicacion_tipo === 'OTRO' ? current.id_ubicacion_actual : current.id_propiedad_padre;
            if (!destinationPropertyId)
                throw new ValidationError('Seleccione una ubicación perteneciente a otra propiedad.');
            if (currentPropertyId === destinationPropertyId) {
                throw new ValidationError('No puede trasladar un animal desde y hacia la misma propiedad.');
            }
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
    validateMovementMode(input.tipo_movimiento, input.modo_seleccion, input.id_grupo_filtro, input.id_grupo_destino);
    const result = await transaction(async (client) => {
        const reason = await movementReason(client, input.id_motivo_movimiento, input.tipo_movimiento);
        const destinationGroupId = input.tipo_movimiento === 'UBICACION' && input.id_grupo_filtro
            ? input.id_grupo_filtro
            : input.id_grupo_destino;
        const animals = input.tipo_movimiento === 'UBICACION' && input.id_grupo_filtro
            ? await completeGroupAnimals(client, input.id_grupo_filtro, input.animales, input.id_ubicacion_destino, destinationGroupId)
            : input.animales;
        const { animales: _animals, ...head } = input;
        const row = (await client.query(buildInsert('movimiento_animal', {
            ...head,
            id_grupo_origen: input.tipo_movimiento === 'UBICACION' ? input.id_grupo_filtro ?? null : input.id_grupo_origen ?? null,
            id_grupo_destino: destinationGroupId ?? null,
            id_motivo_movimiento: reason.id_motivo_movimiento,
            motivo: reason.nombre,
            estado: 'BORRADOR',
            total_candidatos: animals.length,
            total_seleccionados: animals.filter((animal) => animal.seleccionado).length,
            registrado_por: req.user.id,
        }))).rows[0];
        for (const animal of animals)
            await client.query(buildInsert('movimiento_animal_detalle', {
                ...animal,
                id_ubicacion_destino: input.id_ubicacion_destino ?? null,
                id_grupo_destino: destinationGroupId ?? null,
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
            const nextKind = input.tipo_movimiento ?? found.tipo_movimiento;
            const nextMode = input.modo_seleccion ?? found.modo_seleccion;
            const nextGroupFilter = input.id_grupo_filtro === undefined ? found.id_grupo_filtro : input.id_grupo_filtro;
            const requestedDestinationGroup = input.id_grupo_destino === undefined ? found.id_grupo_destino : input.id_grupo_destino;
            const nextDestinationGroup = nextKind === 'UBICACION' && nextGroupFilter ? nextGroupFilter : requestedDestinationGroup;
            validateMovementMode(nextKind, nextMode, nextGroupFilter, nextDestinationGroup);
            return (await client.query(`UPDATE movimiento_animal SET tipo_movimiento=$2,modo_seleccion=$3,id_grupo_filtro=$4,id_ubicacion_origen=$5,
          id_ubicacion_destino=$6,id_grupo_origen=$7,id_grupo_destino=$8,fecha_movimiento=$9,
          id_motivo_movimiento=$10,motivo=$11,observaciones=$12,updated_at=NOW()
         WHERE id_movimiento=$1 RETURNING *`, [id, nextKind, nextMode,
                nextGroupFilter,
                input.id_ubicacion_origen === undefined ? found.id_ubicacion_origen : input.id_ubicacion_origen,
                input.id_ubicacion_destino === undefined ? found.id_ubicacion_destino : input.id_ubicacion_destino,
                nextKind === 'UBICACION' && nextGroupFilter ? nextGroupFilter : input.id_grupo_origen === undefined ? found.id_grupo_origen : input.id_grupo_origen,
                nextDestinationGroup,
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
    const requestedItems = z.array(movementAnimal).parse(req.body.animales);
    await transaction(async (client) => {
        const found = (await client.query('SELECT * FROM movimiento_animal WHERE id_movimiento=$1 AND deleted_at IS NULL FOR UPDATE', [id])).rows[0];
        if (!found)
            throw new NotFoundError();
        if (found.estado !== 'BORRADOR')
            throw new ConflictError('Solo puede editarse un movimiento en borrador.');
        validateMovementMode(found.tipo_movimiento, found.modo_seleccion, found.id_grupo_filtro, found.id_grupo_destino);
        const items = found.tipo_movimiento === 'UBICACION' && found.id_grupo_filtro
            ? await completeGroupAnimals(client, found.id_grupo_filtro, requestedItems, found.id_ubicacion_destino, found.id_grupo_destino)
            : requestedItems;
        await client.query('DELETE FROM movimiento_animal_detalle WHERE id_movimiento=$1', [id]);
        for (const animal of items)
            await client.query(buildInsert('movimiento_animal_detalle', {
                ...animal,
                id_ubicacion_destino: found.id_ubicacion_destino ?? null,
                id_grupo_destino: found.id_grupo_destino ?? null,
                id_movimiento: id,
            }));
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