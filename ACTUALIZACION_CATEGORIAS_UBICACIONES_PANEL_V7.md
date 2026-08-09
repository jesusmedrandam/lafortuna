# Actualización de categorías, ubicaciones y panel — versión 7

## Migraciones requeridas

Los archivos están incluidos en la carpeta `migrations` de este proyecto. Ejecútalos una sola vez sobre Aiven, en este orden:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/20260811_marquillas.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/20260812_reproduccion_fierros_panel.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/20260813_categorias_ubicaciones_panel.sql
```

Si las dos primeras ya fueron aplicadas correctamente, ejecuta únicamente `20260813_categorias_ubicaciones_panel.sql`.

## Cambios incluidos

- Nuevo catálogo **Categorías de animales**, con los valores iniciales `Animales en propiedad` y `Animales fuera de propiedad`.
- Nueva pantalla **Otras propiedades** para registrar fincas, terrenos o ubicaciones que no son potreros ni corrales.
- Cada animal y ubicación queda asociado a una categoría. El servidor impide asignar al animal una ubicación de una categoría diferente.
- Los traslados actualizan automáticamente la categoría del animal según la ubicación de destino.
- En el listado de animales, el propietario reemplaza a la especie entre los filtros principales. La especie continúa disponible en la búsqueda avanzada.
- El botón de filtros avanzados tiene un estado visual más visible.
- El detalle del animal muestra el código del fierro y una miniatura a la altura del texto; al pulsarla se abre la imagen completa.
- El panel se organiza por módulos: animales, ingresos, ventas, producción, tratamientos, traslados, potreros, grupos, reproducción y sexo.
- Cada usuario puede escoger qué módulos mostrar y qué métricas internas desea ver en cada tarjeta.

## Orden recomendado de despliegue

1. Crear una copia de seguridad de la base de datos.
2. Ejecutar las migraciones pendientes en Aiven.
3. Desplegar el backend y frontend de esta versión.
4. Registrar una ubicación de prueba desde `Catálogos → Categorías de animales → Otras propiedades`.
5. Asignar un animal a esa ubicación y verificar el panel personalizado.

