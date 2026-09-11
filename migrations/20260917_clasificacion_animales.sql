BEGIN;

ALTER TABLE configuracion_propiedad
  ADD COLUMN IF NOT EXISTS edad_vacona_meses INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS edad_torete_meses INTEGER NOT NULL DEFAULT 12;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='ck_configuracion_edad_vacona'
  ) THEN
    ALTER TABLE configuracion_propiedad
      ADD CONSTRAINT ck_configuracion_edad_vacona
      CHECK (edad_vacona_meses BETWEEN 0 AND 120);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='ck_configuracion_edad_torete'
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
  SELECT a,
    COALESCE(cp.edad_vacona_meses,12),
    COALESCE(cp.edad_torete_meses,12)
  INTO v_animal,v_edad_vacona,v_edad_torete
  FROM animal a
  LEFT JOIN grupo g ON g.id_grupo=a.id_grupo_actual AND g.deleted_at IS NULL
  LEFT JOIN ubicacion u ON u.id_ubicacion=a.id_ubicacion_actual AND u.deleted_at IS NULL
  LEFT JOIN configuracion_propiedad cp ON cp.id_propiedad=COALESCE(g.id_propiedad,u.id_propiedad)
  WHERE a.id_animal=p_id_animal AND a.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN 'SIN_CLASIFICAR';
  END IF;

  IF v_animal.sexo='HEMBRA' THEN
    SELECT EXISTS(
      SELECT 1 FROM parto p
      WHERE p.id_madre=p_id_animal AND p.deleted_at IS NULL AND p.fecha_parto::date<=p_fecha
    ) OR EXISTS(
      SELECT 1 FROM animal cria
      WHERE cria.id_madre=p_id_animal AND cria.deleted_at IS NULL
        AND (cria.fecha_nacimiento IS NULL OR cria.fecha_nacimiento<=p_fecha)
    ) INTO v_tiene_descendencia;

    IF v_tiene_descendencia THEN
      RETURN 'VACA';
    END IF;
    IF v_animal.fecha_nacimiento IS NOT NULL
       AND v_animal.fecha_nacimiento>p_fecha-make_interval(months=>v_edad_vacona) THEN
      RETURN 'TERNERA';
    END IF;
    RETURN 'VACONA';
  END IF;

  IF v_animal.sexo='MACHO' THEN
    SELECT EXISTS(
      SELECT 1 FROM parto p
      WHERE p.id_padre=p_id_animal AND p.deleted_at IS NULL AND p.fecha_parto::date<=p_fecha
    ) OR EXISTS(
      SELECT 1 FROM animal cria
      WHERE cria.id_padre=p_id_animal AND cria.deleted_at IS NULL
        AND (cria.fecha_nacimiento IS NULL OR cria.fecha_nacimiento<=p_fecha)
    ) INTO v_tiene_descendencia;

    SELECT EXISTS(
      SELECT 1 FROM prenez pr
      WHERE pr.id_padre=p_id_animal AND pr.estado IN ('CONFIRMADA','FINALIZADA')
        AND pr.deleted_at IS NULL AND pr.fecha_confirmacion<=p_fecha
    ) INTO v_tiene_prenez_confirmada;

    IF v_tiene_descendencia OR v_tiene_prenez_confirmada THEN
      RETURN 'TORO';
    END IF;
    IF v_animal.fecha_nacimiento IS NOT NULL
       AND v_animal.fecha_nacimiento>p_fecha-make_interval(months=>v_edad_torete) THEN
      RETURN 'TERNERO';
    END IF;
    RETURN 'TORETE';
  END IF;

  RETURN 'SIN_CLASIFICAR';
END;
$$;

COMMENT ON COLUMN configuracion_propiedad.edad_vacona_meses IS
  'Edad desde la cual una hembra sin descendencia se clasifica como vacona.';
COMMENT ON COLUMN configuracion_propiedad.edad_torete_meses IS
  'Edad desde la cual un macho sin descendencia ni preñez confirmada se clasifica como torete.';
COMMENT ON FUNCTION fn_clasificacion_animal(UUID,DATE) IS
  'Clasificación calculada del animal en una fecha: vaca, vacona, toro, torete o ternero/a.';

COMMIT;
