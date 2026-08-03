# M&M Ganadería — Frontend web

Frontend de la nueva base y del servidor desplegado en:

```text
https://lafortuna.onrender.com/api
```

Está desarrollado con React, Vite y TypeScript. El nombre visible es **M&M Ganadería** y el nombre técnico del proyecto es `mm-ganaderia-frontend`.

## Funciones incluidas en esta entrega

- Inicio de sesión con renovación automática del token.
- Registro, activación por código y recuperación de contraseña mediante Brevo.
- Panel principal con tarjetas que abren el módulo correspondiente.
- Menú dinámico según roles y permisos del servidor.
- Edición del perfil del usuario.
- Animales:
  - listado, búsqueda, filtros y paginación;
  - creación, edición y eliminación lógica;
  - especie, origen, grupo, ubicación, genealogía, razas y colores;
  - foto de perfil y galería mediante el endpoint de Cloudinary.
- Grupos:
  - creación, edición, búsqueda y eliminación lógica.
- Ubicaciones generales.
- Potreros:
  - nombre, área, uso, capacidad, agua y descanso;
  - uno o varios tipos de pasto.
- Corrales:
  - tipo, área, capacidad, piso, cubierta y agua.
- Caché de catálogos mediante `ETag`.
- Consulta periódica de `/api/versiones` para invalidar únicamente los datos que hayan cambiado.
- Diseño adaptable a celular, tableta y computador.

Los módulos de movimientos colectivos, sanidad, limpieza de potreros, partos, producción, catálogos y administración ya aparecen en la navegación cuando el usuario tiene permiso, pero sus formularios avanzados se incorporarán en la siguiente entrega.

## Ejecutar localmente

Requisitos:

```text
Node.js 22.12 o superior
```

Instala las dependencias:

```bash
npm install
```

Copia la plantilla de entorno:

```bash
cp .env.example .env
```

En Windows puedes copiar `.env.example`, pegarlo en la misma carpeta y cambiar el nombre a `.env`.

Contenido:

```env
VITE_API_URL=https://lafortuna.onrender.com/api
VITE_APP_NAME=M&M Ganadería
```

Inicia el proyecto:

```bash
npm run dev
```

Abre:

```text
http://localhost:5173
```

## Comprobar la compilación

```bash
npm run build
```

El resultado se genera en:

```text
dist/
```

## Subir a GitHub

Sube todos estos archivos y carpetas:

```text
public/
src/
.env.example
.env.production
.gitignore
index.html
package.json
tsconfig.app.json
tsconfig.json
tsconfig.node.json
vite.config.ts
README.md
```

No subas:

```text
node_modules/
dist/
.env
```

## Publicar manualmente en Render

En Render selecciona:

```text
New → Static Site
```

Configura:

```text
Build Command:
npm install && npm run build

Publish Directory:
dist
```

Agrega la variable de entorno:

```text
VITE_API_URL = https://lafortuna.onrender.com/api
```

En **Redirects/Rewrites** agrega una regla para que las rutas internas de React funcionen al recargar:

```text
Source:      /*
Destination: /index.html
Action:      Rewrite
```

Cuando Render te entregue la dirección del frontend, por ejemplo:

```text
https://mm-ganaderia.onrender.com
```

entra al Web Service `lafortuna` y cambia la variable:

```text
FRONTEND_URL=https://mm-ganaderia.onrender.com,http://localhost:5173
```

Guarda los cambios para que el servidor permita las solicitudes CORS provenientes del nuevo frontend.

## Cloudinary

Para subir fotografías, el servidor debe tener configuradas estas variables:

```text
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
CLOUDINARY_FOLDER
```

El navegador envía la fotografía al servidor. La clave secreta de Cloudinary nunca se incluye en este proyecto frontend.

## Brevo

El registro, activación y recuperación utilizan el servidor. En el frontend no se coloca ninguna clave de Brevo. Las variables permanecen únicamente en Render:

```text
BREVO_API_KEY
BREVO_SENDER_EMAIL
BREVO_SENDER_NAME
```

## Nota de seguridad

La API actual entrega tokens en JSON, por lo que esta primera versión los conserva en el almacenamiento local del navegador. En una etapa posterior puede migrarse el `refreshToken` a una cookie `HttpOnly` para reforzar la protección frente a código inyectado en el navegador.
