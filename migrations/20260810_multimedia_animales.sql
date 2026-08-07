BEGIN;

ALTER TABLE animal_imagen
  ADD COLUMN IF NOT EXISTS tipo_archivo VARCHAR(10) NOT NULL DEFAULT 'IMAGEN',
  ADD COLUMN IF NOT EXISTS mime_type VARCHAR(120),
  ADD COLUMN IF NOT EXISTS nombre_original VARCHAR(255);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='ck_animal_imagen_tipo_archivo'
  ) THEN
    ALTER TABLE animal_imagen
      ADD CONSTRAINT ck_animal_imagen_tipo_archivo
      CHECK (tipo_archivo IN ('IMAGEN','VIDEO'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS animal_imagen_relacion (
  id_relacion UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_imagen UUID NOT NULL REFERENCES animal_imagen(id_imagen) ON DELETE CASCADE,
  id_animal UUID NOT NULL REFERENCES animal(id_animal) ON DELETE CASCADE,
  registrado_por UUID REFERENCES usuario(id_usuario),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_animal_imagen_relacion_activa
  ON animal_imagen_relacion(id_imagen,id_animal)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_animal_imagen_relacion_animal
  ON animal_imagen_relacion(id_animal,id_imagen)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_animal_imagen_tipo_fecha
  ON animal_imagen(tipo_archivo,created_at DESC)
  WHERE deleted_at IS NULL;

INSERT INTO animal_imagen_relacion(id_imagen,id_animal,registrado_por)
SELECT i.id_imagen,i.id_animal,i.registrado_por
FROM animal_imagen i
WHERE i.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM animal_imagen_relacion r
    WHERE r.id_imagen=i.id_imagen AND r.id_animal=i.id_animal AND r.deleted_at IS NULL
  );

COMMIT;
