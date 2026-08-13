# Parche de lactancias y presentaciones de venta

Este paquete contiene solamente los archivos nuevos o modificados.

## Aplicación

1. Conserva el respaldo actual de PostgreSQL.
2. Ejecuta completo `migrations/20260827_lactancias_y_presentaciones_venta.sql` y confirma que pgAdmin muestre `COMMIT`.
3. Ejecuta `VERIFICAR.sql`; todos los valores de `estado` deben mostrar `OK`.
4. Copia el resto de archivos sobre la raíz del proyecto respetando sus carpetas.
5. Despliega primero el backend y después el frontend.

## Resultado

- Nueva lactancia: las vacas vuelven a cargar y los partos permanecen vacíos hasta seleccionar una vaca.
- Solo se muestran los partos de la vaca elegida.
- El servidor rechaza partos de otra vaca, partos ya relacionados y lactancias con fechas superpuestas.
- Los productos de venta admiten una unidad complementaria configurable.
- La migración crea `Marqueta` en Unidades de medida y la asigna como unidad complementaria de `Queso`.
- En una venta de queso se registra la cantidad principal en libras, utilizada para calcular el subtotal, y también la cantidad de marquetas.

Para otro producto, crea primero la unidad correspondiente en **Catálogos → Unidades de medida** y luego selecciónala en **Productos de venta → Unidad complementaria**.

