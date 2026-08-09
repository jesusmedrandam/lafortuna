# SGB v14 · Ubicación única por grupo y separación por propiedad

## Cambios principales

- Cada grupo queda vinculado con un único potrero, corral o propiedad.
- Al crear un animal o una cría, elegir un grupo asigna automáticamente la ubicación de ese grupo.
- Un grupo ocupado solo puede cambiar de ubicación mediante un movimiento que incluya a todos sus animales activos.
- El cambio individual de grupo solo permite grupos de la misma ubicación y situación de propiedad.
- Los animales que están fuera de la propiedad no pueden cambiarse a un grupo interno.
- Los movimientos de potrero, corral o propiedad solicitan tanto el destino como el grupo correspondiente.
- Al elegir la propiedad de destino, se excluyen de la selección los animales que ya se encuentran allí.
- Reproducción, sanidad y muertes/bajas incluyen vistas separadas para animales en la propiedad y fuera de ella.
- Los filtros también se aplican a los formularios, jornadas colectivas y opciones de animales.

## Migración requerida

Después de las migraciones anteriores, ejecutar:

```sql
migrations/20260818_grupo_ubicacion_consistente.sql
```

La migración agrega la ubicación fija del grupo y completa automáticamente los grupos cuyos animales activos ya comparten una única ubicación. Los grupos históricos con ubicaciones mezcladas quedan pendientes para regularizarlos mediante un movimiento de grupo completo.

## Validación realizada

- Backend: `npm run build`
- Frontend: `npm run build`

Ambas compilaciones finalizaron correctamente.
