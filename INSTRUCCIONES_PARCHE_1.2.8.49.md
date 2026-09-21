# SGB 1.2.8.49 — Finanzas y datos offline

Esta rama incluye las dos entregas de Mis finanzas que no habían sido
publicadas y los ajustes visuales/offline de la versión 1.2.8.49.

## Despliegue

1. Despliega servidor y frontend desde `feature/mis-finanzas-1.2.8.49`.
2. Ejecuta una sola vez y en este orden:
   - `migrations/20260920_mis_finanzas_privadas.sql`
   - `migrations/20260920_finanzas_tarjetas_programadas.sql`
3. Instala la aplicación Android 1.2.8.49 (`versionCode 66`).

## Funcionamiento de tarjetas

- Una tarjeta de débito se registra como cuenta bancaria: descuenta el saldo de
  esa misma cuenta cuando el método es **Tarjeta de débito**.
- Una tarjeta de crédito se registra como cuenta independiente. Cada compra
  aumenta su deuda; para pagarla se registra una transferencia desde efectivo o
  una cuenta bancaria hacia la tarjeta.
- En **Programados** se pueden guardar pagos e ingresos únicos, semanales,
  quincenales, mensuales o anuales. Al llegar la fecha aparece **Aplicar pago** o
  **Aplicar ingreso**, también sin conexión.

## Nota sobre enlaces públicos offline

La creación se conserva en la cola local, pero el enlace queda bloqueado hasta
sincronizar. Esto evita compartir una ficha vacía: el servidor necesita recibir
el token antes de poder mostrarla públicamente.
