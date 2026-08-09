BEGIN;

ALTER TABLE ubicacion
  ADD COLUMN IF NOT EXISTS id_propiedad_padre UUID REFERENCES ubicacion(id_ubicacion);

CREATE INDEX IF NOT EXISTS idx_ubicacion_propiedad_padre_activa
  ON ubicacion(id_propiedad_padre)
  WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='ck_ubicacion_propiedad_distinta'
      AND conrelid='ubicacion'::regclass
  ) THEN
    ALTER TABLE ubicacion
      ADD CONSTRAINT ck_ubicacion_propiedad_distinta
      CHECK (id_propiedad_padre IS NULL OR id_propiedad_padre<>id_ubicacion);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION validar_jerarquia_ubicacion_propiedad()
RETURNS TRIGGER AS $$
DECLARE
  parent_type VARCHAR(30);
  parent_category UUID;
BEGIN
  IF NEW.tipo='OTRO' THEN
    IF NEW.id_propiedad_padre IS NOT NULL THEN
      RAISE EXCEPTION 'Una propiedad externa no puede depender de otra propiedad.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id_propiedad_padre IS NULL THEN
    SELECT id_categoria_animal INTO NEW.id_categoria_animal
    FROM categoria_animal
    WHERE codigo='EN_PROPIEDAD' AND deleted_at IS NULL AND activo=TRUE
    LIMIT 1;
    IF NEW.id_categoria_animal IS NULL THEN
      RAISE EXCEPTION 'No existe la categoría activa EN_PROPIEDAD.';
    END IF;
    RETURN NEW;
  END IF;

  SELECT tipo,id_categoria_animal
  INTO parent_type,parent_category
  FROM ubicacion
  WHERE id_ubicacion=NEW.id_propiedad_padre
    AND deleted_at IS NULL
    AND activo=TRUE;

  IF parent_type IS NULL OR parent_type<>'OTRO' THEN
    RAISE EXCEPTION 'La propiedad seleccionada no está disponible.';
  END IF;

  NEW.id_categoria_animal:=parent_category;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validar_jerarquia_ubicacion_propiedad ON ubicacion;
CREATE TRIGGER trg_validar_jerarquia_ubicacion_propiedad
BEFORE INSERT OR UPDATE OF tipo,id_propiedad_padre,id_categoria_animal
ON ubicacion
FOR EACH ROW EXECUTE FUNCTION validar_jerarquia_ubicacion_propiedad();

COMMENT ON COLUMN ubicacion.id_propiedad_padre IS
  'Propiedad externa a la que pertenece un potrero o corral. NULL identifica estructuras de la propiedad principal.';

COMMIT;
