-- VERSION CORREGIDA V2: sanea primero los registros históricos con los
-- triggers de propiedad temporalmente desactivados.
BEGIN;

-- La propiedad real se obtiene exclusivamente desde propiedad_ganadera.
-- id_propiedad_padre queda como columna heredada para compatibilidad temporal,
-- pero ya no interviene en categorías, filtros ni movimientos.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM propiedad_ganadera
    WHERE es_principal=TRUE AND activa=TRUE AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'No existe una propiedad ganadera principal activa.';
  END IF;
  IF (SELECT COUNT(*) FROM propiedad_ganadera
      WHERE es_principal=TRUE AND activa=TRUE AND deleted_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'Debe existir exactamente una propiedad ganadera principal activa.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM propiedad_ganadera p
    WHERE p.es_principal=FALSE AND p.activa=TRUE AND p.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ubicacion u
        WHERE u.id_ubicacion=p.id_propiedad
          AND u.id_propiedad=p.id_propiedad
          AND u.tipo='OTRO' AND u.activo=TRUE AND u.deleted_at IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'Cada propiedad externa activa debe tener su ubicación general OTRO con el mismo identificador.';
  END IF;
END;
$$;

-- Este trigger pertenecía al modelo anterior, donde una ubicación OTRO era
-- tratada como propiedad padre. En el modelo actual sobrescribía como
-- EN_PROPIEDAD los potreros de propiedades externas.
DROP TRIGGER IF EXISTS trg_validar_jerarquia_ubicacion_propiedad ON ubicacion;
DROP FUNCTION IF EXISTS validar_jerarquia_ubicacion_propiedad();

CREATE OR REPLACE FUNCTION sincronizar_ubicacion_con_propiedad()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  principal BOOLEAN;
  propiedad_activa BOOLEAN;
  propiedad_eliminada TIMESTAMPTZ;
BEGIN
  SELECT es_principal,activa,deleted_at
  INTO principal,propiedad_activa,propiedad_eliminada
  FROM propiedad_ganadera
  WHERE id_propiedad=NEW.id_propiedad;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La propiedad seleccionada no está disponible.';
  END IF;

  -- La migración debe poder desactivar ubicaciones históricas vinculadas con
  -- propiedades ya eliminadas. Lo que no se permite es crear o reactivar una
  -- ubicación dentro de una propiedad inactiva.
  IF (propiedad_activa=FALSE OR propiedad_eliminada IS NOT NULL)
     AND (NEW.activo=TRUE OR NEW.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'La propiedad seleccionada no está disponible.';
  END IF;

  NEW.id_categoria_animal=CASE
    WHEN principal THEN '00000000-0000-4000-8000-000000000101'::UUID
    ELSE '00000000-0000-4000-8000-000000000102'::UUID
  END;
  NEW.id_propiedad_padre=NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sincronizar_ubicacion_propiedad ON ubicacion;
-- Se recrea después de sanear los registros históricos para que ningún
-- trigger anterior interfiera con la corrección masiva.

CREATE OR REPLACE FUNCTION sincronizar_grupo_con_propiedad()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  principal BOOLEAN;
  propiedad_activa BOOLEAN;
  propiedad_eliminada TIMESTAMPTZ;
  propiedad_ubicacion UUID;
  ubicacion_activa BOOLEAN;
  ubicacion_eliminada TIMESTAMPTZ;
BEGIN
  SELECT es_principal,activa,deleted_at
  INTO principal,propiedad_activa,propiedad_eliminada
  FROM propiedad_ganadera
  WHERE id_propiedad=NEW.id_propiedad;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La propiedad seleccionada no está disponible.';
  END IF;

  IF (propiedad_activa=FALSE OR propiedad_eliminada IS NOT NULL)
     AND (NEW.activo=TRUE OR NEW.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'La propiedad seleccionada no está disponible.';
  END IF;

  IF NEW.id_ubicacion_actual IS NOT NULL THEN
    SELECT id_propiedad,activo,deleted_at
    INTO propiedad_ubicacion,ubicacion_activa,ubicacion_eliminada
    FROM ubicacion
    WHERE id_ubicacion=NEW.id_ubicacion_actual;

    IF propiedad_ubicacion IS NULL OR propiedad_ubicacion<>NEW.id_propiedad THEN
      RAISE EXCEPTION 'La ubicación del grupo debe pertenecer a la misma propiedad.';
    END IF;
    IF NEW.activo=TRUE AND NEW.deleted_at IS NULL
       AND (ubicacion_activa=FALSE OR ubicacion_eliminada IS NOT NULL) THEN
      RAISE EXCEPTION 'La ubicación seleccionada no está disponible.';
    END IF;
  END IF;

  NEW.id_categoria_animal=CASE
    WHEN principal THEN '00000000-0000-4000-8000-000000000101'::UUID
    ELSE '00000000-0000-4000-8000-000000000102'::UUID
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sincronizar_grupo_propiedad ON grupo;
-- Se recrea después de sanear los registros históricos.

-- Corrige las categorías redundantes usando la propiedad como fuente real.
UPDATE ubicacion u
SET id_categoria_animal=CASE
      WHEN p.es_principal THEN '00000000-0000-4000-8000-000000000101'::UUID
      ELSE '00000000-0000-4000-8000-000000000102'::UUID
    END,
    id_propiedad_padre=NULL,
    activo=CASE WHEN p.deleted_at IS NULL AND p.activa THEN u.activo ELSE FALSE END,
    deleted_at=CASE
      WHEN p.deleted_at IS NOT NULL OR p.activa=FALSE THEN COALESCE(u.deleted_at,p.deleted_at,NOW())
      ELSE u.deleted_at
    END
FROM propiedad_ganadera p
WHERE p.id_propiedad=u.id_propiedad;

UPDATE grupo g
SET id_categoria_animal=CASE
      WHEN p.es_principal THEN '00000000-0000-4000-8000-000000000101'::UUID
      ELSE '00000000-0000-4000-8000-000000000102'::UUID
    END,
    activo=CASE WHEN p.deleted_at IS NULL AND p.activa THEN g.activo ELSE FALSE END,
    deleted_at=CASE
      WHEN p.deleted_at IS NOT NULL OR p.activa=FALSE THEN COALESCE(g.deleted_at,p.deleted_at,NOW())
      ELSE g.deleted_at
    END
FROM propiedad_ganadera p
WHERE p.id_propiedad=g.id_propiedad;

-- A partir de aquí las filas existentes ya están saneadas. Se activan las
-- reglas estrictas para las operaciones futuras de la API.
CREATE TRIGGER trg_sincronizar_ubicacion_propiedad
BEFORE INSERT OR UPDATE OF id_propiedad,id_categoria_animal,id_propiedad_padre
ON ubicacion
FOR EACH ROW EXECUTE FUNCTION sincronizar_ubicacion_con_propiedad();

CREATE TRIGGER trg_sincronizar_grupo_propiedad
BEFORE INSERT OR UPDATE OF id_propiedad,id_ubicacion_actual,id_categoria_animal
ON grupo
FOR EACH ROW EXECUTE FUNCTION sincronizar_grupo_con_propiedad();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM grupo g
    JOIN ubicacion u ON u.id_ubicacion=g.id_ubicacion_actual
    WHERE g.deleted_at IS NULL AND g.activo=TRUE
      AND u.id_propiedad<>g.id_propiedad
  ) THEN
    RAISE EXCEPTION 'Existen grupos activos cuya ubicación pertenece a otra propiedad.';
  END IF;
END;
$$;

UPDATE animal a
SET id_categoria_animal=CASE
      WHEN p.es_principal THEN '00000000-0000-4000-8000-000000000101'::UUID
      ELSE '00000000-0000-4000-8000-000000000102'::UUID
    END
FROM ubicacion u
JOIN propiedad_ganadera p ON p.id_propiedad=u.id_propiedad
WHERE u.id_ubicacion=a.id_ubicacion_actual;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM animal a
    JOIN grupo g ON g.id_grupo=a.id_grupo_actual
    JOIN ubicacion u ON u.id_ubicacion=a.id_ubicacion_actual
    WHERE a.estado='ACTIVO' AND a.deleted_at IS NULL
      AND (
        g.id_propiedad<>u.id_propiedad
        OR a.id_ubicacion_actual IS DISTINCT FROM g.id_ubicacion_actual
      )
  ) THEN
    RAISE EXCEPTION 'Existen animales activos cuya ubicación no coincide con la ubicación fija de su grupo.';
  END IF;
END;
$$;

ALTER TABLE grupo DROP CONSTRAINT IF EXISTS ck_grupo_activo_ubicacion;
ALTER TABLE grupo
  ADD CONSTRAINT ck_grupo_activo_ubicacion
  CHECK (activo=FALSE OR deleted_at IS NOT NULL OR id_ubicacion_actual IS NOT NULL)
  NOT VALID;
ALTER TABLE grupo VALIDATE CONSTRAINT ck_grupo_activo_ubicacion;

CREATE OR REPLACE FUNCTION validar_posicion_actual_animal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  propiedad_grupo UUID;
  ubicacion_grupo UUID;
  propiedad_ubicacion UUID;
  principal BOOLEAN;
BEGIN
  IF NEW.id_grupo_actual IS NOT NULL THEN
    SELECT id_propiedad,id_ubicacion_actual
    INTO propiedad_grupo,ubicacion_grupo
    FROM grupo
    WHERE id_grupo=NEW.id_grupo_actual
      AND deleted_at IS NULL
      AND activo=TRUE;

    IF propiedad_grupo IS NULL THEN
      RAISE EXCEPTION 'El grupo seleccionado no está disponible.';
    END IF;
  END IF;

  IF NEW.id_ubicacion_actual IS NOT NULL THEN
    SELECT id_propiedad INTO propiedad_ubicacion
    FROM ubicacion
    WHERE id_ubicacion=NEW.id_ubicacion_actual
      AND deleted_at IS NULL
      AND activo=TRUE;

    IF propiedad_ubicacion IS NULL THEN
      RAISE EXCEPTION 'La ubicación seleccionada no está disponible.';
    END IF;
  END IF;

  IF propiedad_grupo IS NOT NULL AND propiedad_ubicacion IS NOT NULL
     AND propiedad_grupo<>propiedad_ubicacion THEN
    RAISE EXCEPTION 'El grupo y la ubicación del animal deben pertenecer a la misma propiedad.';
  END IF;

  IF ubicacion_grupo IS NOT NULL
     AND NEW.id_ubicacion_actual IS DISTINCT FROM ubicacion_grupo THEN
    RAISE EXCEPTION 'Todos los animales del grupo deben compartir su ubicación actual.';
  END IF;

  SELECT es_principal INTO principal
  FROM propiedad_ganadera
  WHERE id_propiedad=COALESCE(propiedad_grupo,propiedad_ubicacion)
    AND deleted_at IS NULL
    AND activa=TRUE;

  IF principal IS NOT NULL THEN
    NEW.id_categoria_animal=CASE
      WHEN principal THEN '00000000-0000-4000-8000-000000000101'::UUID
      ELSE '00000000-0000-4000-8000-000000000102'::UUID
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_posicion_actual_animal ON animal;
CREATE TRIGGER trg_validar_posicion_actual_animal
BEFORE INSERT OR UPDATE OF id_grupo_actual,id_ubicacion_actual,id_categoria_animal
ON animal
FOR EACH ROW EXECUTE FUNCTION validar_posicion_actual_animal();

-- Completa la propiedad de los movimientos usando las relaciones reales.
UPDATE movimiento_animal m
SET id_propiedad_origen=COALESCE(
      m.id_propiedad_origen,
      (SELECT u.id_propiedad FROM ubicacion u WHERE u.id_ubicacion=m.id_ubicacion_origen),
      (SELECT g.id_propiedad FROM grupo g WHERE g.id_grupo=m.id_grupo_origen),
      (SELECT g.id_propiedad FROM grupo g WHERE g.id_grupo=m.id_grupo_filtro)
    ),
    id_propiedad_destino=COALESCE(
      m.id_propiedad_destino,
      (SELECT u.id_propiedad FROM ubicacion u WHERE u.id_ubicacion=m.id_ubicacion_destino),
      (SELECT g.id_propiedad FROM grupo g WHERE g.id_grupo=m.id_grupo_destino)
    ),
    id_ubicacion_origen=COALESCE(
      m.id_ubicacion_origen,
      (SELECT g.id_ubicacion_actual FROM grupo g WHERE g.id_grupo=m.id_grupo_origen),
      (SELECT g.id_ubicacion_actual FROM grupo g WHERE g.id_grupo=m.id_grupo_filtro)
    )
WHERE m.deleted_at IS NULL;

-- Los borradores existentes son recorridos imposibles y se conservan como
-- cancelados para no alterar animales ni perder la auditoría.
UPDATE movimiento_animal
SET estado='CANCELADO',
    observaciones=CONCAT_WS(E'\n',NULLIF(observaciones,''),
      'Cancelado automáticamente al unificar el modelo de propiedades: el recorrido guardado era inválido.'),
    updated_at=NOW()
WHERE estado='BORRADOR'
  AND deleted_at IS NULL
  AND (
    (tipo_movimiento='UBICACION' AND (
      (id_propiedad_origen IS NOT NULL AND id_propiedad_destino IS NOT NULL
        AND id_propiedad_origen<>id_propiedad_destino)
      OR (id_ubicacion_origen IS NOT NULL AND id_ubicacion_destino IS NOT NULL
        AND id_ubicacion_origen=id_ubicacion_destino)
      OR (id_grupo_filtro IS NOT NULL AND id_grupo_destino IS NOT NULL
        AND id_grupo_filtro<>id_grupo_destino)
    ))
    OR
    (tipo_movimiento='GRUPO' AND (
      id_grupo_filtro IS NOT NULL AND id_grupo_destino IS NOT NULL
      AND id_grupo_filtro=id_grupo_destino
    ))
  );

-- Este registro fue creado por el flujo anterior como si fuera un potrero de
-- Jorge. No tiene animales ni grupo activo y ya existe la ubicación general
-- canónica de Jorge, por lo que se retira de los selectores sin borrar su
-- historial ni romper las llaves foráneas de borradores anteriores.
UPDATE ubicacion
SET activo=FALSE,
    deleted_at=COALESCE(deleted_at,NOW()),
    updated_at=NOW()
WHERE id_ubicacion='b8d11b2d-15ef-4782-a603-68e0523870d1'::UUID
  AND NOT EXISTS (
    SELECT 1 FROM animal
    WHERE id_ubicacion_actual='b8d11b2d-15ef-4782-a603-68e0523870d1'::UUID
      AND estado='ACTIVO' AND deleted_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM grupo
    WHERE id_ubicacion_actual='b8d11b2d-15ef-4782-a603-68e0523870d1'::UUID
      AND activo=TRUE AND deleted_at IS NULL
  );

-- Los borradores incompletos son válidos; los aplicados sí deben conservar un
-- destino. La restricción anterior impedía guardar un borrador por etapas.
ALTER TABLE movimiento_animal DROP CONSTRAINT IF EXISTS ck_movimiento_destino;
ALTER TABLE movimiento_animal
  ADD CONSTRAINT ck_movimiento_destino
  CHECK (
    estado IN ('BORRADOR','CANCELADO')
    OR id_ubicacion_destino IS NOT NULL
    OR id_grupo_destino IS NOT NULL
  ) NOT VALID;
ALTER TABLE movimiento_animal VALIDATE CONSTRAINT ck_movimiento_destino;

-- Nombre y código identifican un grupo o ubicación dentro de su propiedad, no
-- en todo el sistema. Esto permite, por ejemplo, un grupo Becerros o un Corral
-- con el mismo nombre en dos fincas distintas.
DROP INDEX IF EXISTS uq_grupo_codigo;
DROP INDEX IF EXISTS uq_grupo_nombre;
DROP INDEX IF EXISTS uq_ubicacion_codigo;
DROP INDEX IF EXISTS uq_ubicacion_nombre;

CREATE UNIQUE INDEX uq_grupo_codigo
ON grupo(id_propiedad,UPPER(codigo))
WHERE codigo IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX uq_grupo_nombre
ON grupo(id_propiedad,LOWER(nombre))
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_ubicacion_codigo
ON ubicacion(id_propiedad,UPPER(codigo))
WHERE codigo IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX uq_ubicacion_nombre
ON ubicacion(id_propiedad,LOWER(nombre))
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_propiedad_ganadera_codigo_activa
ON propiedad_ganadera(UPPER(codigo))
WHERE codigo IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ubicacion_propiedad_activa
ON ubicacion(id_propiedad,tipo,nombre)
WHERE deleted_at IS NULL AND activo=TRUE;

COMMENT ON COLUMN ubicacion.id_propiedad_padre IS
  'Obsoleto desde 20260822. La propiedad de la ubicación es ubicacion.id_propiedad -> propiedad_ganadera.id_propiedad.';

COMMIT;
