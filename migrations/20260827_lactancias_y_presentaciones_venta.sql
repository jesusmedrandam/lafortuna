BEGIN;

-- Una venta conserva la unidad principal para calcular el precio y puede
-- registrar, además, una presentación complementaria (marquetas, cajas,
-- sacos, canecas, etc.) seleccionada desde el catálogo de unidades.
ALTER TABLE producto_venta
  ADD COLUMN IF NOT EXISTS id_unidad_complementaria UUID
  REFERENCES unidad_medida(id_unidad);

ALTER TABLE venta_producto_detalle
  ADD COLUMN IF NOT EXISTS cantidad_complementaria NUMERIC(14,3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='ck_producto_venta_unidades_distintas'
      AND conrelid='producto_venta'::regclass
  ) THEN
    ALTER TABLE producto_venta
      ADD CONSTRAINT ck_producto_venta_unidades_distintas
      CHECK (
        id_unidad_complementaria IS NULL
        OR id_unidad_venta IS NULL
        OR id_unidad_complementaria<>id_unidad_venta
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='ck_venta_producto_cantidad_complementaria'
      AND conrelid='venta_producto_detalle'::regclass
  ) THEN
    ALTER TABLE venta_producto_detalle
      ADD CONSTRAINT ck_venta_producto_cantidad_complementaria
      CHECK (cantidad_complementaria IS NULL OR cantidad_complementaria>0);
  END IF;
END;
$$;

INSERT INTO unidad_medida(codigo,nombre,simbolo,magnitud,activo)
SELECT 'MARQUETA','Marqueta','marqueta','CONTEO',TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM unidad_medida
  WHERE deleted_at IS NULL
    AND (
      UPPER(COALESCE(codigo,''))='MARQUETA'
      OR LOWER(COALESCE(nombre,''))='marqueta'
    )
);

UPDATE producto_venta p
SET id_unidad_complementaria=(
  SELECT u.id_unidad
  FROM unidad_medida u
  WHERE u.deleted_at IS NULL
    AND (
      UPPER(COALESCE(u.codigo,''))='MARQUETA'
      OR LOWER(COALESCE(u.nombre,''))='marqueta'
    )
  ORDER BY u.activo DESC,u.nombre
  LIMIT 1
),
updated_at=NOW()
WHERE UPPER(p.codigo)='QUESO'
  AND p.deleted_at IS NULL
  AND p.id_unidad_complementaria IS NULL;

COMMIT;
