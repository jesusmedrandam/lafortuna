import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, noContent, ok } from '../../core/http.js';
import { ConflictError, NotFoundError } from '../../core/errors.js';
import { requirePermission } from '../../middleware/permission.js';
import { cache } from '../../services/cache.service.js';
import { updateUserAsAdmin } from '../auth/auth.service.js';
import { buildInsert, buildUpdate } from '../shared/sql.js';
export const usersRouter = Router();
usersRouter.get('/', requirePermission('USUARIO_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, (await pool.query(`
    SELECT u.id_usuario,u.nombres,u.apellidos,u.telefono,u.correo,u.fecha_nacimiento,
           u.foto_perfil_url,u.activo,u.correo_verificado,u.ultimo_acceso,u.created_at,
           COALESCE(
             jsonb_agg(DISTINCT jsonb_build_object('id_rol',r.id_rol,'codigo',r.codigo,'nombre',r.nombre))
             FILTER(WHERE r.id_rol IS NOT NULL),'[]'
           ) roles
    FROM usuario u
    LEFT JOIN usuario_rol ur ON ur.id_usuario=u.id_usuario AND ur.deleted_at IS NULL
    LEFT JOIN rol r ON r.id_rol=ur.id_rol AND r.deleted_at IS NULL
    WHERE u.deleted_at IS NULL
    GROUP BY u.id_usuario
    ORDER BY u.created_at DESC
  `)).rows)));
usersRouter.patch('/:id', requirePermission('USUARIO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const data = z.object({
        nombres: z.string().trim().min(2).max(80).optional(),
        apellidos: z.string().trim().min(2).max(80).optional(),
        correo: z.string().trim().email().max(150).optional(),
        telefono: z.string().trim().max(25).nullable().optional(),
        fecha_nacimiento: z.string().date().nullable().optional(),
        activo: z.boolean().optional(),
    }).refine((value) => Object.keys(value).length > 0, 'No hay cambios.').parse(req.body);
    return ok(res, await updateUserAsAdmin(req.user.id, routeParam(req.params.id, 'id'), data));
}));
usersRouter.put('/:id/roles', requirePermission('USUARIO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const userId = routeParam(req.params.id, 'id');
    const roles = z.array(z.string().uuid()).parse(req.body.roles);
    await transaction(async (client) => {
        const exists = await client.query('SELECT 1 FROM usuario WHERE id_usuario=$1 AND deleted_at IS NULL', [userId]);
        if (!exists.rowCount)
            throw new NotFoundError('Usuario no encontrado.');
        if (roles.length) {
            const validRoles = await client.query('SELECT id_rol FROM rol WHERE id_rol=ANY($1::uuid[]) AND deleted_at IS NULL AND activo', [roles]);
            if (validRoles.rowCount !== roles.length)
                throw new ConflictError('Uno de los roles no existe o está inactivo.');
        }
        await client.query('UPDATE usuario_rol SET deleted_at=NOW(),updated_at=NOW(),version=version+1 WHERE id_usuario=$1 AND deleted_at IS NULL', [userId]);
        for (const roleId of roles) {
            await client.query('INSERT INTO usuario_rol(id_usuario,id_rol,asignado_por) VALUES($1,$2,$3)', [userId, roleId, req.user.id]);
        }
        await client.query('UPDATE usuario SET version_sesion=version_sesion+1,updated_at=NOW(),version=version+1 WHERE id_usuario=$1', [userId]);
        await client.query('UPDATE refresh_token SET revocado_en=COALESCE(revocado_en,NOW()) WHERE id_usuario=$1', [userId]);
    }, req.user.id);
    cache.forgetModuleVersion('usuarios');
    return ok(res, { message: roles.length ? 'Roles actualizados.' : 'El usuario quedó sin roles.' });
}));
usersRouter.delete('/:id', requirePermission('USUARIO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const userId = routeParam(req.params.id, 'id');
    if (userId === req.user.id)
        throw new ConflictError('No puedes eliminar tu propia cuenta desde administración.');
    const result = await pool.query(`UPDATE usuario
     SET deleted_at=NOW(),activo=FALSE,version_sesion=version_sesion+1,updated_at=NOW(),version=version+1
     WHERE id_usuario=$1 AND deleted_at IS NULL`, [userId]);
    if (!result.rowCount)
        throw new NotFoundError('Usuario no encontrado.');
    cache.forgetModuleVersion('usuarios');
    return noContent(res);
}));
export const rolesRouter = Router();
rolesRouter.get('/', requirePermission('ROL_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, (await pool.query(`
    SELECT r.*,
           COALESCE(
             jsonb_agg(jsonb_build_object('id_permiso',p.id_permiso,'codigo',p.codigo,'nombre',p.nombre,'modulo',p.modulo))
             FILTER(WHERE p.id_permiso IS NOT NULL),'[]'
           ) permisos
    FROM rol r
    LEFT JOIN rol_permiso rp ON rp.id_rol=r.id_rol AND rp.deleted_at IS NULL
    LEFT JOIN permiso p ON p.id_permiso=rp.id_permiso AND p.deleted_at IS NULL
    WHERE r.deleted_at IS NULL
    GROUP BY r.id_rol
    ORDER BY r.protegido DESC,r.nombre
  `)).rows)));
rolesRouter.get('/permisos', requirePermission('ROL_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, (await pool.query('SELECT * FROM permiso WHERE deleted_at IS NULL AND activo ORDER BY modulo,nombre')).rows)));
rolesRouter.post('/', requirePermission('ROL_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const input = z.object({
        codigo: z.string().trim().min(2).max(60),
        nombre: z.string().trim().min(2).max(100),
        descripcion: z.string().trim().max(300).nullable().optional(),
        activo: z.boolean().optional(),
        permisos: z.array(z.string().uuid()).default([]),
    }).parse(req.body);
    const result = await transaction(async (client) => {
        const { permisos, ...role } = input;
        const createdRole = (await client.query(buildInsert('rol', {
            ...role,
            codigo: role.codigo.toUpperCase().replace(/\s+/g, '_'),
            protegido: false,
        }))).rows[0];
        for (const permissionId of permisos) {
            await client.query('INSERT INTO rol_permiso(id_rol,id_permiso) VALUES($1,$2)', [createdRole.id_rol, permissionId]);
        }
        return createdRole;
    }, req.user.id);
    cache.forgetModuleVersion('usuarios');
    return created(res, result);
}));
rolesRouter.patch('/:id', requirePermission('ROL_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const roleId = routeParam(req.params.id, 'id');
    const current = await pool.query('SELECT protegido FROM rol WHERE id_rol=$1 AND deleted_at IS NULL', [roleId]);
    if (!current.rows[0])
        throw new NotFoundError('Rol no encontrado.');
    const data = z.object({
        nombre: z.string().trim().min(2).max(100).optional(),
        descripcion: z.string().trim().max(300).nullable().optional(),
        activo: z.boolean().optional(),
    }).refine((value) => Object.keys(value).length > 0, 'No hay cambios.').parse(req.body);
    const row = (await pool.query(buildUpdate('rol', 'id_rol', roleId, data))).rows[0];
    cache.forgetModuleVersion('usuarios');
    return ok(res, row);
}));
rolesRouter.put('/:id/permisos', requirePermission('ROL_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const roleId = routeParam(req.params.id, 'id');
    const permisos = z.array(z.string().uuid()).parse(req.body.permisos);
    await transaction(async (client) => {
        const role = await client.query('SELECT protegido FROM rol WHERE id_rol=$1 AND deleted_at IS NULL FOR UPDATE', [roleId]);
        if (!role.rows[0])
            throw new NotFoundError('Rol no encontrado.');
        await client.query('UPDATE rol_permiso SET deleted_at=NOW(),updated_at=NOW(),version=version+1 WHERE id_rol=$1 AND deleted_at IS NULL', [roleId]);
        for (const permissionId of permisos) {
            await client.query('INSERT INTO rol_permiso(id_rol,id_permiso) VALUES($1,$2)', [roleId, permissionId]);
        }
        await client.query(`
      UPDATE usuario SET version_sesion=version_sesion+1,updated_at=NOW(),version=version+1
      WHERE id_usuario IN (
        SELECT id_usuario FROM usuario_rol WHERE id_rol=$1 AND deleted_at IS NULL
      )
    `, [roleId]);
    }, req.user.id);
    cache.forgetModuleVersion('usuarios');
    return ok(res, { message: 'Permisos actualizados.' });
}));
rolesRouter.delete('/:id', requirePermission('ROL_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const roleId = routeParam(req.params.id, 'id');
    const role = await pool.query('SELECT protegido FROM rol WHERE id_rol=$1 AND deleted_at IS NULL', [roleId]);
    if (!role.rows[0])
        throw new NotFoundError('Rol no encontrado.');
    if (role.rows[0].protegido)
        throw new ConflictError('Este rol está protegido y no puede eliminarse.');
    await transaction(async (client) => {
        await client.query('UPDATE usuario_rol SET deleted_at=NOW() WHERE id_rol=$1 AND deleted_at IS NULL', [roleId]);
        await client.query('UPDATE rol SET deleted_at=NOW(),activo=FALSE WHERE id_rol=$1', [roleId]);
    }, req.user.id);
    cache.forgetModuleVersion('usuarios');
    return noContent(res);
}));
//# sourceMappingURL=admin.routes.js.map