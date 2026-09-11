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
    ventas: z.array(z.enum(['semana', 'mes', 'anio', 'ventas_animales_mes', 'animales_vendidos_mes', 'ventas_productos_mes'])).max(6).optional(),
    produccion: z.array(z.enum(['hoy', 'ayer', 'semana', 'mes', 'vacas_hoy', 'promedio_vaca_hoy', 'tanque_hoy'])).max(7).optional(),
    tratamientos: z.array(z.enum(['hoy', 'semana', 'mes', 'animales_mes', 'medicamentos_mes'])).max(5).optional(),
    traslados: z.array(z.enum(['semana', 'mes', 'anio', 'rotaciones_mes', 'cambios_grupo_mes', 'propiedades_mes', 'combinados_mes', 'grupos_completos_mes', 'selecciones_manuales_mes', 'animales_mes'])).max(10).optional(),
    potreros: z.array(z.enum(['total', 'ocupados', 'descanso'])).max(3).optional(),
    grupos: z.array(z.enum(['total', 'con_animales', 'animales_agrupados'])).max(3).optional(),
    reproduccion: z.array(z.enum(['celos_abiertos', 'preneces_confirmadas', 'proximos_partos', 'partos_mes'])).max(4).optional(),
    sexo: z.array(z.enum(['hembras', 'machos'])).max(2).optional(),
});
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
dashboardRouter.get('/resumen', requirePermission('DASHBOARD_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, await cache.rememberComposite(['animales', 'produccion', 'sanidad', 'grupos', 'ubicaciones', 'ventas', 'compras', 'reproduccion'], 'dashboard-resumen-v5', 60, async () => {
    const row = (await pool.query(`WITH animales_principal AS MATERIALIZED (
      SELECT a.*,fn_clasificacion_animal(a.id_animal,CURRENT_DATE) clasificacion_codigo
      FROM animal a
      LEFT JOIN grupo g ON g.id_grupo=a.id_grupo_actual AND g.deleted_at IS NULL
      LEFT JOIN ubicacion u ON u.id_ubicacion=a.id_ubicacion_actual AND u.deleted_at IS NULL
      JOIN propiedad_ganadera propiedad ON propiedad.id_propiedad=COALESCE(g.id_propiedad,u.id_propiedad)
        AND propiedad.deleted_at IS NULL AND propiedad.es_principal=TRUE
      WHERE a.deleted_at IS NULL AND a.estado='ACTIVO'
    )
    SELECT
      (SELECT COUNT(*)::int FROM animal WHERE deleted_at IS NULL AND id_categoria_animal='00000000-0000-4000-8000-000000000101') animales_en_propiedad,
      (SELECT COUNT(*)::int FROM animal WHERE deleted_at IS NULL AND id_categoria_animal='00000000-0000-4000-8000-000000000102') animales_fuera_propiedad,
      (SELECT COUNT(*)::int FROM animal WHERE deleted_at IS NULL AND estado='ACTIVO') animales_activos,
      (SELECT COUNT(*)::int FROM animal WHERE deleted_at IS NULL AND estado<>'ACTIVO') animales_inactivos,
      (SELECT COUNT(*)::int FROM animales_principal) animales_principal_total,
      (SELECT COUNT(*)::int FROM animales_principal a WHERE a.sexo='HEMBRA') animales_principal_hembras,
      (SELECT COUNT(*)::int FROM animales_principal a WHERE a.sexo='MACHO') animales_principal_machos,
      (SELECT COUNT(*)::int FROM animales_principal WHERE clasificacion_codigo='VACA') animales_principal_vacas,
      (SELECT COUNT(*)::int FROM animales_principal WHERE clasificacion_codigo='VACONA') animales_principal_vaconas,
      (SELECT COUNT(*)::int FROM animales_principal WHERE clasificacion_codigo='TORO') animales_principal_toros,
      (SELECT COUNT(*)::int FROM animales_principal WHERE clasificacion_codigo='TORETE') animales_principal_toretes,
      (SELECT COUNT(*)::int FROM animales_principal WHERE clasificacion_codigo='TERNERA') animales_principal_terneras,
      (SELECT COUNT(*)::int FROM animales_principal WHERE clasificacion_codigo='TERNERO') animales_principal_terneros,

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
      (SELECT COUNT(*)::int FROM venta_animal WHERE deleted_at IS NULL AND estado='COMPLETADA' AND fecha_venta>=date_trunc('month',CURRENT_DATE)) ventas_animales_mes,
      (SELECT COUNT(*)::int FROM venta_animal_detalle d JOIN venta_animal v ON v.id_venta=d.id_venta WHERE d.deleted_at IS NULL AND v.deleted_at IS NULL AND v.estado='COMPLETADA' AND v.fecha_venta>=date_trunc('month',CURRENT_DATE)) animales_vendidos_mes,
      (SELECT COUNT(*)::int FROM venta_producto WHERE deleted_at IS NULL AND estado='COMPLETADA' AND fecha_venta>=date_trunc('month',CURRENT_DATE)) ventas_productos_mes,

      (SELECT COALESCE(SUM(litros),0)::numeric FROM produccion_leche WHERE deleted_at IS NULL AND fecha_produccion=CURRENT_DATE) produccion_hoy,
      (SELECT COALESCE(SUM(litros),0)::numeric FROM produccion_leche WHERE deleted_at IS NULL AND fecha_produccion=CURRENT_DATE-1) produccion_ayer,
      (SELECT COALESCE(SUM(litros),0)::numeric FROM produccion_leche WHERE deleted_at IS NULL AND fecha_produccion>=date_trunc('week',CURRENT_DATE)::date) produccion_semana,
      (SELECT COALESCE(SUM(litros),0)::numeric FROM produccion_leche WHERE deleted_at IS NULL AND fecha_produccion>=date_trunc('month',CURRENT_DATE)::date) produccion_mes,
      (SELECT COUNT(DISTINCT id_vaca)::int FROM produccion_leche WHERE deleted_at IS NULL AND fecha_produccion=CURRENT_DATE) vacas_hoy,
      (SELECT COALESCE(AVG(total_vaca),0)::numeric FROM (SELECT SUM(litros) total_vaca FROM produccion_leche WHERE deleted_at IS NULL AND fecha_produccion=CURRENT_DATE GROUP BY id_vaca) pv) promedio_vaca_hoy,
      (SELECT COALESCE(SUM(litros),0)::numeric FROM produccion_tanque WHERE deleted_at IS NULL AND fecha_produccion=CURRENT_DATE) tanque_hoy,

      (SELECT COUNT(*)::int FROM tratamiento_animal WHERE deleted_at IS NULL AND fecha_aplicacion::date=CURRENT_DATE) tratamientos_hoy,
      (SELECT COUNT(*)::int FROM tratamiento_animal WHERE deleted_at IS NULL AND fecha_aplicacion>=date_trunc('week',CURRENT_DATE)) tratamientos_semana,
      (SELECT COUNT(*)::int FROM tratamiento_animal WHERE deleted_at IS NULL AND fecha_aplicacion>=date_trunc('month',CURRENT_DATE)) tratamientos_mes,
      (SELECT COUNT(DISTINCT id_animal)::int FROM tratamiento_animal WHERE deleted_at IS NULL AND fecha_aplicacion>=date_trunc('month',CURRENT_DATE)) tratamientos_animales_mes,
      (SELECT COUNT(DISTINCT id_medicamento)::int FROM tratamiento_animal WHERE deleted_at IS NULL AND fecha_aplicacion>=date_trunc('month',CURRENT_DATE) AND id_medicamento IS NOT NULL) tratamientos_medicamentos_mes,

      (SELECT COUNT(*)::int FROM movimiento_animal WHERE deleted_at IS NULL AND estado='COMPLETADO' AND fecha_movimiento>=date_trunc('week',CURRENT_DATE)) traslados_semana,
      (SELECT COUNT(*)::int FROM movimiento_animal WHERE deleted_at IS NULL AND estado='COMPLETADO' AND fecha_movimiento>=date_trunc('month',CURRENT_DATE)) traslados_mes,
      (SELECT COUNT(*)::int FROM movimiento_animal WHERE deleted_at IS NULL AND estado='COMPLETADO' AND fecha_movimiento>=date_trunc('year',CURRENT_DATE)) traslados_anio,
      (SELECT COUNT(*)::int FROM movimiento_animal WHERE deleted_at IS NULL AND estado='COMPLETADO' AND tipo_movimiento='UBICACION' AND fecha_movimiento>=date_trunc('month',CURRENT_DATE)) rotaciones_mes,
      (SELECT COUNT(*)::int FROM movimiento_animal WHERE deleted_at IS NULL AND estado='COMPLETADO' AND tipo_movimiento='GRUPO' AND fecha_movimiento>=date_trunc('month',CURRENT_DATE)) cambios_grupo_mes,
      (SELECT COUNT(*)::int FROM movimiento_animal WHERE deleted_at IS NULL AND estado='COMPLETADO' AND tipo_movimiento='PROPIEDAD' AND fecha_movimiento>=date_trunc('month',CURRENT_DATE)) propiedades_mes,
      (SELECT COUNT(*)::int FROM movimiento_animal WHERE deleted_at IS NULL AND estado='COMPLETADO' AND tipo_movimiento='COMBINADO' AND fecha_movimiento>=date_trunc('month',CURRENT_DATE)) combinados_mes,
      (SELECT COUNT(*)::int FROM movimiento_animal WHERE deleted_at IS NULL AND estado='COMPLETADO' AND modo_seleccion='GRUPO' AND fecha_movimiento>=date_trunc('month',CURRENT_DATE)) grupos_completos_mes,
      (SELECT COUNT(*)::int FROM movimiento_animal WHERE deleted_at IS NULL AND estado='COMPLETADO' AND modo_seleccion='SELECCION_MANUAL' AND fecha_movimiento>=date_trunc('month',CURRENT_DATE)) selecciones_manuales_mes,
      (SELECT COALESCE(SUM(total_seleccionados),0)::int FROM movimiento_animal WHERE deleted_at IS NULL AND estado='COMPLETADO' AND fecha_movimiento>=date_trunc('month',CURRENT_DATE)) animales_trasladados_mes,

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
    const [groupRows, incomeProductRows, incomeAnimalRows] = await Promise.all([
        pool.query(`SELECT g.id_grupo,g.nombre,COUNT(a.id_animal)::int total
        FROM grupo g
        JOIN propiedad_ganadera propiedad ON propiedad.id_propiedad=g.id_propiedad
          AND propiedad.deleted_at IS NULL AND propiedad.es_principal=TRUE
        LEFT JOIN animal a ON a.id_grupo_actual=g.id_grupo
          AND a.deleted_at IS NULL AND a.estado='ACTIVO'
        WHERE g.deleted_at IS NULL AND g.activo=TRUE
        GROUP BY g.id_grupo,g.nombre
        ORDER BY g.nombre`),
        pool.query(`SELECT producto.codigo,producto.nombre,
          COALESCE(SUM(detalle.subtotal),0)::numeric total
        FROM venta_producto venta
        JOIN venta_producto_detalle detalle ON detalle.id_venta_producto=venta.id_venta_producto
          AND detalle.deleted_at IS NULL
        JOIN producto_venta producto ON producto.id_producto_venta=detalle.id_producto_venta
          AND producto.deleted_at IS NULL
        WHERE venta.deleted_at IS NULL AND venta.estado='COMPLETADA'
          AND venta.fecha_venta>=date_trunc('year',CURRENT_DATE)
        GROUP BY producto.codigo,producto.nombre
        HAVING COALESCE(SUM(detalle.subtotal),0)>0
        ORDER BY producto.nombre`),
        pool.query(`SELECT COALESCE(SUM(precio_total),0)::numeric total FROM venta_animal
        WHERE deleted_at IS NULL AND estado='COMPLETADA'
          AND fecha_venta>=date_trunc('year',CURRENT_DATE)`),
    ]);
    const incomeConcepts = [
        { codigo: 'ANIMALES', nombre: 'Venta de animales', total: Number(incomeAnimalRows.rows[0]?.total ?? 0) },
        ...incomeProductRows.rows.map((item) => ({
            codigo: String(item.codigo),
            nombre: `Venta de ${String(item.nombre).toLocaleLowerCase('es')}`,
            total: Number(item.total),
        })),
    ].filter((item) => item.total > 0);
    return {
        animales: {
            en_propiedad: row.animales_en_propiedad,
            fuera_propiedad: row.animales_fuera_propiedad,
            activos: row.animales_activos,
            inactivos: row.animales_inactivos,
            principal_total: row.animales_principal_total,
            vacas: row.animales_principal_vacas,
            vaconas: row.animales_principal_vaconas,
            toros: row.animales_principal_toros,
            toretes: row.animales_principal_toretes,
            terneras: row.animales_principal_terneras,
            terneros: row.animales_principal_terneros,
            hembras: row.animales_principal_hembras,
            machos: row.animales_principal_machos,
            grupos: groupRows.rows,
        },
        ingresos: { semana: row.ingresos_semana, mes: row.ingresos_mes, anio: row.ingresos_anio, conceptos: incomeConcepts },
        egresos: { semana: row.egresos_semana, mes: row.egresos_mes, anio: row.egresos_anio },
        ventas: { semana: row.ventas_semana, mes: row.ventas_mes, anio: row.ventas_anio, ventas_animales_mes: row.ventas_animales_mes, animales_vendidos_mes: row.animales_vendidos_mes, ventas_productos_mes: row.ventas_productos_mes },
        produccion: { hoy: row.produccion_hoy, ayer: row.produccion_ayer, semana: row.produccion_semana, mes: row.produccion_mes, vacas_hoy: row.vacas_hoy, promedio_vaca_hoy: row.promedio_vaca_hoy, tanque_hoy: row.tanque_hoy },
        tratamientos: { hoy: row.tratamientos_hoy, semana: row.tratamientos_semana, mes: row.tratamientos_mes, animales_mes: row.tratamientos_animales_mes, medicamentos_mes: row.tratamientos_medicamentos_mes },
        traslados: { semana: row.traslados_semana, mes: row.traslados_mes, anio: row.traslados_anio, rotaciones_mes: row.rotaciones_mes, cambios_grupo_mes: row.cambios_grupo_mes, propiedades_mes: row.propiedades_mes, combinados_mes: row.combinados_mes, grupos_completos_mes: row.grupos_completos_mes, selecciones_manuales_mes: row.selecciones_manuales_mes, animales_mes: row.animales_trasladados_mes },
        potreros: { total: row.potreros_total, ocupados: row.potreros_ocupados, descanso: Math.max(0, Number(row.potreros_total) - Number(row.potreros_ocupados)) },
        grupos: { total: row.grupos_total, con_animales: row.grupos_con_animales, animales_agrupados: row.animales_agrupados },
        reproduccion: { celos_abiertos: row.celos_abiertos, preneces_confirmadas: row.preneces_confirmadas, proximos_partos: row.proximos_partos, partos_mes: row.partos_mes },
        sexo: { hembras: row.hembras, machos: row.machos },
    };
}))));
//# sourceMappingURL=dashboard.routes.js.map