import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, noContent, ok } from '../../core/http.js';
import { AppError, NotFoundError, ValidationError } from '../../core/errors.js';
import { requirePermission } from '../../middleware/permission.js';
import { buildInsert, buildUpdate } from '../shared/sql.js';
import { assertAnimalOperationAllowed } from '../../services/animal-operation-policy.js';
import { notifyReproductionEvent } from '../notifications/business-notifications.service.js';
import { assertFemaleReproductionRules, assertMinimumAge, reproductionRulesForAnimal } from '../../services/reproduction-policy.js';
const GESTATION_DAYS = 283;
const heatSchema = z.object({
    id_vaca: z.string().uuid(),
    id_toro: z.string().uuid().nullable().optional(),
    fecha_inicio: z.string().date(),
    fecha_fin: z.string().date().nullable().optional(),
    es_falso: z.boolean().default(false),
    observaciones: z.string().trim().max(500).nullable().optional(),
}).superRefine((value, ctx) => {
    if (value.fecha_fin && value.fecha_fin < value.fecha_inicio) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fecha final del celo no puede ser anterior al inicio.' });
    }
});
const pregnancySchema = z.object({
    id_vaca: z.string().uuid().nullable().optional(),
    id_celo: z.string().uuid().nullable().optional(),
    id_servicio_reproductivo: z.string().uuid().nullable().optional(),
    id_padre: z.string().uuid().nullable().optional(),
    padre_externo: z.string().trim().max(240).nullable().optional(),
    metodo_embarazo: z.enum(['MONTA_NATURAL', 'INSEMINACION_ARTIFICIAL', 'TRANSFERENCIA_EMBRIONES', 'DESCONOCIDO']),
    metodo_confirmacion: z.enum(['PALPACION', 'ECOGRAFIA', 'ANALISIS_SANGRE', 'OBSERVACION', 'OTRO']),
    fecha_confirmacion: z.string().date(),
    dias_gestacion_confirmacion: z.number().int().min(0).max(400).nullable().optional(),
    observaciones: z.string().trim().max(500).nullable().optional(),
}).refine((value) => Boolean(value.id_vaca || value.id_celo || value.id_servicio_reproductivo), 'Selecciona una vaca, un celo o un servicio reproductivo.');
const assistedServiceSchema = z.object({
    id_vaca: z.string().uuid(),
    tipo: z.enum(['INSEMINACION_ARTIFICIAL', 'TRANSFERENCIA_EMBRIONES']),
    fecha: z.string().date(),
    id_celo: z.string().uuid().nullable().optional(),
    id_padre: z.string().uuid().nullable().optional(),
    padre_externo: z.string().trim().max(240).nullable().optional(),
    id_donante: z.string().uuid().nullable().optional(),
    donante_externa: z.string().trim().max(240).nullable().optional(),
    codigo_material: z.string().trim().max(160).nullable().optional(),
    calidad: z.string().trim().max(120).nullable().optional(),
    tecnico: z.string().trim().max(160).nullable().optional(),
    proveedor: z.string().trim().max(160).nullable().optional(),
    observaciones: z.string().trim().max(2000).nullable().optional(),
}).superRefine((value, ctx) => {
    if (value.id_padre && value.padre_externo)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['padre_externo'], message: 'Elige un padre registrado o escribe uno externo, no ambos.' });
    if (value.id_donante && value.donante_externa)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['donante_externa'], message: 'Elige una donante registrada o escribe una externa, no ambas.' });
    if (value.tipo === 'INSEMINACION_ARTIFICIAL' && (value.id_donante || value.donante_externa))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['id_donante'], message: 'La donante solo corresponde a una transferencia de embriones.' });
});
async function eligibleAnimal(client, id, sex, role, operation) {
    const animal = (await client.query(`SELECT id_animal,id_especie,nombre,sexo,fecha_nacimiento,estado
     FROM animal WHERE id_animal=$1 AND deleted_at IS NULL FOR SHARE`, [id])).rows[0];
    if (!animal || animal.sexo !== sex || animal.estado !== 'ACTIVO') {
        throw new ValidationError(`${role} debe ser un animal ${sex === 'HEMBRA' ? 'hembra' : 'macho'} activo.`);
    }
    await assertAnimalOperationAllowed(client, id, operation);
    return animal;
}
async function activeAnimal(client, id, sex, role) {
    const animal = (await client.query(`SELECT id_animal,id_especie,nombre,sexo,fecha_nacimiento,estado
     FROM animal WHERE id_animal=$1 AND deleted_at IS NULL FOR SHARE`, [id])).rows[0];
    if (!animal || animal.sexo !== sex || animal.estado !== 'ACTIVO') {
        throw new ValidationError(`${role} debe ser un animal ${sex === 'HEMBRA' ? 'hembra' : 'macho'} activo.`);
    }
    return animal;
}
function addDays(value, days) {
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}
async function pregnancyData(client, input, excludePregnancyId) {
    let cowId = input.id_vaca ?? null;
    let fatherId = input.id_padre ?? null;
    let heatId = input.id_celo ?? null;
    let startDate = null;
    let heatStart = null;
    let heatEnd = null;
    let serviceId = input.id_servicio_reproductivo ?? null;
    let externalFather = input.padre_externo ?? null;
    if (serviceId) {
        const service = (await client.query(`SELECT id_vaca,id_celo,id_padre,padre_externo,tipo,fecha::text
       FROM servicio_reproductivo WHERE id_servicio_reproductivo=$1 AND deleted_at IS NULL FOR SHARE`, [serviceId])).rows[0];
        if (!service)
            throw new ValidationError('El servicio reproductivo seleccionado no está disponible.');
        if (cowId && cowId !== service.id_vaca)
            throw new ValidationError('La vaca no coincide con el servicio reproductivo.');
        cowId = service.id_vaca;
        heatId = service.id_celo;
        fatherId = service.id_padre;
        externalFather = service.padre_externo;
        input.metodo_embarazo = service.tipo;
        startDate = service.fecha;
        if (input.fecha_confirmacion < service.fecha)
            throw new ValidationError('La confirmación no puede ser anterior al servicio reproductivo.');
    }
    if (heatId) {
        const heat = (await client.query(`SELECT id_vaca,id_toro,fecha_inicio::text,fecha_fin::text,es_falso FROM celo WHERE id_celo=$1 AND deleted_at IS NULL FOR SHARE`, [heatId])).rows[0];
        if (!heat)
            throw new ValidationError('El celo seleccionado no está disponible.');
        if (heat.es_falso)
            throw new ValidationError('Un celo marcado como falso no puede utilizarse para confirmar una preñez.');
        if (cowId && cowId !== heat.id_vaca)
            throw new ValidationError('La vaca no coincide con el celo seleccionado.');
        cowId = heat.id_vaca;
        fatherId = fatherId ?? heat.id_toro;
        heatStart = heat.fecha_inicio;
        heatEnd = heat.fecha_fin;
        if (input.fecha_confirmacion < heatStart)
            throw new ValidationError('La confirmación no puede ser anterior al inicio del celo.');
    }
    if (!cowId)
        throw new ValidationError('Selecciona la vaca.');
    const cow = await eligibleAnimal(client, cowId, 'HEMBRA', 'La vaca', 'PRENEZ');
    const rules = await assertFemaleReproductionRules(client, cowId, input.fecha_confirmacion, 'PRENEZ', false, undefined, excludePregnancyId);
    await assertMinimumAge(client, cow.fecha_nacimiento, input.fecha_confirmacion, rules.edad_minima_celo_meses, 'La vaca');
    if (!heatId && !serviceId && rules.usar_ultimo_celo_valido) {
        const recent = (await client.query(`SELECT id_celo,id_toro,fecha_inicio::text,fecha_fin::text FROM celo
       WHERE id_vaca=$1 AND es_falso=FALSE AND deleted_at IS NULL AND fecha_inicio<=$2::date
       ORDER BY fecha_inicio DESC,created_at DESC LIMIT 1 FOR SHARE`, [cowId, input.fecha_confirmacion])).rows[0];
        if (recent) {
            heatId = recent.id_celo;
            fatherId = fatherId ?? recent.id_toro;
            heatStart = recent.fecha_inicio;
            heatEnd = recent.fecha_fin;
        }
    }
    if (heatStart && !serviceId)
        startDate = rules.usar_ultimo_celo_valido ? (heatEnd ?? heatStart) : heatStart;
    if (fatherId) {
        const father = await eligibleAnimal(client, fatherId, 'MACHO', 'El padre', 'PRENEZ');
        if (father.id_especie !== cow.id_especie)
            throw new ValidationError('El padre y la vaca deben pertenecer a la misma especie.');
        await assertMinimumAge(client, father.fecha_nacimiento, input.fecha_confirmacion, rules.edad_minima_padre_meses, 'El padre');
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
        id_celo: heatId,
        id_servicio_reproductivo: serviceId,
        id_padre: fatherId,
        padre_externo: externalFather,
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
async function actionAvailability(check) {
    try {
        await check();
        return { permitido: true, motivo: null };
    }
    catch (error) {
        if (error instanceof AppError)
            return { permitido: false, motivo: error.message };
        throw error;
    }
}
async function anyActionAvailability(checks) {
    const results = await Promise.all(checks.map(check => actionAvailability(check)));
    const allowed = results.find(result => result.permitido);
    return allowed ?? results[0] ?? { permitido: false, motivo: 'Operación no disponible.' };
}
reproductionRouter.get('/disponibilidad/:id', requirePermission('ANIMAL_CONSULTAR'), asyncHandler(async (req, res) => {
    const animalId = routeParam(req.params.id, 'id');
    const date = z.string().date().catch(new Date().toISOString().slice(0, 10)).parse(req.query.fecha);
    const animal = (await pool.query(`SELECT id_animal,nombre,sexo,estado,fecha_nacimiento
     FROM animal WHERE id_animal=$1 AND deleted_at IS NULL`, [animalId])).rows[0];
    if (!animal)
        throw new NotFoundError('Animal no encontrado.');
    const activePregnancy = (await pool.query(`SELECT id_prenez FROM prenez
     WHERE id_vaca=$1 AND estado='CONFIRMADA' AND deleted_at IS NULL
     ORDER BY fecha_confirmacion DESC LIMIT 1`, [animalId])).rows[0];
    const validFemale = animal.estado === 'ACTIVO' && animal.sexo === 'HEMBRA';
    const unavailable = (message) => ({ permitido: false, motivo: message });
    const femaleCheck = () => {
        if (!validFemale)
            throw new ValidationError('Esta operación solo está disponible para hembras activas.');
    };
    const reproductiveCheck = async (operation, kind, falseHeat = false) => {
        femaleCheck();
        await assertAnimalOperationAllowed(pool, animalId, operation);
        const rules = await assertFemaleReproductionRules(pool, animalId, date, kind, falseHeat);
        await assertMinimumAge(pool, animal.fecha_nacimiento, date, rules.edad_minima_celo_meses, 'La hembra');
    };
    const productionHistory = Number((await pool.query(`SELECT COUNT(*)::int total FROM produccion_leche
     WHERE id_vaca=$1 AND deleted_at IS NULL`, [animalId])).rows[0]?.total ?? 0);
    const production = await actionAvailability(async () => {
        femaleCheck();
        await assertAnimalOperationAllowed(pool, animalId, 'PRODUCCION_LECHE');
        const state = (await pool.query(`SELECT en_ordeno FROM animal WHERE id_animal=$1 AND deleted_at IS NULL`, [animalId])).rows[0];
        if (!state?.en_ordeno)
            throw new ValidationError('La hembra no está marcada como en ordeño.');
        const rules = await reproductionRulesForAnimal(pool, animalId);
        const recentBirth = (await pool.query(`SELECT 1 FROM parto
       WHERE id_madre=$1 AND deleted_at IS NULL AND fecha_parto::date<=$2::date
         AND fecha_parto+(INTERVAL '1 day'*$3::int)>=$2::date
       LIMIT 1`, [animalId, date, rules.dias_maximos_ordeno_posparto])).rowCount;
        if (!recentBirth)
            throw new ValidationError(`No tiene un parto dentro de los ${rules.dias_maximos_ordeno_posparto} días permitidos para ordeño.`);
    });
    const unavailableActions = [
        unavailable('Esta operación solo está disponible para hembras activas.'),
        unavailable('Esta operación solo está disponible para hembras activas.'),
        unavailable('Esta operación solo está disponible para hembras activas.'),
        unavailable('Esta operación solo está disponible para hembras activas.'),
        unavailable('Esta operación solo está disponible para hembras activas.'),
        unavailable('Esta operación solo está disponible para hembras activas.'),
        unavailable('Esta operación solo está disponible para hembras activas.'),
    ];
    const [normalHeat, falseHeat, pregnancy, insemination, embryo, birth, abortion] = validFemale ? await Promise.all([
        actionAvailability(() => reproductiveCheck('CELO', 'CELO', false)),
        actionAvailability(() => reproductiveCheck('CELO', 'CELO', true)),
        actionAvailability(() => reproductiveCheck('PRENEZ', 'PRENEZ')),
        actionAvailability(() => reproductiveCheck('INSEMINACION_ARTIFICIAL', 'PRENEZ')),
        actionAvailability(() => reproductiveCheck('TRANSFERENCIA_EMBRIONES', 'PRENEZ')),
        actionAvailability(async () => {
            femaleCheck();
            await assertAnimalOperationAllowed(pool, animalId, 'PARTO');
            if (!activePregnancy)
                throw new ValidationError('Primero debe existir una preñez confirmada.');
        }),
        actionAvailability(async () => {
            femaleCheck();
            await assertAnimalOperationAllowed(pool, animalId, 'ABORTO');
            if (!activePregnancy)
                throw new ValidationError('Solo se puede registrar un aborto si existe una preñez confirmada.');
        }),
    ]) : unavailableActions;
    const [movement, health, weighing, sale, death] = await Promise.all([
        anyActionAvailability([
            () => assertAnimalOperationAllowed(pool, animalId, 'MOVIMIENTO_UBICACION'),
            () => assertAnimalOperationAllowed(pool, animalId, 'MOVIMIENTO_GRUPO'),
            () => assertAnimalOperationAllowed(pool, animalId, 'MOVIMIENTO_PROPIEDAD'),
        ]),
        actionAvailability(() => assertAnimalOperationAllowed(pool, animalId, 'TRATAMIENTO')),
        actionAvailability(() => assertAnimalOperationAllowed(pool, animalId, 'PESAJE')),
        actionAvailability(() => assertAnimalOperationAllowed(pool, animalId, 'VENTA')),
        actionAvailability(() => assertAnimalOperationAllowed(pool, animalId, 'MUERTE')),
    ]);
    return ok(res, {
        id_animal: animalId,
        fecha: date,
        produccion: { consultar: productionHistory > 0 || production.permitido, registrar: production.permitido, motivo: production.motivo },
        aplica_reproduccion: validFemale,
        id_prenez_confirmada: activePregnancy?.id_prenez ?? null,
        celo: { permitido: normalHeat.permitido || falseHeat.permitido, solo_falso: !normalHeat.permitido && falseHeat.permitido, motivo: normalHeat.motivo ?? falseHeat.motivo },
        prenez: pregnancy,
        inseminacion: insemination,
        embrion: embryo,
        parto: birth,
        aborto: abortion,
        movimiento: movement,
        sanidad: health,
        pesaje: weighing,
        venta: sale,
        muerte: death,
    });
}));
reproductionRouter.get('/opciones', requirePermission('PARTO_CONSULTAR'), asyncHandler(async (_req, res) => {
    const [females, males] = await Promise.all([
        pool.query(`SELECT a.id_animal,a.nombre,a.codigo_arete,a.fecha_nacimiento,a.id_especie,
      a.id_categoria_animal,ca.codigo categoria_codigo,ca.nombre categoria,
      EXISTS(SELECT 1 FROM prenez active WHERE active.id_vaca=a.id_animal AND active.estado='CONFIRMADA' AND active.deleted_at IS NULL) prenez_confirmada
      FROM animal a JOIN categoria_animal ca ON ca.id_categoria_animal=a.id_categoria_animal
      LEFT JOIN ubicacion au ON au.id_ubicacion=a.id_ubicacion_actual
      LEFT JOIN grupo ag ON ag.id_grupo=a.id_grupo_actual
      LEFT JOIN configuracion_propiedad cp ON cp.id_propiedad=COALESCE(au.id_propiedad,ag.id_propiedad,(SELECT id_propiedad FROM propiedad_ganadera WHERE deleted_at IS NULL ORDER BY es_principal DESC LIMIT 1))
      WHERE a.deleted_at IS NULL AND a.estado='ACTIVO' AND a.sexo='HEMBRA'
        AND (a.fecha_nacimiento IS NULL OR a.fecha_nacimiento+make_interval(months=>COALESCE(cp.edad_minima_celo_meses,12))<=CURRENT_DATE) ORDER BY a.nombre`),
        pool.query(`SELECT a.id_animal,a.nombre,a.codigo_arete,a.fecha_nacimiento,a.id_especie,
      a.id_categoria_animal,ca.codigo categoria_codigo,ca.nombre categoria
      FROM animal a JOIN categoria_animal ca ON ca.id_categoria_animal=a.id_categoria_animal
      LEFT JOIN ubicacion au ON au.id_ubicacion=a.id_ubicacion_actual
      LEFT JOIN grupo ag ON ag.id_grupo=a.id_grupo_actual
      LEFT JOIN configuracion_propiedad cp ON cp.id_propiedad=COALESCE(au.id_propiedad,ag.id_propiedad,(SELECT id_propiedad FROM propiedad_ganadera WHERE deleted_at IS NULL ORDER BY es_principal DESC LIMIT 1))
      WHERE a.deleted_at IS NULL AND a.estado='ACTIVO' AND a.sexo='MACHO'
        AND (a.fecha_nacimiento IS NULL OR a.fecha_nacimiento+make_interval(months=>COALESCE(cp.edad_minima_padre_meses,12))<=CURRENT_DATE) ORDER BY a.nombre`),
    ]);
    return ok(res, { hembras: females.rows, hembras_prenez: females.rows.filter((item) => !item.prenez_confirmada), machos: males.rows });
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
        const rules = await assertFemaleReproductionRules(client, input.id_vaca, input.fecha_inicio, 'CELO', input.es_falso);
        await assertMinimumAge(client, cow.fecha_nacimiento, input.fecha_inicio, rules.edad_minima_celo_meses, 'La vaca');
        if (input.id_toro) {
            const bull = await eligibleAnimal(client, input.id_toro, 'MACHO', 'El toro', 'CELO');
            if (bull.id_especie !== cow.id_especie)
                throw new ValidationError('El toro y la vaca deben pertenecer a la misma especie.');
            await assertMinimumAge(client, bull.fecha_nacimiento, input.fecha_inicio, rules.edad_minima_padre_meses, 'El toro');
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
        const rules = await assertFemaleReproductionRules(client, input.id_vaca, input.fecha_inicio, 'CELO', input.es_falso, id);
        await assertMinimumAge(client, cow.fecha_nacimiento, input.fecha_inicio, rules.edad_minima_celo_meses, 'La vaca');
        if (input.id_toro) {
            const bull = await eligibleAnimal(client, input.id_toro, 'MACHO', 'El toro', 'CELO');
            if (bull.id_especie !== cow.id_especie)
                throw new ValidationError('El toro y la vaca deben pertenecer a la misma especie.');
            await assertMinimumAge(client, bull.fecha_nacimiento, input.fecha_inicio, rules.edad_minima_padre_meses, 'El toro');
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
async function assistedServiceData(client, input) {
    const operation = input.tipo === 'INSEMINACION_ARTIFICIAL' ? 'INSEMINACION_ARTIFICIAL' : 'TRANSFERENCIA_EMBRIONES';
    const cow = await eligibleAnimal(client, input.id_vaca, 'HEMBRA', 'La receptora', operation);
    const rules = await assertFemaleReproductionRules(client, input.id_vaca, input.fecha, 'PRENEZ', false);
    await assertMinimumAge(client, cow.fecha_nacimiento, input.fecha, rules.edad_minima_celo_meses, 'La receptora');
    if (input.id_celo) {
        const heat = (await client.query('SELECT id_vaca,es_falso FROM celo WHERE id_celo=$1 AND deleted_at IS NULL FOR SHARE', [input.id_celo])).rows[0];
        if (!heat || heat.id_vaca !== input.id_vaca || heat.es_falso)
            throw new ValidationError('El celo seleccionado no corresponde a la receptora o está marcado como falso.');
    }
    if (input.id_padre) {
        const father = await activeAnimal(client, input.id_padre, 'MACHO', 'El padre');
        if (father.id_especie !== cow.id_especie)
            throw new ValidationError('El padre y la receptora deben pertenecer a la misma especie.');
        await assertMinimumAge(client, father.fecha_nacimiento, input.fecha, rules.edad_minima_padre_meses, 'El padre');
    }
    if (input.id_donante) {
        const donor = await activeAnimal(client, input.id_donante, 'HEMBRA', 'La donante');
        if (donor.id_especie !== cow.id_especie)
            throw new ValidationError('La donante y la receptora deben pertenecer a la misma especie.');
    }
    return { ...input, id_celo: input.id_celo ?? null, id_padre: input.id_padre ?? null, padre_externo: input.padre_externo ?? null, id_donante: input.tipo === 'TRANSFERENCIA_EMBRIONES' ? input.id_donante ?? null : null, donante_externa: input.tipo === 'TRANSFERENCIA_EMBRIONES' ? input.donante_externa ?? null : null, codigo_material: input.codigo_material ?? null, calidad: input.calidad ?? null, tecnico: input.tecnico ?? null, proveedor: input.proveedor ?? null, observaciones: input.observaciones ?? null };
}
reproductionRouter.get('/servicios', requirePermission('PARTO_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, (await pool.query(`SELECT s.*,v.nombre vaca,v.codigo_arete,v.id_categoria_animal,ca.codigo categoria_codigo,ca.nombre categoria,
    COALESCE(p.nombre,s.padre_externo) padre,COALESCE(d.nombre,s.donante_externa) donante,
    EXISTS(SELECT 1 FROM prenez pr WHERE pr.id_servicio_reproductivo=s.id_servicio_reproductivo AND pr.deleted_at IS NULL) tiene_prenez
   FROM servicio_reproductivo s JOIN animal v ON v.id_animal=s.id_vaca
   JOIN categoria_animal ca ON ca.id_categoria_animal=v.id_categoria_animal
   LEFT JOIN animal p ON p.id_animal=s.id_padre LEFT JOIN animal d ON d.id_animal=s.id_donante
   WHERE s.deleted_at IS NULL ORDER BY s.fecha DESC,s.created_at DESC`)).rows)));
reproductionRouter.post('/servicios', requirePermission('PARTO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const input = assistedServiceSchema.parse(req.body);
    const row = await transaction(async (client) => {
        const data = await assistedServiceData(client, input);
        return (await client.query(buildInsert('servicio_reproductivo', { ...data, registrado_por: req.user.id }))).rows[0];
    }, req.user.id);
    return created(res, row);
}));
reproductionRouter.patch('/servicios/:id', requirePermission('PARTO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const input = assistedServiceSchema.parse(req.body);
    const id = routeParam(req.params.id, 'id');
    const row = await transaction(async (client) => {
        const linked = await client.query('SELECT 1 FROM prenez WHERE id_servicio_reproductivo=$1 AND deleted_at IS NULL LIMIT 1', [id]);
        if (linked.rowCount)
            throw new ValidationError('No se puede modificar un servicio que ya tiene una preñez relacionada.');
        const data = await assistedServiceData(client, input);
        const saved = (await client.query(buildUpdate('servicio_reproductivo', 'id_servicio_reproductivo', id, data))).rows[0];
        if (!saved)
            throw new NotFoundError('Servicio reproductivo no encontrado.');
        return saved;
    }, req.user.id);
    return ok(res, row);
}));
reproductionRouter.delete('/servicios/:id', requirePermission('PARTO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, 'id');
    await transaction(async (client) => {
        const linked = await client.query('SELECT 1 FROM prenez WHERE id_servicio_reproductivo=$1 AND deleted_at IS NULL LIMIT 1', [id]);
        if (linked.rowCount)
            throw new ValidationError('No se puede eliminar un servicio que ya tiene una preñez relacionada.');
        const result = await client.query('UPDATE servicio_reproductivo SET deleted_at=NOW(),updated_at=NOW() WHERE id_servicio_reproductivo=$1 AND deleted_at IS NULL', [id]);
        if (!result.rowCount)
            throw new NotFoundError('Servicio reproductivo no encontrado.');
    }, req.user.id);
    return noContent(res);
}));
reproductionRouter.get('/preneces', requirePermission('PARTO_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, (await pool.query(`SELECT p.*,v.nombre vaca,v.codigo_arete,v.id_especie,v.id_categoria_animal,COALESCE(pa.nombre,p.padre_externo) padre,c.fecha_inicio celo_inicio,
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
        const data = await pregnancyData(client, input, id);
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
    v.nombre vaca,v.codigo_arete,COALESCE(pa.nombre,p.padre_externo) padre,ca.codigo categoria_codigo,ca.nombre categoria
   FROM proximo_parto pp JOIN prenez p ON p.id_prenez=pp.id_prenez AND p.deleted_at IS NULL
   JOIN animal v ON v.id_animal=pp.id_vaca
   JOIN categoria_animal ca ON ca.id_categoria_animal=v.id_categoria_animal
   LEFT JOIN animal pa ON pa.id_animal=p.id_padre
   WHERE pp.deleted_at IS NULL AND pp.estado='PENDIENTE' AND p.estado='CONFIRMADA'
   ORDER BY pp.fecha_tentativa NULLS LAST,v.nombre`)).rows)));
//# sourceMappingURL=reproduction.routes.js.map