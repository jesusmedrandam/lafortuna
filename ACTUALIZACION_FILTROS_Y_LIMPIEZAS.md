# Actualización: filtros de animales y unidades de limpieza

## Cambios incluidos

- Búsqueda de animales por nombre, arete o descripción.
- Filtros combinables por sexo, estado, especie, grupo, corral/potrero, propietario, raza, color y rango de fecha de nacimiento.
- Botón para limpiar todos los filtros y contador de filtros activos.
- En limpieza de potreros se puede elegir si la aplicación se registra en **tanques** o **bombadas**.
- La cantidad, capacidad y dosis de producto se muestran con la unidad seleccionada.

## Migración obligatoria de PostgreSQL

Antes de desplegar el backend actualizado, ejecutar una sola vez:

`migrations/20260807_unidad_aplicacion_limpieza.sql`

La migración agrega `unidad_aplicacion` a `limpieza_potrero`. Los registros anteriores conservan su valor ambiguo como “Tanques o bombadas”; los nuevos obligan a escoger una de las dos opciones. No se elimina ni modifica ninguna columna existente.

## Verificación

```bash
npm run typecheck
npm run build
cd frontend
npm run typecheck
npm run build
```
