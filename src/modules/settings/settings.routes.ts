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
    codigo_operacion: z.enum(animalOperationDefinitions.map((item) => item.codigo) as [string, ...string[]]),
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
      await client.query(
        `INSERT INTO operacion_categoria_animal(id_categoria_animal,codigo_operacion,permitido,registrado_por)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(id_categoria_animal,codigo_operacion)
         DO UPDATE SET permitido=EXCLUDED.permitido,deleted_at=NULL,updated_at=NOW(),registrado_por=EXCLUDED.registrado_por`,
        [item.id_categoria_animal, item.codigo_operacion, item.permitido, req.user!.id],
      );
    }
  }, req.user!.id);
  return ok(res, { message: 'Configuración de operaciones actualizada.' });
}));

settingsRouter.get('/finca', requirePermission('CATALOGO_CONSULTAR'), asyncHandler(async (_req, res) => {
  const rows = (await pool.query(`SELECT
      p.id_propiedad,p.codigo,p.nombre,p.es_principal,p.activa,
      COALESCE(cp.alertas_garrapata,TRUE) alertas_garrapata,
      COALESCE(cp.inicio_eclosion_dias,21)::int inicio_eclosion_dias,
      COALESCE(cp.descanso_minimo_dias,45)::int descanso_minimo_dias,
      COALESCE(cp.riesgo_reducido_dias,100)::int riesgo_reducido_dias,
      cp.updated_at
    FROM propiedad_ganadera p
    LEFT JOIN configuracion_propiedad cp ON cp.id_propiedad=p.id_propiedad
    WHERE p.deleted_at IS NULL
    ORDER BY p.es_principal DESC,p.activa DESC,p.nombre`)).rows;
  return ok(res, { propiedades: rows });
}));

settingsRouter.put('/finca/:id/alertas-garrapata', requirePermission('CATALOGO_ADMINISTRAR'), asyncHandler(async (req, res) => {
  const propertyId = routeParam(req.params.id, 'id');
  const input = tickConfigurationSchema.parse(req.body);
  const row = await transaction(async (client) => {
    const property = (await client.query(
      `SELECT id_propiedad FROM propiedad_ganadera
       WHERE id_propiedad=$1 AND deleted_at IS NULL FOR UPDATE`,
      [propertyId],
    )).rows[0];
    if (!property) throw new NotFoundError('Propiedad no encontrada.');
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
      propertyId,input.alertas_garrapata,input.inicio_eclosion_dias,
      input.descanso_minimo_dias,input.riesgo_reducido_dias,req.user!.id,
    ])).rows[0];
  }, req.user!.id);
  return ok(res, row);
}));
