# SGB v16 · Grupos y potreros en propiedades externas

## Cambios principales

- Una propiedad externa puede utilizarse como ubicación general aunque todavía no tenga potreros ni corrales.
- Al crear un grupo se selecciona primero la propiedad.
- Para una propiedad externa aparece la opción **Sin potrero o corral · Ubicación general** y también sus potreros o corrales vinculados.
- Al crear o editar un potrero o corral se puede indicar si pertenece a la propiedad principal o a una propiedad externa.
- Los potreros y corrales externos heredan automáticamente la categoría de su propiedad.
- Los grupos y animales históricos vinculados directamente con una propiedad externa se conservan sin alteraciones.
- No se permite cambiar de propiedad un potrero o corral que todavía tenga grupos o animales activos.
- En los traslados a otra propiedad también pueden seleccionarse sus potreros o corrales; se sigue impidiendo trasladar un animal hacia la misma propiedad en la que ya está.

## Migración requerida

Después de las migraciones anteriores, ejecutar:

```sql
migrations/20260820_propiedades_externas_estructuradas.sql
```

La migración agrega una relación opcional entre un potrero o corral y su propiedad externa. Las ubicaciones sin propiedad padre continúan perteneciendo a la propiedad principal. No modifica las asignaciones históricas existentes.

## Validación realizada

- Backend: `npm run build`
- Frontend: `npm run build`

Ambas compilaciones finalizaron correctamente.
