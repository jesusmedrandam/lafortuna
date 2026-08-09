BEGIN;

CREATE TABLE IF NOT EXISTS animal_condicion_evento (
  id_evento UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_animal UUID NOT NULL REFERENCES animal(id_animal),
  tipo_evento VARCHAR(40) NOT NULL,
  estado_anterior VARCHAR(40) NOT NULL REFERENCES condicion_animal(codigo) ON UPDATE CASCADE,
  estado_nuevo VARCHAR(40) NOT NULL REFERENCES condicion_animal(codigo) ON UPDATE CASCADE,
  fecha_evento TIMESTAMPTZ NOT NULL,
  id_categoria_anterior UUID REFERENCES categoria_animal(id_categoria_animal),
  id_categoria_destino UUID REFERENCES categoria_animal(id_categoria_animal),
  id_grupo_anterior UUID REFERENCES grupo(id_grupo),
  id_grupo_destino UUID REFERENCES grupo(id_grupo),
  id_ubicacion_anterior UUID REFERENCES ubicacion(id_ubicacion),
  id_ubicacion_destino UUID REFERENCES ubicacion(id_ubicacion),
  observaciones VARCHAR(1000),
  registrado_por UUID NOT NULL REFERENCES usuario(id_usuario),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT ck_animal_condicion_evento_tipo CHECK (
    tipo_evento IN ('DESACTIVAR','REACTIVAR','REPORTAR_DESAPARICION','REGISTRAR_HALLAZGO')
  )
);

CREATE INDEX IF NOT EXISTS idx_animal_condicion_evento_animal_fecha
  ON animal_condicion_evento(id_animal,fecha_evento DESC)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE animal_condicion_evento IS
  'Audita desactivaciones, reactivaciones, desapariciones y hallazgos sin permitir que la edición general altere la condición.';

ALTER TABLE limpieza_potrero_producto
  ADD COLUMN IF NOT EXISTS valor_unitario NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS valor_total NUMERIC(14,2);

CREATE OR REPLACE FUNCTION calcular_valor_total_limpieza_producto()
RETURNS TRIGGER AS $$
BEGIN
  NEW.valor_total := CASE
    WHEN NEW.valor_unitario IS NULL THEN NULL
    ELSE ROUND(NEW.cantidad_total * NEW.valor_unitario, 2)
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calcular_valor_total_limpieza_producto ON limpieza_potrero_producto;
CREATE TRIGGER trg_calcular_valor_total_limpieza_producto
BEFORE INSERT OR UPDATE OF cantidad_total,valor_unitario
ON limpieza_potrero_producto
FOR EACH ROW EXECUTE FUNCTION calcular_valor_total_limpieza_producto();

UPDATE limpieza_potrero_producto
SET valor_total=ROUND(cantidad_total * valor_unitario, 2)
WHERE valor_unitario IS NOT NULL
  AND valor_total IS DISTINCT FROM ROUND(cantidad_total * valor_unitario, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='ck_limpieza_producto_valor_unitario'
      AND conrelid='limpieza_potrero_producto'::regclass
  ) THEN
    ALTER TABLE limpieza_potrero_producto
      ADD CONSTRAINT ck_limpieza_producto_valor_unitario
      CHECK (valor_unitario IS NULL OR valor_unitario>=0);
  END IF;
END;
$$;

COMMENT ON COLUMN limpieza_potrero_producto.valor_unitario IS
  'Valor en USD por cada unidad registrada en cantidad_total.';
COMMENT ON COLUMN limpieza_potrero_producto.valor_total IS
  'Calculado automáticamente como cantidad_total por valor_unitario.';

COMMIT;
