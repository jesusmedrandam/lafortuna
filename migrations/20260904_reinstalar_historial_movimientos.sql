BEGIN;

-- Corrige la aplicación de movimientos cuya fecha declarada es igual o
-- anterior al inicio del tramo histórico actualmente abierto.
--
-- ck_historial_grupo_fechas y ck_historial_ubicacion_fechas impiden cerrar un
-- tramo antes de su inicio. El error observado demuestra que la base activa
-- todavía intentó guardar fecha_hasta < fecha_desde. Esta migración vuelve a
-- instalar la función completa y calcula el cierre desde cada fila abierta,
-- sin depender de que otra migración anterior se haya ejecutado correctamente.
--
-- La fecha elegida por el usuario permanece intacta en movimiento_animal. El
-- historial técnico avanza un microsegundo únicamente cuando es indispensable
-- para conservar un intervalo válido y una secuencia sin solapamientos.
CREATE OR REPLACE FUNCTION public.fn_sincronizar_historial_animal()
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
    fecha_evento := NULLIF(current_setting('app.fecha_movimiento', TRUE), '')::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN
    fecha_evento := NULL;
  END;
  fecha_evento := COALESCE(fecha_evento, NOW());

  BEGIN
    movimiento := NULLIF(current_setting('app.movimiento_id', TRUE), '')::UUID;
  EXCEPTION WHEN OTHERS THEN
    movimiento := NULL;
  END;

  motivo := NULLIF(current_setting('app.motivo_cambio', TRUE), '');
  actor := public.fn_usuario_actual();

  IF TG_OP = 'INSERT' THEN
    IF NEW.id_grupo_actual IS NOT NULL THEN
      INSERT INTO public.animal_grupo_historial(
        id_animal, id_grupo, fecha_desde, motivo, id_movimiento, registrado_por
      ) VALUES (
        NEW.id_animal, NEW.id_grupo_actual, fecha_evento, motivo, movimiento, actor
      );
    END IF;
  ELSIF OLD.id_grupo_actual IS DISTINCT FROM NEW.id_grupo_actual THEN
    -- Bloquea todos los tramos abiertos y toma el inicio más reciente. Esto
    -- también protege bases que hayan quedado con más de un tramo abierto por
    -- datos históricos anteriores.
    SELECT MAX(abierto.fecha_desde)
    INTO inicio_grupo
    FROM (
      SELECT fecha_desde
      FROM public.animal_grupo_historial
      WHERE id_animal = NEW.id_animal
        AND fecha_hasta IS NULL
        AND deleted_at IS NULL
      FOR UPDATE
    ) AS abierto;

    fecha_grupo := GREATEST(
      fecha_evento,
      COALESCE(inicio_grupo + INTERVAL '1 microsecond', fecha_evento)
    );

    UPDATE public.animal_grupo_historial
    SET fecha_hasta = GREATEST(
      fecha_grupo,
      fecha_desde + INTERVAL '1 microsecond'
    )
    WHERE id_animal = NEW.id_animal
      AND fecha_hasta IS NULL
      AND deleted_at IS NULL;

    IF NEW.id_grupo_actual IS NOT NULL THEN
      INSERT INTO public.animal_grupo_historial(
        id_animal, id_grupo, fecha_desde, motivo, id_movimiento, registrado_por
      ) VALUES (
        NEW.id_animal, NEW.id_grupo_actual, fecha_grupo, motivo, movimiento, actor
      );
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.id_ubicacion_actual IS NOT NULL THEN
      INSERT INTO public.animal_ubicacion_historial(
        id_animal, id_ubicacion, fecha_desde, motivo, id_movimiento, registrado_por
      ) VALUES (
        NEW.id_animal, NEW.id_ubicacion_actual, fecha_evento, motivo, movimiento, actor
      );
    END IF;
  ELSIF OLD.id_ubicacion_actual IS DISTINCT FROM NEW.id_ubicacion_actual THEN
    SELECT MAX(abierto.fecha_desde)
    INTO inicio_ubicacion
    FROM (
      SELECT fecha_desde
      FROM public.animal_ubicacion_historial
      WHERE id_animal = NEW.id_animal
        AND fecha_hasta IS NULL
        AND deleted_at IS NULL
      FOR UPDATE
    ) AS abierto;

    fecha_ubicacion := GREATEST(
      fecha_evento,
      COALESCE(inicio_ubicacion + INTERVAL '1 microsecond', fecha_evento)
    );

    UPDATE public.animal_ubicacion_historial
    SET fecha_hasta = GREATEST(
      fecha_ubicacion,
      fecha_desde + INTERVAL '1 microsecond'
    )
    WHERE id_animal = NEW.id_animal
      AND fecha_hasta IS NULL
      AND deleted_at IS NULL;

    IF NEW.id_ubicacion_actual IS NOT NULL THEN
      INSERT INTO public.animal_ubicacion_historial(
        id_animal, id_ubicacion, fecha_desde, motivo, id_movimiento, registrado_por
      ) VALUES (
        NEW.id_animal, NEW.id_ubicacion_actual, fecha_ubicacion, motivo, movimiento, actor
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
