BEGIN;

CREATE TABLE IF NOT EXISTS marquilla (
  id_marquilla UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario UUID NOT NULL REFERENCES usuario(id_usuario),
  codigo VARCHAR(80) NOT NULL,
  nombre VARCHAR(140) NOT NULL,
  descripcion VARCHAR(300),
  public_id VARCHAR(300),
  url TEXT,
  secure_url TEXT,
  formato VARCHAR(30),
  ancho INTEGER,
  alto INTEGER,
  bytes INTEGER,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  registrado_por UUID REFERENCES usuario(id_usuario),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_marquilla_usuario_codigo_activa
  ON marquilla(id_usuario,LOWER(codigo)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_marquilla_usuario
  ON marquilla(id_usuario,nombre) WHERE deleted_at IS NULL;

ALTER TABLE animal
  ADD COLUMN IF NOT EXISTS id_marquilla UUID REFERENCES marquilla(id_marquilla);

CREATE INDEX IF NOT EXISTS idx_animal_marquilla
  ON animal(id_marquilla) WHERE deleted_at IS NULL;

COMMIT;
