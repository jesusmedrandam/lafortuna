BEGIN;

CREATE TABLE IF NOT EXISTS finanzas_usuario_configuracion (
  id_usuario UUID PRIMARY KEY REFERENCES usuario(id_usuario) ON DELETE CASCADE,
  habilitadas BOOLEAN NOT NULL DEFAULT FALSE,
  permitir_saldo_negativo BOOLEAN NOT NULL DEFAULT FALSE,
  moneda CHAR(3) NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (moneda = UPPER(moneda))
);

CREATE TABLE IF NOT EXISTS cuenta_financiera (
  id_cuenta UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario UUID NOT NULL REFERENCES usuario(id_usuario) ON DELETE CASCADE,
  nombre VARCHAR(100) NOT NULL,
  tipo VARCHAR(16) NOT NULL,
  saldo_inicial NUMERIC(14,2) NOT NULL DEFAULT 0,
  descripcion VARCHAR(500),
  color VARCHAR(7),
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CHECK (tipo IN ('EFECTIVO','BANCO','BILLETERA','OTRO')),
  CHECK (saldo_inicial >= 0),
  CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
  UNIQUE (id_cuenta,id_usuario)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cuenta_financiera_usuario_nombre
  ON cuenta_financiera(id_usuario,LOWER(nombre)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS deuda_personal (
  id_deuda UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario UUID NOT NULL REFERENCES usuario(id_usuario) ON DELETE CASCADE,
  tipo VARCHAR(12) NOT NULL,
  contraparte VARCHAR(160) NOT NULL,
  concepto VARCHAR(200) NOT NULL,
  monto_original NUMERIC(14,2) NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_vencimiento DATE,
  estado VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE',
  observaciones TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CHECK (tipo IN ('A_FAVOR','EN_CONTRA')),
  CHECK (estado IN ('PENDIENTE','PAGADA','CANCELADA')),
  CHECK (monto_original > 0),
  CHECK (fecha_vencimiento IS NULL OR fecha_vencimiento >= fecha_inicio),
  UNIQUE (id_deuda,id_usuario)
);

CREATE TABLE IF NOT EXISTS movimiento_financiero (
  id_movimiento_financiero UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario UUID NOT NULL REFERENCES usuario(id_usuario) ON DELETE CASCADE,
  tipo VARCHAR(20) NOT NULL,
  id_cuenta_origen UUID,
  id_cuenta_destino UUID,
  id_deuda UUID,
  monto NUMERIC(14,2) NOT NULL,
  metodo_pago VARCHAR(20) NOT NULL,
  categoria VARCHAR(100),
  concepto VARCHAR(200) NOT NULL,
  fecha DATE NOT NULL,
  observaciones TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CHECK (tipo IN ('INGRESO','EGRESO','TRANSFERENCIA','AJUSTE_ENTRADA','AJUSTE_SALIDA')),
  CHECK (metodo_pago IN ('EFECTIVO','TRANSFERENCIA','TARJETA_DEBITO','TARJETA_CREDITO','DEPOSITO','OTRO')),
  CHECK (monto > 0),
  CHECK (id_cuenta_origen IS NULL OR id_cuenta_destino IS NULL OR id_cuenta_origen <> id_cuenta_destino),
  CHECK (
    (tipo IN ('INGRESO','AJUSTE_ENTRADA') AND id_cuenta_origen IS NULL AND id_cuenta_destino IS NOT NULL) OR
    (tipo IN ('EGRESO','AJUSTE_SALIDA') AND id_cuenta_origen IS NOT NULL AND id_cuenta_destino IS NULL) OR
    (tipo = 'TRANSFERENCIA' AND id_cuenta_origen IS NOT NULL AND id_cuenta_destino IS NOT NULL)
  ),
  FOREIGN KEY (id_cuenta_origen,id_usuario) REFERENCES cuenta_financiera(id_cuenta,id_usuario),
  FOREIGN KEY (id_cuenta_destino,id_usuario) REFERENCES cuenta_financiera(id_cuenta,id_usuario),
  FOREIGN KEY (id_deuda,id_usuario) REFERENCES deuda_personal(id_deuda,id_usuario)
);

CREATE INDEX IF NOT EXISTS idx_cuenta_financiera_usuario ON cuenta_financiera(id_usuario,activa) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_movimiento_financiero_usuario_fecha ON movimiento_financiero(id_usuario,fecha DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_movimiento_financiero_cuenta_origen ON movimiento_financiero(id_cuenta_origen) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_movimiento_financiero_cuenta_destino ON movimiento_financiero(id_cuenta_destino) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_movimiento_financiero_deuda ON movimiento_financiero(id_deuda) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deuda_personal_usuario ON deuda_personal(id_usuario,estado,fecha_vencimiento) WHERE deleted_at IS NULL;

COMMIT;
