# SGB 2 con la interfaz de La Fortuna

La rama `feature/sgb-v2-interfaz` conserva el frontend anterior y su apariencia.
El punto de entrada `frontend/src/main.tsx` monta la integración SGB 2 por
defecto. El código anterior queda disponible en esta rama como referencia y
`main` no cambia.

## Arquitectura

| Pieza | Origen |
| --- | --- |
| Diseño, barra lateral, búsqueda y listado de animales | `lafortuna/frontend` |
| Sesión, permisos y propiedad activa | API nueva de `SGB` |
| Paneles y llamadas ganaderas ya implementados | `SGB/apps/web` adaptados en `frontend/src/sgb-v2` |
| Datos y migraciones | PostgreSQL nuevo, esquema de `SGB/database/migrations` |

El servidor anterior no se despliega en esta configuración. Sus tablas `usuario`,
`animal.id_animal` y `propiedad_ganadera` no corresponden al esquema nuevo.
Tampoco se utiliza su caché ni su cola offline con la API nueva; al integrar
sincronización móvil habrá que diseñar su contrato y pruebas específicos.

## Despliegue de la vista previa

Configurar `montes.onrender.com` como Static Site del repositorio `lafortuna`,
rama `feature/sgb-v2-interfaz`, directorio raíz `frontend`, comando de compilación
`npm ci && npm run build` y directorio público `dist`. Configurar:

```text
VITE_API_URL=https://appsgb.onrender.com
```

La API debe permitir `https://montes.onrender.com` como `FRONTEND_URL` y usar una
cookie de renovación válida para ese origen. El migrador de SGB aplica los SQL
versionados; no se pegan migraciones manualmente. Montes es el entorno de prueba
autorizado para esta integración todavía parcial; comprobar allí el inicio de
sesión y las operaciones habilitadas con una cuenta de prueba. El sitio anterior
`medranda.onrender.com` sigue en `main`.

## Estado de integración

| Área | Estado |
| --- | --- |
| Acceso, registro, verificación por enlace y recuperación | Integrado con la API nueva; falta prueba en Render |
| Propiedad activa, rol, visibilidad del menú | Integrado |
| Animales | Listado, filtros y vista de ficha con el diseño anterior; edición y creación mediante el panel de SGB 2 |
| Grupos, potreros, corrales | Listas, búsqueda, filtros, detalles y formularios separados con la presentación anterior; datos de la API nueva |
| Movimientos | Listado, búsqueda, filtros de orden y acceso a detalles con el diseño anterior; las asignaciones de ubicación se gestionan solo aquí |
| Pesajes | Pantalla, filtros, ficha, registro y anulación integrados; requieren la migración y API de la rama `feature/sgb-v2-pesajes` del repositorio `SGB` |
| Auditoría | Tabla, filtros, paginación y detalles con el diseño anterior; requiere la ruta `/audit` en la rama `feature/sgb-v2-pesajes` de `SGB` |
| Reproducción | Lista, filtros, detalle y formularios separados con la presentación anterior y la API nueva |
| Producción | Pestañas, resumen diario, lactancias, búsqueda, detalles y formularios separados con la presentación anterior y la API nueva |
| Sanidad, limpiezas | Conectados a los paneles y API nueva; resta adaptar sus vistas originales |
| Actividades | Lista, filtros, detalle, edición separada y fotografías con la presentación anterior y la API nueva |
| Multimedia, catálogos, equipo, configuración, superadministración | Conectados a los paneles y API nueva |
| Historial y acciones adicionales de la ficha antigua | Pendientes de trasladar al modelo nuevo |
| Bajas, ventas, compras, agenda, finanzas y notificaciones | Pantallas antiguas presentes como referencia; faltan entidades y rutas equivalentes en la API nueva |
| Android y sincronización sin conexión | Pendiente de un contrato con la API nueva |

No habilitar pantallas del sistema anterior que todavía enviarían datos al
servidor antiguo ni señalar esos módulos como terminados. Integrar cada área
desde sus entidades y permisos en SGB antes de desplegarla para usuarios.
