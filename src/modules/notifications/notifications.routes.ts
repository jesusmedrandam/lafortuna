import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/async-handler.js';
import { noContent, ok } from '../../core/http.js';
import { routeParam } from '../../core/route-param.js';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { emitNotification } from './notifications.service.js';
import { dispatchPendingPushNotifications } from './notifications.push.js';

export const notificationsRouter = Router();

const notificationCategories = [
  'ANIMALES','MOVIMIENTOS','PESAJES','SANIDAD','PRODUCCION','REPRODUCCION',
  'MANTENIMIENTO','ACTIVIDADES','VENTAS','COMPRAS','SISTEMA',
] as const;

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  solo_no_leidas: z.enum(['true','false','1','0']).optional(),
  categoria: z.string().trim().max(40).optional(),
});

const deviceSchema = z.object({
  token: z.string().trim().min(20).max(4096),
  plataforma: z.enum(['ANDROID','WEB']).default('ANDROID'),
  nombre_dispositivo: z.string().trim().max(120).optional().nullable(),
  version_app: z.string().trim().max(32).optional().nullable(),
});

const preferenceSchema = z.object({
  preferencias: z.array(z.object({
    categoria: z.enum(notificationCategories),
    mostrar_en_buzon: z.boolean(),
    enviar_push: z.boolean(),
  }).refine(item => item.mostrar_en_buzon || !item.enviar_push, {
    message: 'El envío push también requiere conservar el aviso en el buzón.',
  })).max(notificationCategories.length),
});

notificationsRouter.get('/', asyncHandler(async (req,res) => {
  const input = listSchema.parse(req.query);
  const unreadOnly = input.solo_no_leidas === 'true' || input.solo_no_leidas === '1';
  const params: unknown[] = [req.user!.id];
  const where = ['nu.id_usuario=$1','nu.archivada_at IS NULL'];
  if (unreadOnly) where.push('nu.leida_at IS NULL');
  if (input.categoria) {
    params.push(input.categoria);
    where.push(`n.categoria=$${params.length}`);
  }
  params.push(input.limit);
  const [items,noLeidas] = await Promise.all([
    pool.query(`SELECT
      n.id_notificacion,n.tipo,n.categoria,n.prioridad,n.titulo,n.mensaje,
      n.entidad_tipo,n.entidad_id,n.ruta,n.datos,n.created_at,
      nu.leida_at,(nu.leida_at IS NULL) AS no_leida
    FROM notificacion_usuario nu
    JOIN notificacion n ON n.id_notificacion=nu.id_notificacion
    WHERE ${where.join(' AND ')}
    ORDER BY n.created_at DESC
    LIMIT $${params.length}`,params),
    pool.query(`SELECT COUNT(*)::int AS total
      FROM notificacion_usuario
      WHERE id_usuario=$1 AND leida_at IS NULL AND archivada_at IS NULL`,[req.user!.id]),
  ]);
  return ok(res,{items:items.rows,no_leidas:noLeidas.rows[0].total});
}));

notificationsRouter.get('/resumen', asyncHandler(async (req,res) => ok(res,(await pool.query(
  `SELECT
    COUNT(*) FILTER(WHERE leida_at IS NULL AND archivada_at IS NULL)::int AS no_leidas,
    COUNT(*) FILTER(WHERE archivada_at IS NULL)::int AS total
   FROM notificacion_usuario WHERE id_usuario=$1`,[req.user!.id],
)).rows[0])));

notificationsRouter.post('/leer-todas', asyncHandler(async (req,res) => {
  const result = await pool.query(`UPDATE notificacion_usuario SET leida_at=COALESCE(leida_at,NOW())
    WHERE id_usuario=$1 AND leida_at IS NULL AND archivada_at IS NULL`,[req.user!.id]);
  return ok(res,{actualizadas:result.rowCount ?? 0});
}));

notificationsRouter.get('/preferencias', asyncHandler(async (req,res) => {
  const stored = (await pool.query<{
    categoria: typeof notificationCategories[number];
    mostrar_en_buzon: boolean;
    enviar_push: boolean;
  }>(`SELECT categoria,mostrar_en_buzon,enviar_push
     FROM notificacion_preferencia WHERE id_usuario=$1`,[req.user!.id])).rows;
  const byCategory = new Map(stored.map(item => [item.categoria,item]));
  return ok(res,notificationCategories.map(categoria => byCategory.get(categoria) ?? {
    categoria,mostrar_en_buzon:true,enviar_push:true,
  }));
}));

