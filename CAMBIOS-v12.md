# Cambios v12

## Animales y trazabilidad

- **Clasificación y lugar actual** aparece únicamente al registrar un animal.
- La edición general ya no puede modificar situación de propiedad, grupo, ubicación, fecha de ingreso ni condición.
- Se corrigió el formulario de edición para conservar el origen real del animal; los valores predeterminados se aplican solo al crear.
- Desde la ficha del animal se puede abrir directamente un movimiento individual.
- Se agregaron acciones auditadas para desactivar, reactivar, reportar desaparición y registrar hallazgo.
- Un animal no activo queda excluido de nuevas operaciones, incluidas ventas y registros sanitarios/productivos.

## Movimientos

- El formulario permite elegir claramente entre:
  - cambio de ubicación (potrero o corral);
  - cambio de grupo;
  - traslado a otra propiedad registrada como ubicación externa;
  - cambio combinado de ubicación y grupo.
- Los traslados a ubicaciones externas sincronizan la categoría del animal mediante la trazabilidad existente de ubicación.

## Limpieza de potreros

- Cada producto solicita cantidad total, unidad y valor unitario en USD.
- El valor total se calcula automáticamente como `cantidad total × valor unitario`.
- El cálculo también se protege en PostgreSQL mediante un trigger.

## Migración requerida

Después de las migraciones anteriores, ejecutar:

```text
migrations/20260816_trazabilidad_condicion_y_costos_limpieza.sql
```

Esta migración crea el historial de actividad, desapariciones y hallazgos, y añade los valores unitario y total a los productos de limpieza.
