# Parche 20260829

Este archivo corresponde únicamente al parche incremental de lactancias,
producción, reproducción, fotografías y limpieza de potreros.

## Orden de aplicación

1. Conserva el respaldo reciente de PostgreSQL.
2. Ejecuta primero `migrations/20260829_lactancias_reproduccion_detalles.sql`
   en la misma base usada por el sistema. Debe finalizar con `COMMIT`.
3. Copia el resto de los archivos respetando sus carpetas.
4. Despliega nuevamente backend y frontend.
5. Recarga el navegador sin caché (`Ctrl + F5`).

## Comportamiento de datos existentes

- Las lactancias activas que ya existían se marcan inicialmente como
  `en_ordeno = true`, para conservar las vacas que aparecían en producción.
- Después puedes editar cada lactancia y desmarcar **En ordeño** sin cerrarla.
- El nuevo límite para registrar producción es de 18 meses desde el inicio de
  la lactancia.
- Un aborto puede relacionarse con una preñez confirmada o guardarse sin una.

La migración es reutilizable: si ya terminó correctamente, volver a ejecutarla
no duplica columnas, restricciones ni índices.
