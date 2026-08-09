# Actualización v9: condiciones del animal administrables

## Qué cambia

- Se agregó **Catálogos → Condiciones del animal**.
- Los formularios y filtros de animales ya no contienen una lista fija.
- Se pueden crear, editar y desactivar condiciones personalizadas.
- Las condiciones principales `ACTIVO`, `INACTIVO`, `VENDIDO`, `TRASLADADO`, `DESAPARECIDO` y `MUERTO` conservan sus códigos porque son utilizadas por reglas del sistema.
- **En propiedad/Fuera de propiedad** continúa en **Categorías de animales** y no se mezcla con la condición operativa.

## Migración requerida

Ejecutar primero:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/20260815_condiciones_animales_catalogo.sql
```

Después se despliegan normalmente el backend y el frontend incluidos en esta versión.
