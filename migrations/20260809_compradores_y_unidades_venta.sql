BEGIN;

CREATE TABLE IF NOT EXISTS comprador (
  id_comprador UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo VARCHAR(50) NOT NULL UNIQUE,
  nombre VARCHAR(200) NOT NULL,
  contacto VARCHAR(160),
  destino VARCHAR(220),
  descripcion VARCHAR(300),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

INSERT INTO unidad_medida(codigo,nombre,simbolo,activo)
SELECT 'LITRO','Litro','L',TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM unidad_medida
  WHERE UPPER(COALESCE(codigo,'')) IN ('L','LT','LITRO')
     OR LOWER(COALESCE(nombre,''))='litro'
     OR simbolo='L'
);

INSERT INTO unidad_medida(codigo,nombre,simbolo,activo)
SELECT 'LIBRA','Libra','lb',TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM unidad_medida
  WHERE UPPER(COALESCE(codigo,'')) IN ('LB','LIBRA')
     OR LOWER(COALESCE(nombre,''))='libra'
     OR LOWER(COALESCE(simbolo,''))='lb'
);

ALTER TABLE producto_venta
  ADD COLUMN IF NOT EXISTS id_unidad_venta UUID REFERENCES unidad_medida(id_unidad);

ALTER TABLE producto_venta
  ALTER COLUMN unidad DROP NOT NULL;

UPDATE producto_venta
SET id_unidad_venta=(
  SELECT id_unidad FROM unidad_medida
  WHERE deleted_at IS NULL
    AND (UPPER(COALESCE(codigo,'')) IN ('L','LT','LITRO') OR LOWER(COALESCE(nombre,''))='litro' OR simbolo='L')
  ORDER BY activo DESC,nombre
  LIMIT 1
)
WHERE codigo='LECHE' AND id_unidad_venta IS NULL;

UPDATE producto_venta
SET id_unidad_venta=(
  SELECT id_unidad FROM unidad_medida
  WHERE deleted_at IS NULL
    AND (UPPER(COALESCE(codigo,'')) IN ('LB','LIBRA') OR LOWER(COALESCE(nombre,''))='libra' OR LOWER(COALESCE(simbolo,''))='lb')
  ORDER BY activo DESC,nombre
  LIMIT 1
)
WHERE codigo='QUESO' AND id_unidad_venta IS NULL;

ALTER TABLE venta_animal
  ADD COLUMN IF NOT EXISTS id_comprador UUID REFERENCES comprador(id_comprador);

ALTER TABLE venta_producto
  ADD COLUMN IF NOT EXISTS id_comprador UUID REFERENCES comprador(id_comprador);

CREATE INDEX IF NOT EXISTS idx_comprador_activo_nombre
  ON comprador(activo,nombre) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_venta_animal_comprador
  ON venta_animal(id_comprador) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_venta_producto_comprador
  ON venta_producto(id_comprador) WHERE deleted_at IS NULL;

COMMIT;
