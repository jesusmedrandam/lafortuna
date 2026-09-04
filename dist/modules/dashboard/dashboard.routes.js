import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { asyncHandler } from '../../core/async-handler.js';
import { ok } from '../../core/http.js';
import { requirePermission } from '../../middleware/permission.js';
import { cache } from '../../services/cache.service.js';
export const dashboardRouter = Router();
const dashboardConfigurationSchema = z.object({
    animales: z.array(z.enum(['en_propiedad', 'fuera_propiedad', 'activos', 'inactivos'])).max(4).optional(),
    ingresos: z.array(z.enum(['semana', 'mes', 'anio'])).max(3).optional(),
    egresos: z.array(z.enum(['semana', 'mes', 'anio'])).max(3).optional(),
    ventas: z.array(z.enum(['semana', 'mes', 'anio'])).max(3).optional(),
    produccion: z.array(z.enum(['hoy', 'semana', 'mes'])).max(3).optional(),
    tratamientos: z.array(z.enum(['hoy', 'semana', 'mes'])).max(3).optional(),
    traslados: z.array(z.enum(['semana', 'mes', 'anio'])).max(3).optional(),
    potreros: z.array(z.enum(['total', 'ocupados', 'descanso'])).max(3).optional(),
    grupos: z.array(z.enum(['total', 'con_animales', 'animales_agrupados'])).max(3).optional(),
    reproduccion: z.array(z.enum(['celos_abiertos', 'preneces_confirmadas', 'proximos_partos', 'partos_mes'])).max(4).optional(),
    sexo: z.array(z.enum(['hembras', 'machos'])).max(2).optional(),
}).strict();
dashboardRouter.get('/preferencias', requirePermission('DASHBOARD_CONSULTAR'), asyncHandler(async (req, res) => {
    const row = (await pool.query('SELECT configuracion FROM usuario_preferencia_panel WHERE id_usuario=$1', [req.user.id])).rows[0];
    return ok(res, { configuracion: row?.configuracion ?? null });
}));
dashboardRouter.patch('/preferencias', requirePermission('DASHBOARD_CONSULTAR'), asyncHandler(async (req, res) => {
    const configuracion = dashboardConfigurationSchema.parse(req.body.configuracion);
    const row = (await pool.query(`INSERT INTO usuario_preferencia_panel(id_usuario,configuracion)
     VALUES($1,$2::jsonb)
     ON CONFLICT(id_usuario) DO UPDATE
       SET configuracion=EXCLUDED.configuracion,updated_at=NOW()
     RETURNING configuracion`, [req.user.id, JSON.stringify(configuracion)])).rows[0];
    return ok(res, row);
}));
dashboardRouter.get('/resumen', requirePermission('DASHBOARD_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, await cache.rememberComposite(['animales', 'produccion', 'sanidad', 'grupos', 'ubicaciones', 'ventas', 'compras', 'reproduccion'], 'dashboard-resumen-v2', 60, async () => {
    const row = (await pool.query(`SELECT
      (SELECT COUNT(*)::int FROM animal WHERE deleted_at IS NULL AND id_categoria_animal='00000000-0000-4000-8000-000000000101') animales_en_propiedad,
      (SELECT COUNT(*)::int FROM animal WHERE deleted_at IS NULL AND id_categoria_animal='00000000-0000-4000-8000-000000000102') animales_fuera_propiedad,
      (SELECT COUNT(*)::int FROM animal WHERE deleted_at IS NULL AND estado='ACTIVO') animales_activos,
      (SELECT COUNT(*)::int FROM animal WHERE deleted_at IS NULL AND estado<>'ACTIVO') animales_inactivos,

      ((SELECT COALESCE(SUM(precio_total),0) FROM venta_animal WHERE deleted_at IS NULL AND estado='COMPLETADA' AND fecha_venta>=date_trunc('week',CURRENT_DATE))+
       (SELECT COALESCE(SUM(precio_total),0) FROM venta_producto WHERE deleted_at IS NULL AND estado='COMPLETADA' AND fecha_venta>=date_trunc('week',CURRENT_DATE)))::numeric ingresos_semana,
      ((SELECT COALESCE(SUM(precio_total),0) FROM venta_animal WHERE deleted_at IS NULL AND estado='COMPLETADA' AND fecha_venta>=date_trunc('month',CURRENT_DATE))+
       (SELECT COALESCE(SUM(precio_total),0) FROM venta_producto WHERE deleted_at IS NULL AND estado='COMPLETADA' AND fecha_venta>=date_trunc('month',CURRENT_DATE)))::numeric ingresos_mes,
      ((SELECT COALESCE(SUM(precio_total),0) FROM venta_animal WHERE deleted_at IS NULL AND estado='COMPLETADA' AND fecha_venta>=date_trunc('year',CURRENT_DATE))+
       (SELECT COALESCE(SUM(precio_total),0) FROM venta_producto WHERE deleted_at IS NULL AND estado='COMPLETADA' AND fecha_venta>=date_trunc('year',CURRENT_DATE)))::numeric ingresos_anio,

      (SELECT COALESCE(SUM(valor_total),0)::numeric FROM compra WHERE deleted_at IS NULL AND fecha_compra>=date_trunc('week',CURRENT_DATE)::date) egresos_semana,
      (SELECT COALESCE(SUM(valor_total),0)::numeric FROM compra WHERE deleted_at IS NULL AND fecha_compra>=date_trunc('month',CURRENT_DATE)::date) egresos_mes,
      (SELECT COALESCE(SUM(valor_total),0)::numeric FROM compra WHERE deleted_at IS NULL AND fecha_compra>=date_trunc('year',CURRENT_DATE)::date) egresos_anio,

      ((SELECT COUNT(*) FROM venta_animal WHERE deleted_at IS NULL AND estado='COMPLETADA' AND fecha_venta>=date_trunc('week',CURRENT_DATE))+
       (SELECT COUNT(*) FROM venta_producto WHERE deleted_at IS NULL AND estado='COMPLETADA' AND fecha_venta>=date_trunc('week',CURRENT_DATE)))::int ventas_semana,
      ((SELECT COUNT(*) FROM venta_animal WHERE deleted_at IS NULL AND estado='COMPLETADA' AND fecha_venta>=date_trunc('month',CURRENT_DATE))+
       (SELECT COUNT(*) FROM venta_producto WHERE deleted_at IS NULL AND estado='COMPLETADA' AND fecha_venta>=date_trunc('month',CURRENT_DATE)))::int ventas_mes,
      ((SELECT COUNT(*) FROM venta_animal WHERE deleted_at IS NULL AND estado='COMPLETADA' AND fecha_venta>=date_trunc('year',CURRENT_DATE))+
       (SELECT COUNT(*) FROM venta_producto WHERE deleted_at IS NULL AND estado='COMPLETADA' AND fecha_venta>=date_trunc('year',CURRENT_DATE)))::int ventas_anio,

      (SELECT COALESCE(SUM(litros),0)::numeric FROM produccion_leche WHERE deleted_at IS NULL AND fecha_produccion=CURRENT_DATE) produccion_hoy,
      (SELECT COALESCE(SUM(litros),0)::numeric FROM produccion_leche WHERE deleted_at IS NULL AND fecha_produccion>=date_trunc('week',CURRENT_DATE)::date) produccion_semana,
      (SELECT COALESCE(SUM(litros),0)::numeric FROM produccion_leche WHERE deleted_at IS NULL AND fecha_produccion>=date_trunc('month',CURRENT_DATE)::date) produccion_mes,

      (SELECT COUNT(*)::int FROM tratamiento_animal WHERE deleted_at IS NULL AND fecha_aplicacion::date=CURRENT_DATE) tratamientos_hoy,
      (SELECT COUNT(*)::int FROM tratamiento_animal WHERE deleted_at IS NULL AND fecha_aplicacion>=date_trunc('week',CURRENT_DATE)) tratamientos_semana,
      (SELECT COUNT(*)::int FROM tratamiento_animal WHERE deleted_at IS NULL AND fecha_aplicacion>=date_trunc('month',CURRENT_DATE)) tratamientos_mes,

      (SELECT COUNT(*)::int FROM movimiento_animal WHERE deleted_at IS NULL AND estado='COMPLETADO' AND fecha_movimiento>=date_trunc('week',CURRENT_DATE)) traslados_semana,
      (SELECT COUNT(*)::int FROM movimiento_animal WHERE deleted_at IS NULL AND estado='COMPLETADO' AND fecha_movimiento>=date_trunc('month',CURRENT_DATE)) traslados_mes,
      (SELECT COUNT(*)::int FROM movimiento_animal WHERE deleted_at IS NULL AND estado='COMPLETADO' AND fecha_movimiento>=date_trunc('year',CURRENT_DATE)) traslados_anio,

      (SELECT COUNT(*)::int FROM potrero p JOIN ubicacion u ON u.id_ubicacion=p.id_ubicacion WHERE p.deleted_at IS NULL AND u.deleted_at IS NULL AND u.activo) potreros_total,
      (SELECT COUNT(DISTINCT p.id_potrero)::int FROM potrero p JOIN animal a ON a.id_ubicacion_actual=p.id_ubicacion
       WHERE p.deleted_at IS NULL AND a.deleted_at IS NULL AND a.estado='ACTIVO') potreros_ocupados,

      (SELECT COUNT(*)::int FROM grupo WHERE deleted_at IS NULL AND activo) grupos_total,
      (SELECT COUNT(DISTINCT g.id_grupo)::int FROM grupo g JOIN animal a ON a.id_grupo_actual=g.id_grupo
       WHERE g.deleted_at IS NULL AND g.activo AND a.deleted_at IS NULL AND a.estado='ACTIVO') grupos_con_animales,
      (SELECT COUNT(*)::int FROM animal WHERE deleted_at IS NULL AND estado='ACTIVO' AND id_grupo_actual IS NOT NULL) animales_agrupados,

      (SELECT COUNT(*)::int FROM celo WHERE deleted_at IS NULL AND (fecha_fin IS NULL OR fecha_fin>=CURRENT_DATE)) celos_abiertos,
      (SELECT COUNT(*)::int FROM prenez WHERE deleted_at IS NULL AND estado='CONFIRMADA') preneces_confirmadas,
      (SELECT COUNT(*)::int FROM proximo_parto WHERE deleted_at IS NULL AND estado='PENDIENTE') proximos_partos,
      (SELECT COUNT(*)::int FROM parto WHERE deleted_at IS NULL AND fecha_parto>=date_trunc('month',CURRENT_DATE)) partos_mes,

      (SELECT COUNT(*)::int FROM animal WHERE deleted_at IS NULL AND estado='ACTIVO' AND sexo='HEMBRA') hembras,
      (SELECT COUNT(*)::int FROM animal WHERE deleted_at IS NULL AND estado='ACTIVO' AND sexo='MACHO') machos`)).rows[0];
    return {
        animales: { en_propiedad: row.animales_en_propiedad, fuera_propiedad: row.animales_fuera_propiedad, activos: row.animales_activos, inactivos: row.animales_inactivos },
        ingresos: { semana: row.ingresos_semana, mes: row.ingresos_mes, anio: row.ingresos_anio },
        egresos: { semana: row.egresos_semana, mes: row.egresos_mes, anio: row.egresos_anio },
        ventas: { semana: row.ventas_semana, mes: row.ventas_mes, anio: row.ventas_anio },
        produccion: { hoy: row.produccion_hoy, semana: row.produccion_semana, mes: row.produccion_mes },
        tratamientos: { hoy: row.tratamientos_hoy, semana: row.tratamientos_semana, mes: row.tratamientos_mes },
        traslados: { semana: row.traslados_semana, mes: row.traslados_mes, anio: row.traslados_anio },
        potreros: { total: row.potreros_total, ocupados: row.potreros_ocupados, descanso: Math.max(0, Number(row.potreros_total) - Number(row.potreros_ocupados)) },
        grupos: { total: row.grupos_total, con_animales: row.grupos_con_animales, animales_agrupados: row.animales_agrupados },
        reproduccion: { celos_abiertos: row.celos_abiertos, preneces_confirmadas: row.preneces_confirmadas, proximos_partos: row.proximos_partos, partos_mes: row.partos_mes },
        sexo: { hembras: row.hembras, machos: row.machos },
    };
}))));
//# sourceMappingURL=dashboard.routes.js.map