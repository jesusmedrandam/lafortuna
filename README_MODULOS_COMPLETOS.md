# M&M Ganadería — sistema completo

Repositorio monorepo con la API en la raíz y la aplicación web en `frontend/`.

## Módulos web

- Animales, fotografías y pesajes.
- Grupos y ubicaciones.
- Potreros, corrales y limpiezas.
- Movimientos colectivos con selección masiva y excepciones.
- Jornadas sanitarias y tratamientos individuales.
- Partos, crías y abortos.
- Lactancias y producción de leche.
- Muertes y bajas.
- Catálogos, usuarios, roles, permisos y auditoría.

Las cuentas registradas públicamente se crean sin roles. Un administrador debe asignarles acceso.

## Estructura

```text
src/          API Node/Express/TypeScript
frontend/     React/Vite/TypeScript
```

## Despliegue

### API

```text
Build: npm install && npm run build
Start: npm start
```

### Sitio estático

```text
Root Directory: frontend
Build: npm install && npm run build
Publish Directory: dist
```

La aplicación web utiliza `VITE_API_URL=https://lafortuna.onrender.com/api`.
