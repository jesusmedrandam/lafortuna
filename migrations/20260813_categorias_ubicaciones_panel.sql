BEGIN;

CREATE TABLE IF NOT EXISTS categoria_animal (
  id_categoria_animal UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo VARCHAR(40) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  descripcion VARCHAR(300),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_categoria_animal_codigo_activa
  ON categoria_animal(UPPER(codigo))
  WHERE deleted_at IS NULL;

INSERT INTO categoria_animal(id_categoria_animal,codigo,nombre,descripcion)
VALUES
  ('00000000-0000-4000-8000-000000000101','EN_PROPIEDAD','Animales en propiedad','Animales ubicados dentro de la propiedad.'),
  ('00000000-0000-4000-8000-000000000102','FUERA_PROPIEDAD','Animales fuera de propiedad','Animales ubicados en fincas, terrenos u otras propiedades externas.')
ON CONFLICT(id_categoria_animal) DO UPDATE SET
  nombre=EXCLUDED.nombre,
  descripcion=EXCLUDED.descripcion,
  activo=TRUE,
  deleted_at=NULL,
  updated_at=NOW();

ALTER TABLE ubicacion
  ADD COLUMN IF NOT EXISTS id_categoria_animal UUID
  REFERENCES categoria_animal(id_categoria_animal);

UPDATE ubicacion
SET id_categoria_animal='00000000-0000-4000-8000-000000000101'
WHERE id_categoria_animal IS NULL;

ALTER TABLE ubicacion
  ALTER COLUMN id_categoria_animal SET DEFAULT '00000000-0000-4000-8000-000000000101',
  ALTER COLUMN id_categoria_animal SET NOT NULL;

ALTER TABLE animal
  ADD COLUMN IF NOT EXISTS id_categoria_animal UUID
  REFERENCES categoria_animal(id_categoria_animal);

UPDATE animal a
SET id_categoria_animal=COALESCE(
  (SELECT u.id_categoria_animal FROM ubicacion u WHERE u.id_ubicacion=a.id_ubicacion_actual),
  '00000000-0000-4000-8000-000000000101'
)
WHERE a.id_categoria_animal IS NULL;

ALTER TABLE animal
  ALTER COLUMN id_categoria_animal SET DEFAULT '00000000-0000-4000-8000-000000000101',
  ALTER COLUMN id_categoria_animal SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_animal_categoria_activa
  ON animal(id_categoria_animal)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION sincronizar_categoria_animal_ubicacion()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id_ubicacion_actual IS NOT NULL THEN
    SELECT id_categoria_animal INTO NEW.id_categoria_animal
    FROM ubicacion
    WHERE id_ubicacion=NEW.id_ubicacion_actual AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sincronizar_categoria_ubicacion ON animal;
CREATE TRIGGER trg_sincronizar_categoria_ubicacion
BEFORE INSERT OR UPDATE OF id_ubicacion_actual ON animal
FOR EACH ROW EXECUTE FUNCTION sincronizar_categoria_animal_ubicacion();

ALTER TABLE usuario_preferencia_panel
  ADD COLUMN IF NOT EXISTS configuracion JSONB;

COMMIT;
