import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, noContent, ok } from '../../core/http.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { requirePermission } from '../../middleware/permission.js';
import { buildInsert, buildUpdate } from '../shared/sql.js';
import { assertAnimalOperationAllowed } from '../../services/animal-operation-policy.js';
import { notifyReproductionEvent } from '../notifications/business-notifications.service.js';
const GESTATION_DAYS = 283;
const heatSchema = z.object({
    id_vaca: z.string().uuid(),
    id_toro: z.string().uuid().nullable().optional(),
    fecha_inicio: z.string().date(),
    fecha_fin: z.string().date().nullable().optional(),
    observaciones: z.string().trim().max(500).nullable().optional(),
}).superRefine((value, ctx) => {
    if (value.fecha_fin && value.fecha_fin < value.fecha_inicio) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fecha final del celo no puede ser anterior al inicio.' });
    }
});
const pregnancySchema = z.object({
    id_vaca: z.string().uuid().nullable().optional(),
    id_celo: z.string().uuid().nullable().optional(),
    id_padre: z.string().uuid().nullable().optional(),
    metodo_embarazo: z.enum(['MONTA_NATURAL', 'INSEMINACION_ARTIFICIAL', 'TRANSFERENCIA_EMBRIONES', 'DESCONOCIDO']),
    metodo_confirmacion: z.enum(['PALPACION', 'ECOGRAFIA', 'ANALISIS_SANGRE', 'OBSERVACION', 'OTRO']),
    fecha_confirmacion: z.string().date(),
    dias_gestacion_confirmacion: z.number().int().min(0).max(400).nullable().optional(),
    observaciones: z.string().trim().max(500).nullable().optional(),
}).refine((value) => Boolean(value.id_vaca || value.id_celo), 'Selecciona una vaca o un celo confirmado.');
async function eligibleAnimal(client, id, sex, role, operation) {
    const animal = (await client.query(`SELECT id_animal,id_especie,nombre,sexo,fecha_nacimiento,estado
     FROM animal WHERE id_animal=$1 AND deleted_at IS NULL FOR SHARE`, [id])).rows[0];
    if (!animal || animal.sexo !== sex || animal.estado !== 'ACTIVO') {
        throw new ValidationError(`${role} debe ser un animal ${sex === 'HEMBRA' ? 'hembra' : 'macho'} activo.`);
    }
    await assertAnimalOperationAllowed(client, id, operation);
    if (animal.fecha_nacimiento) {
        const result = await client.query(`SELECT $1::date <= CURRENT_DATE - INTERVAL '1 year' AS valido`, [animal.fecha_nacimiento]);
        if (!result.rows[0]?.valido)
            throw new ValidationError(`${role} debe tener al menos un año de edad.`);
    }
    return animal;
}
function addDays(value, days) {
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}
async function pregnancyData(client, input) {
    let cowId = input.id_vaca ?? null;
    let fatherId = input.id_padre ?? null;
    let startDate = null;
    if (input.id_celo) {
        const heat = (await client.query(`SELECT id_vaca,id_toro,fecha_inicio FROM celo WHERE id_celo=$1 AND deleted_at IS NULL FOR SHARE`, [input.id_celo])).rows[0];
        if (!heat)
            throw new ValidationError('El celo seleccionado no está disponible.');
        if (cowId && cowId !== heat.id_vaca)
            throw new ValidationError('La vaca no coincide con el celo seleccionado.');
        cowId = heat.id_vaca;
        fatherId = fatherId ?? heat.id_toro;
        startDate = String(heat.fecha_inicio).slice(0, 10);
        if (input.fecha_confirmacion < startDate)
            throw new ValidationError('La confirmación no puede ser anterior al inicio del celo.');
    }
    if (!cowId)
        throw new ValidationError('Selecciona la vaca.');
    const cow = await eligibleAnimal(client, cowId, 'HEMBRA', 'La vaca', 'PRENEZ');
    if (fatherId) {
        const father = await eligibleAnimal(client, fatherId, 'MACHO', 'El padre', 'PRENEZ');
        if (father.id_especie !== cow.id_especie)
            throw new ValidationError('El padre y la vaca deben pertenecer a la misma especie.');
    }
    let gestationDays = input.dias_gestacion_confirmacion ?? null;
    if (startDate) {
        const elapsed = Math.max(0, Math.floor((new Date(`${input.fecha_confirmacion}T12:00:00Z`).getTime() - new Date(`${startDate}T12:00:00Z`).getTime()) / 86_400_000));
        gestationDays = elapsed;
    }
    else if (gestationDays !== null) {
        startDate = addDays(input.fecha_confirmacion, -gestationDays);
    }
    const tentativeDate = startDate ? addDays(startDate, GESTATION_DAYS) : null;
    return {
        id_vaca: cowId,
        id_celo: input.id_celo ?? null,
        id_padre: fatherId,
        metodo_embarazo: input.metodo_embarazo,
        metodo_confirmacion: input.metodo_confirmacion,
        fecha_confirmacion: input.fecha_confirmacion,
        dias_gestacion_confirmacion: gestationDays,
        fecha_inicio_estimada: startDate,
        fecha_parto_tentativa: tentativeDate,
        observaciones: input.observaciones ?? null,
    };
}
export const reproductionRouter = Router();
reproductionRouter.get('/opciones', requirePermission('PARTO_CONSULTAR'), asyncHandler(async (_req, res) => {
    const [females, males] = await Promise.all([
        pool.query(`SELECT a.id_animal,a.nombre,a.codigo_arete,a.fecha_nacimiento,a.id_especie,
      a.id_categoria_animal,ca.codigo categoria_codigo,ca.nombre categoria
      FROM animal a JOIN categoria_animal ca ON ca.id_categoria_animal=a.id_categoria_animal
      WHERE a.deleted_at IS NULL AND a.estado='ACTIVO' AND a.sexo='HEMBRA'
        AND (a.fecha_nacimiento IS NULL OR a.fecha_nacimiento<=CURRENT_DATE-INTERVAL '1 year') ORDER BY a.nombre`),
        pool.query(`SELECT a.id_animal,a.nombre,a.codigo_arete,a.fecha_nacimiento,a.id_especie,
      a.id_categoria_animal,ca.codigo categoria_codigo,ca.nombre categoria
      FROM animal a JOIN categoria_animal ca ON ca.id_categoria_animal=a.id_categoria_animal
      WHERE a.deleted_at IS NULL AND a.estado='ACTIVO' AND a.sexo='MACHO'
        AND (a.fecha_nacimiento IS NULL OR a.fecha_nacimiento<=CURRENT_DATE-INTERVAL '1 year') ORDER BY a.nombre`),
    ]);
    return ok(res, { hembras: females.rows, machos: males.rows });
}));
reproductionRouter.get('/celos', requirePermission('PARTO_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, (await pool.query(`SELECT c.*,v.nombre vaca,v.codigo_arete,t.nombre toro,t.codigo_arete toro_arete,
    ca.codigo categoria_codigo,ca.nombre categoria,
    EXISTS(SELECT 1 FROM prenez p WHERE p.id_celo=c.id_celo AND p.deleted_at IS NULL) tiene_prenez
   FROM celo c JOIN animal v ON v.id_animal=c.id_vaca
   JOIN categoria_animal ca ON ca.id_categoria_animal=v.id_categoria_animal
   LEFT JOIN animal t ON t.id_animal=c.id_toro
   WHERE c.deleted_at IS NULL ORDER BY c.fecha_inicio DESC,c.created_at DESC`)).rows)));
reproductionRouter.post('/celos', requirePermission('PARTO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const input = heatSchema.parse(req.body);
    const row = await transaction(async (client) => {
        const cow = await eligibleAnimal(client, input.id_vaca, 'HEMBRA', 'La vaca', 'CELO');
        if (input.id_toro) {
            const bull = await eligibleAnimal(client, input.id_toro, 'MACHO', 'El toro', 'CELO');
            if (bull.id_especie !== cow.id_especie)
                throw new ValidationError('El toro y la vaca deben pertenecer a la misma especie.');
        }
        const saved = (await client.query(buildInsert('celo', { ...input, registrado_por: req.user.id }))).rows[0];
        await notifyReproductionEvent(client, 'CELO', saved, req.user.id);
        return saved;
    }, req.user.id);
    return created(res, row);
}));
reproductionRouter.patch('/celos/:id', requirePermission('PARTO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const input = heatSchema.parse(req.body);
    const id = routeParam(req.params.id, 'id');
    const row = await transaction(async (client) => {
        const linked = await client.query('SELECT 1 FROM prenez WHERE id_celo=$1 AND deleted_at IS NULL LIMIT 1', [id]);
        if (linked.rowCount)
            throw new ValidationError('No se puede modificar un celo que ya tiene una preñez relacionada.');
        const cow = await eligibleAnimal(client, input.id_vaca, 'HEMBRA', 'La vaca', 'CELO');
        if (input.id_toro) {
            const bull = await eligibleAnimal(client, input.id_toro, 'MACHO', 'El toro', 'CELO');
            if (bull.id_especie !== cow.id_especie)
                throw new ValidationError('El toro y la vaca deben pertenecer a la misma especie.');
        }
        const updated = (await client.query(buildUpdate('celo', 'id_celo', id, input))).rows[0];
        if (!updated)
            throw new NotFoundError('Celo no encontrado.');
        return updated;
    }, req.user.id);
    return ok(res, row);
}));
reproductionRouter.delete('/celos/:id', requirePermission('PARTO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, 'id');
    await transaction(async (client) => {
        const linked = await client.query('SELECT 1 FROM prenez WHERE id_celo=$1 AND deleted_at IS NULL LIMIT 1', [id]);
        if (linked.rowCount)
            throw new ValidationError('No se puede eliminar un celo que ya tiene una preñez relacionada.');
        const result = await client.query('UPDATE celo SET deleted_at=NOW() WHERE id_celo=$1 AND deleted_at IS NULL', [id]);
        if (!result.rowCount)
            throw new NotFoundError('Celo no encontrado.');
    }, req.user.id);
    return noContent(res);
}));
reproductionRouter.get('/preneces', requirePermission('PARTO_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, (await pool.query(`SELECT p.*,v.nombre vaca,v.codigo_arete,v.id_especie,v.id_categoria_animal,pa.nombre padre,c.fecha_inicio celo_inicio,
    ca.codigo categoria_codigo,ca.nombre categoria,
    pp.id_proximo_parto,pp.estado proximo_estado
   FROM prenez p JOIN animal v ON v.id_animal=p.id_vaca
   JOIN categoria_animal ca ON ca.id_categoria_animal=v.id_categoria_animal
   LEFT JOIN animal pa ON pa.id_animal=p.id_padre LEFT JOIN celo c ON c.id_celo=p.id_celo
   LEFT JOIN proximo_parto pp ON pp.id_prenez=p.id_prenez AND pp.deleted_at IS NULL
   WHERE p.deleted_at IS NULL ORDER BY p.estado='CONFIRMADA' DESC,p.fecha_confirmacion DESC`)).rows)));
reproductionRouter.post('/preneces', requirePermission('PARTO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const input = pregnancySchema.parse(req.body);
    try {
        const row = await transaction(async (client) => {
            const data = await pregnancyData(client, input);
            const pregnancy = (await client.query(buildInsert('prenez', { ...data, estado: 'CONFIRMADA', registrado_por: req.user.id }))).rows[0];
            await client.query(buildInsert('proximo_parto', {
                id_prenez: pregnancy.id_prenez,
                id_vaca: data.id_vaca,
                fecha_tentativa: data.fecha_parto_tentativa,
                estado: 'PENDIENTE',
                registrado_por: req.user.id,
            }));
            await notifyReproductionEvent(client, 'PRENEZ', pregnancy, req.user.id);
            return pregnancy;
        }, req.user.id);
        return created(res, row);
    }
    catch (error) {
        if (error.code === '23505')
            throw new ValidationError('Esta vaca ya tiene una preñez confirmada pendiente de finalizar.');
        throw error;
    }
}));
reproductionRouter.patch('/preneces/:id', requirePermission('PARTO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const input = pregnancySchema.parse(req.body);
    const id = routeParam(req.params.id, 'id');
    const row = await transaction(async (client) => {
        const current = (await client.query('SELECT estado FROM prenez WHERE id_prenez=$1 AND deleted_at IS NULL FOR UPDATE', [id])).rows[0];
        if (!current)
            throw new NotFoundError('Preñez no encontrada.');
        if (current.estado !== 'CONFIRMADA')
            throw new ValidationError('Solo se puede modificar una preñez confirmada y pendiente.');
        const data = await pregnancyData(client, input);
        const pregnancy = (await client.query(buildUpdate('prenez', 'id_prenez', id, data))).rows[0];
        await client.query(`UPDATE proximo_parto SET id_vaca=$2,fecha_tentativa=$3,updated_at=NOW()
       WHERE id_prenez=$1 AND deleted_at IS NULL`, [id, data.id_vaca, data.fecha_parto_tentativa]);
        return pregnancy;
    }, req.user.id);
    return ok(res, row);
}));
reproductionRouter.delete('/preneces/:id', requirePermission('PARTO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, 'id');
    await transaction(async (client) => {
        const result = await client.query(`UPDATE prenez SET estado='CANCELADA',updated_at=NOW()
       WHERE id_prenez=$1 AND deleted_at IS NULL AND estado='CONFIRMADA'`, [id]);
        if (!result.rowCount)
            throw new NotFoundError('Preñez confirmada no encontrada.');
        await client.query(`UPDATE proximo_parto SET estado='CANCELADO',updated_at=NOW() WHERE id_prenez=$1 AND deleted_at IS NULL`, [id]);
    }, req.user.id);
    return noContent(res);
}));
reproductionRouter.get('/proximos-partos', requirePermission('PARTO_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, (await pool.query(`SELECT pp.*,p.fecha_confirmacion,p.metodo_embarazo,p.metodo_confirmacion,p.dias_gestacion_confirmacion,
    v.nombre vaca,v.codigo_arete,pa.nombre padre,ca.codigo categoria_codigo,ca.nombre categoria
   FROM proximo_parto pp JOIN prenez p ON p.id_prenez=pp.id_prenez AND p.deleted_at IS NULL
   JOIN animal v ON v.id_animal=pp.id_vaca
   JOIN categoria_animal ca ON ca.id_categoria_animal=v.id_categoria_animal
   LEFT JOIN animal pa ON pa.id_animal=p.id_padre
   WHERE pp.deleted_at IS NULL AND pp.estado='PENDIENTE' AND p.estado='CONFIRMADA'
   ORDER BY pp.fecha_tentativa NULLS LAST,v.nombre`)).rows)));
//# sourceMappingURL=reproduction.routes.js.map