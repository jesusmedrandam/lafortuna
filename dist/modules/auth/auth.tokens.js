import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
export function signAccessToken(userId, sessionVersion) {
    return jwt.sign({ sub: userId, sv: sessionVersion, type: 'access' }, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_MINUTES * 60 });
}
export function signRefreshToken(userId, tokenId, sessionVersion) {
    return jwt.sign({ sub: userId, jti: tokenId, sv: sessionVersion, type: 'refresh' }, env.JWT_REFRESH_SECRET, { expiresIn: env.REFRESH_TOKEN_DAYS * 86_400 });
}
export function verifyAccessToken(token) { return jwt.verify(token, env.JWT_ACCESS_SECRET); }
export function verifyRefreshToken(token) { return jwt.verify(token, env.JWT_REFRESH_SECRET); }
export function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
export function randomCode() { return crypto.randomInt(100000, 1000000).toString(); }
//# sourceMappingURL=auth.tokens.js.map