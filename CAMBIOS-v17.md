# SGB v17 · Ubicación histórica y borradores de traslados

## Cambios principales

- Toda propiedad externa, incluida Jorge, dispone de una opción **Propiedad · Ubicación histórica/general**.
- Esa ubicación permite crear grupos externos sin registrar previamente un potrero o corral.
- Al seleccionar la propiedad externa en el formulario del grupo, la ubicación histórica/general se selecciona automáticamente.
- Los movimientos pueden guardarse como borrador aunque todavía no tengan animales, grupo, ubicación o motivo completos.
- Si el motivo queda pendiente, se asigna automáticamente el motivo general correspondiente al tipo de movimiento.
- Las reglas de propiedad, grupo, potrero, animales activos y operaciones permitidas se ejecutan al aplicar el movimiento.
- Los borradores pueden editarse y completar posteriormente antes de aplicarlos.

## Migración requerida

Esta versión no agrega una migración nueva. Debe estar aplicada la última migración estructural:

```sql
migrations/20260820_propiedades_externas_estructuradas.sql
```

## Validación realizada

- Backend: `npm run build`
- Frontend: `npm run build`

Ambas compilaciones finalizaron correctamente.
