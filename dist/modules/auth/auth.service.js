import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { AppError, ConflictError, UnauthorizedError } from '../../core/errors.js';
import { sendCodeEmail } from '../../services/email.service.js';
import { cache } from '../../services/cache.service.js';
import { randomCode, signAccessToken, signRefreshToken, tokenHash, verifyRefreshToken } from './auth.tokens.js';
import { env } from '../../config/env.js';
const normalize = (email) => email.trim().toLowerCase();
const codeExpiry = () => new Date(Date.now() + 15 * 60_000);
const refreshExpiry = () => new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000);
async function loadUser(client, id) {
    const result = await client.query({
        text: `SELECT u.id_usuario, u.correo, u.nombres, u.apellidos, u.foto_perfil_url, u.version_sesion,
      COALESCE(array_agg(DISTINCT r.codigo) FILTER (WHERE r.codigo IS NOT NULL), '{}') AS roles,
      COALESCE(array_agg(DISTINCT p.codigo) FILTER (WHERE p.codigo IS NOT NULL), '{}') AS permissions
    FROM usuario u
    LEFT JOIN usuario_rol ur ON ur.id_usuario=u.id_usuario AND ur.deleted_at IS NULL
    LEFT JOIN rol r ON r.id_rol=ur.id_rol AND r.deleted_at IS NULL AND r.activo
    LEFT JOIN rol_permiso rp ON rp.id_rol=r.id_rol AND rp.deleted_at IS NULL
    LEFT JOIN permiso p ON p.id_permiso=rp.id_permiso AND p.deleted_at IS NULL AND p.activo
    WHERE u.id_usuario=$1 AND u.deleted_at IS NULL AND u.activo
    GROUP BY u.id_usuario`, values: [id]
    });
    const row = result.rows[0];
    if (!row)
        return null;
    return { id: row.id_usuario, correo: row.correo, nombres: row.nombres, apellidos: row.apellidos, fotoPerfilUrl: row.foto_perfil_url, roles: row.roles, permissions: row.permissions, sessionVersion: row.version_sesion };
}
export async function getAuthenticatedUser(id) {
    return cache.remember('usuarios', `auth:${id}`, 60, () => loadUser(pool, id));
}
async function upsertChallenge(client, userId, purpose, code) {
    const hash = await bcrypt.hash(code, 10);
    await client.query(`INSERT INTO desafio_codigo(id_usuario, proposito, codigo_hash, expira_en, intentos_fallidos, nivel_bloqueo, bloqueado_hasta, consumido_en, restablecido_en, ultimo_envio, envios_ventana, ventana_inicio)
    VALUES($1,$2,$3,$4,0,0,NULL,NULL,NULL,NOW(),1,NOW())
    ON CONFLICT(id_usuario,proposito) DO UPDATE SET codigo_hash=EXCLUDED.codigo_hash, expira_en=EXCLUDED.expira_en, intentos_fallidos=0, bloqueado_hasta=NULL, consumido_en=NULL, restablecido_en=NULL, ultimo_envio=NOW(), envios_ventana=CASE WHEN desafio_codigo.ventana_inicio > NOW()-INTERVAL '1 hour' THEN desafio_codigo.envios_ventana+1 ELSE 1 END, ventana_inicio=CASE WHEN desafio_codigo.ventana_inicio > NOW()-INTERVAL '1 hour' THEN desafio_codigo.ventana_inicio ELSE NOW() END`, [userId, purpose, hash, codeExpiry()]);
}
async function issueTokens(client, user, req) {
    const tokenId = randomUUID();
    const accessToken = signAccessToken(user.id, user.sessionVersion);
    const refreshToken = signRefreshToken(user.id, tokenId, user.sessionVersion);
    await client.query(`INSERT INTO refresh_token(id_refresh_token,id_usuario,token_hash,expira_en,ip_hash,user_agent) VALUES($1,$2,$3,$4,$5,$6)`, [tokenId, user.id, tokenHash(refreshToken), refreshExpiry(), req.ip ? tokenHash(req.ip) : null, req.userAgent?.slice(0, 500)]);
    return { accessToken, refreshToken, expiresInMinutes: env.ACCESS_TOKEN_MINUTES, user };
}
export async function register(input) {
    const email = normalize(input.correo);
    const code = randomCode();
    const user = await transaction(async (client) => {
        const exists = await client.query('SELECT 1 FROM usuario WHERE LOWER(correo)=$1 AND deleted_at IS NULL', [email]);
        if (exists.rowCount)
            throw new ConflictError('Ya existe una cuenta con ese correo.');
        const passwordHash = await bcrypt.hash(input.password, 12);
        const result = await client.query(`INSERT INTO usuario(nombres,apellidos,correo,password_hash,telefono,activo,correo_verificado) VALUES($1,$2,$3,$4,$5,FALSE,FALSE) RETURNING id_usuario,correo`, [input.nombres, input.apellidos, email, passwordHash, input.telefono ?? null]);
        const created = result.rows[0];
        // Las cuentas nuevas se crean sin roles. Un administrador decide después qué acceso otorgar.
        await upsertChallenge(client, created.id_usuario, 'ACTIVACION', code);
        return created;
    });
    await sendCodeEmail(email, code, 'ACTIVACION');
    return { idUsuario: user.id_usuario, correo: user.correo, message: 'Cuenta creada. Revisa tu correo para activarla.' };
}
async function verifyChallenge(client, email, purpose, code) {
    const result = await client.query(`SELECT u.id_usuario,d.* FROM usuario u JOIN desafio_codigo d ON d.id_usuario=u.id_usuario AND d.proposito=$2 WHERE LOWER(u.correo)=$1 AND u.deleted_at IS NULL FOR UPDATE OF d`, [normalize(email), purpose]);
    const row = result.rows[0];
    if (!row)
        throw new AppError(400, 'Código inválido o expirado.', 'INVALID_CODE');
    if (row.bloqueado_hasta && new Date(row.bloqueado_hasta) > new Date())
        throw new AppError(429, 'Demasiados intentos. Intenta más tarde.', 'CODE_LOCKED');
    if (row.consumido_en || new Date(row.expira_en) < new Date())
        throw new AppError(400, 'Código inválido o expirado.', 'INVALID_CODE');
    const valid = await bcrypt.compare(code, row.codigo_hash);
    if (!valid) {
        const attempts = Number(row.intentos_fallidos) + 1;
        const level = attempts >= 3 ? Number(row.nivel_bloqueo) + 1 : Number(row.nivel_bloqueo);
        const blocked = attempts >= 3 ? new Date(Date.now() + 5 * 60_000 * Math.pow(2, Math.max(0, level - 1))) : null;
        await client.query('UPDATE desafio_codigo SET intentos_fallidos=$2,nivel_bloqueo=$3,bloqueado_hasta=$4 WHERE id_desafio=$1', [row.id_desafio, attempts >= 3 ? 0 : attempts, level, blocked]);
        throw new AppError(400, 'Código incorrecto.', 'INVALID_CODE');
    }
    return row;
}
export async function verifyEmail(email, code) {
    return transaction(async (client) => {
        const row = await verifyChallenge(client, email, 'ACTIVACION', code);
        await client.query('UPDATE usuario SET activo=TRUE,correo_verificado=TRUE WHERE id_usuario=$1', [row.id_usuario]);
        await client.query('UPDATE desafio_codigo SET consumido_en=NOW() WHERE id_desafio=$1', [row.id_desafio]);
        return { message: 'Cuenta activada correctamente.' };
    });
}
export async function resendVerification(email) {
    const normalized = normalize(email);
    const code = randomCode();
    const result = await pool.query('SELECT id_usuario,correo_verificado FROM usuario WHERE LOWER(correo)=$1 AND deleted_at IS NULL', [normalized]);
    const user = result.rows[0];
    if (!user)
        return { message: 'Si la cuenta existe, se enviará un código.' };
    if (user.correo_verificado)
        throw new ConflictError('La cuenta ya está verificada.');
    await transaction(async (c) => upsertChallenge(c, user.id_usuario, 'ACTIVACION', code));
    await sendCodeEmail(normalized, code, 'ACTIVACION');
    return { message: 'Código enviado.' };
}
export async function login(email, password, request) {
    const normalized = normalize(email);
    return transaction(async (client) => {
        const lock = await client.query('SELECT * FROM control_login WHERE correo_normalizado=$1 FOR UPDATE', [normalized]);
        const ctrl = lock.rows[0];
        if (ctrl?.bloqueado_hasta && new Date(ctrl.bloqueado_hasta) > new Date())
            throw new AppError(429, 'Cuenta temporalmente bloqueada por intentos fallidos.', 'LOGIN_LOCKED');
        const result = await client.query('SELECT * FROM usuario WHERE LOWER(correo)=$1 AND deleted_at IS NULL', [normalized]);
        const row = result.rows[0];
        const valid = row?.password_hash ? await bcrypt.compare(password, row.password_hash) : false;
        if (!row || !valid) {
            const attempts = Number(ctrl?.intentos_fallidos ?? 0) + 1;
            const level = attempts >= 5 ? Number(ctrl?.nivel_bloqueo ?? 0) + 1 : Number(ctrl?.nivel_bloqueo ?? 0);
            const blocked = attempts >= 5 ? new Date(Date.now() + 5 * 60_000 * Math.pow(2, Math.max(0, level - 1))) : null;
            await client.query(`INSERT INTO control_login(correo_normalizado,intentos_fallidos,nivel_bloqueo,bloqueado_hasta,ultimo_fallo) VALUES($1,$2,$3,$4,NOW()) ON CONFLICT(correo_normalizado) DO UPDATE SET intentos_fallidos=$2,nivel_bloqueo=$3,bloqueado_hasta=$4,ultimo_fallo=NOW(),updated_at=NOW()`, [normalized, attempts >= 5 ? 0 : attempts, level, blocked]);
            throw new UnauthorizedError('Correo o contraseña incorrectos.');
        }
        if (!row.correo_verificado)
            throw new AppError(403, 'Debes verificar tu correo.', 'EMAIL_NOT_VERIFIED');
        if (!row.activo)
            throw new AppError(403, 'La cuenta está desactivada.', 'ACCOUNT_DISABLED');
        await client.query('DELETE FROM control_login WHERE correo_normalizado=$1', [normalized]);
        await client.query('UPDATE usuario SET ultimo_acceso=NOW() WHERE id_usuario=$1', [row.id_usuario]);
        const user = await loadUser(client, row.id_usuario);
        if (!user)
            throw new UnauthorizedError();
        return issueTokens(client, user, request);
    });
}
export async function refresh(refreshToken, request) {
    let payload;
    try {
        payload = verifyRefreshToken(refreshToken);
    }
    catch {
        throw new UnauthorizedError('El token de renovación no es válido.');
    }
    return transaction(async (client) => {
        const stored = await client.query('SELECT * FROM refresh_token WHERE id_refresh_token=$1 FOR UPDATE', [payload.jti]);
        const row = stored.rows[0];
        if (!row || row.revocado_en || new Date(row.expira_en) < new Date() || row.token_hash !== tokenHash(refreshToken))
            throw new UnauthorizedError('La sesión ya no es válida.');
        const user = await loadUser(client, payload.sub);
        if (!user || user.sessionVersion !== payload.sv)
            throw new UnauthorizedError('La sesión fue invalidada.');
        await client.query('UPDATE refresh_token SET revocado_en=NOW() WHERE id_refresh_token=$1', [payload.jti]);
        const tokens = await issueTokens(client, user, request);
        const next = verifyRefreshToken(tokens.refreshToken);
        await client.query('UPDATE refresh_token SET reemplazado_por=$2 WHERE id_refresh_token=$1', [payload.jti, next.jti]);
        return tokens;
    });
}
export async function logout(refreshToken) {
    try {
        const payload = verifyRefreshToken(refreshToken);
        await pool.query('UPDATE refresh_token SET revocado_en=COALESCE(revocado_en,NOW()) WHERE id_refresh_token=$1', [payload.jti]);
    }
    catch { /* respuesta idempotente */ }
    return { message: 'Sesión cerrada.' };
}
export async function forgotPassword(email) {
    const normalized = normalize(email);
    const code = randomCode();
    const result = await pool.query('SELECT id_usuario FROM usuario WHERE LOWER(correo)=$1 AND deleted_at IS NULL', [normalized]);
    const user = result.rows[0];
    if (user) {
        await transaction(c => upsertChallenge(c, user.id_usuario, 'RESTABLECER_PASSWORD', code));
        await sendCodeEmail(normalized, code, 'RESTABLECER_PASSWORD');
    }
    return { message: 'Si el correo está registrado, recibirás un código.' };
}
export async function resetPassword(email, code, password) {
    return transaction(async (client) => {
        const row = await verifyChallenge(client, email, 'RESTABLECER_PASSWORD', code);
        const hash = await bcrypt.hash(password, 12);
        await client.query('UPDATE usuario SET password_hash=$2,password_changed_at=NOW(),version_sesion=version_sesion+1 WHERE id_usuario=$1', [row.id_usuario, hash]);
        await client.query('UPDATE desafio_codigo SET consumido_en=NOW(),restablecido_en=NOW() WHERE id_desafio=$1', [row.id_desafio]);
        await client.query('UPDATE refresh_token SET revocado_en=COALESCE(revocado_en,NOW()) WHERE id_usuario=$1', [row.id_usuario]);
        cache.forgetModuleVersion('usuarios');
        return { message: 'Contraseña actualizada.' };
    });
}
export async function changePassword(userId, currentPassword, newPassword) {
    return transaction(async (client) => {
        const user = (await client.query('SELECT password_hash FROM usuario WHERE id_usuario=$1 AND deleted_at IS NULL FOR UPDATE', [userId])).rows[0];
        if (!user?.password_hash || !await bcrypt.compare(currentPassword, user.password_hash)) {
            throw new UnauthorizedError('La contraseña actual no es correcta.');
        }
        if (await bcrypt.compare(newPassword, user.password_hash)) {
            throw new ConflictError('La nueva contraseña debe ser diferente de la actual.');
        }
        const hash = await bcrypt.hash(newPassword, 12);
        await client.query('UPDATE usuario SET password_hash=$2,password_changed_at=NOW(),version_sesion=version_sesion+1,updated_at=NOW() WHERE id_usuario=$1', [userId, hash]);
        await client.query('UPDATE refresh_token SET revocado_en=COALESCE(revocado_en,NOW()) WHERE id_usuario=$1', [userId]);
        cache.forgetModuleVersion('usuarios');
        return { message: 'Contraseña actualizada. Por seguridad, inicia sesión nuevamente.' };
    });
}
export async function profile(userId) {
    const result = await pool.query('SELECT id_usuario,nombres,apellidos,telefono,correo,fecha_nacimiento,foto_perfil_url,ultimo_acceso,created_at FROM usuario WHERE id_usuario=$1 AND deleted_at IS NULL', [userId]);
    if (!result.rows[0])
        throw new UnauthorizedError();
    return { ...result.rows[0], auth: await getAuthenticatedUser(userId) };
}
export async function updateProfile(userId, input) {
    let verification = null;
    const updated = await transaction(async (client) => {
        const currentResult = await client.query('SELECT * FROM usuario WHERE id_usuario=$1 AND deleted_at IS NULL FOR UPDATE', [userId]);
        const current = currentResult.rows[0];
        if (!current)
            throw new UnauthorizedError();
        const values = [];
        const sets = [];
        const add = (column, value) => {
            values.push(value);
            sets.push(`${column}=$${values.length + 1}`);
        };
        if (input.nombres !== undefined)
            add('nombres', input.nombres);
        if (input.apellidos !== undefined)
            add('apellidos', input.apellidos);
        if (input.telefono !== undefined)
            add('telefono', input.telefono);
        if (input.fecha_nacimiento !== undefined)
            add('fecha_nacimiento', input.fecha_nacimiento);
        if (input.correo !== undefined) {
            const nextEmail = normalize(input.correo);
            if (nextEmail !== normalize(current.correo)) {
                const exists = await client.query('SELECT 1 FROM usuario WHERE LOWER(correo)=$1 AND id_usuario<>$2 AND deleted_at IS NULL', [nextEmail, userId]);
                if (exists.rowCount)
                    throw new ConflictError('Ya existe una cuenta con ese correo.');
                add('correo', nextEmail);
                add('correo_verificado', false);
                add('activo', false);
                add('version_sesion', Number(current.version_sesion) + 1);
                const codigo = randomCode();
                await upsertChallenge(client, userId, 'ACTIVACION', codigo);
                await client.query('UPDATE refresh_token SET revocado_en=COALESCE(revocado_en,NOW()) WHERE id_usuario=$1', [userId]);
                verification = { correo: nextEmail, codigo };
            }
        }
        if (sets.length === 0) {
            return current;
        }
        sets.push('updated_at=NOW()', 'version=version+1');
        const result = await client.query(`UPDATE usuario SET ${sets.join(',')} WHERE id_usuario=$1 AND deleted_at IS NULL
       RETURNING id_usuario,nombres,apellidos,telefono,correo,fecha_nacimiento,foto_perfil_url,correo_verificado,activo`, [userId, ...values]);
        return result.rows[0];
    }, userId);
    cache.forgetModuleVersion('usuarios');
    const pendingVerification = verification;
    if (pendingVerification) {
        await sendCodeEmail(pendingVerification.correo, pendingVerification.codigo, 'ACTIVACION');
    }
    return {
        ...updated,
        emailVerificationRequired: Boolean(pendingVerification),
        message: pendingVerification
            ? 'Perfil actualizado. Verifica el nuevo correo para volver a iniciar sesión.'
            : 'Perfil actualizado correctamente.',
    };
}
export async function updateUserAsAdmin(actorId, userId, input) {
    let verification = null;
    const updated = await transaction(async (client) => {
        const currentResult = await client.query('SELECT * FROM usuario WHERE id_usuario=$1 AND deleted_at IS NULL FOR UPDATE', [userId]);
        const current = currentResult.rows[0];
        if (!current)
            throw new AppError(404, 'Usuario no encontrado.', 'NOT_FOUND');
        const values = [];
        const sets = [];
        const add = (column, value) => {
            values.push(value);
            sets.push(`${column}=$${values.length + 1}`);
        };
        if (input.nombres !== undefined)
            add('nombres', input.nombres);
        if (input.apellidos !== undefined)
            add('apellidos', input.apellidos);
        if (input.telefono !== undefined)
            add('telefono', input.telefono);
        if (input.fecha_nacimiento !== undefined)
            add('fecha_nacimiento', input.fecha_nacimiento);
        let emailChanged = false;
        if (input.correo !== undefined) {
            const nextEmail = normalize(input.correo);
            if (nextEmail !== normalize(current.correo)) {
                const exists = await client.query('SELECT 1 FROM usuario WHERE LOWER(correo)=$1 AND id_usuario<>$2 AND deleted_at IS NULL', [nextEmail, userId]);
                if (exists.rowCount)
                    throw new ConflictError('Ya existe una cuenta con ese correo.');
                // Un correo cambiado debe comprobarse antes de volver a habilitar la cuenta.
                emailChanged = true;
                add('correo', nextEmail);
                add('correo_verificado', false);
                add('activo', false);
                const codigo = randomCode();
                await upsertChallenge(client, userId, 'ACTIVACION', codigo);
                verification = { correo: nextEmail, codigo };
            }
        }
        if (!emailChanged && input.activo !== undefined)
            add('activo', input.activo);
        add('version_sesion', Number(current.version_sesion) + 1);
        sets.push('updated_at=NOW()', 'version=version+1');
        const result = await client.query(`UPDATE usuario SET ${sets.join(',')} WHERE id_usuario=$1 AND deleted_at IS NULL
       RETURNING id_usuario,nombres,apellidos,telefono,correo,fecha_nacimiento,foto_perfil_url,correo_verificado,activo`, [userId, ...values]);
        await client.query('UPDATE refresh_token SET revocado_en=COALESCE(revocado_en,NOW()) WHERE id_usuario=$1', [userId]);
        return result.rows[0];
    }, actorId);
    cache.forgetModuleVersion('usuarios');
    const pendingVerification = verification;
    if (pendingVerification) {
        await sendCodeEmail(pendingVerification.correo, pendingVerification.codigo, 'ACTIVACION');
    }
    return {
        ...updated,
        emailVerificationRequired: Boolean(pendingVerification),
        message: pendingVerification
            ? 'Usuario actualizado. Se envió un código de verificación al nuevo correo.'
            : 'Usuario actualizado correctamente.',
    };
}
//# sourceMappingURL=auth.service.js.map