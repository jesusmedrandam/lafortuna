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
    fecha_movimiento: z.string().date(),
    motivo: z.string().max(300).nullable().optional(),
    observaciones: z.string().nullable().optional(),
    animales: z.array(movementAnimal).min(1),
});
async function validateMovementSelection(database, input) {
    const selected = input.animales.filter((item) => item.seleccionado);
    if (!selected.length)
        throw new ValidationError('Seleccione al menos un animal.');
    const location = input.id_ubicacion_destino
        ? (await database.query('SELECT tipo,id_categoria_animal FROM ubicacion WHERE id_ubicacion=$1 AND deleted_at IS NULL', [input.id_ubicacion_destino])).rows[0]
        : undefined;
    const group = input.id_grupo_destino
        ? (await database.query('SELECT id_categoria_animal FROM grupo WHERE id_grupo=$1 AND deleted_at IS NULL AND activo=TRUE', [input.id_grupo_destino])).rows[0]
        : undefined;
    if (input.id_ubicacion_destino && !location)
        throw new ValidationError('La ubicación de destino no está disponible.');
    if (input.id_grupo_destino && !group)
        throw new ValidationError('El grupo de destino no está disponible.');
    if (location && group && location.id_categoria_animal !== group.id_categoria_animal) {
        throw new ValidationError('El grupo de destino debe pertenecer a la misma situación de propiedad que la ubicación.');
    }
    const operations = input.tipo_movimiento === 'UBICACION'
        ? ['MOVIMIENTO_UBICACION']
        : input.tipo_movimiento === 'GRUPO'
            ? ['MOVIMIENTO_GRUPO']
            : input.tipo_movimiento === 'PROPIEDAD'
                ? ['MOVIMIENTO_PROPIEDAD']
                : [location?.tipo === 'OTRO' ? 'MOVIMIENTO_PROPIEDAD' : 'MOVIMIENTO_UBICACION', 'MOVIMIENTO_GRUPO'];
    for (const animal of selected) {
        for (const operation of operations)
            await assertAnimalOperationAllowed(database, animal.id_animal, operation);
        if (input.tipo_movimiento === 'GRUPO' && group) {
            const current = (await database.query('SELECT id_categoria_animal FROM animal WHERE id_animal=$1', [animal.id_animal])).rows[0];
            if (current.id_categoria_animal !== group.id_categoria_animal) {
                throw new ValidationError('Para cambiar solo de grupo, el grupo de destino debe tener la misma situación de propiedad que el animal.');
            }
        }
    }
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
movementsRouter.get('/', requirePermission('MOVIMIENTO_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, (await pool.query(`SELECT m.*,u1.nombre ubicacion_origen,u2.nombre ubicacion_destino,g1.nombre grupo_origen,g2.nombre grupo_destino,
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
   WHERE m.deleted_at IS NULL ORDER BY m.fecha_movimiento DESC`)).rows)));
movementsRouter.post('/', requirePermission('MOVIMIENTO_CREAR'), asyncHandler(async (req, res) => {
    const input = movement.parse(req.body);
    const result = await transaction(async (client) => {
        await validateMovementSelection(client, input);
        const { animales, ...head } = input;
        const row = (await client.query(buildInsert('movimiento_animal', {
            ...head,
            estado: 'BORRADOR',
            total_candidatos: animales.length,
            total_seleccionados: animales.filter((animal) => animal.seleccionado).length,
            registrado_por: req.user.id,
        }))).rows[0];
        for (const animal of animales)
            await client.query(buildInsert('movimiento_animal_detalle', { ...animal, id_movimiento: row.id_movimiento }));
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
        if (found.estado === 'BORRADOR') {
            return (await client.query(`UPDATE movimiento_animal SET tipo_movimiento=$2,modo_seleccion=$3,id_grupo_filtro=$4,id_ubicacion_origen=$5,
          id_ubicacion_destino=$6,id_grupo_origen=$7,id_grupo_destino=$8,fecha_movimiento=$9,motivo=$10,observaciones=$11,updated_at=NOW()
         WHERE id_movimiento=$1 RETURNING *`, [id, input.tipo_movimiento ?? found.tipo_movimiento, input.modo_seleccion ?? found.modo_seleccion,
                input.id_grupo_filtro === undefined ? found.id_grupo_filtro : input.id_grupo_filtro,
                input.id_ubicacion_origen === undefined ? found.id_ubicacion_origen : input.id_ubicacion_origen,
                input.id_ubicacion_destino === undefined ? found.id_ubicacion_destino : input.id_ubicacion_destino,
                input.id_grupo_origen === undefined ? found.id_grupo_origen : input.id_grupo_origen,
                input.id_grupo_destino === undefined ? found.id_grupo_destino : input.id_grupo_destino,
                input.fecha_movimiento ?? found.fecha_movimiento, input.motivo === undefined ? found.motivo : input.motivo,
                input.observaciones === undefined ? found.observaciones : input.observaciones])).rows[0];
        }
        return (await client.query(`UPDATE movimiento_animal SET fecha_movimiento=$2,motivo=$3,observaciones=$4,updated_at=NOW()
       WHERE id_movimiento=$1 RETURNING *`, [id, input.fecha_movimiento ?? found.fecha_movimiento, input.motivo === undefined ? found.motivo : input.motivo, input.observaciones === undefined ? found.observaciones : input.observaciones])).rows[0];
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
        await validateMovementSelection(client, movement.parse({ ...found, fecha_movimiento: String(found.fecha_movimiento).slice(0, 10), animales: items }));
        await client.query('DELETE FROM movimiento_animal_detalle WHERE id_movimiento=$1', [id]);
        for (const animal of items)
            await client.query(buildInsert('movimiento_animal_detalle', { ...animal, id_movimiento: id }));
        await client.query('UPDATE movimiento_animal SET total_candidatos=$2,total_seleccionados=$3 WHERE id_movimiento=$1', [id, items.length, items.filter((item) => item.seleccionado).length]);
    }, req.user.id);
    return ok(res, { message: 'Selección actualizada.' });
}));
movementsRouter.post('/:id/aplicar', requirePermission('MOVIMIENTO_CREAR'), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, 'id');
    await transaction(async (client) => validateMovementSelection(client, await loadMovementForValidation(client, id)), req.user.id);
    const row = (await pool.query('SELECT aplicar_movimiento_animales($1,$2) cantidad', [id, req.user.id])).rows[0];
    return ok(res, row);
}));
movementsRouter.post('/:id/cancelar', requirePermission('MOVIMIENTO_ANULAR'), asyncHandler(async (req, res) => {
    const row = (await pool.query("UPDATE movimiento_animal SET estado='CANCELADO' WHERE id_movimiento=$1 AND estado NOT IN('COMPLETADO','CANCELADO') AND deleted_at IS NULL RETURNING *", [routeParam(req.params.id, 'id')])).rows[0];
    if (!row)
        throw new NotFoundError();
    return ok(res, row);
}));
//# sourceMappingURL=movements.routes.js.map