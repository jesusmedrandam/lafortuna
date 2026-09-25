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

`montes.onrender.com` es un Static Site del repositorio `lafortuna`, rama
`feature/sgb-v2-interfaz`, sin directorio raíz adicional, con comando de
compilación `cd frontend && npm ci && npm run build` y directorio público
`frontend/dist`. El frontend usa por defecto `https://appsgb.onrender.com`
en producción; también admite la variable explícita:

```text
VITE_API_URL=https://appsgb.onrender.com
```

La API debe permitir `https://montes.onrender.com` como `FRONTEND_URL` y usar una
cookie de renovación válida para ese origen. El migrador de SGB aplica los SQL
versionados; no se pegan migraciones manualmente. Montes es el entorno de prueba
autorizado para esta integración todavía parcial; comprobar allí el inicio de
sesión y las operaciones habilitadas con una cuenta de prueba. El sitio anterior
`medranda.onrender.com` sigue en `main`. En Render, `appsgb.onrender.com`
se despliega desde `SGB/feature/sgb-v2-pesajes`, que contiene las rutas de
Auditoría y Pesajes y aplicó automáticamente la migración `0025`.

## Estado de integración

| Área | Estado |
| --- | --- |
| Acceso, registro, verificación por enlace y recuperación | Integrado con la API nueva; falta prueba en Render |
| Propiedad activa, rol, visibilidad del menú | Integrado |
| Animales | Listado, filtros y vista de ficha con el diseño anterior; edición y creación mediante el panel de SGB 2 |
| Grupos, potreros, corrales | Listas, búsqueda, filtros, detalles y formularios separados con la presentación anterior; datos de la API nueva |
| Movimientos | Listado, búsqueda, filtros de orden y acceso a detalles con el diseño anterior; las asignaciones de ubicación se gestionan solo aquí |
| Pesajes | Pantalla, filtros, ficha, registro y anulación integrados; API y migración desplegadas, pendiente prueba con módulo habilitado |
| Auditoría | Tabla, filtros, paginación y detalles con el diseño anterior; ruta `/audit` desplegada, pendiente prueba autenticada |
| Reproducción | Lista, filtros, detalle y formularios separados con la presentación anterior y la API nueva |
| Producción | Pestañas, resumen diario, lactancias, búsqueda, detalles y formularios separados con la presentación anterior y la API nueva |
| Sanidad | Conectada a la API nueva; conserva el listado compacto y los detalles separados, quedan ajustes visuales |
| Limpiezas | Lista y filtros con el diseño anterior, detalle y edición separados; fotografías conectadas a la API nueva |
| Actividades | Lista, filtros, detalle, edición separada y fotografías con la presentación anterior y la API nueva |
| Multimedia, catálogos, equipo, configuración, superadministración | Conectados a los paneles y API nueva |
| Historial y acciones adicionales de la ficha antigua | Pendientes de trasladar al modelo nuevo |
| Bajas, ventas, compras, agenda, finanzas y notificaciones | Pantallas antiguas presentes como referencia; faltan entidades y rutas equivalentes en la API nueva |
| Android y sincronización sin conexión | Pendiente de un contrato con la API nueva |

No habilitar pantallas del sistema anterior que todavía enviarían datos al
servidor antiguo ni señalar esos módulos como terminados. Integrar cada área
desde sus entidades y permisos en SGB antes de desplegarla para usuarios.
