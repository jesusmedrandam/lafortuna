import { Router } from 'express';
import { pool } from '../../database/pool.js';
import { asyncHandler } from '../../core/async-handler.js';
import { ok } from '../../core/http.js';
import { requirePermission } from '../../middleware/permission.js';
import { cache } from '../../services/cache.service.js';

export const dashboardRouter = Router();

dashboardRouter.get('/resumen', requirePermission('DASHBOARD_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, await cache.rememberComposite(
  ['animales', 'produccion', 'sanidad', 'grupos', 'ubicaciones', 'ventas'],
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
