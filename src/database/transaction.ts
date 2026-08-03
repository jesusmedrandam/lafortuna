import type { PoolClient } from 'pg';
import { pool } from './pool.js';

export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>,
  userId?: string
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (userId) {
      await client.query("SELECT set_config('app.usuario_id', $1, true)", [userId]);
    }
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
