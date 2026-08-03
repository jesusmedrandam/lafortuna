import { Router } from 'express';
import { pool } from '../../database/pool.js';
import { asyncHandler } from '../../core/async-handler.js';
import { ok } from '../../core/http.js';
import { requirePermission } from '../../middleware/permission.js';
export const auditRouter=Router();
auditRouter.get('/',requirePermission('AUDITORIA_CONSULTAR'),asyncHandler(async(req,res)=>{const limit=Math.min(Number(req.query.limit)||50,200);return ok(res,(await pool.query('SELECT a.*,concat_ws(\' \',u.nombres,u.apellidos) usuario FROM auditoria a LEFT JOIN usuario u ON u.id_usuario=a.id_usuario ORDER BY a.created_at DESC LIMIT $1',[limit])).rows);}));
