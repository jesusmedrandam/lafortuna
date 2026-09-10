BEGIN;

CREATE TABLE IF NOT EXISTS operacion_propiedad_animal (
  id_operacion_propiedad UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_propiedad UUID NOT NULL REFERENCES propiedad_ganadera(id_propiedad),
  codigo_operacion VARCHAR(60) NOT NULL,
  permitido BOOLEAN NOT NULL DEFAULT TRUE,
  registrado_por UUID REFERENCES usuario(id_usuario),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_operacion_propiedad_animal UNIQUE(id_propiedad,codigo_operacion),
  CONSTRAINT ck_operacion_propiedad_animal_codigo CHECK (codigo_operacion IN (
    'MOVIMIENTO_UBICACION','MOVIMIENTO_GRUPO','MOVIMIENTO_PROPIEDAD',
    'CELO','INSEMINACION_ARTIFICIAL','TRANSFERENCIA_EMBRIONES','PRENEZ','PARTO','ABORTO',
    'TRATAMIENTO','VENTA','PESAJE','MUERTE','LACTANCIA','PRODUCCION_LECHE'
  ))
);

CREATE INDEX IF NOT EXISTS idx_operacion_propiedad_animal_activa
  ON operacion_propiedad_animal(id_propiedad,codigo_operacion)
  WHERE deleted_at IS NULL;

INSERT INTO operacion_propiedad_animal(id_propiedad,codigo_operacion,permitido)
SELECT p.id_propiedad,operation.codigo,
  COALESCE(legacy.permitido,TRUE)
FROM propiedad_ganadera p
CROSS JOIN (VALUES
  ('MOVIMIENTO_UBICACION'),('MOVIMIENTO_GRUPO'),('MOVIMIENTO_PROPIEDAD'),
  ('CELO'),('INSEMINACION_ARTIFICIAL'),('TRANSFERENCIA_EMBRIONES'),('PRENEZ'),('PARTO'),('ABORTO'),
  ('TRATAMIENTO'),('VENTA'),('PESAJE'),('MUERTE'),('LACTANCIA'),('PRODUCCION_LECHE')
) operation(codigo)
LEFT JOIN categoria_animal category
  ON category.codigo=CASE WHEN p.es_principal THEN 'EN_PROPIEDAD' ELSE 'FUERA_PROPIEDAD' END
  AND category.deleted_at IS NULL
LEFT JOIN operacion_categoria_animal legacy
  ON legacy.id_categoria_animal=category.id_categoria_animal
  AND legacy.codigo_operacion=operation.codigo
  AND legacy.deleted_at IS NULL
WHERE p.deleted_at IS NULL
ON CONFLICT(id_propiedad,codigo_operacion) DO NOTHING;

COMMENT ON TABLE operacion_propiedad_animal IS
  'Operaciones habilitadas para los animales según su propiedad actual.';

COMMIT;
