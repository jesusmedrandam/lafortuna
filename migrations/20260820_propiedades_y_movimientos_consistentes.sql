BEGIN;

CREATE TABLE IF NOT EXISTS propiedad_ganadera (
  id_propiedad UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo VARCHAR(50),
  nombre VARCHAR(120) NOT NULL,
  descripcion VARCHAR(300),
  latitud NUMERIC(10,7),
  longitud NUMERIC(10,7),
  es_principal BOOLEAN NOT NULL DEFAULT FALSE,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- La propiedad determinística recibe todos los potreros y corrales internos
-- existentes. El administrador puede cambiar después su nombre y marcar otra
-- propiedad como principal.
INSERT INTO propiedad_ganadera(
  id_propiedad,codigo,nombre,descripcion,es_principal,activa
)
VALUES (
  '00000000-0000-4000-8000-000000000401',
  'PRINCIPAL',
  'Propiedad principal',
  'Propiedad creada automáticamente para conservar los potreros, corrales y grupos existentes.',
  FALSE,
  TRUE
)
ON CONFLICT(id_propiedad) DO NOTHING;

-- Las antiguas ubicaciones de tipo OTRO se convierten en propiedades reales.
-- Se conserva el mismo UUID para mantener una relación inequívoca con el dato
-- histórico que representaba a esa propiedad.
INSERT INTO propiedad_ganadera(
  id_propiedad,codigo,nombre,descripcion,latitud,longitud,es_principal,activa,deleted_at
)
SELECT
  u.id_ubicacion,
  u.codigo,
  u.nombre,
  u.descripcion,
  u.latitud,
  u.longitud,
  FALSE,
  u.activo AND u.deleted_at IS NULL,
  u.deleted_at
FROM ubicacion u
WHERE u.tipo='OTRO'
ON CONFLICT(id_propiedad) DO UPDATE SET
  nombre=EXCLUDED.nombre,
  descripcion=COALESCE(propiedad_ganadera.descripcion,EXCLUDED.descripcion),
  latitud=COALESCE(propiedad_ganadera.latitud,EXCLUDED.latitud),
  longitud=COALESCE(propiedad_ganadera.longitud,EXCLUDED.longitud),
  activa=EXCLUDED.activa,
  deleted_at=EXCLUDED.deleted_at,
  updated_at=NOW();

UPDATE propiedad_ganadera
SET es_principal=TRUE,updated_at=NOW()
WHERE id_propiedad='00000000-0000-4000-8000-000000000401'
  AND NOT EXISTS (
    SELECT 1 FROM propiedad_ganadera
    WHERE es_principal=TRUE AND deleted_at IS NULL
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_propiedad_ganadera_principal
  ON propiedad_ganadera(es_principal)
  WHERE es_principal=TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_propiedad_ganadera_activa
  ON propiedad_ganadera(activa,nombre)
  WHERE deleted_at IS NULL;

ALTER TABLE ubicacion
  ADD COLUMN IF NOT EXISTS id_propiedad UUID
  REFERENCES propiedad_ganadera(id_propiedad);

UPDATE ubicacion
SET id_propiedad=CASE
  WHEN tipo='OTRO' THEN id_ubicacion
  ELSE '00000000-0000-4000-8000-000000000401'::UUID
END
WHERE id_propiedad IS NULL;

ALTER TABLE ubicacion
  ALTER COLUMN id_propiedad SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ubicacion_propiedad_activa
  ON ubicacion(id_propiedad,tipo)
  WHERE deleted_at IS NULL;

ALTER TABLE grupo
  ADD COLUMN IF NOT EXISTS id_propiedad UUID
  REFERENCES propiedad_ganadera(id_propiedad);

UPDATE grupo g
SET id_propiedad=COALESCE(
  (SELECT u.id_propiedad FROM ubicacion u WHERE u.id_ubicacion=g.id_ubicacion_actual),
  (
    SELECT u.id_propiedad
    FROM animal a
    JOIN ubicacion u ON u.id_ubicacion=a.id_ubicacion_actual
    WHERE a.id_grupo_actual=g.id_grupo AND a.deleted_at IS NULL
    GROUP BY u.id_propiedad
    ORDER BY COUNT(*) DESC
    LIMIT 1
  ),
  '00000000-0000-4000-8000-000000000401'::UUID
)
WHERE g.id_propiedad IS NULL;

ALTER TABLE grupo
  ALTER COLUMN id_propiedad SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grupo_propiedad_activo
  ON grupo(id_propiedad)
  WHERE deleted_at IS NULL;

ALTER TABLE movimiento_animal
  ADD COLUMN IF NOT EXISTS id_propiedad_origen UUID
    REFERENCES propiedad_ganadera(id_propiedad),
  ADD COLUMN IF NOT EXISTS id_propiedad_destino UUID
    REFERENCES propiedad_ganadera(id_propiedad);

UPDATE movimiento_animal m
SET id_propiedad_origen=COALESCE(
  (SELECT u.id_propiedad FROM ubicacion u WHERE u.id_ubicacion=m.id_ubicacion_origen),
  (SELECT g.id_propiedad FROM grupo g WHERE g.id_grupo=m.id_grupo_origen),
  (SELECT g.id_propiedad FROM grupo g WHERE g.id_grupo=m.id_grupo_filtro),
  '00000000-0000-4000-8000-000000000401'::UUID
)
WHERE m.id_propiedad_origen IS NULL;

UPDATE movimiento_animal m
SET id_propiedad_destino=COALESCE(
  (SELECT u.id_propiedad FROM ubicacion u WHERE u.id_ubicacion=m.id_ubicacion_destino),
  (SELECT g.id_propiedad FROM grupo g WHERE g.id_grupo=m.id_grupo_destino),
  m.id_propiedad_origen,
  '00000000-0000-4000-8000-000000000401'::UUID
)
WHERE m.id_propiedad_destino IS NULL;

ALTER TABLE movimiento_animal
  ALTER COLUMN id_propiedad_origen SET NOT NULL,
  ALTER COLUMN id_propiedad_destino SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_movimiento_propiedades
  ON movimiento_animal(id_propiedad_origen,id_propiedad_destino)
  WHERE deleted_at IS NULL;

-- La categoría técnica anterior se conserva por compatibilidad con reportes y
-- políticas. Ahora se deriva automáticamente de la propiedad principal.
UPDATE ubicacion u
SET id_categoria_animal=CASE
  WHEN p.es_principal THEN '00000000-0000-4000-8000-000000000101'::UUID
  ELSE '00000000-0000-4000-8000-000000000102'::UUID
END
FROM propiedad_ganadera p
WHERE p.id_propiedad=u.id_propiedad;

UPDATE grupo g
SET id_categoria_animal=CASE
  WHEN p.es_principal THEN '00000000-0000-4000-8000-000000000101'::UUID
  ELSE '00000000-0000-4000-8000-000000000102'::UUID
END
FROM propiedad_ganadera p
WHERE p.id_propiedad=g.id_propiedad;

UPDATE animal a
SET id_categoria_animal=CASE
  WHEN propiedad.es_principal THEN '00000000-0000-4000-8000-000000000101'::UUID
  ELSE '00000000-0000-4000-8000-000000000102'::UUID
END
FROM propiedad_ganadera propiedad
WHERE propiedad.id_propiedad=COALESCE(
  (SELECT g.id_propiedad FROM grupo g WHERE g.id_grupo=a.id_grupo_actual),
  (SELECT u.id_propiedad FROM ubicacion u WHERE u.id_ubicacion=a.id_ubicacion_actual)
);

CREATE OR REPLACE FUNCTION sincronizar_ubicacion_con_propiedad()
RETURNS TRIGGER AS $$
DECLARE
  principal BOOLEAN;
BEGIN
  SELECT es_principal INTO principal
  FROM propiedad_ganadera
  WHERE id_propiedad=NEW.id_propiedad AND deleted_at IS NULL AND activa=TRUE;
  IF principal IS NULL THEN
    RAISE EXCEPTION 'La propiedad seleccionada no está disponible.';
  END IF;
  NEW.id_categoria_animal=CASE
    WHEN principal THEN '00000000-0000-4000-8000-000000000101'::UUID
    ELSE '00000000-0000-4000-8000-000000000102'::UUID
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sincronizar_ubicacion_propiedad ON ubicacion;
CREATE TRIGGER trg_sincronizar_ubicacion_propiedad
BEFORE INSERT OR UPDATE OF id_propiedad ON ubicacion
FOR EACH ROW EXECUTE FUNCTION sincronizar_ubicacion_con_propiedad();

CREATE OR REPLACE FUNCTION sincronizar_grupo_con_propiedad()
RETURNS TRIGGER AS $$
DECLARE
  principal BOOLEAN;
  propiedad_ubicacion UUID;
BEGIN
  SELECT es_principal INTO principal
  FROM propiedad_ganadera
  WHERE id_propiedad=NEW.id_propiedad AND deleted_at IS NULL AND activa=TRUE;
  IF principal IS NULL THEN
    RAISE EXCEPTION 'La propiedad seleccionada no está disponible.';
  END IF;
  IF NEW.id_ubicacion_actual IS NOT NULL THEN
    SELECT id_propiedad INTO propiedad_ubicacion
    FROM ubicacion
    WHERE id_ubicacion=NEW.id_ubicacion_actual AND deleted_at IS NULL AND activo=TRUE;
    IF propiedad_ubicacion IS NULL OR propiedad_ubicacion<>NEW.id_propiedad THEN
      RAISE EXCEPTION 'La ubicación del grupo debe pertenecer a la misma propiedad.';
    END IF;
  END IF;
  NEW.id_categoria_animal=CASE
    WHEN principal THEN '00000000-0000-4000-8000-000000000101'::UUID
    ELSE '00000000-0000-4000-8000-000000000102'::UUID
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sincronizar_grupo_propiedad ON grupo;
CREATE TRIGGER trg_sincronizar_grupo_propiedad
BEFORE INSERT OR UPDATE OF id_propiedad,id_ubicacion_actual ON grupo
FOR EACH ROW EXECUTE FUNCTION sincronizar_grupo_con_propiedad();

CREATE OR REPLACE FUNCTION sincronizar_categorias_propiedad_principal()
RETURNS TRIGGER AS $$
DECLARE
  categoria UUID;
BEGIN
  categoria=CASE
    WHEN NEW.es_principal THEN '00000000-0000-4000-8000-000000000101'::UUID
    ELSE '00000000-0000-4000-8000-000000000102'::UUID
  END;
  UPDATE ubicacion SET id_categoria_animal=categoria,updated_at=NOW()
  WHERE id_propiedad=NEW.id_propiedad AND deleted_at IS NULL;
  UPDATE grupo SET id_categoria_animal=categoria,updated_at=NOW()
  WHERE id_propiedad=NEW.id_propiedad AND deleted_at IS NULL;
  UPDATE animal a SET id_categoria_animal=categoria,updated_at=NOW()
  WHERE a.deleted_at IS NULL AND (
    EXISTS(SELECT 1 FROM grupo g WHERE g.id_grupo=a.id_grupo_actual AND g.id_propiedad=NEW.id_propiedad)
    OR EXISTS(SELECT 1 FROM ubicacion u WHERE u.id_ubicacion=a.id_ubicacion_actual AND u.id_propiedad=NEW.id_propiedad)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sincronizar_propiedad_principal ON propiedad_ganadera;
CREATE TRIGGER trg_sincronizar_propiedad_principal
AFTER INSERT OR UPDATE OF es_principal ON propiedad_ganadera
FOR EACH ROW EXECUTE FUNCTION sincronizar_categorias_propiedad_principal();

-- Los cambios de potrero son válidos dentro de cualquier propiedad. Lactancia
-- y ordeño permanecen bloqueados para todas las propiedades no principales.
UPDATE operacion_categoria_animal policy
SET permitido=TRUE,updated_at=NOW()
FROM categoria_animal category
WHERE category.id_categoria_animal=policy.id_categoria_animal
  AND category.codigo='FUERA_PROPIEDAD'
  AND policy.codigo_operacion IN ('MOVIMIENTO_UBICACION','MOVIMIENTO_GRUPO','MOVIMIENTO_PROPIEDAD');

UPDATE operacion_categoria_animal policy
SET permitido=FALSE,updated_at=NOW()
FROM categoria_animal category
WHERE category.id_categoria_animal=policy.id_categoria_animal
  AND category.codigo='FUERA_PROPIEDAD'
  AND policy.codigo_operacion IN ('LACTANCIA','PRODUCCION_LECHE');

COMMENT ON TABLE propiedad_ganadera IS
  'Fincas o propiedades que contienen grupos, potreros y corrales. Solo una puede ser principal.';
COMMENT ON COLUMN propiedad_ganadera.es_principal IS
  'Habilita las operaciones de lactancia y ordeño para los animales ubicados en esta propiedad.';
COMMENT ON COLUMN ubicacion.id_propiedad IS
  'Propiedad a la que pertenece el potrero, corral o ubicación histórica.';
COMMENT ON COLUMN grupo.id_propiedad IS
  'Propiedad del grupo; debe coincidir con la propiedad de su ubicación actual.';

COMMIT;
