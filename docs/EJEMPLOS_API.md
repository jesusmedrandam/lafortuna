# Ejemplos de solicitudes

## Crear potrero

```json
POST /api/potreros
{
  "ubicacion": { "nombre": "Potrero El Mango", "codigo": "P-01", "descripcion": "Zona norte" },
  "area": 3.5,
  "id_unidad_area": "UUID-HA",
  "id_tipo_uso_potrero": "UUID-PASTOREO",
  "capacidad_estimada": 18,
  "disponibilidad_agua": true,
  "pastos": [
    { "id_tipo_pasto": "UUID-SABOYA", "porcentaje_estimado": 70 },
    { "id_tipo_pasto": "UUID-MOMBAZA", "porcentaje_estimado": 30 }
  ]
}
```

## Vista previa de un grupo

```json
POST /api/selecciones/animales/preview
{ "modo": "GRUPO", "id_grupo": "UUID-GRUPO", "ids": [], "filtros": {} }
```

## Crear movimiento con una excepción desmarcada

```json
POST /api/movimientos
{
  "modo_seleccion": "GRUPO",
  "id_grupo_filtro": "UUID-GRUPO",
  "id_ubicacion_destino": "UUID-POTRERO",
  "fecha_movimiento": "2026-08-02T18:00:00-05:00",
  "motivo": "Rotación de potrero",
  "animales": [
    { "id_animal": "UUID-1", "seleccionado": true },
    { "id_animal": "UUID-2", "seleccionado": false, "observaciones": "Permanece en observación" }
  ]
}
```

Después se confirma con `POST /api/movimientos/{id}/aplicar`.

## Subir foto

Enviar `multipart/form-data` a `POST /api/animales/{id}/imagenes`:

- `imagen`: archivo
- `es_perfil`: `true` o `false`
- `descripcion`: texto opcional
