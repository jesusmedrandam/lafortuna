BEGIN;

CREATE TABLE IF NOT EXISTS motivo_movimiento (
  id_motivo_movimiento UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo VARCHAR(50) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  descripcion VARCHAR(300),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_motivo_movimiento_codigo_activo
  ON motivo_movimiento(UPPER(codigo))
  WHERE deleted_at IS NULL;

INSERT INTO motivo_movimiento(id_motivo_movimiento,codigo,nombre,descripcion)
VALUES
  ('00000000-0000-4000-8000-000000000301','ROTACION_POTRERO','Rotación de potrero','Traslado del grupo a otro potrero o corral.'),
  ('00000000-0000-4000-8000-000000000302','CAMBIO_GRUPO','Cambio de grupo','Reasignación de uno o varios animales a otro grupo.'),
  ('00000000-0000-4000-8000-000000000303','TRASLADO_PROPIEDAD','Traslado a otra propiedad','Salida de animales hacia una propiedad externa.'),
  ('00000000-0000-4000-8000-000000000304','REORGANIZACION','Reorganización','Cambio combinado de grupo y ubicación.'),
  ('00000000-0000-4000-8000-000000000305','OTRO','Otro','Otro motivo registrado por el administrador.')
ON CONFLICT(id_motivo_movimiento) DO UPDATE SET
  nombre=EXCLUDED.nombre,
  descripcion=EXCLUDED.descripcion,
  activo=TRUE,
  deleted_at=NULL,
  updated_at=NOW();

ALTER TABLE movimiento_animal
  ADD COLUMN IF NOT EXISTS id_motivo_movimiento UUID REFERENCES motivo_movimiento(id_motivo_movimiento);

UPDATE movimiento_animal
SET id_motivo_movimiento=CASE tipo_movimiento
  WHEN 'UBICACION' THEN '00000000-0000-4000-8000-000000000301'::UUID
  WHEN 'GRUPO' THEN '00000000-0000-4000-8000-000000000302'::UUID
  WHEN 'PROPIEDAD' THEN '00000000-0000-4000-8000-000000000303'::UUID
  WHEN 'COMBINADO' THEN '00000000-0000-4000-8000-000000000304'::UUID
  ELSE '00000000-0000-4000-8000-000000000305'::UUID
END
WHERE id_motivo_movimiento IS NULL;

ALTER TABLE movimiento_animal
  ALTER COLUMN id_motivo_movimiento SET NOT NULL;

ALTER TABLE limpieza_potrero
  ADD COLUMN IF NOT EXISTS tipo_area_intervenida VARCHAR(20);

ALTER TABLE limpieza_potrero_producto
  ADD COLUMN IF NOT EXISTS cantidad_por_tanque NUMERIC(14,4);

UPDATE limpieza_potrero_producto producto
SET cantidad_por_tanque=CASE
  WHEN limpieza.cantidad_tanques IS NOT NULL AND limpieza.cantidad_tanques>0
    THEN ROUND(producto.cantidad_total/limpieza.cantidad_tanques,4)
  ELSE producto.cantidad_total
END
FROM limpieza_potrero limpieza
WHERE limpieza.id_limpieza=producto.id_limpieza
  AND producto.cantidad_por_tanque IS NULL;

UPDATE limpieza_potrero
SET tipo_area_intervenida=CASE WHEN area_intervenida IS NULL THEN 'TOTAL' ELSE 'PARCIAL' END
WHERE tipo_area_intervenida IS NULL;

ALTER TABLE limpieza_potrero
  ALTER COLUMN tipo_area_intervenida SET DEFAULT 'TOTAL',
  ALTER COLUMN tipo_area_intervenida SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='ck_limpieza_tipo_area_intervenida'
      AND conrelid='limpieza_potrero'::regclass
  ) THEN
    ALTER TABLE limpieza_potrero
      ADD CONSTRAINT ck_limpieza_tipo_area_intervenida
      CHECK (tipo_area_intervenida IN ('TOTAL','PARCIAL'));
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='ck_limpieza_producto_cantidad_por_tanque'
      AND conrelid='limpieza_potrero_producto'::regclass
  ) THEN
    ALTER TABLE limpieza_potrero_producto
      ADD CONSTRAINT ck_limpieza_producto_cantidad_por_tanque
      CHECK (cantidad_por_tanque IS NULL OR cantidad_por_tanque>0);
  END IF;
END;
$$;

-- Los campos monetarios anteriores se conservan únicamente para no eliminar
-- datos históricos. Desde esta versión ya no se capturan ni se muestran.
DROP TRIGGER IF EXISTS trg_calcular_valor_total_limpieza_producto ON limpieza_potrero_producto;

COMMENT ON TABLE motivo_movimiento IS
  'Opciones administrables que explican por qué se realiza un movimiento animal.';
COMMENT ON COLUMN limpieza_potrero.tipo_area_intervenida IS
  'Indica si la actividad cubrió el potrero de forma total o parcial.';
COMMENT ON COLUMN limpieza_potrero_producto.cantidad_por_tanque IS
  'Cantidad de producto aplicada en cada tanque o bombada.';
COMMENT ON COLUMN limpieza_potrero_producto.cantidad_total IS
  'Consumo calculado como cantidad por tanque o bombada multiplicada por el número de aplicaciones.';

COMMIT;
