# Actualización de reproducción, fierros y panel

## Migraciones requeridas

Ejecuta una sola vez sobre la base de datos de Aiven y en este orden:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/20260811_marquillas.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/20260812_reproduccion_fierros_panel.sql
```

Si la migración `20260811_marquillas.sql` ya fue ejecutada, aplica únicamente la segunda. Ambas usan transacciones y no eliminan animales, fotografías ni registros anteriores.

## Cambios incluidos

- El catálogo ahora presenta las marquillas como **fierros** y permite relacionar cada fierro con uno o varios usuarios.
- Las fotografías de los fierros se procesan en formato 4:3 y aparecen en tamaño reducido dentro de la ficha del animal.
- La edad del animal se calcula en años, meses y días sin alterar la fecha elegida.
- Solo pueden seleccionarse como padres los machos activos de la misma especie, con al menos un año o sin fecha de nacimiento.
- Se incorporan los registros de celo, confirmación de preñez y próximos partos.
- El cálculo bovino usa 283 días de gestación. Cuando la preñez nace de un celo, la fecha tentativa se calcula desde el inicio del celo. Sin una fecha estimable, el próximo parto permanece visible sin fecha tentativa.
- Los partos nuevos solo pueden registrarse desde una preñez confirmada y pendiente.
- Multimedia muestra arriba de cada archivo el primer animal relacionado y deja de usar comentarios como título.
- El panel de inicio puede personalizarse por usuario para escoger las tarjetas visibles.

## Orden recomendado de despliegue

1. Ejecutar las migraciones en Aiven.
2. Desplegar el backend actualizado.
3. Desplegar el frontend actualizado.
4. Probar el flujo `Celo → Preñez → Próximo parto → Parto` con un registro de prueba.

