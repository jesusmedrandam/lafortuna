BEGIN;

ALTER TABLE cuenta_financiera DROP CONSTRAINT IF EXISTS cuenta_financiera_tipo_check;
ALTER TABLE cuenta_financiera DROP CONSTRAINT IF EXISTS cuenta_financiera_saldo_inicial_check;
ALTER TABLE cuenta_financiera DROP CONSTRAINT IF EXISTS cuenta_financiera_limite_credito_check;
ALTER TABLE cuenta_financiera DROP CONSTRAINT IF EXISTS cuenta_financiera_dia_corte_check;
ALTER TABLE cuenta_financiera DROP CONSTRAINT IF EXISTS cuenta_financiera_dia_pago_check;
ALTER TABLE cuenta_financiera
  ADD COLUMN IF NOT EXISTS limite_credito NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS dia_corte SMALLINT,
  ADD COLUMN IF NOT EXISTS dia_pago SMALLINT;

ALTER TABLE cuenta_financiera
  ADD CONSTRAINT cuenta_financiera_tipo_check
    CHECK (tipo IN ('EFECTIVO','BANCO','BILLETERA','TARJETA_CREDITO','OTRO')),
  ADD CONSTRAINT cuenta_financiera_saldo_inicial_check
    CHECK ((tipo='TARJETA_CREDITO' AND saldo_inicial<=0) OR (tipo<>'TARJETA_CREDITO' AND saldo_inicial>=0)),
  ADD CONSTRAINT cuenta_financiera_limite_credito_check
    CHECK (limite_credito IS NULL OR limite_credito>0),
  ADD CONSTRAINT cuenta_financiera_dia_corte_check
    CHECK (dia_corte IS NULL OR dia_corte BETWEEN 1 AND 31),
  ADD CONSTRAINT cuenta_financiera_dia_pago_check
    CHECK (dia_pago IS NULL OR dia_pago BETWEEN 1 AND 31);

CREATE TABLE IF NOT EXISTS movimiento_financiero_programado (
  id_programacion UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario UUID NOT NULL REFERENCES usuario(id_usuario) ON DELETE CASCADE,
  tipo VARCHAR(20) NOT NULL,
  id_cuenta_origen UUID,
  id_cuenta_destino UUID,
  monto NUMERIC(14,2) NOT NULL,
  metodo_pago VARCHAR(20) NOT NULL,
  categoria VARCHAR(100),
  concepto VARCHAR(200) NOT NULL,
  observaciones TEXT,
  frecuencia VARCHAR(12) NOT NULL DEFAULT 'UNICA',
  fecha_proxima DATE NOT NULL,
  fecha_fin DATE,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CHECK (tipo IN ('INGRESO','EGRESO','TRANSFERENCIA')),
  CHECK (metodo_pago IN ('EFECTIVO','TRANSFERENCIA','TARJETA_DEBITO','TARJETA_CREDITO','DEPOSITO','OTRO')),
  CHECK (frecuencia IN ('UNICA','SEMANAL','QUINCENAL','MENSUAL','ANUAL')),
  CHECK (monto>0),
  CHECK (fecha_fin IS NULL OR fecha_fin>=fecha_proxima),
  CHECK (
    (tipo='INGRESO' AND id_cuenta_origen IS NULL AND id_cuenta_destino IS NOT NULL) OR
    (tipo='EGRESO' AND id_cuenta_origen IS NOT NULL AND id_cuenta_destino IS NULL) OR
    (tipo='TRANSFERENCIA' AND id_cuenta_origen IS NOT NULL AND id_cuenta_destino IS NOT NULL AND id_cuenta_origen<>id_cuenta_destino)
  ),
  UNIQUE (id_programacion,id_usuario),
  FOREIGN KEY (id_cuenta_origen,id_usuario) REFERENCES cuenta_financiera(id_cuenta,id_usuario),
  FOREIGN KEY (id_cuenta_destino,id_usuario) REFERENCES cuenta_financiera(id_cuenta,id_usuario)
);

ALTER TABLE movimiento_financiero
  ADD COLUMN IF NOT EXISTS id_programacion UUID,
  ADD COLUMN IF NOT EXISTS fecha_programada DATE;

DO $$ BEGIN
  ALTER TABLE movimiento_financiero
    ADD CONSTRAINT movimiento_financiero_programacion_fk
    FOREIGN KEY (id_programacion,id_usuario)
    REFERENCES movimiento_financiero_programado(id_programacion,id_usuario);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_movimiento_financiero_programado_aplicado
  ON movimiento_financiero(id_programacion,fecha_programada)
  WHERE id_programacion IS NOT NULL AND fecha_programada IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_finanza_programada_usuario_fecha
  ON movimiento_financiero_programado(id_usuario,activa,fecha_proxima)
  WHERE deleted_at IS NULL;

COMMIT;
