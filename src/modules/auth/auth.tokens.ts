import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

interface AccessPayload { sub: string; sv: number; type: 'access' }
interface RefreshPayload { sub: string; jti: string; sv: number; type: 'refresh' }
export function signAccessToken(userId: string, sessionVersion: number) {
  return jwt.sign({ sub: userId, sv: sessionVersion, type: 'access' } satisfies AccessPayload, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_MINUTES * 60 });
}
export function signRefreshToken(userId: string, tokenId: string, sessionVersion: number) {
  return jwt.sign({ sub: userId, jti: tokenId, sv: sessionVersion, type: 'refresh' } satisfies RefreshPayload, env.JWT_REFRESH_SECRET, { expiresIn: env.REFRESH_TOKEN_DAYS * 86_400 });
}
export function verifyAccessToken(token: string) { return jwt.verify(token, env.JWT_ACCESS_SECRET) as unknown as AccessPayload; }
export function verifyRefreshToken(token: string) { return jwt.verify(token, env.JWT_REFRESH_SECRET) as unknown as RefreshPayload; }
export function tokenHash(token: string) { return crypto.createHash('sha256').update(token).digest('hex'); }
export function randomCode() { return crypto.randomInt(100000, 1000000).toString(); }
