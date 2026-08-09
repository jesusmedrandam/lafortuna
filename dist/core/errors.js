export class AppError extends Error {
    status;
    code;
    details;
    constructor(status, message, code = 'APP_ERROR', details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
        this.name = 'AppError';
    }
}
export class NotFoundError extends AppError {
    constructor(message = 'Registro no encontrado.') { super(404, message, 'NOT_FOUND'); }
}
export class ForbiddenError extends AppError {
    constructor(message = 'No tiene permiso para realizar esta acción.') { super(403, message, 'FORBIDDEN'); }
}
export class UnauthorizedError extends AppError {
    constructor(message = 'Debe iniciar sesión.') { super(401, message, 'UNAUTHORIZED'); }
}
export class ConflictError extends AppError {
    constructor(message) { super(409, message, 'CONFLICT'); }
}
export class ValidationError extends AppError {
    constructor(message, details) { super(400, message, 'VALIDATION_ERROR', details); }
}
//# sourceMappingURL=errors.js.map