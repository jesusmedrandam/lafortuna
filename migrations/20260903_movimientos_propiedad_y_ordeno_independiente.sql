BEGIN;

-- 1. El estado "en ordeño" pertenece a la vaca, no exclusivamente a una
-- lactancia. Esto permite ordeñar una vaca cuyo becerro murió o cuya lactancia
-- administrativa fue cerrada, siempre que tenga un parto dentro de 18 meses.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema=current_schema()
      AND table_name='animal'
      AND column_name='en_ordeno'
  ) THEN
    ALTER TABLE animal ADD COLUMN en_ordeno BOOLEAN NOT NULL DEFAULT FALSE;

    UPDATE animal a
    SET en_ordeno=TRUE,updated_at=NOW()
    WHERE a.deleted_at IS NULL AND a.estado='ACTIVO' AND a.sexo='HEMBRA'
      AND EXISTS(
        SELECT 1
        FROM lactancia l
        JOIN parto p ON p.id_parto=l.id_parto AND p.deleted_at IS NULL
        WHERE l.id_vaca=a.id_animal AND l.deleted_at IS NULL
          AND l.activa=TRUE AND l.en_ordeno=TRUE
          AND p.fecha_parto<=CURRENT_DATE
          AND p.fecha_parto + INTERVAL '18 months'>=CURRENT_DATE
      );
  END IF;
END;
$$;

COMMENT ON COLUMN animal.en_ordeno IS
  'Indica si la vaca está actualmente incluida en el ordeño. Requiere un parto dentro de los últimos 18 meses.';

CREATE INDEX IF NOT EXISTS idx_animal_en_ordeno
  ON animal(en_ordeno,id_animal)
  WHERE en_ordeno=TRUE AND estado='ACTIVO' AND deleted_at IS NULL;

-- Una producción puede corresponder a una vaca en ordeño sin una lactancia
-- administrativa abierta. Si existe una lactancia válida, la API la conserva.
ALTER TABLE produccion_leche ALTER COLUMN id_lactancia DROP NOT NULL;

-- Cierra estados heredados que ya superaron el límite de 18 meses.
UPDATE lactancia l
SET activa=FALSE,
    en_ordeno=FALSE,
    fecha_fin=GREATEST(
      l.fecha_inicio,
      LEAST(
        COALESCE(l.fecha_fin,(p.fecha_parto + INTERVAL '18 months')::date),
        (p.fecha_parto + INTERVAL '18 months')::date
      )
    ),
    updated_at=NOW()
FROM parto p
WHERE p.id_parto=l.id_parto
  AND p.deleted_at IS NULL
  AND l.deleted_at IS NULL
  AND l.activa=TRUE
  AND p.fecha_parto + INTERVAL '18 months'<CURRENT_DATE;

UPDATE animal a
SET en_ordeno=FALSE,updated_at=NOW()
WHERE a.en_ordeno=TRUE
  AND NOT EXISTS(
    SELECT 1 FROM parto p
    WHERE p.id_madre=a.id_animal AND p.deleted_at IS NULL
      AND p.fecha_parto<=CURRENT_DATE
      AND p.fecha_parto + INTERVAL '18 months'>=CURRENT_DATE
  );

CREATE OR REPLACE FUNCTION fn_validar_produccion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  vaca_reg RECORD;
  lactancia_reg RECORD;
  parto_valido BOOLEAN;
BEGIN
  SELECT sexo,estado,en_ordeno
  INTO vaca_reg
  FROM animal
  WHERE id_animal=NEW.id_vaca AND deleted_at IS NULL;

  IF NOT FOUND OR vaca_reg.estado<>'ACTIVO' THEN
    RAISE EXCEPTION 'La vaca no existe o está inactiva.';
  END IF;
  IF vaca_reg.sexo<>'HEMBRA' THEN
    RAISE EXCEPTION 'La producción de leche solo puede registrarse para una hembra.';
  END IF;
  IF vaca_reg.en_ordeno=FALSE THEN
    RAISE EXCEPTION 'La vaca no está marcada como en ordeño.';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM parto p
    WHERE p.id_madre=NEW.id_vaca AND p.deleted_at IS NULL
      AND p.fecha_parto<=NEW.fecha_produccion
      AND p.fecha_parto + INTERVAL '18 months'>=NEW.fecha_produccion
  ) INTO parto_valido;

  IF parto_valido=FALSE THEN
    RAISE EXCEPTION 'La vaca debe tener un parto registrado dentro de los 18 meses anteriores a la producción.';
  END IF;

  IF NEW.id_lactancia IS NOT NULL THEN
    SELECT id_vaca,fecha_inicio,fecha_fin
    INTO lactancia_reg
    FROM lactancia
    WHERE id_lactancia=NEW.id_lactancia AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La lactancia seleccionada no existe.';
    END IF;
    IF lactancia_reg.id_vaca<>NEW.id_vaca THEN
      RAISE EXCEPTION 'La producción no corresponde a la vaca de la lactancia.';
    END IF;
    IF NEW.fecha_produccion<lactancia_reg.fecha_inicio
       OR NEW.fecha_produccion>lactancia_reg.fecha_inicio + INTERVAL '18 months'
       OR (lactancia_reg.fecha_fin IS NOT NULL AND NEW.fecha_produccion>lactancia_reg.fecha_fin) THEN
      RAISE EXCEPTION 'La fecha de producción está fuera del período permitido de la lactancia.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. En traslados entre propiedades y cambios de grupo, el grupo de destino
