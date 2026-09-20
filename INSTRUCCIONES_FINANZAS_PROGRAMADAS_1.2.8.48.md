# Mis finanzas: tarjetas y movimientos programados

Esta actualización amplía la rama `feature/mis-finanzas-1.2.8.48`.

## Base de datos

Después de la migración original de Mis finanzas, ejecutar una sola vez:

```text
migrations/20260920_finanzas_tarjetas_programadas.sql
```

La migración:

- agrega tarjetas de crédito con límite, día de corte y día de pago;
- agrega pagos, ingresos y transferencias programadas;
- evita aplicar dos veces una misma fecha programada.

## Funcionamiento

- Una tarjeta de débito usa una cuenta bancaria o billetera y descuenta su saldo.
- Una compra con tarjeta de crédito aumenta la deuda de esa tarjeta.
- El pago de una tarjeta de crédito se registra como una transferencia desde efectivo, banco o billetera hacia la tarjeta.
- Al llegar la fecha de una programación aparece **Aplicar pago** o **Aplicar ingreso**. El movimiento se registra una sola vez y se calcula la próxima fecha.
- Las programaciones descargadas pueden aplicarse sin conexión; se sincronizan después respetando la validación contra duplicados.
