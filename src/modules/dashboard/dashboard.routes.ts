import { Router } from 'express';
import { pool } from '../../database/pool.js';
import { asyncHandler } from '../../core/async-handler.js';
import { ok } from '../../core/http.js';
import { requirePermission } from '../../middleware/permission.js';
import { cache } from '../../services/cache.service.js';
import { z } from 'zod';

export const dashboardRouter = Router();

const cardKeys = z.enum(['ingresos_hoy','ingresos_mes','ventas_mes','potreros_ocupados','animales_total','animales_activos','hembras','machos','grupos','litros_hoy','tratamientos_hoy','proximos_partos']);

dashboardRouter.get('/preferencias', requirePermission('DASHBOARD_CONSULTAR'), asyncHandler(async (req, res) => {
  const row = (await pool.query('SELECT tarjetas FROM usuario_preferencia_panel WHERE id_usuario=$1', [req.user!.id])).rows[0];
  return ok(res, { tarjetas: row?.tarjetas ?? null });
}));

dashboardRouter.patch('/preferencias', requirePermission('DASHBOARD_CONSULTAR'), asyncHandler(async (req, res) => {
  const tarjetas = z.array(cardKeys).max(30).parse(req.body.tarjetas);
  const row = (await pool.query(
    `INSERT INTO usuario_preferencia_panel(id_usuario,tarjetas) VALUES($1,$2::jsonb)
     ON CONFLICT(id_usuario) DO UPDATE SET tarjetas=EXCLUDED.tarjetas,updated_at=NOW()
     RETURNING tarjetas`,
    [req.user!.id, JSON.stringify([...new Set(tarjetas)])],
  )).rows[0];
  return ok(res, row);
}));

dashboardRouter.get('/resumen', requirePermission('DASHBOARD_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, await cache.rememberComposite(
  ['animales', 'produccion', 'sanidad', 'grupos', 'ubicaciones', 'ventas', 'reproduccion'],
  'dashboard-resumen',
  60,
  async () => {
    const result = await pool.query(`SELECT
      (SELECT COUNT(*)::int FROM animal WHERE deleted_at IS NULL) animales_total,
      (SELECT COUNT(*)::int FROM animal WHERE deleted_at IS NULL AND estado='ACTIVO') animales_activos,
      (SELECT COUNT(*)::int FROM animal WHERE deleted_at IS NULL AND estado='ACTIVO' AND sexo='HEMBRA') hembras,
      (SELECT COUNT(*)::int FROM animal WHERE deleted_at IS NULL AND estado='ACTIVO' AND sexo='MACHO') machos,
      (SELECT COUNT(*)::int FROM grupo WHERE deleted_at IS NULL AND activo) grupos,
      (SELECT COUNT(*)::int FROM ubicacion WHERE deleted_at IS NULL AND activo) ubicaciones,
      (SELECT COALESCE(SUM(litros),0)::numeric FROM produccion_leche WHERE deleted_at IS NULL AND fecha_produccion=CURRENT_DATE) litros_hoy,
      (SELECT COUNT(*)::int FROM tratamiento_animal WHERE deleted_at IS NULL AND fecha_aplicacion::date=CURRENT_DATE) tratamientos_hoy,
      (SELECT COUNT(*)::int FROM proximo_parto pp JOIN prenez pr ON pr.id_prenez=pp.id_prenez
       WHERE pp.deleted_at IS NULL AND pp.estado='PENDIENTE' AND pr.deleted_at IS NULL AND pr.estado='CONFIRMADA') proximos_partos,
      (SELECT COUNT(DISTINCT p.id_potrero)::int
       FROM potrero p JOIN animal a ON a.id_ubicacion_actual=p.id_ubicacion
       WHERE p.deleted_at IS NULL AND a.deleted_at IS NULL AND a.estado='ACTIVO') potreros_ocupados,
      ((SELECT COUNT(*) FROM venta_animal
        WHERE deleted_at IS NULL AND estado='COMPLETADA'
          AND fecha_venta>=date_trunc('month',CURRENT_DATE)
          AND fecha_venta<date_trunc('month',CURRENT_DATE)+INTERVAL '1 month')
       +(SELECT COUNT(*) FROM venta_producto
        WHERE deleted_at IS NULL AND estado='COMPLETADA'
          AND fecha_venta>=date_trunc('month',CURRENT_DATE)
          AND fecha_venta<date_trunc('month',CURRENT_DATE)+INTERVAL '1 month'))::int ventas_mes,
      ((SELECT COALESCE(SUM(precio_total),0) FROM venta_animal
        WHERE deleted_at IS NULL AND estado='COMPLETADA' AND fecha_venta::date=CURRENT_DATE)
       +(SELECT COALESCE(SUM(precio_total),0) FROM venta_producto
        WHERE deleted_at IS NULL AND estado='COMPLETADA' AND fecha_venta::date=CURRENT_DATE))::numeric ingresos_hoy,
      ((SELECT COALESCE(SUM(precio_total),0) FROM venta_animal
        WHERE deleted_at IS NULL AND estado='COMPLETADA'
          AND fecha_venta>=date_trunc('month',CURRENT_DATE)
          AND fecha_venta<date_trunc('month',CURRENT_DATE)+INTERVAL '1 month')
       +(SELECT COALESCE(SUM(precio_total),0) FROM venta_producto
        WHERE deleted_at IS NULL AND estado='COMPLETADA'
          AND fecha_venta>=date_trunc('month',CURRENT_DATE)
          AND fecha_venta<date_trunc('month',CURRENT_DATE)+INTERVAL '1 month'))::numeric ingresos_mes`);
    return result.rows[0];
  },
))));
