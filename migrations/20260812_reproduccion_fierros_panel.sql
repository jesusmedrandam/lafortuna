BEGIN;

-- Un fierro puede pertenecer a uno o varios usuarios. La columna id_usuario de
-- marquilla se conserva temporalmente por compatibilidad con instalaciones
-- anteriores, pero las nuevas relaciones se guardan en marquilla_usuario.
CREATE TABLE IF NOT EXISTS marquilla_usuario (
  id_marquilla_usuario UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_marquilla UUID NOT NULL REFERENCES marquilla(id_marquilla),
  id_usuario UUID NOT NULL REFERENCES usuario(id_usuario),
  es_principal BOOLEAN NOT NULL DEFAULT FALSE,
  registrado_por UUID REFERENCES usuario(id_usuario),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_marquilla_usuario_activa
  ON marquilla_usuario(id_marquilla,id_usuario)
  WHERE deleted_at IS NULL;

INSERT INTO marquilla_usuario(id_marquilla,id_usuario,es_principal,registrado_por)
SELECT id_marquilla,id_usuario,TRUE,registrado_por
FROM marquilla
WHERE id_usuario IS NOT NULL AND deleted_at IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE marquilla ALTER COLUMN id_usuario DROP NOT NULL;
DROP INDEX IF EXISTS uq_marquilla_usuario_codigo_activa;
CREATE INDEX IF NOT EXISTS idx_marquilla_usuario_usuario
  ON marquilla_usuario(id_usuario,id_marquilla) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS celo (
  id_celo UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_vaca UUID NOT NULL REFERENCES animal(id_animal),
  id_toro UUID REFERENCES animal(id_animal),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE,
  observaciones VARCHAR(500),
  registrado_por UUID REFERENCES usuario(id_usuario),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT ck_celo_fechas CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio)
);
CREATE INDEX IF NOT EXISTS idx_celo_vaca_fecha
  ON celo(id_vaca,fecha_inicio DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS prenez (
  id_prenez UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_vaca UUID NOT NULL REFERENCES animal(id_animal),
  id_celo UUID REFERENCES celo(id_celo),
  id_padre UUID REFERENCES animal(id_animal),
  metodo_embarazo VARCHAR(40) NOT NULL DEFAULT 'MONTA_NATURAL',
  metodo_confirmacion VARCHAR(40) NOT NULL,
  fecha_confirmacion DATE NOT NULL,
  dias_gestacion_confirmacion INTEGER,
  fecha_inicio_estimada DATE,
  fecha_parto_tentativa DATE,
  estado VARCHAR(20) NOT NULL DEFAULT 'CONFIRMADA',
  observaciones VARCHAR(500),
  registrado_por UUID REFERENCES usuario(id_usuario),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT ck_prenez_dias CHECK (dias_gestacion_confirmacion IS NULL OR dias_gestacion_confirmacion BETWEEN 0 AND 400),
  CONSTRAINT ck_prenez_estado CHECK (estado IN ('CONFIRMADA','FINALIZADA','CANCELADA'))
);
CREATE INDEX IF NOT EXISTS idx_prenez_vaca_estado
  ON prenez(id_vaca,estado,fecha_confirmacion DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_prenez_activa_vaca
  ON prenez(id_vaca) WHERE deleted_at IS NULL AND estado='CONFIRMADA';

CREATE TABLE IF NOT EXISTS proximo_parto (
  id_proximo_parto UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_prenez UUID NOT NULL UNIQUE REFERENCES prenez(id_prenez),
  id_vaca UUID NOT NULL REFERENCES animal(id_animal),
  fecha_tentativa DATE,
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  registrado_por UUID REFERENCES usuario(id_usuario),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT ck_proximo_parto_estado CHECK (estado IN ('PENDIENTE','REGISTRADO','CANCELADO'))
);
CREATE INDEX IF NOT EXISTS idx_proximo_parto_fecha
  ON proximo_parto(estado,fecha_tentativa) WHERE deleted_at IS NULL;

ALTER TABLE parto ADD COLUMN IF NOT EXISTS id_prenez UUID REFERENCES prenez(id_prenez);
CREATE UNIQUE INDEX IF NOT EXISTS uq_parto_prenez
  ON parto(id_prenez) WHERE id_prenez IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS usuario_preferencia_panel (
  id_usuario UUID PRIMARY KEY REFERENCES usuario(id_usuario),
  tarjetas JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
