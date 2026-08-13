SELECT 'producto_venta.id_unidad_complementaria' AS comprobacion,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='producto_venta'
      AND column_name='id_unidad_complementaria'
  ) THEN 'OK' ELSE 'REVISAR' END AS estado;

SELECT 'venta_producto_detalle.cantidad_complementaria' AS comprobacion,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='venta_producto_detalle'
      AND column_name='cantidad_complementaria'
  ) THEN 'OK' ELSE 'REVISAR' END AS estado;

SELECT 'unidad Marqueta' AS comprobacion,
  CASE WHEN EXISTS (
    SELECT 1 FROM unidad_medida
    WHERE deleted_at IS NULL
      AND (UPPER(COALESCE(codigo,''))='MARQUETA' OR LOWER(COALESCE(nombre,''))='marqueta')
  ) THEN 'OK' ELSE 'REVISAR' END AS estado;

SELECT 'Queso con unidad complementaria' AS comprobacion,
  CASE WHEN EXISTS (
    SELECT 1 FROM producto_venta p
    JOIN unidad_medida u ON u.id_unidad=p.id_unidad_complementaria
    WHERE UPPER(p.codigo)='QUESO' AND p.deleted_at IS NULL
      AND LOWER(u.nombre)='marqueta' AND u.deleted_at IS NULL
  ) THEN 'OK' ELSE 'REVISAR' END AS estado;
