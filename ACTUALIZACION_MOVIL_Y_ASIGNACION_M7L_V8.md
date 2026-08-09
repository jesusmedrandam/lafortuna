# Actualización móvil y asignación M7L — versión 8

## Diferencia entre condición y situación de propiedad

- **Condición del animal**: activo, inactivo, vendido, trasladado, desaparecido o muerto.
- **Situación de propiedad**: animales en propiedad o fuera de propiedad.

`Inactivo` no se reemplaza en la base por `Fuera de propiedad`, porque un animal puede estar activo y encontrarse temporalmente en otra finca. Las situaciones de propiedad se administran desde `Catálogos → Categorías de animales`.

## Correcciones móviles

- Clasificación y edad ya no ocupan la misma fila en el listado de animales.
- Las métricas del panel usan dos columnas en celulares y una columna en pantallas especialmente estrechas.
- Los filtros principales se redujeron a sexo, propietario y situación de propiedad.
- La condición, el grupo, la especie y los demás criterios permanecen en filtros avanzados.

## Asignación masiva

Después de ejecutar las migraciones `20260811`, `20260812` y `20260813`, ejecuta:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/20260814_asignar_m7l_y_categoria_en_propiedad.sql
```

Este script:

- reutiliza el fierro M7L existente y conserva su fotografía;
- crea M7L si todavía no existe;
- lo relaciona con los propietarios actuales;
- asigna M7L a todos los animales no eliminados;
- asigna a esos animales la categoría `Animales en propiedad`;
- no modifica si están activos, vendidos, muertos u otra condición.

