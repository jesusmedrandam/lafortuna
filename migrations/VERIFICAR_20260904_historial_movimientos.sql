-- Ejecutar DESPUÉS de 20260904_reinstalar_historial_movimientos.sql.
-- Este archivo es de solo lectura.

SELECT
  EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'fn_sincronizar_historial_animal'
      AND pg_get_functiondef(oid) ILIKE '%1 microsecond%'
      AND pg_get_functiondef(oid) ILIKE '%FOR UPDATE%'
  ) AS correccion_instalada;

SELECT
  conrelid::regclass AS tabla,
  conname AS restriccion,
  pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conname IN (
  'ck_historial_grupo_fechas',
  'ck_historial_ubicacion_fechas'
)
ORDER BY conname;

SELECT
  (SELECT COUNT(*)
   FROM animal_grupo_historial
   WHERE deleted_at IS NULL
     AND fecha_hasta IS NOT NULL
     AND fecha_hasta < fecha_desde) AS historiales_grupo_invalidos,
  (SELECT COUNT(*)
   FROM animal_ubicacion_historial
   WHERE deleted_at IS NULL
     AND fecha_hasta IS NOT NULL
     AND fecha_hasta < fecha_desde) AS historiales_ubicacion_invalidos,
  (SELECT COUNT(*)
   FROM animal_grupo_historial
   WHERE deleted_at IS NULL
     AND fecha_hasta = fecha_desde) AS historiales_grupo_duracion_cero,
  (SELECT COUNT(*)
   FROM animal_ubicacion_historial
   WHERE deleted_at IS NULL
     AND fecha_hasta = fecha_desde) AS historiales_ubicacion_duracion_cero;

SELECT 'grupo' AS tipo, id_animal, COUNT(*) AS tramos_abiertos
FROM animal_grupo_historial
WHERE deleted_at IS NULL AND fecha_hasta IS NULL
GROUP BY id_animal
HAVING COUNT(*) > 1
UNION ALL
SELECT 'ubicacion' AS tipo, id_animal, COUNT(*) AS tramos_abiertos
FROM animal_ubicacion_historial
WHERE deleted_at IS NULL AND fecha_hasta IS NULL
GROUP BY id_animal
HAVING COUNT(*) > 1;
