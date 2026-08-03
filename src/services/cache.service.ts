import { createClient, type RedisClientType } from 'redis';
import { env } from '../config/env.js';
import { pool } from '../database/pool.js';

interface MemoryItem { value: string; expiresAt: number }
class CacheService {
  private redis?: RedisClientType;
  private memory = new Map<string, MemoryItem>();
  private versionMemory = new Map<string, { version: number; expiresAt: number }>();

  async connect() {
    if (!env.REDIS_URL) return;
    this.redis = createClient({ url: env.REDIS_URL });
    this.redis.on('error', (error) => console.error('Redis:', error));
    await this.redis.connect();
  }

  async disconnect() { if (this.redis?.isOpen) await this.redis.quit(); }

  private async version(module: string): Promise<number> {
    const local = this.versionMemory.get(module);
    if (local && local.expiresAt > Date.now()) return local.version;
    const result = await pool.query<{ version: string }>('SELECT version FROM version_datos WHERE modulo = $1', [module]);
    const version = Number(result.rows[0]?.version ?? 1);
    this.versionMemory.set(module, { version, expiresAt: Date.now() + 10_000 });
    return version;
  }

  async key(module: string, key: string): Promise<string> {
    return `mm:${module}:v${await this.version(module)}:${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = this.redis ? await this.redis.get(key) : this.getMemory(key);
    return raw ? JSON.parse(raw) as T : null;
  }

  async set(key: string, value: unknown, ttl = env.CACHE_DEFAULT_SECONDS) {
    const raw = JSON.stringify(value);
    if (this.redis) await this.redis.set(key, raw, { EX: ttl });
    else this.memory.set(key, { value: raw, expiresAt: Date.now() + ttl * 1000 });
  }

  async remember<T>(module: string, logicalKey: string, ttl: number, loader: () => Promise<T>): Promise<T> {
    const key = await this.key(module, logicalKey);
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await loader();
    await this.set(key, value, ttl);
    return value;
  }


  async rememberComposite<T>(modules: string[], logicalKey: string, ttl: number, loader: () => Promise<T>): Promise<T> {
    const result = await pool.query<{ modulo: string; version: string }>(
      'SELECT modulo, version FROM version_datos WHERE modulo = ANY($1::text[]) ORDER BY modulo',
      [modules]
    );
    const signature = result.rows.map((row) => `${row.modulo}:${row.version}`).join('|');
    const key = `mm:composite:${logicalKey}:${signature}`;
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await loader();
    await this.set(key, value, ttl);
    return value;
  }

  forgetModuleVersion(module: string) { this.versionMemory.delete(module); }

  private getMemory(key: string): string | null {
    const item = this.memory.get(key);
    if (!item) return null;
    if (item.expiresAt <= Date.now()) { this.memory.delete(key); return null; }
    return item.value;
  }
}
export const cache = new CacheService();
