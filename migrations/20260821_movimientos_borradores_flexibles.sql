BEGIN;

-- Un borrador puede guardarse antes de completar su origen y destino. Estas
-- columnas se validan obligatoriamente al aplicar el movimiento, no al crearlo.
DO $$
DECLARE
  target_column TEXT;
BEGIN
  FOREACH target_column IN ARRAY ARRAY[
    'id_propiedad_origen',
    'id_propiedad_destino',
    'id_ubicacion_origen',
    'id_ubicacion_destino',
    'id_grupo_origen',
    'id_grupo_destino',
    'id_grupo_filtro'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema=current_schema()
        AND c.table_name='movimiento_animal'
        AND c.column_name=target_column
    ) THEN
      EXECUTE format('ALTER TABLE movimiento_animal ALTER COLUMN %I DROP NOT NULL', target_column);
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE
  target_column TEXT;
BEGIN
  FOREACH target_column IN ARRAY ARRAY[
    'id_ubicacion_destino',
    'id_grupo_destino'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema=current_schema()
        AND c.table_name='movimiento_animal_detalle'
        AND c.column_name=target_column
    ) THEN
      EXECUTE format('ALTER TABLE movimiento_animal_detalle ALTER COLUMN %I DROP NOT NULL', target_column);
    END IF;
  END LOOP;
END;
$$;

COMMENT ON TABLE movimiento_animal IS
  'Los campos de origen y destino pueden quedar pendientes mientras el registro esté en BORRADOR; la API exige el recorrido completo antes de aplicarlo.';

COMMIT;
