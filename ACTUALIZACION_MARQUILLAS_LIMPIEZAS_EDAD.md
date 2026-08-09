# Actualización de marquillas, limpiezas y edad

## Migración requerida

Ejecuta una sola vez sobre la base de datos de Aiven:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/20260811_marquillas.sql
```

Esta migración crea el catálogo de marquillas y agrega la relación opcional al animal. No modifica los animales existentes.

## Cambios incluidos

- Catálogo independiente de marquillas con usuario propietario, código, nombre, descripción y fotografía.
- El mismo código de marquilla puede registrarse para usuarios diferentes.
- Selección de marquilla al crear o editar un animal.
- Edad calculada automáticamente desde la fecha de nacimiento.
- Listado móvil de animales más compacto y con edad en lugar de peso.
- Limpiezas en formato de listado compacto y ficha detallada al abrir.
- Multimedia muestra los nombres de los animales como título.
- Eliminación del texto informativo sobre unidades en ventas.
