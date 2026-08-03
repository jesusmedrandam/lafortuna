import { app } from './app.js';
import { env } from './config/env.js';
import { pingDatabase, pool } from './database/pool.js';
import { cache } from './services/cache.service.js';
async function start(){await pingDatabase();await cache.connect();const server=app.listen(env.PORT,()=>console.log(`${env.APP_NAME} API escuchando en puerto ${env.PORT} bajo ${env.API_PREFIX}`));const shutdown=async()=>{server.close();await cache.disconnect();await pool.end();process.exit(0);};process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);}
start().catch(error=>{console.error('No se pudo iniciar el servidor:',error);process.exit(1);});
