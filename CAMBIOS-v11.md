# Cambios de la versión 11

## Identidad SGB

- Logo SGB completo y transparente en la pantalla de acceso y en el encabezado del Panel.
- Logo compacto SGB en la barra lateral, pantalla de carga y favicon.
- Variante con fondo blanco conservada en `frontend/public/branding/logo-sgb-print.jpg` para impresión o documentos.
- Textos principales actualizados a “SGB · Sistema de Gestión Bovina”.

## Movimientos

- El botón Editar ahora aparece en movimientos Borrador y Completados.
- En Borrador se pueden modificar destino, selección de animales, fecha, motivo y observaciones.
- En movimientos aplicados se pueden corregir fecha, motivo y observaciones.
- Origen, destino y animales de un movimiento aplicado se mantienen protegidos para conservar la auditoría.
- Los movimientos cancelados permanecen inmutables.

## Potreros

- El listado ahora devuelve el estado y tiempo de ocupación calculados desde el historial.
- Filtros por Ocupado o En descanso.
- Rangos mínimo y máximo de días de ocupación.
- Rangos mínimo y máximo de días de descanso.
- Cada fila muestra los días en el estado actual.

## Reproducción y Partos

- Búsqueda y orden en Celos, Preñeces, Próximos partos, Partos y Abortos.
- Partos reorganizados como lista compacta con madre, fecha, padre, crías, tipo y acciones.
- Miniatura de la primera cría cuando existe una fotografía.
- Detalle del parto con datos generales y todas las crías.
- Edición segura de fecha, tipo de parto y observaciones sin alterar vínculos históricos.

## Verificación

- Backend compilado con TypeScript.
- Frontend compilado y generado con Vite.
- No requiere una migración adicional de base de datos respecto de v10.
