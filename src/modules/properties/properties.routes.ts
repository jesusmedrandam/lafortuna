import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/async-handler.js';
import { ConflictError, NotFoundError } from '../../core/errors.js';
import { created, noContent, ok } from '../../core/http.js';
import { routeParam } from '../../core/route-param.js';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { requirePermission } from '../../middleware/permission.js';
import { buildInsert, buildUpdate } from '../shared/sql.js';

const propertySchema = z.object({
  codigo: z.string().trim().max(50).nullable().optional(),
  nombre: z.string().trim().min(2).max(120),
  descripcion: z.string().trim().max(300).nullable().optional(),
  latitud: z.number().min(-90).max(90).nullable().optional(),
  longitud: z.number().min(-180).max(180).nullable().optional(),
  es_principal: z.boolean().optional(),
  activa: z.boolean().optional(),
});

export const propertiesRouter = Router();

propertiesRouter.get('/', requirePermission('UBICACION_CONSULTAR'), asyncHandler(async (_req, res) => {
  const rows = (await pool.query(`
    SELECT p.*,
      (SELECT COUNT(*)::int FROM grupo g
       WHERE g.id_propiedad=p.id_propiedad AND g.deleted_at IS NULL) total_grupos,
      (SELECT COUNT(*)::int FROM ubicacion u
       WHERE u.id_propiedad=p.id_propiedad AND u.tipo='POTRERO' AND u.deleted_at IS NULL) total_potreros,
      (SELECT COUNT(*)::int FROM ubicacion u
       WHERE u.id_propiedad=p.id_propiedad AND u.tipo='CORRAL' AND u.deleted_at IS NULL) total_corrales,
      (SELECT COUNT(DISTINCT a.id_animal)::int
       FROM animal a
       LEFT JOIN grupo g ON g.id_grupo=a.id_grupo_actual
       LEFT JOIN ubicacion u ON u.id_ubicacion=a.id_ubicacion_actual
       WHERE COALESCE(g.id_propiedad,u.id_propiedad)=p.id_propiedad
         AND a.deleted_at IS NULL AND a.estado='ACTIVO') total_animales
    FROM propiedad_ganadera p
    WHERE p.deleted_at IS NULL
    ORDER BY p.es_principal DESC,p.activa DESC,p.nombre
  `)).rows;
  return ok(res, rows);
}));

propertiesRouter.post('/', requirePermission('UBICACION_ADMINISTRAR'), asyncHandler(async (req, res) => {
  const input = propertySchema.parse(req.body);
  const row = await transaction(async (client) => {
    const hasPrincipal = Boolean((await client.query(
      'SELECT 1 FROM propiedad_ganadera WHERE es_principal=TRUE AND deleted_at IS NULL LIMIT 1',
    )).rowCount);
    const principal = input.es_principal ?? !hasPrincipal;
    if (principal) {
      await client.query(
        'UPDATE propiedad_ganadera SET es_principal=FALSE,updated_at=NOW() WHERE es_principal=TRUE AND deleted_at IS NULL',
      );
    }
    return (await client.query(buildInsert('propiedad_ganadera', { ...input, es_principal: principal }))).rows[0];
  }, req.user!.id);
  return created(res, row);
}));

propertiesRouter.patch('/:id', requirePermission('UBICACION_ADMINISTRAR'), asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, 'id');
  const input = propertySchema.partial().parse(req.body);
  const row = await transaction(async (client) => {
    const current = (await client.query(
      'SELECT * FROM propiedad_ganadera WHERE id_propiedad=$1 AND deleted_at IS NULL FOR UPDATE',
      [id],
    )).rows[0] as { es_principal: boolean; activa: boolean } | undefined;
    if (!current) throw new NotFoundError('Propiedad no encontrada.');
    if (current.es_principal && input.es_principal === false) {
      throw new ConflictError('Primero selecciona otra propiedad como principal. El sistema siempre debe conservar una.');
    }
    if (current.es_principal && input.activa === false) {
      throw new ConflictError('La propiedad principal no puede desactivarse. Selecciona primero otra propiedad como principal.');
    }
    if (input.es_principal === true) {
      await client.query(
        `UPDATE propiedad_ganadera SET es_principal=FALSE,updated_at=NOW()
         WHERE id_propiedad<>$1 AND es_principal=TRUE AND deleted_at IS NULL`,
        [id],
      );
      input.activa = true;
    }
    const updated = (await client.query(buildUpdate('propiedad_ganadera', 'id_propiedad', id, input))).rows[0];
    if (!updated) throw new NotFoundError('Propiedad no encontrada.');
    return updated;
  }, req.user!.id);
  return ok(res, row);
}));

propertiesRouter.delete('/:id', requirePermission('UBICACION_ADMINISTRAR'), asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, 'id');
  await transaction(async (client) => {
    const current = (await client.query(
      'SELECT es_principal FROM propiedad_ganadera WHERE id_propiedad=$1 AND deleted_at IS NULL FOR UPDATE',
      [id],
    )).rows[0] as { es_principal: boolean } | undefined;
    if (!current) throw new NotFoundError('Propiedad no encontrada.');
    if (current.es_principal) throw new ConflictError('La propiedad principal no puede eliminarse.');
    const related = await client.query(
      `SELECT
        EXISTS(SELECT 1 FROM grupo WHERE id_propiedad=$1 AND deleted_at IS NULL) grupos,
        EXISTS(SELECT 1 FROM ubicacion WHERE id_propiedad=$1 AND tipo IN('POTRERO','CORRAL') AND deleted_at IS NULL) ubicaciones`,
      [id],
    );
    if (related.rows[0]?.grupos || related.rows[0]?.ubicaciones) {
      throw new ConflictError('La propiedad tiene grupos, potreros o corrales. Trasládalos o elimínalos antes de desactivarla.');
    }
    await client.query(
      'UPDATE propiedad_ganadera SET activa=FALSE,deleted_at=NOW(),updated_at=NOW() WHERE id_propiedad=$1',
      [id],
    );
  }, req.user!.id);
  return noContent(res);
}));
