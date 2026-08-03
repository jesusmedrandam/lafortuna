import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedUser } from '../modules/auth/auth.types.js';
import { ForbiddenError, UnauthorizedError } from '../core/errors.js';

export function hasPermission(user: AuthenticatedUser | undefined, ...permissions: string[]) {
  return Boolean(user && (user.roles.includes('ADMINISTRADOR') || permissions.some((permission) => user.permissions.includes(permission))));
}

export function assertPermission(user: AuthenticatedUser | undefined, ...permissions: string[]) {
  if (!user) throw new UnauthorizedError();
  if (!hasPermission(user, ...permissions)) throw new ForbiddenError();
}

export function requirePermission(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      assertPermission(req.user, ...permissions);
      next();
    } catch (error) {
      next(error);
    }
  };
}
