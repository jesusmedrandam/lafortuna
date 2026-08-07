BEGIN;

CREATE TABLE IF NOT EXISTS producto_venta (
  id_producto_venta UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo VARCHAR(50) NOT NULL UNIQUE,
  nombre VARCHAR(120) NOT NULL,
  unidad VARCHAR(30) NOT NULL,
  descripcion VARCHAR(300),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS venta_producto (
  id_venta_producto UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha_venta TIMESTAMPTZ NOT NULL,
  periodicidad VARCHAR(10) NOT NULL,
  comprador_nombre VARCHAR(200) NOT NULL,
  comprador_contacto VARCHAR(160),
  destino VARCHAR(220),
  precio_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  moneda CHAR(3) NOT NULL DEFAULT 'USD',
  observaciones TEXT,
  estado VARCHAR(20) NOT NULL DEFAULT 'COMPLETADA',
  anulado_en TIMESTAMPTZ,
  registrado_por UUID NOT NULL REFERENCES usuario(id_usuario),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT venta_producto_periodicidad_check CHECK (periodicidad IN ('DIARIA', 'SEMANAL')),
  CONSTRAINT venta_producto_estado_check CHECK (estado IN ('COMPLETADA', 'ANULADA')),
  CONSTRAINT venta_producto_precio_total_check CHECK (precio_total >= 0)
);

CREATE TABLE IF NOT EXISTS venta_producto_detalle (
  id_venta_producto_detalle UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_venta_producto UUID NOT NULL REFERENCES venta_producto(id_venta_producto),
  id_producto_venta UUID NOT NULL REFERENCES producto_venta(id_producto_venta),
  cantidad NUMERIC(14,3) NOT NULL,
  precio_unitario NUMERIC(14,4) NOT NULL,
  subtotal NUMERIC(14,2) NOT NULL,
  observaciones VARCHAR(300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT venta_producto_detalle_cantidad_check CHECK (cantidad > 0),
  CONSTRAINT venta_producto_detalle_precio_check CHECK (precio_unitario >= 0),
  CONSTRAINT venta_producto_detalle_subtotal_check CHECK (subtotal >= 0)
);

CREATE INDEX IF NOT EXISTS idx_venta_producto_fecha ON venta_producto(fecha_venta DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_venta_producto_detalle_venta ON venta_producto_detalle(id_venta_producto) WHERE deleted_at IS NULL;

INSERT INTO producto_venta(codigo,nombre,unidad,descripcion)
VALUES
  ('LECHE','Leche','L','Leche destinada a la venta'),
  ('QUESO','Queso','kg','Queso destinado a la venta')
ON CONFLICT (codigo) DO NOTHING;

COMMIT;
