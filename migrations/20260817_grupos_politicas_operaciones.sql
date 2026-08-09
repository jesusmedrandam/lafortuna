BEGIN;

-- Cada grupo representa una sola situación de propiedad.
ALTER TABLE grupo
  ADD COLUMN IF NOT EXISTS id_categoria_animal UUID
  REFERENCES categoria_animal(id_categoria_animal);

UPDATE grupo g
SET id_categoria_animal=COALESCE(
  (
    SELECT a.id_categoria_animal
    FROM animal a
    WHERE a.id_grupo_actual=g.id_grupo AND a.deleted_at IS NULL
    GROUP BY a.id_categoria_animal
    ORDER BY COUNT(*) DESC
    LIMIT 1
  ),
  '00000000-0000-4000-8000-000000000101'
)
WHERE g.id_categoria_animal IS NULL;

ALTER TABLE grupo
  ALTER COLUMN id_categoria_animal SET DEFAULT '00000000-0000-4000-8000-000000000101',
  ALTER COLUMN id_categoria_animal SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grupo_categoria_activo
  ON grupo(id_categoria_animal)
  WHERE deleted_at IS NULL;

-- Política configurable por categoría. La ausencia de una fila se interpreta como permitido.
CREATE TABLE IF NOT EXISTS operacion_categoria_animal (
  id_operacion_categoria UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_categoria_animal UUID NOT NULL REFERENCES categoria_animal(id_categoria_animal),
  codigo_operacion VARCHAR(60) NOT NULL,
  permitido BOOLEAN NOT NULL DEFAULT TRUE,
  registrado_por UUID REFERENCES usuario(id_usuario),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_operacion_categoria_animal UNIQUE(id_categoria_animal,codigo_operacion),
  CONSTRAINT ck_operacion_categoria_animal_codigo CHECK (codigo_operacion IN (
    'MOVIMIENTO_UBICACION','MOVIMIENTO_GRUPO','MOVIMIENTO_PROPIEDAD',
    'CELO','PRENEZ','PARTO','ABORTO','TRATAMIENTO','VENTA','PESAJE','MUERTE',
    'LACTANCIA','PRODUCCION_LECHE'
  ))
);

INSERT INTO operacion_categoria_animal(id_categoria_animal,codigo_operacion,permitido)
SELECT ca.id_categoria_animal,op.codigo,TRUE
FROM categoria_animal ca
CROSS JOIN (VALUES
  ('MOVIMIENTO_UBICACION'),('MOVIMIENTO_GRUPO'),('MOVIMIENTO_PROPIEDAD'),
  ('CELO'),('PRENEZ'),('PARTO'),('ABORTO'),('TRATAMIENTO'),('VENTA'),('PESAJE'),('MUERTE'),
  ('LACTANCIA'),('PRODUCCION_LECHE')
) AS op(codigo)
WHERE ca.deleted_at IS NULL
ON CONFLICT(id_categoria_animal,codigo_operacion) DO NOTHING;

-- Valores seguros iniciales para animales que se encuentran fuera de la propiedad.
UPDATE operacion_categoria_animal policy
SET permitido=FALSE,updated_at=NOW()
FROM categoria_animal category
WHERE category.id_categoria_animal=policy.id_categoria_animal
  AND category.codigo='FUERA_PROPIEDAD'
  AND policy.codigo_operacion IN ('MOVIMIENTO_UBICACION','LACTANCIA','PRODUCCION_LECHE');

-- Conserva explícitamente qué recorrido se solicitó, incluso si aún no se aplica.
ALTER TABLE movimiento_animal
  ADD COLUMN IF NOT EXISTS tipo_movimiento VARCHAR(30);

UPDATE movimiento_animal movement
SET tipo_movimiento=CASE
  WHEN movement.id_ubicacion_destino IS NOT NULL AND movement.id_grupo_destino IS NOT NULL THEN 'COMBINADO'
  WHEN movement.id_grupo_destino IS NOT NULL THEN 'GRUPO'
  WHEN EXISTS(
    SELECT 1 FROM ubicacion location
    WHERE location.id_ubicacion=movement.id_ubicacion_destino AND location.tipo='OTRO'
  ) THEN 'PROPIEDAD'
  ELSE 'UBICACION'
END
WHERE movement.tipo_movimiento IS NULL;

ALTER TABLE movimiento_animal
  ALTER COLUMN tipo_movimiento SET DEFAULT 'UBICACION',
  ALTER COLUMN tipo_movimiento SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='ck_movimiento_animal_tipo'
      AND conrelid='movimiento_animal'::regclass
  ) THEN
    ALTER TABLE movimiento_animal
      ADD CONSTRAINT ck_movimiento_animal_tipo
      CHECK (tipo_movimiento IN ('UBICACION','GRUPO','PROPIEDAD','COMBINADO'));
  END IF;
END;
$$;

COMMENT ON COLUMN grupo.id_categoria_animal IS
  'Situación de propiedad común a todos los animales que pertenecen al grupo.';
COMMENT ON TABLE operacion_categoria_animal IS
  'Matriz configurable de operaciones disponibles para cada categoría de animales.';

COMMIT;
