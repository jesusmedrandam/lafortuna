-- Ejecutar DESPUÉS de 20260903_movimientos_propiedad_y_ordeno_independiente.sql.
-- Este archivo es de solo lectura: no modifica ningún registro.

SELECT
  EXISTS(
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='animal'
      AND column_name='en_ordeno' AND is_nullable='NO'
  ) AS animal_en_ordeno_correcto,
  EXISTS(
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='produccion_leche'
      AND column_name='id_lactancia' AND is_nullable='YES'
  ) AS produccion_sin_lactancia_permitida,
  EXISTS(
    SELECT 1 FROM pg_proc
    WHERE proname='fn_sincronizar_historial_animal'
      AND pg_get_functiondef(oid) ILIKE '%GREATEST%'
  ) AS historial_protegido;

SELECT COUNT(*)::integer AS borradores_con_destino_inconsistente
FROM movimiento_animal m
JOIN grupo g ON g.id_grupo=m.id_grupo_destino
WHERE m.deleted_at IS NULL AND m.estado='BORRADOR'
  AND m.tipo_movimiento IN('GRUPO','PROPIEDAD','COMBINADO')
  AND (
    m.id_ubicacion_destino IS DISTINCT FROM g.id_ubicacion_actual
    OR m.id_propiedad_destino IS DISTINCT FROM g.id_propiedad
  );

SELECT
  (SELECT COUNT(*) FROM animal_grupo_historial
   WHERE deleted_at IS NULL AND fecha_hasta<fecha_desde) AS historiales_grupo_invalidos,
  (SELECT COUNT(*) FROM animal_ubicacion_historial
   WHERE deleted_at IS NULL AND fecha_hasta<fecha_desde) AS historiales_ubicacion_invalidos,
  (SELECT COUNT(*)
   FROM lactancia l JOIN parto p ON p.id_parto=l.id_parto
   WHERE l.deleted_at IS NULL AND p.deleted_at IS NULL AND l.activa=TRUE
     AND p.fecha_parto + INTERVAL '18 months'<CURRENT_DATE) AS lactancias_activas_vencidas,
  (SELECT COUNT(*)
   FROM animal a
   WHERE a.deleted_at IS NULL AND a.en_ordeno=TRUE
     AND NOT EXISTS(
       SELECT 1 FROM parto p
       WHERE p.id_madre=a.id_animal AND p.deleted_at IS NULL
         AND p.fecha_parto<=CURRENT_DATE
         AND p.fecha_parto + INTERVAL '18 months'>=CURRENT_DATE
     )) AS vacas_en_ordeno_no_elegibles;
