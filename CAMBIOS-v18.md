# SGB v18 · Corrección al registrar grupos

## Correcciones

- El alta de grupos ahora se ejecuta dentro de una transacción identificada con el usuario que realiza la operación.
- Si el código se deja vacío, el servidor genera uno único a partir del nombre del grupo; por ejemplo, `Jorge` genera `JORGE`.
- La ubicación histórica/general de una propiedad externa sigue siendo una ubicación válida para el grupo, aunque todavía no existan potreros o corrales secundarios.
- Los errores de campos obligatorios, reglas de PostgreSQL y migraciones faltantes ya no se ocultan detrás de “Ocurrió un error interno”.

## Base de datos

Esta versión no agrega migraciones. Requiere tener aplicadas las migraciones hasta:

`migrations/20260820_propiedades_externas_estructuradas.sql`

