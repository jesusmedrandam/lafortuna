import { env } from '../../config/env.js';
import { pool } from '../../database/pool.js';
import { firebaseMessaging } from '../../services/firebase.service.js';
let running = false;
let timer = null;
let scheduledDispatch = null;
async function claimPending(limit = 50) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`UPDATE notificacion_usuario nu
      SET push_estado='OMITIDA',push_procesando_at=NULL,
          push_ultimo_error='Prueba de Firebase vencida; no se vuelve a enviar.'
      FROM notificacion n
      WHERE n.id_notificacion=nu.id_notificacion
        AND n.tipo='PRUEBA_FIREBASE'
        AND nu.push_estado IN ('PENDIENTE','ERROR','EN_PROCESO')
        AND n.created_at < NOW() - INTERVAL '5 minutes'`);
        const result = await client.query(`
      WITH candidatos AS (
        SELECT nu.id_notificacion,nu.id_usuario
        FROM notificacion_usuario nu
        JOIN notificacion n ON n.id_notificacion=nu.id_notificacion
        WHERE (
          (n.tipo='PRUEBA_FIREBASE' AND nu.push_estado='PENDIENTE' AND nu.push_intentos=0)
          OR (n.tipo<>'PRUEBA_FIREBASE' AND (
            (nu.push_estado IN ('PENDIENTE','ERROR') AND nu.push_intentos < 5)
            OR (nu.push_estado='EN_PROCESO' AND nu.push_intentos < 5
                AND nu.push_procesando_at < NOW() - INTERVAL '5 minutes')
          ))
        )
        ORDER BY
          CASE n.prioridad WHEN 'URGENTE' THEN 0 WHEN 'IMPORTANTE' THEN 1 ELSE 2 END,
          CASE WHEN n.tipo='PRUEBA_FIREBASE' THEN 1 ELSE 0 END,
          nu.created_at
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
             n.titulo,n.mensaje,n.ruta,NULLIF(n.datos->>'imagen_url','') imagen_url
      FROM reclamados r
      JOIN notificacion n ON n.id_notificacion=r.id_notificacion
    `, [limit]);
        await client.query('COMMIT');
        return result.rows;
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
function invalidRegistration(errorCode) {
    return errorCode === 'messaging/registration-token-not-registered'
        || errorCode === 'messaging/invalid-registration-token'
        || errorCode === 'messaging/invalid-argument';
}
async function deactivateInvalidTokens(tokens, response) {
    const invalid = response.responses.flatMap((item, index) => !item.success && invalidRegistration(item.error?.code) ? [tokens[index]] : []);
    if (!invalid.length)
        return;
    await pool.query(`UPDATE notificacion_dispositivo
    SET activo=FALSE,updated_at=NOW()
    WHERE token_push=ANY($1::text[])`, [invalid]);
}
async function finish(item, state, error) {
    await pool.query(`UPDATE notificacion_usuario SET
      push_estado=$3::varchar,push_procesando_at=NULL,
      push_enviada_at=CASE WHEN $4::boolean THEN NOW() ELSE push_enviada_at END,
      push_ultimo_error=$5::text
    WHERE id_notificacion=$1 AND id_usuario=$2 AND push_estado='EN_PROCESO'`, [item.id_notificacion, item.id_usuario, state, state === 'ENVIADA', error?.slice(0, 1000) ?? null]);
}
async function sendRecipient(item) {
    try {
        const messaging = firebaseMessaging();
        if (!messaging) {
            await finish(item, 'ERROR', 'Firebase no está configurado en el servidor.');
            return;
        }
        const tokens = (await pool.query(`
      SELECT token_push FROM notificacion_dispositivo
      WHERE id_usuario=$1 AND activo=TRUE
      ORDER BY ultimo_uso_at DESC
      LIMIT 500`, [item.id_usuario])).rows.map(row => row.token_push);
        if (!tokens.length) {
            await finish(item, 'OMITIDA', 'El usuario no tiene dispositivos activos.');
            return;
        }
        const send = messaging.sendEachForMulticast({
            tokens,
            data: {
                id_notificacion: item.id_notificacion,
                tipo: item.tipo,
                categoria: item.categoria,
                prioridad: item.prioridad,
                titulo: item.titulo,
                mensaje: item.mensaje,
                ruta: item.ruta ?? '',
                imagen_url: item.imagen_url ?? '',
            },
            android: {
                priority: 'high',
                ttl: 24 * 60 * 60 * 1000,
            },
        });
        const response = await Promise.race([
            send,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase no respondió en 30 segundos.')), 30_000)),
        ]);
        await deactivateInvalidTokens(tokens, response);
        if (response.successCount > 0) {
            const partial = response.failureCount ? `${response.failureCount} ${response.failureCount === 1 ? 'dispositivo no recibió' : 'dispositivos no recibieron'} el aviso.` : undefined;
            await finish(item, 'ENVIADA', partial);
        }
        else {
            const message = response.responses.find(value => value.error)?.error?.message ?? 'Firebase rechazó todos los dispositivos.';
            await finish(item, 'ERROR', message);
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido de Firebase.';
        try {
            await finish(item, 'ERROR', message);
        }
        catch (finishError) {
            console.error('No se pudo finalizar un destinatario push:', {
                id_notificacion: item.id_notificacion,
                id_usuario: item.id_usuario,
                error: finishError,
            });
            throw finishError;
        }
    }
}
export async function dispatchPendingPushNotifications() {
    if (running || !firebaseMessaging())
        return 0;
    running = true;
    try {
        const pending = await claimPending();
        for (const item of pending) {
            try {
                await sendRecipient(item);
            }
            catch (error) {
                console.error('Falló un destinatario push; se continúa con los demás:', {
                    id_notificacion: item.id_notificacion,
                    id_usuario: item.id_usuario,
                    error,
                });
            }
        }
        return pending.length;
    }
    finally {
        running = false;
    }
}
export function scheduleNotificationPushDispatch(delayMs = 750) {
    if (scheduledDispatch)
        clearTimeout(scheduledDispatch);
    scheduledDispatch = setTimeout(() => {
        scheduledDispatch = null;
        void dispatchPendingPushNotifications().catch(error => console.error('Error al despachar notificación push:', error));
    }, delayMs);
}
export function startNotificationPushWorker() {
    if (timer)
        return () => undefined;
    void dispatchPendingPushNotifications().catch(error => console.error('Error al despachar notificaciones push:', error));
    timer = setInterval(() => {
        void dispatchPendingPushNotifications().catch(error => console.error('Error al despachar notificaciones push:', error));
    }, env.PUSH_DISPATCH_INTERVAL_MS);
    timer.unref();
    return () => {
        if (scheduledDispatch)
            clearTimeout(scheduledDispatch);
        scheduledDispatch = null;
        if (timer)
            clearInterval(timer);
        timer = null;
    };
}
//# sourceMappingURL=notifications.push.js.map