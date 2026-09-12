BEGIN;

ALTER TABLE operacion_propiedad_animal
  DROP CONSTRAINT IF EXISTS ck_operacion_propiedad_animal_codigo;

ALTER TABLE operacion_propiedad_animal
  ADD CONSTRAINT ck_operacion_propiedad_animal_codigo CHECK (codigo_operacion IN (
    'MOVIMIENTO_UBICACION','MOVIMIENTO_GRUPO','MOVIMIENTO_PROPIEDAD',
    'CELO','INSEMINACION_ARTIFICIAL','TRANSFERENCIA_EMBRIONES','PRENEZ','PARTO','ABORTO',
    'TRATAMIENTO','LIMPIEZA_POTRERO','COMPRA','VENTA','PESAJE','HERRAJE','DESCORNE',
    'MUERTE','LACTANCIA','PRODUCCION_LECHE'
  ));

INSERT INTO operacion_propiedad_animal(id_propiedad,codigo_operacion,permitido)
SELECT p.id_propiedad,operation.codigo,TRUE
FROM propiedad_ganadera p
CROSS JOIN (VALUES
  ('LIMPIEZA_POTRERO'),('COMPRA'),('HERRAJE'),('DESCORNE')
) operation(codigo)
WHERE p.deleted_at IS NULL
ON CONFLICT(id_propiedad,codigo_operacion) DO UPDATE
  SET deleted_at=NULL,updated_at=NOW();

COMMIT;
