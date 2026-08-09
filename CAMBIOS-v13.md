# SGB v13 · Grupos por propiedad, políticas de operación y fechas

## Cambios principales

- Los grupos ahora se clasifican por situación: animales en propiedad o fuera de propiedad.
- Al crear animales y crías, solo se muestran grupos compatibles con su situación de propiedad.
- Los cambios de grupo, potrero, corral y propiedad validan tanto la categoría como las operaciones permitidas.
- Se agregó **Administración → Configuración**, con una matriz para permitir o bloquear operaciones por categoría de animal.
- Configuración inicial para animales fuera de propiedad:
  - permite celos, preñeces, partos, abortos, tratamientos, ventas, pesajes, muertes, cambios de grupo y traslados entre propiedades;
  - bloquea cambios de potrero o corral, lactancias y ordeño/producción de leche.
- La política se valida también en el servidor para impedir registros incompatibles aunque se intente acceder directamente a la API.
- Todos los formularios operativos solicitan únicamente la fecha. La hora real de registro se conserva automáticamente en los campos de auditoría (`created_at`).

## Migración requerida

Después de las migraciones anteriores, ejecutar:

```sql
migrations/20260817_grupos_politicas_operaciones.sql
```

La migración asigna a cada grupo existente la categoría predominante de sus animales; los grupos vacíos quedan inicialmente como **En propiedad**.

## Validación realizada

- Backend: `npm run build`
- Frontend: `npm run build`

Ambas compilaciones finalizaron correctamente.
