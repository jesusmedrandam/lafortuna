# Parche incremental: herrajes, multimedia e historiales

Este paquete contiene únicamente los archivos modificados. Se aplica sobre la
versión que ya tiene ejecutadas las migraciones hasta
`20260827_lactancias_y_presentaciones_venta.sql`.

## Orden de instalación

1. Realiza un respaldo de PostgreSQL.
2. Ejecuta en pgAdmin, completa y sin seleccionar fragmentos, la migración:
   `migrations/20260828_herrajes_multimedia_historial.sql`.
3. Confirma que la pestaña **Messages** termine con `COMMIT`.
4. Copia las carpetas `src`, `frontend` y `migrations` sobre el proyecto,
   conservando sus rutas.
5. Publica nuevamente backend y frontend.

Si PostgreSQL informa que la transacción está abortada, ejecuta `ROLLBACK;` en
una consulta separada, revisa el primer error real y solo entonces vuelve a
ejecutar la migración completa.

## Cambios incluidos

- Herraje permite elegir uno o varios animales y el fierro aplicado. El fierro
  actual del animal se reemplaza, pero el registro histórico conserva cuál se
  utilizó en cada actividad.
- Visor común dentro del sistema con navegación lateral, teclado, deslizamiento
  táctil y descarga.
- Multimedia reúne animales, partos, movimientos, actividades y limpiezas.
- Los filtros cambian según la categoría; en movimientos se puede filtrar por
  potrero de origen, destino y lado de la fotografía.
- El detalle de grupo muestra animales actuales e historial de movimientos.
- El perfil animal muestra total de partos cuando corresponde e historiales de
  actividades, movimientos y tratamientos.

## Verificación técnica realizada

- Backend: `npm run typecheck`
- Frontend: `npm run typecheck`
- Frontend: `npm run build`
