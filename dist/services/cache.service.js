import { createClient } from 'redis';
import { env } from '../config/env.js';
import { pool } from '../database/pool.js';
class CacheService {
    redis;
    memory = new Map();
    versionMemory = new Map();
    async connect() {
        if (!env.REDIS_URL)
            return;
        this.redis = createClient({ url: env.REDIS_URL });
        this.redis.on('error', (error) => console.error('Redis:', error));
        await this.redis.connect();
    }
    async disconnect() { if (this.redis?.isOpen)
        await this.redis.quit(); }
    async version(module) {
        const local = this.versionMemory.get(module);
        if (local && local.expiresAt > Date.now())
            return local.version;
        const result = await pool.query('SELECT version FROM version_datos WHERE modulo = $1', [module]);
        const version = Number(result.rows[0]?.version ?? 1);
        this.versionMemory.set(module, { version, expiresAt: Date.now() + 10_000 });
        return version;
    }
    async key(module, key) {
        return `mm:${module}:v${await this.version(module)}:${key}`;
    }
    async get(key) {
        const raw = this.redis ? await this.redis.get(key) : this.getMemory(key);
        return raw ? JSON.parse(raw) : null;
    }
    async set(key, value, ttl = env.CACHE_DEFAULT_SECONDS) {
        const raw = JSON.stringify(value);
        if (this.redis)
            await this.redis.set(key, raw, { EX: ttl });
        else
            this.memory.set(key, { value: raw, expiresAt: Date.now() + ttl * 1000 });
    }
    async remember(module, logicalKey, ttl, loader) {
        const key = await this.key(module, logicalKey);
        const cached = await this.get(key);
        if (cached !== null)
            return cached;
        const value = await loader();
        await this.set(key, value, ttl);
        return value;
    }
    async rememberComposite(modules, logicalKey, ttl, loader) {
        const result = await pool.query('SELECT modulo, version FROM version_datos WHERE modulo = ANY($1::text[]) ORDER BY modulo', [modules]);
        const signature = result.rows.map((row) => `${row.modulo}:${row.version}`).join('|');
        const key = `mm:composite:${logicalKey}:${signature}`;
        const cached = await this.get(key);
        if (cached !== null)
            return cached;
        const value = await loader();
        await this.set(key, value, ttl);
        return value;
    }
    forgetModuleVersion(module) { this.versionMemory.delete(module); }
    getMemory(key) {
        const item = this.memory.get(key);
        if (!item)
            return null;
        if (item.expiresAt <= Date.now()) {
            this.memory.delete(key);
            return null;
        }
        return item.value;
    }
}
export const cache = new CacheService();
//# sourceMappingURL=cache.service.js.map