notificationsRouter.put('/preferencias', asyncHandler(async (req,res) => {
  const input = preferenceSchema.parse(req.body);
  await transaction(async (client) => {
    for (const item of input.preferencias) {
      await client.query(`INSERT INTO notificacion_preferencia(id_usuario,categoria,mostrar_en_buzon,enviar_push)
        VALUES($1,$2,$3,$4)
        ON CONFLICT(id_usuario,categoria) DO UPDATE SET
          mostrar_en_buzon=EXCLUDED.mostrar_en_buzon,
          enviar_push=EXCLUDED.enviar_push,updated_at=NOW()`,
      [req.user!.id,item.categoria,item.mostrar_en_buzon,item.enviar_push]);
    }
  },req.user!.id);
  return ok(res,{actualizadas:input.preferencias.length});
}));

notificationsRouter.post('/dispositivos', asyncHandler(async (req,res) => {
  const input = deviceSchema.parse(req.body);
  const row = (await pool.query(`INSERT INTO notificacion_dispositivo(
      id_usuario,token_push,plataforma,nombre_dispositivo,version_app
    ) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(token_push) DO UPDATE SET
      id_usuario=EXCLUDED.id_usuario,plataforma=EXCLUDED.plataforma,
      nombre_dispositivo=EXCLUDED.nombre_dispositivo,version_app=EXCLUDED.version_app,
      activo=TRUE,ultimo_uso_at=NOW(),updated_at=NOW()
    RETURNING id_dispositivo,plataforma,nombre_dispositivo,version_app,activo`,
  [req.user!.id,input.token,input.plataforma,input.nombre_dispositivo ?? null,input.version_app ?? null])).rows[0];
  return ok(res,row);
}));

notificationsRouter.get('/dispositivos', asyncHandler(async (req,res) => ok(res,(await pool.query(
  `SELECT id_dispositivo,plataforma,nombre_dispositivo,version_app,activo,ultimo_uso_at,created_at
   FROM notificacion_dispositivo
   WHERE id_usuario=$1
   ORDER BY activo DESC,ultimo_uso_at DESC`,[req.user!.id],
)).rows)));

notificationsRouter.post('/prueba', asyncHandler(async (req,res) => {
  const notificationId = await transaction(client=>emitNotification(client,{
    tipo:'PRUEBA_FIREBASE',categoria:'SISTEMA',prioridad:'IMPORTANTE',
    titulo:'Firebase conectado',
    mensaje:'Las notificaciones push de SGB están funcionando correctamente.',
    ruta:'/',usuarios:[req.user!.id],creadoPor:req.user!.id,
  }),req.user!.id);
  void dispatchPendingPushNotifications().catch(error=>console.error('No se pudo enviar la notificación de prueba:',error));
  return ok(res,{id_notificacion:notificationId});
}));

notificationsRouter.delete('/dispositivos/:id', asyncHandler(async (req,res) => {
  await pool.query(`UPDATE notificacion_dispositivo SET activo=FALSE,updated_at=NOW()
    WHERE id_dispositivo=$1 AND id_usuario=$2`,[routeParam(req.params.id,'id'),req.user!.id]);
  return noContent(res);
}));

notificationsRouter.patch('/:id/leer', asyncHandler(async (req,res) => {
  const row = (await pool.query(`UPDATE notificacion_usuario
    SET leida_at=COALESCE(leida_at,NOW())
    WHERE id_notificacion=$1 AND id_usuario=$2 AND archivada_at IS NULL
    RETURNING id_notificacion,leida_at`,
  [routeParam(req.params.id,'id'),req.user!.id])).rows[0] ?? null;
  return ok(res,row);
}));

notificationsRouter.delete('/:id', asyncHandler(async (req,res) => {
  await pool.query(`UPDATE notificacion_usuario SET archivada_at=NOW()
    WHERE id_notificacion=$1 AND id_usuario=$2`,[routeParam(req.params.id,'id'),req.user!.id]);
  return noContent(res);
}));
