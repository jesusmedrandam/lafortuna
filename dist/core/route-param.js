import { ValidationError } from './errors.js';
/**
 * Express 5 puede tipar un parámetro de ruta como string o string[].
 * Esta función devuelve siempre un string válido para consultas y servicios.
 */
export function routeParam(value, name = 'parámetro') {
    const normalized = Array.isArray(value) ? value[0] : value;
    if (!normalized || !normalized.trim()) {
        throw new ValidationError(`El ${name} de la ruta es obligatorio.`);
    }
    return normalized;
}
//# sourceMappingURL=route-param.js.map