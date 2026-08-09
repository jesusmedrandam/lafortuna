import { Router } from 'express';
import { pool } from '../../database/pool.js';
import { asyncHandler } from '../../core/async-handler.js';
import { ok } from '../../core/http.js';
export const versionsRouter = Router();
versionsRouter.get('/', asyncHandler(async (_req, res) => ok(res, (await pool.query('SELECT modulo,version,updated_at FROM version_datos ORDER BY modulo')).rows)));
//# sourceMappingURL=versions.routes.js.map