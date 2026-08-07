BEGIN;

ALTER TABLE limpieza_potrero
  ADD COLUMN IF NOT EXISTS unidad_aplicacion VARCHAR(10);

ALTER TABLE limpieza_potrero
  ALTER COLUMN unidad_aplicacion DROP DEFAULT,
  ALTER COLUMN unidad_aplicacion DROP NOT NULL;

ALTER TABLE limpieza_potrero
  DROP CONSTRAINT IF EXISTS limpieza_potrero_unidad_aplicacion_check;

ALTER TABLE limpieza_potrero
  ADD CONSTRAINT limpieza_potrero_unidad_aplicacion_check
  CHECK (unidad_aplicacion IN ('TANQUES', 'BOMBADAS'));

COMMENT ON COLUMN limpieza_potrero.unidad_aplicacion IS
  'Indica si cantidad_tanques representa tanques o bombadas; NULL conserva la ambigüedad de registros anteriores.';

COMMIT;
