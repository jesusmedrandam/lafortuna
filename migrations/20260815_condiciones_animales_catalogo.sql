BEGIN;

CREATE TABLE IF NOT EXISTS condicion_animal (
  id_condicion_animal UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo VARCHAR(40) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  descripcion VARCHAR(300),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  es_sistema BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT ck_condicion_animal_codigo_formato
    CHECK (codigo=UPPER(BTRIM(codigo)) AND codigo ~ '^[A-Z0-9_]+$'),
  CONSTRAINT uq_condicion_animal_codigo UNIQUE(codigo)
);

INSERT INTO condicion_animal(id_condicion_animal,codigo,nombre,descripcion,activo,es_sistema)
VALUES
  ('00000000-0000-4000-8000-000000000201','ACTIVO','Activo','Animal activo dentro del registro operativo.',TRUE,TRUE),
  ('00000000-0000-4000-8000-000000000202','INACTIVO','Inactivo','Registro no operativo; no indica que el animal esté fuera de la propiedad.',TRUE,TRUE),
  ('00000000-0000-4000-8000-000000000203','VENDIDO','Vendido','Animal registrado como vendido.',TRUE,TRUE),
  ('00000000-0000-4000-8000-000000000204','TRASLADADO','Trasladado','Animal trasladado fuera de su ubicación operativa.',TRUE,TRUE),
  ('00000000-0000-4000-8000-000000000205','DESAPARECIDO','Desaparecido','Animal reportado como desaparecido.',TRUE,TRUE),
  ('00000000-0000-4000-8000-000000000206','MUERTO','Muerto','Animal con fallecimiento registrado.',TRUE,TRUE)
ON CONFLICT(codigo) DO UPDATE SET
  nombre=EXCLUDED.nombre,
  descripcion=EXCLUDED.descripcion,
  activo=TRUE,
  es_sistema=TRUE,
  deleted_at=NULL,
  updated_at=NOW();

DO $$
DECLARE
  v_udt_name TEXT;
BEGIN
  SELECT udt_name INTO v_udt_name
  FROM information_schema.columns
  WHERE table_schema=CURRENT_SCHEMA()
    AND table_name='animal'
    AND column_name='estado';

  IF v_udt_name IS NULL THEN
    RAISE EXCEPTION 'No existe la columna animal.estado.';
  END IF;

  IF v_udt_name<>'varchar' THEN
    ALTER TABLE animal ALTER COLUMN estado DROP DEFAULT;
    ALTER TABLE animal ALTER COLUMN estado TYPE VARCHAR(40) USING UPPER(BTRIM(estado::TEXT));
  END IF;
END;
$$;

INSERT INTO condicion_animal(codigo,nombre,descripcion,activo,es_sistema)
SELECT DISTINCT
  a.estado,
  INITCAP(REPLACE(LOWER(a.estado),'_',' ')),
  'Condición conservada desde los registros existentes.',
  TRUE,
  FALSE
FROM animal a
WHERE a.estado IS NOT NULL
ON CONFLICT(codigo) DO NOTHING;

ALTER TABLE animal ALTER COLUMN estado SET DEFAULT 'ACTIVO';
ALTER TABLE animal ALTER COLUMN estado SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='fk_animal_condicion_codigo'
      AND conrelid='animal'::regclass
  ) THEN
    ALTER TABLE animal
      ADD CONSTRAINT fk_animal_condicion_codigo
      FOREIGN KEY(estado) REFERENCES condicion_animal(codigo)
      ON UPDATE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_animal_condicion_activa
  ON animal(estado)
  WHERE deleted_at IS NULL;

COMMIT;
