# Cambios de la versión 10

## Vistas de registros

- Ventas, movimientos, sanidad, usuarios y roles ahora usan listas compactas como Potreros.
- Al seleccionar una fila se abre el detalle completo del registro.
- Las acciones de edición están disponibles desde la fila y desde el detalle, según los permisos del usuario.
- Limpieza de potreros permite editar la actividad completa, incluidos productos y operadores.
- Los tratamientos individuales, usuarios, roles y permisos conservan sus formularios de edición.
- Las ventas de animales permiten editar sus datos generales sin alterar los animales vendidos ni su historial.
- Las ventas de productos permiten editar datos generales y líneas de productos.
- Los movimientos y jornadas sanitarias solo se pueden editar mientras estén en estado Borrador.

## Búsqueda y orden

- Se agregó búsqueda y selector de orden en Ventas, Movimientos, Sanidad, Limpieza de potreros, Usuarios, Roles y Potreros.
- Multimedia incorpora orden por fecha o nombre de archivo.
- El orden seleccionado se conserva por pantalla en el navegador.

## Multimedia

- Se aumentó la densidad del mosaico para mostrar más elementos.
- La fecha y el animal relacionado aparecen superpuestos en la parte inferior de la imagen.
- Los controles de tipo, edición y eliminación aparecen en la esquina superior izquierda.

## Verificación

- Backend compilado con TypeScript.
- Frontend compilado y generado con Vite.
- Esta versión no requiere una migración adicional de base de datos respecto de v9.
