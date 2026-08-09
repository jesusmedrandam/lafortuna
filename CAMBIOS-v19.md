# SGB v19 · Traslado obligatorio del grupo completo y borradores

## Movimientos de potrero o corral

- Al elegir **Cambiar ubicación (potrero o corral)** solo aparece la selección de un grupo completo.
- Ya no se ofrecen las opciones Todos los animales ni Selección manual para este movimiento.
- Los animales cargados del grupo no pueden desmarcarse individualmente.
- Al elegir el grupo, sus animales activos se cargan automáticamente; no es necesario pulsar un botón adicional.
- El servidor reconstruye la selección con todos los miembros activos del grupo al guardar el borrador.
- El grupo se conserva y todos sus animales activos pasan juntos al nuevo potrero o corral.
- La misma regla se valida también en el servidor para impedir recorridos inconsistentes mediante la API.

## Borradores

- Se corrige el error de PostgreSQL que exigía `id_propiedad_origen` al guardar un borrador incompleto.
- El borrador puede quedar sin origen, destino, grupo o animales; esas reglas se comprueban al momento de aplicarlo.
- Si el motivo queda pendiente, se asigna automáticamente el motivo general correspondiente al tipo de movimiento.

## Migración requerida

Después de las migraciones anteriores, ejecutar:

`migrations/20260821_movimientos_borradores_flexibles.sql`
