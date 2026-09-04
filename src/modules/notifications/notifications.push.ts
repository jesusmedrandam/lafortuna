import type { BatchResponse } from 'firebase-admin/messaging';
import { env } from '../../config/env.js';
import { pool } from '../../database/pool.js';
import { firebaseMessaging } from '../../services/firebase.service.js';

interface PendingRecipient {
  id_notificacion: string;
  id_usuario: string;
  tipo: string;
  categoria: string;
  prioridad: 'INFO' | 'IMPORTANTE' | 'URGENTE';
  titulo: string;
  mensaje: string;
  ruta: string | null;
}

let running = false;
let timer: NodeJS.Timeout | null = null;
let scheduledDispatch: NodeJS.Timeout | null = null;

async function claimPending(limit = 50): Promise<PendingRecipient[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<PendingRecipient>(`
      WITH candidatos AS (
        SELECT nu.id_notificacion,nu.id_usuario
        FROM notificacion_usuario nu
        WHERE (
          (nu.push_estado IN ('PENDIENTE','ERROR') AND nu.push_intentos < 5)
          OR (nu.push_estado='EN_PROCESO' AND nu.push_procesando_at < NOW() - INTERVAL '5 minutes')
        )
        ORDER BY nu.created_at
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      ), reclamados AS (
        UPDATE notificacion_usuario nu
        SET push_estado='EN_PROCESO',push_procesando_at=NOW(),push_intentos=nu.push_intentos+1
        FROM candidatos c
        WHERE nu.id_notificacion=c.id_notificacion AND nu.id_usuario=c.id_usuario
        RETURNING nu.id_notificacion,nu.id_usuario
      )
      SELECT r.id_notificacion,r.id_usuario,n.tipo,n.categoria,n.prioridad,
             n.titulo,n.mensaje,n.ruta
      FROM reclamados r
      JOIN notificacion n ON n.id_notificacion=r.id_notificacion
    `,[limit]);
    await client.query('COMMIT');
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function invalidRegistration(errorCode?: string) {
  return errorCode === 'messaging/registration-token-not-registered'
    || errorCode === 'messaging/invalid-registration-token'
    || errorCode === 'messaging/invalid-argument';
}

async function deactivateInvalidTokens(tokens: string[], response: BatchResponse) {
  const invalid = response.responses.flatMap((item,index) =>
    !item.success && invalidRegistration(item.error?.code) ? [tokens[index]] : [],
  );
  if (!invalid.length) return;
  await pool.query(`UPDATE notificacion_dispositivo
    SET activo=FALSE,updated_at=NOW()
    WHERE token_push=ANY($1::text[])`,[invalid]);
}

async function finish(
  item: PendingRecipient,
  state: 'ENVIADA' | 'ERROR' | 'OMITIDA',
  error?: string,
) {
  await pool.query(`UPDATE notificacion_usuario SET
      push_estado=$3,push_procesando_at=NULL,
      push_enviada_at=CASE WHEN $3='ENVIADA' THEN NOW() ELSE push_enviada_at END,
      push_ultimo_error=$4
    WHERE id_notificacion=$1 AND id_usuario=$2 AND push_estado='EN_PROCESO'`,
  [item.id_notificacion,item.id_usuario,state,error?.slice(0,1000) ?? null]);
}

async function sendRecipient(item: PendingRecipient) {
  const messaging = firebaseMessaging();
  if (!messaging) {
    await finish(item,'ERROR','Firebase no está configurado en el servidor.');
    return;
  }
  const tokens = (await pool.query<{token_push:string}>(`
    SELECT token_push FROM notificacion_dispositivo
    WHERE id_usuario=$1 AND activo=TRUE
    ORDER BY ultimo_uso_at DESC
    LIMIT 500`,[item.id_usuario])).rows.map(row=>row.token_push);
  if (!tokens.length) {
    await finish(item,'OMITIDA','El usuario no tiene dispositivos activos.');
    return;
  }
  try {
    const response = await messaging.sendEachForMulticast({
      tokens,
      data: {
        id_notificacion: item.id_notificacion,
        tipo: item.tipo,
        categoria: item.categoria,
        prioridad: item.prioridad,
        titulo: item.titulo,
        mensaje: item.mensaje,
        ruta: item.ruta ?? '',
      },
      android: {
        priority: item.prioridad === 'INFO' ? 'normal' : 'high',
        ttl: 24 * 60 * 60 * 1000,
      },
    });
    await deactivateInvalidTokens(tokens,response);
    if (response.successCount > 0) {
      const partial = response.failureCount ? `${response.failureCount} ${response.failureCount === 1 ? 'dispositivo no recibió' : 'dispositivos no recibieron'} el aviso.` : undefined;
      await finish(item,'ENVIADA',partial);
    } else {
      const message = response.responses.find(value=>value.error)?.error?.message ?? 'Firebase rechazó todos los dispositivos.';
      await finish(item,'ERROR',message);
    }
  } catch (error) {
    await finish(item,'ERROR',error instanceof Error ? error.message : 'Error desconocido de Firebase.');
  }
}

export async function dispatchPendingPushNotifications() {
  if (running || !firebaseMessaging()) return 0;
  running = true;
  try {
    const pending = await claimPending();
    for (const item of pending) await sendRecipient(item);
    return pending.length;
  } finally {
    running = false;
  }
}

export function scheduleNotificationPushDispatch(delayMs = 750) {
  if (scheduledDispatch) clearTimeout(scheduledDispatch);
  scheduledDispatch = setTimeout(() => {
    scheduledDispatch = null;
    void dispatchPendingPushNotifications().catch(error=>console.error('Error al despachar notificación push:',error));
  },delayMs);
  scheduledDispatch.unref();
}

export function startNotificationPushWorker() {
  if (timer) return () => undefined;
  void dispatchPendingPushNotifications().catch(error=>console.error('Error al despachar notificaciones push:',error));
  timer = setInterval(() => {
    void dispatchPendingPushNotifications().catch(error=>console.error('Error al despachar notificaciones push:',error));
  },env.PUSH_DISPATCH_INTERVAL_MS);
  timer.unref();
  return () => {
    if (scheduledDispatch) clearTimeout(scheduledDispatch);
    scheduledDispatch = null;
    if (timer) clearInterval(timer);
    timer = null;
  };
}
