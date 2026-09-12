import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;
// Los planes pequeños de PostgreSQL reservan varias conexiones para tareas
// administrativas. Mantener un límite conservador evita que una sola
// instancia web agote todas las ranuras disponibles.
const poolMax = Math.max(1, Math.min(env.DATABASE_POOL_MAX, 4));
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: poolMax,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

pool.on('error', (error) => {
  console.error('Error inesperado del pool PostgreSQL:', error);
});

export async function pingDatabase(): Promise<void> {
  await pool.query('SELECT 1');
}
