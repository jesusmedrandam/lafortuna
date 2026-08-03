import { Router } from 'express';
import { pool } from '../../database/pool.js';
import { asyncHandler } from '../../core/async-handler.js';
import { ok } from '../../core/http.js';
import { requirePermission } from '../../middleware/permission.js';
import { cache } from '../../services/cache.service.js';
export const dashboardRouter=Router();
dashboardRouter.get('/resumen',requirePermission('DASHBOARD_CONSULTAR'),asyncHandler(async(_req,res)=>ok(res,await cache.rememberComposite(['animales','produccion','sanidad','grupos','ubicaciones'],'dashboard-resumen',60,async()=>{const result=await pool.query(`SELECT (SELECT COUNT(*)::int FROM animal WHERE deleted_at IS NULL) animales_total,(SELECT COUNT(*)::int FROM animal WHERE deleted_at IS NULL AND estado='ACTIVO') animales_activos,(SELECT COUNT(*)::int FROM animal WHERE deleted_at IS NULL AND estado='ACTIVO' AND sexo='HEMBRA') hembras,(SELECT COUNT(*)::int FROM animal WHERE deleted_at IS NULL AND estado='ACTIVO' AND sexo='MACHO') machos,(SELECT COUNT(*)::int FROM grupo WHERE deleted_at IS NULL AND activo) grupos,(SELECT COUNT(*)::int FROM ubicacion WHERE deleted_at IS NULL AND activo) ubicaciones,(SELECT COALESCE(SUM(litros),0)::numeric FROM produccion_leche WHERE deleted_at IS NULL AND fecha_produccion=CURRENT_DATE) litros_hoy,(SELECT COUNT(*)::int FROM tratamiento_animal WHERE deleted_at IS NULL AND fecha_aplicacion::date=CURRENT_DATE) tratamientos_hoy`);return result.rows[0];}))));
