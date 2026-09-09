-- Consulta de solo lectura. No modifica ningún dato.

SELECT
  n.created_at,
  n.tipo,
  n.categoria,
  n.prioridad,
  n.titulo,
  n.mensaje,
  n.ruta,
  n.clave_dedupe,
  COUNT(nu.id_usuario)::int AS destinatarios
FROM notificacion n
LEFT JOIN notificacion_usuario nu ON nu.id_notificacion=n.id_notificacion
WHERE n.created_at>=NOW()-INTERVAL '7 days'
GROUP BY n.id_notificacion
ORDER BY n.created_at DESC;

SELECT
  n.tipo,
  nu.push_estado,
  COUNT(*)::int AS total
FROM notificacion_usuario nu
JOIN notificacion n ON n.id_notificacion=nu.id_notificacion
WHERE n.created_at>=NOW()-INTERVAL '7 days'
GROUP BY n.tipo,nu.push_estado
ORDER BY n.tipo,nu.push_estado;

-- Si el evento aparece en el buzón pero no como push, esta consulta muestra
-- si fue enviado, omitido o rechazado por Firebase.
SELECT
  n.created_at,
  n.tipo,
  n.titulo,
  nu.id_usuario,
  nu.push_estado,
  nu.push_intentos,
  nu.push_enviada_at,
  nu.push_ultimo_error
FROM notificacion n
JOIN notificacion_usuario nu ON nu.id_notificacion=n.id_notificacion
WHERE n.tipo<>'PRUEBA_FIREBASE'
ORDER BY n.created_at DESC
LIMIT 50;

SELECT
  n.created_at,
  n.titulo,
  n.datos->>'nivel_riesgo' AS nivel_riesgo,
  n.datos->>'dias_descanso' AS dias_descanso,
  n.datos->>'id_potrero' AS id_potrero
FROM notificacion n
WHERE n.tipo='RIESGO_GARRAPATA_POTRERO'
ORDER BY n.created_at DESC
LIMIT 20;