-- determina siempre la propiedad y la ubicación. Corrige borradores existentes
-- que ya tengan un grupo seleccionado.
UPDATE movimiento_animal m
SET id_ubicacion_destino=g.id_ubicacion_actual,
    id_propiedad_destino=g.id_propiedad,
    updated_at=NOW()
FROM grupo g
WHERE g.id_grupo=m.id_grupo_destino
  AND g.deleted_at IS NULL AND g.activo=TRUE
  AND m.deleted_at IS NULL AND m.estado='BORRADOR'
  AND m.tipo_movimiento IN('GRUPO','PROPIEDAD','COMBINADO')
  AND (
    m.id_ubicacion_destino IS DISTINCT FROM g.id_ubicacion_actual
    OR m.id_propiedad_destino IS DISTINCT FROM g.id_propiedad
  );

UPDATE movimiento_animal_detalle d
SET id_ubicacion_destino=m.id_ubicacion_destino,
    id_grupo_destino=m.id_grupo_destino,
    updated_at=NOW()
FROM movimiento_animal m
WHERE m.id_movimiento=d.id_movimiento
  AND m.deleted_at IS NULL AND m.estado='BORRADOR'
  AND m.tipo_movimiento IN('GRUPO','PROPIEDAD','COMBINADO')
  AND d.deleted_at IS NULL
  AND (
    d.id_ubicacion_destino IS DISTINCT FROM m.id_ubicacion_destino
    OR d.id_grupo_destino IS DISTINCT FROM m.id_grupo_destino
  );

-- 3. La fecha introducida por el usuario no incluye hora y también puede
-- corresponder a un movimiento histórico. Para no violar
-- ck_historial_*_fechas, el instante efectivo del historial nunca queda antes
-- del inicio del tramo abierto. La fecha declarada por el usuario se conserva
-- intacta en movimiento_animal para auditoría.
CREATE OR REPLACE FUNCTION fn_sincronizar_historial_animal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  fecha_evento TIMESTAMPTZ;
  fecha_grupo TIMESTAMPTZ;
  fecha_ubicacion TIMESTAMPTZ;
  inicio_grupo TIMESTAMPTZ;
  inicio_ubicacion TIMESTAMPTZ;
  movimiento UUID;
  motivo TEXT;
  actor UUID;
BEGIN
  BEGIN
    fecha_evento:=NULLIF(current_setting('app.fecha_movimiento',true),'')::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN
    fecha_evento:=NULL;
  END;
  fecha_evento:=COALESCE(fecha_evento,NOW());

  BEGIN
    movimiento:=NULLIF(current_setting('app.movimiento_id',true),'')::UUID;
  EXCEPTION WHEN OTHERS THEN
    movimiento:=NULL;
  END;

  motivo:=NULLIF(current_setting('app.motivo_cambio',true),'');
  actor:=fn_usuario_actual();

  IF TG_OP='INSERT' THEN
    IF NEW.id_grupo_actual IS NOT NULL THEN
      INSERT INTO animal_grupo_historial(
        id_animal,id_grupo,fecha_desde,motivo,id_movimiento,registrado_por
      ) VALUES(NEW.id_animal,NEW.id_grupo_actual,fecha_evento,motivo,movimiento,actor);
    END IF;
  ELSIF OLD.id_grupo_actual IS DISTINCT FROM NEW.id_grupo_actual THEN
    SELECT fecha_desde INTO inicio_grupo
    FROM animal_grupo_historial
    WHERE id_animal=NEW.id_animal AND fecha_hasta IS NULL AND deleted_at IS NULL
    LIMIT 1 FOR UPDATE;

    fecha_grupo:=GREATEST(fecha_evento,COALESCE(inicio_grupo,fecha_evento));

    UPDATE animal_grupo_historial
    SET fecha_hasta=fecha_grupo
    WHERE id_animal=NEW.id_animal AND fecha_hasta IS NULL AND deleted_at IS NULL;

    IF NEW.id_grupo_actual IS NOT NULL THEN
      INSERT INTO animal_grupo_historial(
        id_animal,id_grupo,fecha_desde,motivo,id_movimiento,registrado_por
      ) VALUES(NEW.id_animal,NEW.id_grupo_actual,fecha_grupo,motivo,movimiento,actor);
    END IF;
  END IF;

  IF TG_OP='INSERT' THEN
    IF NEW.id_ubicacion_actual IS NOT NULL THEN
      INSERT INTO animal_ubicacion_historial(
        id_animal,id_ubicacion,fecha_desde,motivo,id_movimiento,registrado_por
      ) VALUES(NEW.id_animal,NEW.id_ubicacion_actual,fecha_evento,motivo,movimiento,actor);
    END IF;
  ELSIF OLD.id_ubicacion_actual IS DISTINCT FROM NEW.id_ubicacion_actual THEN
    SELECT fecha_desde INTO inicio_ubicacion
    FROM animal_ubicacion_historial
    WHERE id_animal=NEW.id_animal AND fecha_hasta IS NULL AND deleted_at IS NULL
    LIMIT 1 FOR UPDATE;

    fecha_ubicacion:=GREATEST(fecha_evento,COALESCE(inicio_ubicacion,fecha_evento));

    UPDATE animal_ubicacion_historial
    SET fecha_hasta=fecha_ubicacion
    WHERE id_animal=NEW.id_animal AND fecha_hasta IS NULL AND deleted_at IS NULL;

    IF NEW.id_ubicacion_actual IS NOT NULL THEN
      INSERT INTO animal_ubicacion_historial(
        id_animal,id_ubicacion,fecha_desde,motivo,id_movimiento,registrado_por
      ) VALUES(NEW.id_animal,NEW.id_ubicacion_actual,fecha_ubicacion,motivo,movimiento,actor);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
