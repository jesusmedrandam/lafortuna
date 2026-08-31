import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

type Queryable = Pick<PoolClient, 'query'>;

export interface NotificationEvent {
  tipo: string;
  categoria: string;
  titulo: string;
  mensaje: string;
  prioridad?: 'INFO' | 'IMPORTANTE' | 'URGENTE';
  permiso?: string;
  entidadTipo?: string;
  entidadId?: string;
  ruta?: string;
  datos?: Record<string, unknown>;
  claveDedupe?: string;
  creadoPor?: string;
  excluirUsuario?: string;
  usuarios?: string[];
}

/**
 * Crea una notificación y su buzón por usuario. Los destinatarios se resuelven
 * por permiso (incluido ADMINISTRADOR) o mediante una lista explícita.
 * El transporte push se ejecutará en una etapa posterior sobre estos mismos
 * destinatarios, sin duplicar el evento.
 */
export async function emitNotification(client: Queryable, event: NotificationEvent) {
  const id = randomUUID();
  const inserted = await client.query<{ id_notificacion: string }>({
    text: `INSERT INTO notificacion(
      id_notificacion,tipo,categoria,prioridad,titulo,mensaje,entidad_tipo,
      entidad_id,ruta,datos,clave_dedupe,creado_por
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
    ON CONFLICT (clave_dedupe) WHERE clave_dedupe IS NOT NULL DO NOTHING
    RETURNING id_notificacion`,
    values: [
      id,event.tipo,event.categoria,event.prioridad ?? 'INFO',event.titulo,
      event.mensaje,event.entidadTipo ?? null,event.entidadId ?? null,
      event.ruta ?? null,JSON.stringify(event.datos ?? {}),event.claveDedupe ?? null,
      event.creadoPor ?? null,
    ],
  });
  let notificationId = inserted.rows[0]?.id_notificacion;
  if (!notificationId && event.claveDedupe) {
    notificationId = (await client.query<{ id_notificacion: string }>(
      'SELECT id_notificacion FROM notificacion WHERE clave_dedupe=$1',
      [event.claveDedupe],
    )).rows[0]?.id_notificacion;
  }
  if (!notificationId) return null;

  await client.query({
    text: `INSERT INTO notificacion_usuario(id_notificacion,id_usuario,push_estado)
      SELECT $1,u.id_usuario,
        CASE WHEN COALESCE(np.enviar_push,TRUE) THEN 'PENDIENTE' ELSE 'OMITIDA' END
      FROM usuario u
      LEFT JOIN notificacion_preferencia np
        ON np.id_usuario=u.id_usuario AND np.categoria=$2
      WHERE u.activo=TRUE AND u.deleted_at IS NULL
        AND COALESCE(np.mostrar_en_buzon,TRUE)=TRUE
        AND ($3::uuid[] IS NULL OR u.id_usuario=ANY($3::uuid[]))
        AND ($4::text IS NULL OR
          EXISTS(
            SELECT 1 FROM usuario_rol ur
            JOIN rol r ON r.id_rol=ur.id_rol AND r.activo=TRUE AND r.deleted_at IS NULL
            LEFT JOIN rol_permiso rp ON rp.id_rol=r.id_rol AND rp.deleted_at IS NULL
            LEFT JOIN permiso p ON p.id_permiso=rp.id_permiso AND p.activo=TRUE AND p.deleted_at IS NULL
            WHERE ur.id_usuario=u.id_usuario AND ur.deleted_at IS NULL
              AND (r.codigo='ADMINISTRADOR' OR p.codigo=$4)
          )
        )
        AND ($5::uuid IS NULL OR u.id_usuario<>$5::uuid)
      ON CONFLICT DO NOTHING`,
    values: [
      notificationId,event.categoria,event.usuarios?.length ? event.usuarios : null,
      event.permiso ?? null,event.excluirUsuario ?? null,
    ],
  });
  return notificationId;
}
