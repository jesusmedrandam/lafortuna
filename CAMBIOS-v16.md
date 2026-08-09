# SGB v16 · Propiedades, grupos y movimientos consistentes

## Nuevo modelo de propiedades

- Se incorpora un catálogo propio de propiedades ganaderas.
- Cada grupo pertenece obligatoriamente a una propiedad.
- Cada potrero o corral pertenece obligatoriamente a una propiedad.
- Solo una propiedad puede ser principal o favorita.
- Lactancias y ordeño se habilitan únicamente para animales de la propiedad principal.
- La clasificación técnica `EN_PROPIEDAD` o `FUERA_PROPIEDAD` se conserva para compatibilidad, pero ahora se calcula automáticamente y ya no se administra desde la interfaz.

## Reglas de movimiento

### Cambiar de potrero o corral

1. Se selecciona la propiedad.
2. Se selecciona un grupo completo.
3. Se selecciona otro potrero o corral de la misma propiedad.
4. El lugar actual no aparece entre los destinos.
5. Todos los animales activos del grupo se trasladan juntos y el grupo conserva su identidad.

### Cambiar de grupo

1. Se selecciona la propiedad y los animales concretos.
2. Se selecciona el grupo de destino dentro de esa misma propiedad.
3. El potrero o corral se obtiene automáticamente del grupo de destino.

### Trasladar a otra propiedad

1. Se seleccionan propiedades de origen y destino diferentes.
2. La selección de animales se limita a la propiedad de origen y puede abarcar todos, un grupo o una selección manual.
3. Se exige un grupo de la propiedad de destino.
4. El potrero o corral se obtiene automáticamente del grupo de destino.

Las mismas reglas se vuelven a validar en el servidor antes de guardar la selección y antes de aplicar el movimiento. Esto evita traslados parciales de grupos, destinos de otra propiedad y animales que ya no pertenecen al origen.

## Formularios relacionados

- Al crear un animal, la propiedad filtra los grupos disponibles y el grupo define automáticamente su potrero o corral.
- La ubicación sigue sin poder cambiarse desde **Editar animal**.
- Al registrar una cría desde partos, solo aparecen grupos de la propiedad de la madre y el lugar se asigna desde el grupo elegido.
- Potreros, corrales y grupos incluyen la propiedad en sus formularios y listados.
- La pantalla de propiedades permite crear, editar y elegir la propiedad principal.

## Migración requerida

Ejecutar después de las migraciones 17, 18 y 19:

```sql
migrations/20260820_propiedades_y_movimientos_consistentes.sql
```

La migración convierte las antiguas ubicaciones externas en propiedades, crea una propiedad principal determinística para los potreros y corrales existentes, agrega las relaciones obligatorias y sincroniza la clasificación técnica.

## Validación realizada

- Backend: `npm run build`
- Frontend: `npm run build`

Ambas compilaciones finalizaron correctamente.
