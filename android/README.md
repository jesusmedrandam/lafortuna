# SGB para Android

Aplicación Android de SGB con identificador `com.jdmedranda.sgb`.

## Enfoque sin conexión

- La interfaz lee primero IndexedDB, separada por usuario, propiedad y rol.
- Cada escritura se proyecta localmente antes de llamar a la API.
- Las escrituras pendientes se sincronizan en orden FIFO con una clave de idempotencia.
- La cola se refleja también en almacenamiento privado de Android; WorkManager puede enviarla
  cuando la actividad está en segundo plano y vuelve la conexión.
- El APK incluye una copia compilada de toda la interfaz. La pantalla abre desde esos recursos
  locales con el origen seguro de la aplicación web, aunque Render o internet no estén disponibles.
- Los GET usan revalidación HTTP/ETag para evitar volver a descargar respuestas sin cambios.

## Compilación

```bash
cd ../frontend
npm ci
npm run build
cd ../android
./gradlew :app:assembleDebug
```

El APK se genera en `app/build/outputs/apk/debug/app-debug.apk`. La URL web puede cambiarse sin
editar código:

```bash
./gradlew :app:assembleDebug -PSGB_WEB_APP_URL=https://ejemplo.com
```

No se reutiliza el `google-services.json` de la aplicación anterior porque corresponde a otro
identificador. Firebase se habilitará únicamente con una configuración emitida para
`com.jdmedranda.sgb`.
