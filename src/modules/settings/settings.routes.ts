import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { asyncHandler } from '../../core/async-handler.js';
import { ok } from '../../core/http.js';
import { requirePermission } from '../../middleware/permission.js';
import { animalOperationDefinitions } from '../../services/animal-operation-policy.js';

const updateSchema = z.object({
  configuracion: z.array(z.object({
    id_categoria_animal: z.string().uuid(),
    codigo_operacion: z.enum(animalOperationDefinitions.map((item) => item.codigo) as [string, ...string[]]),
    permitido: z.boolean(),
  })),
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
