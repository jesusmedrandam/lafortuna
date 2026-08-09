# SGB v15 · Traslado de grupos y consumo en limpieza

## Cambios principales

- Para cambiar un grupo de potrero o corral se selecciona primero el grupo de origen y después el destino.
- El potrero o corral actual del grupo se excluye de los destinos disponibles.
- El grupo se conserva durante el traslado y todos sus animales activos se mueven juntos.
- Los motivos de movimiento ahora se seleccionan desde un catálogo administrable en **Catálogos > Motivos de movimiento**.
- En limpieza de potreros se eliminó la captura de valores monetarios.
- Por cada producto se registra la cantidad aplicada en cada tanque o bombada.
- La cantidad total utilizada se calcula en el servidor como `cantidad por tanque o bombada × número de aplicaciones`.
- El área intervenida se registra únicamente como **Total** o **Parcial**.

## Migración requerida

Después de las migraciones anteriores, ejecutar:

```sql
migrations/20260819_motivos_movimiento_y_consumo_limpieza.sql
```

La migración crea el catálogo de motivos, relaciona los movimientos existentes con un motivo, agrega el tipo de área intervenida y conserva el consumo por tanque o bombada. Los campos monetarios anteriores se mantienen únicamente para no eliminar información histórica, pero ya no se utilizan en el sistema.

## Validación realizada

- Backend: `npm run build`
- Frontend: `npm run build`

Ambas compilaciones finalizaron correctamente.
