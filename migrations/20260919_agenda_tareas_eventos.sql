BEGIN;
CREATE TABLE IF NOT EXISTS configuracion_agenda (
  id_configuracion SMALLINT PRIMARY KEY DEFAULT 1 CHECK(id_configuracion=1),
  tareas_habilitadas BOOLEAN NOT NULL DEFAULT TRUE,eventos_habilitados BOOLEAN NOT NULL DEFAULT TRUE,
  actualizado_por UUID REFERENCES usuario(id_usuario),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO configuracion_agenda(id_configuracion) VALUES(1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS agenda_item (
  id_agenda_item UUID PRIMARY KEY DEFAULT gen_random_uuid(),clase VARCHAR(10) NOT NULL,tipo_actividad VARCHAR(40) NOT NULL,
  titulo VARCHAR(180) NOT NULL,instrucciones TEXT,programado_para TIMESTAMPTZ NOT NULL,recordatorio_para TIMESTAMPTZ,
  visibilidad VARCHAR(20) NOT NULL DEFAULT 'SELECCIONADOS',estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  datos JSONB NOT NULL DEFAULT '{}'::jsonb,datos_realizados JSONB,campos_editables TEXT[] NOT NULL DEFAULT '{}'::text[],
  asignacion_seguimiento VARCHAR(24) NOT NULL DEFAULT 'SELECCIONADOS',creado_por UUID NOT NULL REFERENCES usuario(id_usuario),
  completado_por UUID REFERENCES usuario(id_usuario),completado_at TIMESTAMPTZ,recordatorio_enviado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),deleted_at TIMESTAMPTZ,
  CHECK(clase IN ('TAREA','EVENTO')),
  CHECK(tipo_actividad IN ('TRATAMIENTO','MOVIMIENTO','LIMPIEZA_POTRERO','HERRAJE','PESAJE','INSEMINACION_ARTIFICIAL','TRANSFERENCIA_EMBRIONES','DESCORNE','PERSONALIZADA')),
  CHECK(visibilidad IN ('PRIVADO','SELECCIONADOS','TODOS')),
  CHECK(estado IN ('PENDIENTE','ACEPTADA','RECHAZADA','COMPLETADA','CANCELADA')),
  CHECK(asignacion_seguimiento IN ('MISMO_ASIGNADO','TODOS','SELECCIONADOS')),
  CHECK(recordatorio_para IS NULL OR recordatorio_para<=programado_para)
);
CREATE TABLE IF NOT EXISTS agenda_usuario (
  id_agenda_usuario UUID PRIMARY KEY DEFAULT gen_random_uuid(),id_agenda_item UUID NOT NULL REFERENCES agenda_item(id_agenda_item) ON DELETE CASCADE,
  id_usuario UUID NOT NULL REFERENCES usuario(id_usuario),rol VARCHAR(12) NOT NULL,respuesta VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE',
  respondido_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CHECK(rol IN ('ASIGNADO','VISOR')),
  CHECK(respuesta IN ('PENDIENTE','ACEPTADA','RECHAZADA')),UNIQUE(id_agenda_item,id_usuario,rol)
);
CREATE TABLE IF NOT EXISTS agenda_animal (
  id_agenda_animal UUID PRIMARY KEY DEFAULT gen_random_uuid(),id_agenda_item UUID NOT NULL REFERENCES agenda_item(id_agenda_item) ON DELETE CASCADE,
  id_animal UUID NOT NULL REFERENCES animal(id_animal),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(id_agenda_item,id_animal)
);
CREATE INDEX IF NOT EXISTS idx_agenda_item_programado ON agenda_item(programado_para,estado) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agenda_item_recordatorio ON agenda_item(recordatorio_para) WHERE deleted_at IS NULL AND recordatorio_enviado_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agenda_usuario_usuario ON agenda_usuario(id_usuario,id_agenda_item);
CREATE INDEX IF NOT EXISTS idx_agenda_animal_animal ON agenda_animal(id_animal,id_agenda_item);
COMMIT;
