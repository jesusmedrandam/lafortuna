import { app } from './app.js';
import { env } from './config/env.js';
import { pingDatabase, pool } from './database/pool.js';
import { cache } from './services/cache.service.js';
import { startNotificationPushWorker } from './modules/notifications/notifications.push.js';
import { startCalculatedNotificationWorker } from './modules/notifications/calculated-notifications.service.js';
async function start(){await pingDatabase();await cache.connect();const stopPushWorker=startNotificationPushWorker();const stopCalculatedWorker=startCalculatedNotificationWorker();const server=app.listen(env.PORT,()=>console.log(`${env.APP_NAME} API escuchando en puerto ${env.PORT} bajo ${env.API_PREFIX}`));const shutdown=async()=>{stopCalculatedWorker();stopPushWorker();server.close();await cache.disconnect();await pool.end();process.exit(0);};process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);}
start().catch(error=>{console.error('No se pudo iniciar el servidor:',error);process.exit(1);});
