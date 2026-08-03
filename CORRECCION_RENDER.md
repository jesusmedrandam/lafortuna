# Corrección para Render

Esta corrección resuelve dos problemas:

1. Express 5 tipa los parámetros de ruta como `string | string[]`. Se agregó `src/core/route-param.ts` y se normalizaron los parámetros antes de utilizarlos.
2. TypeScript ahora compila `src/server.ts` directamente como `dist/server.js`.

## Render

- Build Command: `npm install && npm run build`
- Start Command: `npm start`

Después de subir estos archivos a GitHub, usa **Manual Deploy → Clear build cache & deploy**.
