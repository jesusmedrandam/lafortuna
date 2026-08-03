import type { Pool, PoolClient } from 'pg';
import { ValidationError } from '../../core/errors.js';

export type Queryable = Pool | PoolClient;
export function pick(input: Record<string, unknown>, allowed: readonly string[]) {
  const output: Record<string, unknown> = {};
  for (const key of allowed) if (Object.prototype.hasOwnProperty.call(input, key)) output[key] = input[key];
  return output;
}
export function buildInsert(table: string, data: Record<string, unknown>) {
  const keys=Object.keys(data); if(!keys.length) throw new ValidationError('No hay datos para guardar.');
  return { text:`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`, values:keys.map(k=>data[k]) };
}
export function buildUpdate(table:string,idColumn:string,id:string,data:Record<string,unknown>) {
  const keys=Object.keys(data); if(!keys.length) throw new ValidationError('No hay datos para modificar.');
  return { text:`UPDATE ${table} SET ${keys.map((k,i)=>`${k}=$${i+2}`).join(',')} WHERE ${idColumn}=$1 AND deleted_at IS NULL RETURNING *`, values:[id,...keys.map(k=>data[k])] };
}
