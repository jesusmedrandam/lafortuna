import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { asyncHandler } from '../../core/async-handler.js';
import { NotFoundError } from '../../core/errors.js';
import { ok } from '../../core/http.js';
import { routeParam } from '../../core/route-param.js';
import { requirePermission } from '../../middleware/permission.js';
import { animalOperationDefinitions } from '../../services/animal-operation-policy.js';
const updateSchema = z.object({
    configuracion: z.array(z.object({
        id_categoria_animal: z.string().uuid(),
        codigo_operacion: z.enum(animalOperationDefinitions.map((item) => item.codigo)),
        permitido: z.boolean(),
    })),
});
const tickConfigurationSchema = z.object({
    alertas_garrapata: z.boolean(),
    inicio_eclosion_dias: z.number().int().min(1).max(120),
    descanso_minimo_dias: z.number().int().min(2).max(180),
    riesgo_reducido_dias: z.number().int().min(3).max(365),
}).superRefine((value, context) => {
    if (value.inicio_eclosion_dias >= value.descanso_minimo_dias) {
        context.addIssue({
            code: 'custom',
            path: ['descanso_minimo_dias'],
            message: 'El descanso mínimo debe ser mayor que el inicio posible de eclosión.',
        });
    }
    if (value.descanso_minimo_dias >= value.riesgo_reducido_dias) {
        context.addIssue({
            code: 'custom',
            path: ['riesgo_reducido_dias'],
            message: 'El riesgo reducido debe comenzar después del descanso mínimo.',
        });
    }
});
const reproductionConfigurationSchema = z.object({
    dias_posparto_para_celo: z.number().int().min(0).max(365),
    dias_posparto_para_prenez: z.number().int().min(0).max(365),
    dias_posaborto_para_celo: z.number().int().min(0).max(365),
    dias_posaborto_para_prenez: z.number().int().min(0).max(365),
    edad_minima_celo_meses: z.number().int().min(0).max(120),
    edad_minima_padre_meses: z.number().int().min(0).max(120),
    permitir_segundo_celo: z.boolean(),
    permitir_celo_falso_en_prenez: z.boolean(),
    usar_ultimo_celo_valido: z.boolean(),
    dias_maximos_ordeno_posparto: z.number().int().min(1).max(730),
});
export const settingsRouter = Router();
settingsRouter.get('/operaciones-animales', requirePermission('CATALOGO_CONSULTAR'), asyncHandler(async (_req, res) => {
    const [categories, configuration] = await Promise.all([
        pool.query(`SELECT id_categoria_animal,codigo,nombre FROM categoria_animal WHERE deleted_at IS NULL AND activo=TRUE ORDER BY nombre`),
        pool.query(`SELECT id_categoria_animal,codigo_operacion,permitido FROM operacion_categoria_animal WHERE deleted_at IS NULL`),
    ]);
    return ok(res, { categorias: categories.rows, operaciones: animalOperationDefinitions, configuracion: configuration.rows });
}));
settingsRouter.put('/operaciones-animales', requirePermission('CATALOGO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);
    await transaction(async (client) => {
        for (const item of input.configuracion) {
            await client.query(`INSERT INTO operacion_categoria_animal(id_categoria_animal,codigo_operacion,permitido,registrado_por)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(id_categoria_animal,codigo_operacion)
         DO UPDATE SET permitido=EXCLUDED.permitido,deleted_at=NULL,updated_at=NOW(),registrado_por=EXCLUDED.registrado_por`, [item.id_categoria_animal, item.codigo_operacion, item.permitido, req.user.id]);
        }
    }, req.user.id);
    return ok(res, { message: 'Configuración de operaciones actualizada.' });
}));
settingsRouter.get('/finca', requirePermission('CATALOGO_CONSULTAR'), asyncHandler(async (_req, res) => {
    const rows = (await pool.query(`SELECT
      p.id_propiedad,p.codigo,p.nombre,p.es_principal,p.activa,
      COALESCE(cp.alertas_garrapata,TRUE) alertas_garrapata,
      COALESCE(cp.inicio_eclosion_dias,21)::int inicio_eclosion_dias,
      COALESCE(cp.descanso_minimo_dias,45)::int descanso_minimo_dias,
      COALESCE(cp.riesgo_reducido_dias,100)::int riesgo_reducido_dias,
      COALESCE(cp.dias_posparto_para_celo,30)::int dias_posparto_para_celo,
      COALESCE(cp.dias_posparto_para_prenez,45)::int dias_posparto_para_prenez,
      COALESCE(cp.dias_posaborto_para_celo,21)::int dias_posaborto_para_celo,
      COALESCE(cp.dias_posaborto_para_prenez,30)::int dias_posaborto_para_prenez,
      COALESCE(cp.edad_minima_celo_meses,12)::int edad_minima_celo_meses,
      COALESCE(cp.edad_minima_padre_meses,12)::int edad_minima_padre_meses,
      COALESCE(cp.permitir_segundo_celo,TRUE) permitir_segundo_celo,
      COALESCE(cp.permitir_celo_falso_en_prenez,TRUE) permitir_celo_falso_en_prenez,
      COALESCE(cp.usar_ultimo_celo_valido,TRUE) usar_ultimo_celo_valido,
      COALESCE(cp.dias_maximos_ordeno_posparto,305)::int dias_maximos_ordeno_posparto,
      cp.updated_at
    FROM propiedad_ganadera p
    LEFT JOIN configuracion_propiedad cp ON cp.id_propiedad=p.id_propiedad
    WHERE p.deleted_at IS NULL
    ORDER BY p.es_principal DESC,p.activa DESC,p.nombre`)).rows;
    return ok(res, { propiedades: rows });
}));
settingsRouter.put('/finca/:id/reglas-reproduccion', requirePermission('CATALOGO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const propertyId = routeParam(req.params.id, 'id');
    const input = reproductionConfigurationSchema.parse(req.body);
    const row = await transaction(async (client) => {
        const property = (await client.query('SELECT id_propiedad FROM propiedad_ganadera WHERE id_propiedad=$1 AND deleted_at IS NULL FOR UPDATE', [propertyId])).rows[0];
        if (!property)
            throw new NotFoundError('Propiedad no encontrada.');
        return (await client.query(`INSERT INTO configuracion_propiedad(
      id_propiedad,dias_posparto_para_celo,dias_posparto_para_prenez,
      dias_posaborto_para_celo,dias_posaborto_para_prenez,
      edad_minima_celo_meses,edad_minima_padre_meses,
      permitir_segundo_celo,permitir_celo_falso_en_prenez,
      usar_ultimo_celo_valido,dias_maximos_ordeno_posparto,actualizado_por
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT(id_propiedad) DO UPDATE SET
      dias_posparto_para_celo=EXCLUDED.dias_posparto_para_celo,
      dias_posparto_para_prenez=EXCLUDED.dias_posparto_para_prenez,
      dias_posaborto_para_celo=EXCLUDED.dias_posaborto_para_celo,
      dias_posaborto_para_prenez=EXCLUDED.dias_posaborto_para_prenez,
      edad_minima_celo_meses=EXCLUDED.edad_minima_celo_meses,
      edad_minima_padre_meses=EXCLUDED.edad_minima_padre_meses,
      permitir_segundo_celo=EXCLUDED.permitir_segundo_celo,
      permitir_celo_falso_en_prenez=EXCLUDED.permitir_celo_falso_en_prenez,
      usar_ultimo_celo_valido=EXCLUDED.usar_ultimo_celo_valido,
      dias_maximos_ordeno_posparto=EXCLUDED.dias_maximos_ordeno_posparto,
      actualizado_por=EXCLUDED.actualizado_por,updated_at=NOW()
    RETURNING *`, [propertyId, input.dias_posparto_para_celo, input.dias_posparto_para_prenez,
            input.dias_posaborto_para_celo, input.dias_posaborto_para_prenez, input.edad_minima_celo_meses,
            input.edad_minima_padre_meses, input.permitir_segundo_celo, input.permitir_celo_falso_en_prenez,
            input.usar_ultimo_celo_valido, input.dias_maximos_ordeno_posparto, req.user.id])).rows[0];
    }, req.user.id);
    return ok(res, row);
}));
settingsRouter.put('/finca/:id/alertas-garrapata', requirePermission('CATALOGO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const propertyId = routeParam(req.params.id, 'id');
    const input = tickConfigurationSchema.parse(req.body);
    const row = await transaction(async (client) => {
        const property = (await client.query(`SELECT id_propiedad FROM propiedad_ganadera
       WHERE id_propiedad=$1 AND deleted_at IS NULL FOR UPDATE`, [propertyId])).rows[0];
        if (!property)
            throw new NotFoundError('Propiedad no encontrada.');
        return (await client.query(`INSERT INTO configuracion_propiedad(
        id_propiedad,alertas_garrapata,inicio_eclosion_dias,
        descanso_minimo_dias,riesgo_reducido_dias,actualizado_por
      ) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(id_propiedad) DO UPDATE SET
        alertas_garrapata=EXCLUDED.alertas_garrapata,
        inicio_eclosion_dias=EXCLUDED.inicio_eclosion_dias,
        descanso_minimo_dias=EXCLUDED.descanso_minimo_dias,
        riesgo_reducido_dias=EXCLUDED.riesgo_reducido_dias,
        actualizado_por=EXCLUDED.actualizado_por,
        updated_at=NOW()
      RETURNING id_propiedad,alertas_garrapata,inicio_eclosion_dias,
        descanso_minimo_dias,riesgo_reducido_dias,updated_at`, [
            propertyId, input.alertas_garrapata, input.inicio_eclosion_dias,
            input.descanso_minimo_dias, input.riesgo_reducido_dias, req.user.id,
        ])).rows[0];
    }, req.user.id);
    return ok(res, row);
}));
//# sourceMappingURL=settings.routes.js.map