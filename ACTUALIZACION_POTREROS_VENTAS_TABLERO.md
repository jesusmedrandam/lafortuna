# Actualización de potreros, ventas y tablero

## Cambios incluidos

- Potreros en listado compacto y ficha completa al seleccionar un registro.
- Resumen automático de área, pastos, ocupación actual, fechas y días de ocupación/descanso.
- Historial de períodos de ocupación con el descanso previo a cada período.
- Pestañas separadas para ventas de animales y ventas de productos.
- Catálogo de productos de venta, inicialmente con **Leche** y **Queso**.
- Catálogo de compradores; las ventas nuevas deben seleccionar un comprador registrado.
- Unidades de los productos vinculadas al catálogo de medidas (Litro y Libra como valores iniciales).
- Ventas de productos diarias o semanales, con cantidad, unidad, precio unitario, subtotal y total.
- Tablero compacto con ingresos de hoy, ingresos del mes, ventas del mes y potreros ocupados.
- Se eliminó el bloque “Base nueva, servidor nuevo y datos organizados”.

## Migraciones obligatorias en Aiven

Ejecuta las migraciones antes de desplegar esta versión del backend:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/20260807_unidad_aplicacion_limpieza.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/20260808_ventas_productos.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/20260809_compradores_y_unidades_venta.sql
```

También puedes abrir cada archivo en **Estudio PG** de Aiven, copiar todo su contenido y ejecutarlo en el orden indicado.

La segunda migración crea:

- `producto_venta`
- `venta_producto`
- `venta_producto_detalle`

La segunda migración registra los productos iniciales. La tercera crea el catálogo de compradores, agrega las relaciones con las ventas y vincula los productos al catálogo general de unidades. También agrega `Litro (L)` y `Libra (lb)` si todavía no existen, asigna litros a la leche y libras al queso.

Después de migrar puedes:

- Registrar clientes desde **Catálogos → Compradores**.
- Cambiar o agregar medidas desde **Catálogos → Unidades de medida**.
- Elegir la unidad de cada producto desde **Catálogos → Productos de venta**.

## Funcionamiento del historial de potreros

El historial se deriva de `animal_ubicacion_historial`. Los intervalos superpuestos se agrupan para representar períodos continuos en los que el potrero estuvo ocupado. El descanso previo se calcula entre el final de un período y el inicio del siguiente. De esta forma, los movimientos de animales siguen siendo la fuente oficial y no hace falta mantener un historial duplicado manualmente.

## Verificación realizada

- Typecheck del backend.
- Compilación de producción del backend.
- Typecheck del frontend.
- Compilación de producción del frontend.
