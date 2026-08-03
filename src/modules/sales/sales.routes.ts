import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/async-handler.js';
import { created, ok } from '../../core/http.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { routeParam } from '../../core/route-param.js';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { requirePermission } from '../../middleware/permission.js';
import { cache } from '../../services/cache.service.js';
import { buildInsert } from '../shared/sql.js';

const detailSchema = z.object({
  id_animal: z.string().uuid(),
  precio_individual: z.number().min(0).nullable().optional(),
  observaciones: z.string().trim().max(300).nullable().optional(),
});

const saleSchema = z.object({
  fecha_venta: z.string().datetime(),
  comprador_nombre: z.string().trim().min(2).max(200),
  comprador_contacto: z.string().trim().max(160).nullable().optional(),
  destino: z.string().trim().max(220).nullable().optional(),
  precio_total: z.number().min(0).nullable().optional(),
  moneda: z.string().trim().length(3).default('USD'),
  observaciones: z.string().trim().max(2000).nullable().optional(),
  animales: z.array(detailSchema).min(1),
});

export const salesRouter = Router();

salesRouter.get('/', requirePermission('VENTA_CONSULTAR'), asyncHandler(async (_req, res) => {
  const rows = (await pool.query(
    `SELECT v.*,
      TRIM(CONCAT(u.nombres, ' ', u.apellidos)) registrado_por_nombre,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id_venta_detalle', d.id_venta_detalle,
          'id_animal', a.id_animal,
          'animal', a.nombre,
          'codigo_arete', a.codigo_arete,
          'precio_individual', d.precio_individual,
          'observaciones', d.observaciones
        ) ORDER BY a.nombre)
        FROM venta_animal_detalle d
        JOIN animal a ON a.id_animal=d.id_animal
        WHERE d.id_venta=v.id_venta AND d.deleted_at IS NULL
      ), '[]'::jsonb) animales
     FROM venta_animal v
     JOIN usuario u ON u.id_usuario=v.registrado_por
     WHERE v.deleted_at IS NULL
     ORDER BY v.fecha_venta DESC, v.created_at DESC`,
  )).rows;
  return ok(res, rows);
}));

salesRouter.post('/', requirePermission('VENTA_ADMINISTRAR'), asyncHandler(async (req, res) => {
  const input = saleSchema.parse(req.body);
  const uniqueIds = new Set(input.animales.map((item) => item.id_animal));
  if (uniqueIds.size !== input.animales.length) throw new ValidationError('No repitas animales en la misma venta.');

  const sale = await transaction(async (client) => {
    const animals = (await client.query(
      `SELECT id_animal,nombre,estado,id_grupo_actual,id_ubicacion_actual
       FROM animal
       WHERE id_animal=ANY($1::uuid[]) AND deleted_at IS NULL
       FOR UPDATE`,
      [[...uniqueIds]],
    )).rows;
    if (animals.length !== uniqueIds.size) throw new NotFoundError('Uno o más animales no existen.');
    const unavailable = animals.filter((animal) => ['MUERTO', 'VENDIDO'].includes(animal.estado));
    if (unavailable.length) {
      throw new ConflictError(`No se pueden vender: ${unavailable.map((item) => item.nombre).join(', ')}.`);
    }

    const { animales, ...header } = input;
    const row = (await client.query(buildInsert('venta_animal', {
      ...header,
      moneda: header.moneda.toUpperCase(),
      registrado_por: req.user!.id,
    }))).rows[0];

    for (const detail of animales) {
      const animal = animals.find((item) => item.id_animal === detail.id_animal)!;
      const ownerSnapshot = (await client.query(
        `SELECT ap.id_usuario,ap.porcentaje_propiedad,ap.es_principal,
                TRIM(CONCAT(u.nombres,' ',u.apellidos)) nombre
         FROM animal_propietario ap
         JOIN usuario u ON u.id_usuario=ap.id_usuario
         WHERE ap.id_animal=$1 AND ap.fecha_hasta IS NULL AND ap.deleted_at IS NULL
         ORDER BY ap.es_principal DESC,u.nombres,u.apellidos`,
        [animal.id_animal],
      )).rows;

      await client.query(buildInsert('venta_animal_detalle', {
        id_venta: row.id_venta,
        id_animal: animal.id_animal,
        precio_individual: detail.precio_individual ?? null,
        estado_anterior: animal.estado,
        id_grupo_anterior: animal.id_grupo_actual,
        id_ubicacion_anterior: animal.id_ubicacion_actual,
        propietarios_anteriores: JSON.stringify(ownerSnapshot),
        observaciones: detail.observaciones ?? null,
      }));

      await client.query(
        `UPDATE animal
         SET estado='VENDIDO',id_grupo_actual=NULL,id_ubicacion_actual=NULL
         WHERE id_animal=$1`,
        [animal.id_animal],
      );
      await client.query(
        `UPDATE animal_grupo_historial
         SET fecha_hasta=$2
         WHERE id_animal=$1 AND fecha_hasta IS NULL AND deleted_at IS NULL`,
        [animal.id_animal, input.fecha_venta],
      );
      await client.query(
        `UPDATE animal_ubicacion_historial
         SET fecha_hasta=$2
         WHERE id_animal=$1 AND fecha_hasta IS NULL AND deleted_at IS NULL`,
        [animal.id_animal, input.fecha_venta],
      );
      await client.query(
        `UPDATE animal_propietario
         SET fecha_hasta=$2::date
         WHERE id_animal=$1 AND fecha_hasta IS NULL AND deleted_at IS NULL`,
        [animal.id_animal, input.fecha_venta],
      );
    }

    return row;
  }, req.user!.id);

  cache.forgetModuleVersion('ventas');
  cache.forgetModuleVersion('animales');
  return created(res, sale);
}));

