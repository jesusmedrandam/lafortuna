BEGIN;

-- Este script requiere que se hayan ejecutado previamente las migraciones
-- 20260811, 20260812 y 20260813.
-- Es idempotente: puede ejecutarse nuevamente sin crear otro fierro M7L.

INSERT INTO categoria_animal(
  id_categoria_animal,
  codigo,
  nombre,
  descripcion,
  activo
)
VALUES (
  '00000000-0000-4000-8000-000000000101',
  'EN_PROPIEDAD',
  'Animales en propiedad',
  'Animales ubicados dentro de la propiedad.',
  TRUE
)
ON CONFLICT(id_categoria_animal) DO UPDATE SET
  codigo=EXCLUDED.codigo,
  nombre=EXCLUDED.nombre,
  descripcion=EXCLUDED.descripcion,
  activo=TRUE,
  deleted_at=NULL,
  updated_at=NOW();

DO $$
DECLARE
  v_id_marquilla UUID;
  v_animales_actualizados INTEGER := 0;
  v_ubicaciones_incompatibles INTEGER := 0;
BEGIN
  -- Si M7L ya existe, reutiliza ese registro y conserva su fotografía.
  SELECT id_marquilla
  INTO v_id_marquilla
  FROM marquilla
  WHERE LOWER(BTRIM(codigo))='m7l'
  ORDER BY (deleted_at IS NULL) DESC, activo DESC, created_at
  LIMIT 1;

  IF v_id_marquilla IS NULL THEN
    INSERT INTO marquilla(
      id_usuario,
      codigo,
      nombre,
      descripcion,
      activo
    )
    VALUES (
      NULL,
      'M7L',
      'M7L',
      'Fierro M7L asignado a los animales registrados.',
      TRUE
    )
    RETURNING id_marquilla INTO v_id_marquilla;
  ELSE
    UPDATE marquilla
    SET codigo='M7L',
        nombre=COALESCE(NULLIF(BTRIM(nombre),''),'M7L'),
        activo=TRUE,
        deleted_at=NULL,
        updated_at=NOW()
    WHERE id_marquilla=v_id_marquilla;
  END IF;

  -- Relaciona el fierro con todos los propietarios actuales de los animales.
  INSERT INTO marquilla_usuario(
    id_marquilla,
    id_usuario,
    es_principal
  )
  SELECT
    v_id_marquilla,
    ap.id_usuario,
    BOOL_OR(ap.es_principal)
  FROM animal_propietario ap
  JOIN animal a ON a.id_animal=ap.id_animal AND a.deleted_at IS NULL
  WHERE ap.deleted_at IS NULL
    AND ap.fecha_hasta IS NULL
  GROUP BY ap.id_usuario
  ON CONFLICT DO NOTHING;

  -- Asigna M7L y la categoría En propiedad a todos los animales no eliminados.
  UPDATE animal
  SET id_marquilla=v_id_marquilla,
      id_categoria_animal='00000000-0000-4000-8000-000000000101'
  WHERE deleted_at IS NULL;

  GET DIAGNOSTICS v_animales_actualizados = ROW_COUNT;

  SELECT COUNT(*)::INTEGER
  INTO v_ubicaciones_incompatibles
  FROM animal a
  JOIN ubicacion u ON u.id_ubicacion=a.id_ubicacion_actual
  WHERE a.deleted_at IS NULL
    AND u.deleted_at IS NULL
    AND u.id_categoria_animal<>'00000000-0000-4000-8000-000000000101';

  RAISE NOTICE 'Fierro M7L asignado a % animales.', v_animales_actualizados;
  IF v_ubicaciones_incompatibles>0 THEN
    RAISE WARNING '% animales conservan una ubicación clasificada como Fuera de propiedad. Revise sus ubicaciones actuales.', v_ubicaciones_incompatibles;
  END IF;
END;
$$;

COMMIT;

