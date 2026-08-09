import { ForbiddenError, UnauthorizedError } from '../core/errors.js';
export function hasPermission(user, ...permissions) {
    return Boolean(user && (user.roles.includes('ADMINISTRADOR') || permissions.some((permission) => user.permissions.includes(permission))));
}
export function assertPermission(user, ...permissions) {
    if (!user)
        throw new UnauthorizedError();
    if (!hasPermission(user, ...permissions))
        throw new ForbiddenError();
}
export function requirePermission(...permissions) {
    return (req, _res, next) => {
        try {
            assertPermission(req.user, ...permissions);
            next();
        }
        catch (error) {
            next(error);
        }
    };
}
//# sourceMappingURL=permission.js.map