# Actualización de fechas, compradores y multimedia

## Migración requerida

Después de desplegar el backend y antes de usar Multimedia, ejecuta una sola vez sobre Aiven:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/20260810_multimedia_animales.sql
```

La migración no borra ni duplica archivos. Conserva `animal_imagen` y crea la relación muchos-a-muchos con los animales. Todas las fotografías existentes quedan enlazadas automáticamente con su animal original.

## Cambios incluidos

- Selector visual de calendario para fechas y fecha/hora.
- Corrección del día anterior en fecha de nacimiento e ingreso.
- Catálogo de compradores sin respuestas antiguas de caché.
- Fotos y videos relacionados con uno o varios animales.
- Fotografías de partos relacionadas automáticamente con madre y cría.
- Pantalla Multimedia con búsqueda por animal/arete y filtros por tipo, animal, grupo, ubicación, sexo y fechas.
- Edición posterior de los animales relacionados con cada archivo.

## Configuración opcional

Para cambiar el máximo permitido por foto o video agrega en Render:

```env
MAX_MEDIA_MB=40
```

Si no se configura, se utilizarán 40 MB.
