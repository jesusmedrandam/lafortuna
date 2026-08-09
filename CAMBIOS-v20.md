# SGB v20 · Propiedad de origen y aplicación de movimientos

## Flujo restaurado

- Se restaura **Propiedad de origen** antes de seleccionar el grupo o los animales.
- La propiedad principal queda seleccionada inicialmente.
- Los grupos externos ya no aparecen mezclados con los grupos de la propiedad principal.
- Si se elige una propiedad externa, solo se muestran sus propios grupos y animales.
- En el cambio de potrero o corral, los destinos pertenecen obligatoriamente a la misma propiedad de origen.

## Aplicación del movimiento

- El servidor completa la ubicación y el grupo de origen al guardar el borrador.
- La aplicación deja de depender de la función antigua de PostgreSQL que requería campos heredados de propiedad.
- Se mantienen las validaciones de grupo completo, propiedad, categoría, ubicación y operaciones permitidas.
- Cambiar un grupo de potrero no exige también un permiso de cambio de grupo, porque el grupo se conserva.

## Migración

Esta versión no agrega otra migración. Debe estar aplicada:

`migrations/20260821_movimientos_borradores_flexibles.sql`

