import pg from 'pg';
import { env } from '../config/env.js';
const { Pool, types } = pg;
// PostgreSQL DATE representa un día de calendario. El parser predeterminado de
// pg lo convierte a Date usando la zona del proceso de Node y al serializarlo
// puede adelantar o atrasar el día. Se entrega como YYYY-MM-DD sin conversión.
types.setTypeParser(types.builtins.DATE, (value) => value);
// Los planes pequeños de PostgreSQL reservan varias conexiones para tareas
// administrativas. Mantener un límite conservador evita que una sola
// instancia web agote todas las ranuras disponibles.
const poolMax = Math.max(1, Math.min(env.DATABASE_POOL_MAX, 4));
export const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: poolMax,
    // CURRENT_DATE y NOW() continúan coordinados con la operación en Ecuador.
    // Esto ya no modifica los campos DATE porque su parser conserva el texto.
    options: '-c timezone=America/Guayaquil',
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
});
pool.on('error', (error) => {
    console.error('Error inesperado del pool PostgreSQL:', error);
});
export async function pingDatabase() {
    await pool.query('SELECT 1');
}
//# sourceMappingURL=pool.js.map