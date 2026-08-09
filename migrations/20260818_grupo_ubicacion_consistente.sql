BEGIN;

ALTER TABLE grupo
  ADD COLUMN IF NOT EXISTS id_ubicacion_actual UUID REFERENCES ubicacion(id_ubicacion);

-- Solo se completa automáticamente cuando todos los animales activos del grupo
-- ya comparten una única ubicación. Los grupos históricos inconsistentes quedan
-- pendientes de regularización mediante un movimiento.
UPDATE grupo g
SET id_ubicacion_actual = resumen.id_ubicacion
FROM (
  SELECT
    a.id_grupo_actual AS id_grupo,
    MIN(a.id_ubicacion_actual::text)::UUID AS id_ubicacion
  FROM animal a
  WHERE a.id_grupo_actual IS NOT NULL
    AND a.estado = 'ACTIVO'
    AND a.deleted_at IS NULL
  GROUP BY a.id_grupo_actual
  HAVING COUNT(*) FILTER (WHERE a.id_ubicacion_actual IS NULL) = 0
     AND COUNT(DISTINCT a.id_ubicacion_actual) = 1
) resumen
WHERE g.id_grupo = resumen.id_grupo
  AND g.id_ubicacion_actual IS NULL;

CREATE INDEX IF NOT EXISTS idx_grupo_ubicacion_actual
  ON grupo(id_ubicacion_actual)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN grupo.id_ubicacion_actual IS
  'Ubicación única del grupo. Todos sus animales activos deben compartirla.';

COMMIT;
