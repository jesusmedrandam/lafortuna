# SGB · Sistema de Gestión Bovina — servidor

Servidor modular para la nueva base de datos. El nombre visible es **SGB · Sistema de Gestión Bovina**. Todas las rutas se publican bajo `/api`.

## Instalación

```bash
npm install
cp .env.example .env
npm run bootstrap:admin
npm run dev
```

Antes de ejecutar `bootstrap:admin`, configura la nueva `DATABASE_URL`, las dos claves JWT y las variables `BOOTSTRAP_ADMIN_*`.

## Rutas principales

- `GET /health`
- `POST /api/auth/register`, `verify-email`, `login`, `refresh`, `logout`, `forgot-password`, `reset-password`
- `GET|PATCH /api/auth/me`
- `GET /api/versiones`
- `GET /api/dashboard/resumen`
- CRUD `/api/animales`, `/api/grupos`, `/api/ubicaciones`
- Categorías de animales y ubicaciones externas mediante `/api/catalogos/categorias-animales` y `/api/ubicaciones`
- Fierros con varios usuarios y fotografía 4:3 `/api/marquillas`
- CRUD compuesto `/api/potreros`, `/api/corrales`
- Multimedia `/api/animales/:id/imagenes`, `/api/imagenes` y `/api/imagenes/:id`
- Selección previa `/api/selecciones/animales/preview`
- Movimientos `/api/movimientos`
- Jornadas colectivas `/api/jornadas-sanitarias`
- Limpiezas `/api/limpiezas-potrero`
- Reproducción `/api/reproduccion/{celos|preneces|proximos-partos}` y partos `/api/partos`
- Registros simples `/api/registros/{abortos|lactancias|producciones|pesajes|muertes|tratamientos}`
- Política configurable de operaciones por categoría `/api/configuracion/operaciones-animales`
- Administración `/api/usuarios`, `/api/roles`, `/api/auditoria`

## Caché

La clave de caché incorpora la versión de `version_datos`. Los triggers de PostgreSQL incrementan la versión cuando hay cambios; por tanto, las respuestas antiguas dejan de utilizarse automáticamente. Si `REDIS_URL` no está configurada, se usa una caché de memoria para desarrollo.

## Multimedia

El navegador envía `multipart/form-data` con el archivo en el campo `archivo` (se conserva compatibilidad con `imagen`). El servidor acepta fotos y videos, valida su tamaño, los sube a Cloudinary y almacena en PostgreSQL únicamente URL, `public_id` y metadatos. Una misma foto o video puede relacionarse con varios animales; las fotos de perfil permanecen individuales. La clave privada de Cloudinary nunca se envía al frontend. El límite general se controla con `MAX_MEDIA_MB` (40 MB por defecto).

## Render

El archivo `render.yaml` crea el Web Service. Configura manualmente las variables sensibles. La ruta de salud es `/health`.

## Observaciones

- El proyecto apunta exclusivamente a la base nueva.
- El sistema anterior no necesita cambios.
- Para la versión 8 consulta `ACTUALIZACION_MOVIL_Y_ASIGNACION_M7L_V8.md` y aplica las migraciones indicadas antes de desplegar.
- Antes de producción conviene ejecutar pruebas de integración contra una copia de la base.
- Para la versión 12 aplica `migrations/20260816_trazabilidad_condicion_y_costos_limpieza.sql` después de las migraciones anteriores.
- Para la versión 13 aplica `migrations/20260817_grupos_politicas_operaciones.sql` después de la migración de la versión 12.
- Para la versión 14 aplica `migrations/20260818_grupo_ubicacion_consistente.sql` después de la migración de la versión 13.
- Para la versión 15 aplica `migrations/20260819_motivos_movimiento_y_consumo_limpieza.sql` después de la migración de la versión 14.
- Para la versión 16 aplica `migrations/20260820_propiedades_externas_estructuradas.sql` después de la migración de la versión 15.
- La versión 17 no requiere una migración adicional; utiliza la estructura creada por `20260820_propiedades_externas_estructuradas.sql`.
- La versión 18 no requiere una migración adicional; corrige el alta de grupos y mejora los mensajes de error de PostgreSQL.
