-- Ejecutar después de 20260822_propiedades_fuente_unica.sql.
-- Es una consulta de solo lectura: problemas=0 confirma las invariantes nuevas.

WITH problemas AS (
  SELECT 'PROPIEDAD_EXTERNA_SIN_UBICACION_GENERAL' tipo,
    p.id_propiedad::TEXT entidad,p.nombre detalle
  FROM propiedad_ganadera p
  WHERE p.es_principal=FALSE AND p.activa=TRUE AND p.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM ubicacion u
      WHERE u.id_ubicacion=p.id_propiedad AND u.id_propiedad=p.id_propiedad
        AND u.tipo='OTRO' AND u.activo=TRUE AND u.deleted_at IS NULL
    )

  UNION ALL
  SELECT 'UBICACION_CATEGORIA_INCORRECTA',u.id_ubicacion::TEXT,u.nombre
  FROM ubicacion u
  JOIN propiedad_ganadera p ON p.id_propiedad=u.id_propiedad
  WHERE u.deleted_at IS NULL
    AND u.id_categoria_animal<>CASE WHEN p.es_principal
      THEN '00000000-0000-4000-8000-000000000101'::UUID
      ELSE '00000000-0000-4000-8000-000000000102'::UUID END

  UNION ALL
  SELECT 'GRUPO_UBICACION_OTRA_PROPIEDAD',g.id_grupo::TEXT,g.nombre
  FROM grupo g
  JOIN ubicacion u ON u.id_ubicacion=g.id_ubicacion_actual
  WHERE g.activo=TRUE AND g.deleted_at IS NULL
    AND u.id_propiedad<>g.id_propiedad

  UNION ALL
  SELECT 'ANIMAL_GRUPO_UBICACION_INCONSISTENTE',a.id_animal::TEXT,a.nombre
  FROM animal a
  JOIN grupo g ON g.id_grupo=a.id_grupo_actual
  WHERE a.estado='ACTIVO' AND a.deleted_at IS NULL
    AND a.id_ubicacion_actual IS DISTINCT FROM g.id_ubicacion_actual

  UNION ALL
  SELECT 'MOVIMIENTO_APLICADO_SIN_DESTINO',m.id_movimiento::TEXT,m.tipo_movimiento
  FROM movimiento_animal m
  WHERE m.estado NOT IN ('BORRADOR','CANCELADO') AND m.deleted_at IS NULL
    AND m.id_ubicacion_destino IS NULL AND m.id_grupo_destino IS NULL

  UNION ALL
  SELECT 'ROTACION_ENTRE_PROPIEDADES',m.id_movimiento::TEXT,m.estado::TEXT
  FROM movimiento_animal m
  WHERE m.tipo_movimiento='UBICACION' AND m.estado<>'CANCELADO' AND m.deleted_at IS NULL
    AND m.id_propiedad_origen IS NOT NULL AND m.id_propiedad_destino IS NOT NULL
    AND m.id_propiedad_origen<>m.id_propiedad_destino
)
SELECT COUNT(*)::INT problemas,
  CASE WHEN COUNT(*)=0 THEN 'CORRECTO' ELSE 'REVISAR' END estado,
  COALESCE(JSONB_AGG(TO_JSONB(problemas)) FILTER (WHERE tipo IS NOT NULL),'[]'::JSONB) detalle
FROM problemas;
