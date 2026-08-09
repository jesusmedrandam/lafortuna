import { UnauthorizedError } from '../core/errors.js';
import { getAuthenticatedUser } from '../modules/auth/auth.service.js';
import { verifyAccessToken } from '../modules/auth/auth.tokens.js';
export async function authenticate(req, _res, next) {
    try {
        const header = req.header('authorization');
        if (!header?.startsWith('Bearer '))
            throw new UnauthorizedError();
        const payload = verifyAccessToken(header.slice(7));
        if (payload.type !== 'access')
            throw new UnauthorizedError();
        const user = await getAuthenticatedUser(payload.sub);
        if (!user || user.sessionVersion !== payload.sv)
            throw new UnauthorizedError('La sesión ya no es válida.');
        req.user = user;
        next();
    }
    catch (error) {
        next(error instanceof UnauthorizedError ? error : new UnauthorizedError('Token inválido o vencido.'));
    }
}
//# sourceMappingURL=auth.js.map