salesRouter.patch('/:id/anular', requirePermission('VENTA_ADMINISTRAR'), asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, 'id');
  const result = await transaction(async (client) => {
    const sale = (await client.query(
      `SELECT * FROM venta_animal
       WHERE id_venta=$1 AND deleted_at IS NULL
       FOR UPDATE`,
      [id],
    )).rows[0];
    if (!sale) throw new NotFoundError('Venta no encontrada.');
    if (sale.estado === 'ANULADA') throw new ConflictError('La venta ya está anulada.');

    const details = (await client.query(
      `SELECT * FROM venta_animal_detalle
       WHERE id_venta=$1 AND deleted_at IS NULL`,
      [id],
    )).rows;

    for (const detail of details) {
      const updated = (await client.query(
        `UPDATE animal
         SET estado=$2,id_grupo_actual=$3,id_ubicacion_actual=$4
         WHERE id_animal=$1 AND estado='VENDIDO' AND deleted_at IS NULL
         RETURNING id_animal`,
        [detail.id_animal, detail.estado_anterior, detail.id_grupo_anterior, detail.id_ubicacion_anterior],
      )).rows[0];
      if (!updated) {
        throw new ConflictError('No se puede anular la venta porque uno de los animales ya no está marcado como vendido.');
      }

      await client.query(
        `UPDATE animal_grupo_historial
         SET fecha_hasta=NOW()
         WHERE id_animal=$1 AND fecha_hasta IS NULL AND deleted_at IS NULL`,
        [detail.id_animal],
      );
      await client.query(
        `UPDATE animal_ubicacion_historial
         SET fecha_hasta=NOW()
         WHERE id_animal=$1 AND fecha_hasta IS NULL AND deleted_at IS NULL`,
        [detail.id_animal],
      );
      await client.query(
        `UPDATE animal_propietario
         SET fecha_hasta=CURRENT_DATE
         WHERE id_animal=$1 AND fecha_hasta IS NULL AND deleted_at IS NULL`,
        [detail.id_animal],
      );

      if (detail.id_grupo_anterior) {
        await client.query(buildInsert('animal_grupo_historial', {
          id_animal: detail.id_animal,
          id_grupo: detail.id_grupo_anterior,
          fecha_desde: new Date().toISOString(),
          motivo: 'Restauración por anulación de venta',
          registrado_por: req.user!.id,
        }));
      }
      if (detail.id_ubicacion_anterior) {
        await client.query(buildInsert('animal_ubicacion_historial', {
          id_animal: detail.id_animal,
          id_ubicacion: detail.id_ubicacion_anterior,
          fecha_desde: new Date().toISOString(),
          motivo: 'Restauración por anulación de venta',
          registrado_por: req.user!.id,
        }));
      }
      const owners = Array.isArray(detail.propietarios_anteriores) ? detail.propietarios_anteriores : [];
      for (const owner of owners) {
        await client.query(buildInsert('animal_propietario', {
          id_animal: detail.id_animal,
          id_usuario: owner.id_usuario,
          porcentaje_propiedad: owner.porcentaje_propiedad ?? null,
          es_principal: owner.es_principal ?? false,
          fecha_desde: new Date().toISOString().slice(0, 10),
          registrado_por: req.user!.id,
        }));
      }
    }

    return (await client.query(
      `UPDATE venta_animal
       SET estado='ANULADA',anulado_en=NOW()
       WHERE id_venta=$1
       RETURNING *`,
      [id],
    )).rows[0];
  }, req.user!.id);

  cache.forgetModuleVersion('ventas');
  cache.forgetModuleVersion('animales');
  return ok(res, result);
}));
