BEGIN;

-- Este parche sustituye la función de 20260917 si aquella ejecución falló.
-- Es idempotente y no requiere volver a ejecutar migraciones anteriores.
ALTER TABLE configuracion_propiedad
  ADD COLUMN IF NOT EXISTS edad_vacona_meses INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS edad_torete_meses INTEGER NOT NULL DEFAULT 12;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='ck_configuracion_edad_vacona'
      AND conrelid='configuracion_propiedad'::regclass
  ) THEN
    ALTER TABLE configuracion_propiedad
      ADD CONSTRAINT ck_configuracion_edad_vacona
      CHECK (edad_vacona_meses BETWEEN 0 AND 120);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='ck_configuracion_edad_torete'
      AND conrelid='configuracion_propiedad'::regclass
  ) THEN
    ALTER TABLE configuracion_propiedad
      ADD CONSTRAINT ck_configuracion_edad_torete
      CHECK (edad_torete_meses BETWEEN 0 AND 120);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_clasificacion_animal(
  p_id_animal UUID,
  p_fecha DATE DEFAULT CURRENT_DATE
) RETURNS VARCHAR(20)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_animal animal%ROWTYPE;
  v_edad_vacona INTEGER := 12;
  v_edad_torete INTEGER := 12;
  v_tiene_descendencia BOOLEAN := FALSE;
  v_tiene_prenez_confirmada BOOLEAN := FALSE;
BEGIN
  SELECT a.*
  INTO v_animal
  FROM animal a
  WHERE a.id_animal=p_id_animal AND a.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN 'SIN_CLASIFICAR';
  END IF;

  SELECT
    COALESCE(cp.edad_vacona_meses,12),
    COALESCE(cp.edad_torete_meses,12)
  INTO v_edad_vacona,v_edad_torete
  FROM animal a
  LEFT JOIN grupo g ON g.id_grupo=a.id_grupo_actual AND g.deleted_at IS NULL
  LEFT JOIN ubicacion u ON u.id_ubicacion=a.id_ubicacion_actual AND u.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT p.id_propiedad
    FROM propiedad_ganadera p
    WHERE p.deleted_at IS NULL
      AND (p.id_propiedad=COALESCE(g.id_propiedad,u.id_propiedad)
        OR COALESCE(g.id_propiedad,u.id_propiedad) IS NULL)
    ORDER BY (p.id_propiedad=COALESCE(g.id_propiedad,u.id_propiedad)) DESC,
      p.es_principal DESC,p.activa DESC,p.nombre
    LIMIT 1
  ) propiedad ON TRUE
  LEFT JOIN configuracion_propiedad cp ON cp.id_propiedad=propiedad.id_propiedad
  WHERE a.id_animal=p_id_animal;

  IF v_animal.sexo='HEMBRA' THEN
    SELECT EXISTS(
      SELECT 1 FROM parto p
      WHERE p.id_madre=p_id_animal AND p.deleted_at IS NULL
        AND p.fecha_parto::date<=p_fecha
    ) OR EXISTS(
      SELECT 1 FROM animal cria
      WHERE cria.id_madre=p_id_animal AND cria.deleted_at IS NULL
        AND (cria.fecha_nacimiento IS NULL OR cria.fecha_nacimiento<=p_fecha)
    ) INTO v_tiene_descendencia;

    IF v_tiene_descendencia THEN RETURN 'VACA'; END IF;
    IF v_animal.fecha_nacimiento IS NOT NULL
       AND v_animal.fecha_nacimiento>p_fecha-make_interval(months=>v_edad_vacona) THEN
      RETURN 'TERNERA';
    END IF;
    RETURN 'VACONA';
  END IF;

  IF v_animal.sexo='MACHO' THEN
    SELECT EXISTS(
      SELECT 1 FROM parto p
      WHERE p.id_padre=p_id_animal AND p.deleted_at IS NULL
        AND p.fecha_parto::date<=p_fecha
    ) OR EXISTS(
      SELECT 1 FROM animal cria
      WHERE cria.id_padre=p_id_animal AND cria.deleted_at IS NULL
        AND (cria.fecha_nacimiento IS NULL OR cria.fecha_nacimiento<=p_fecha)
    ) INTO v_tiene_descendencia;

    SELECT EXISTS(
      SELECT 1 FROM prenez pr
      WHERE pr.id_padre=p_id_animal
        AND pr.estado IN ('CONFIRMADA','FINALIZADA')
        AND pr.deleted_at IS NULL
        AND pr.fecha_confirmacion<=p_fecha
    ) INTO v_tiene_prenez_confirmada;

    IF v_tiene_descendencia OR v_tiene_prenez_confirmada THEN RETURN 'TORO'; END IF;
    IF v_animal.fecha_nacimiento IS NOT NULL
       AND v_animal.fecha_nacimiento>p_fecha-make_interval(months=>v_edad_torete) THEN
      RETURN 'TERNERO';
    END IF;
    RETURN 'TORETE';
  END IF;

  RETURN 'SIN_CLASIFICAR';
END;
$$;

ALTER TABLE animal_imagen
  ADD COLUMN IF NOT EXISTS id_evento_condicion UUID,
  ADD COLUMN IF NOT EXISTS id_muerte UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='fk_animal_imagen_evento_condicion'
      AND conrelid='animal_imagen'::regclass
  ) THEN
    ALTER TABLE animal_imagen
      ADD CONSTRAINT fk_animal_imagen_evento_condicion
      FOREIGN KEY(id_evento_condicion) REFERENCES animal_condicion_evento(id_evento);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='fk_animal_imagen_muerte'
      AND conrelid='animal_imagen'::regclass
  ) THEN
    ALTER TABLE animal_imagen
      ADD CONSTRAINT fk_animal_imagen_muerte
      FOREIGN KEY(id_muerte) REFERENCES muerte(id_muerte);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_animal_imagen_evento_condicion
  ON animal_imagen(id_evento_condicion)
  WHERE id_evento_condicion IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_animal_imagen_muerte
  ON animal_imagen(id_muerte)
  WHERE id_muerte IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN animal_imagen.id_evento_condicion IS
  'Fotografía única asociada a una recuperación o novedad de condición.';
COMMENT ON COLUMN animal_imagen.id_muerte IS
  'Fotografía única asociada al registro de muerte.';

COMMIT;
