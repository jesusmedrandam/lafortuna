# Parche 1.2.8.5 — corrección de movimientos, push y riesgo de garrapata

## Qué incorpora

Las notificaciones se crean dentro de la misma transacción del evento. Si el registro falla, el aviso tampoco se guarda. Los destinatarios se determinan por el permiso de consulta correspondiente; los administradores también se incluyen. Cada evento solicita el despacho push inmediatamente después de guardarse y además queda en el buzón. La clave de deduplicación evita que un reintento u otro ciclo del trabajador repita el mismo aviso.

Eventos inmediatos:

- partos, abortos, celos y preñeces confirmadas;
- muertes, pesajes y condiciones de salud;
- tratamientos individuales y jornadas sanitarias aplicadas;
- ventas de animales, ventas de productos y compras;
- movimientos aplicados;
- limpiezas de potreros y otras actividades;
- inicio de lactancias y mediciones del tanque de leche.

Alertas calculadas automáticamente:

- partos estimados a 14, 7 y 2 días, y partos estimados atrasados;
- cumpleaños de animales;
- tratamientos próximos, programados para hoy o atrasados;
- variación de al menos 20 % en la producción diaria frente al promedio de los siete días anteriores que tengan registros;
- potreros con 60 días o más desde la última limpieza completada, o sin limpieza registrada.

No se envía un aviso por cada medición individual de leche porque eso saturaría el buzón durante el ordeño. Se notifica la medición del tanque y la variación diaria calculada.

## Regla preventiva para garrapatas

Solamente al aplicar un movimiento de tipo `UBICACION` (cambio de potrero del grupo completo), el servidor calcula cuántos días estuvo sin animales antes del ingreso y genera un segundo aviso. Un movimiento `GRUPO` no ejecuta este cálculo: uno o varios animales se integran al grupo destino y adoptan el potrero que ese grupo ya ocupa.

- **fase previa a la eclosión:** entre 0 y 20 días; las larvas probablemente aún no emergieron, pero pueden permanecer huevos que eclosionen después del ingreso;
- **alto:** entre 21 y 44 días, ventana en la que pueden comenzar a aparecer larvas, o cuando no existe historial suficiente;
- **moderado:** entre 45 y 99 días; la carga puede reducirse, aunque aún pueden persistir larvas;
- **reducido:** descansó 100 días o más.

“Riesgo reducido” no significa libre de garrapatas. La aplicación no receta medicamentos ni reemplaza la inspección de los animales o el criterio del médico veterinario.

La regla es deliberadamente conservadora. En Ecuador continental, *Rhipicephalus microplus* y *Amblyomma cajennense* s.l. figuran entre las principales garrapatas del ganado. En condiciones tropicales cálidas y húmedas estudiadas para *R. microplus*, la fase parasitaria fue cercana a 21 días, la etapa previa a la eclosión alrededor de 39–41 días, la supervivencia larvaria media alrededor de 54–56 días y los picos generacionales aparecieron aproximadamente cada 62–68 días. Un trabajo de pastoreo rotacional en trópico húmedo encontró menor carga con 45 días de descanso que con 30 días. Como las larvas pueden persistir bastante más en determinados microhábitats, se conserva un margen de 100 días antes de denominar el riesgo “reducido”.

Fuentes:

- Distribución de garrapatas bovinas en Ecuador (2024): https://pubmed.ncbi.nlm.nih.gov/38388882/
- Dinámica de *R. microplus* en ambiente tropical cálido-húmedo (2024): https://link.springer.com/article/10.1186/s13071-024-06220-w
- Pastoreo rotacional de 30 frente a 45 días en trópico húmedo: https://pmc.ncbi.nlm.nih.gov/articles/PMC11496573/
- Persistencia ambiental observada en campo por USDA ARS: https://www.ars.usda.gov/research/project/?accnNo=436694&fy=2024

No se encontró una medición publicada que establezca un número único y exacto para todos los potreros de la Costa ecuatoriana. La temperatura, humedad, sombra, cobertura vegetal, carga animal y especie de garrapata cambian mucho la supervivencia. Por eso 45 y 100 días son umbrales operativos preventivos y configurables, no la afirmación de que exista un ciclo costero fijo.

## Instalación

1. Subir los archivos respetando exactamente sus carpetas. Los archivos de `src` deben quedar dentro de `src`; no deben copiarse en la raíz del repositorio.
2. Confirmar los cambios y esperar el despliegue automático de Render.
3. No se necesita ejecutar una migración SQL nueva. Este parche utiliza las tablas de notificaciones que ya funcionan en la instalación 1.2.8.3.
4. No se necesitan secretos adicionales de Firebase.

Los valores predeterminados funcionan sin agregar variables. Solo si se desea ajustar la política, pueden definirse en Render:

```text
TICK_MINIMUM_REST_DAYS=45
TICK_EARLIEST_HATCH_DAYS=21
TICK_REDUCED_RISK_DAYS=100
CLEANING_ALERT_DAYS=60
PRODUCTION_VARIATION_ALERT_PERCENT=20
CALCULATED_ALERT_INTERVAL_MS=3600000
```

Después de cambiar estas variables se debe redeplegar el servicio.

## Comprobación recomendada

1. Registrar una compra o un pesaje y comprobar el aviso del evento.
2. Crear y aplicar un cambio de potrero. Deben aparecer dos avisos: movimiento aplicado y evaluación de garrapatas.
3. Abrir el aviso de riesgo y verificar que el número de días coincida con el historial de ocupación del potrero.
4. Registrar una medición de tanque y comprobar el aviso de producción.
5. Revisar `VERIFICAR_NOTIFICACIONES_EVENTOS.sql` en la base de datos para confirmar destinatarios y estado de entrega push.

Las alertas calculadas se revisan al iniciar el servidor y luego cada hora. Sus claves de deduplicación impiden que un reinicio de Render las repita.
