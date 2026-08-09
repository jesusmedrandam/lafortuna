import { ValidationError } from '../../core/errors.js';
export function pick(input, allowed) {
    const output = {};
    for (const key of allowed)
        if (Object.prototype.hasOwnProperty.call(input, key))
            output[key] = input[key];
    return output;
}
export function buildInsert(table, data) {
    const keys = Object.keys(data);
    if (!keys.length)
        throw new ValidationError('No hay datos para guardar.');
    return { text: `INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, values: keys.map(k => data[k]) };
}
export function buildUpdate(table, idColumn, id, data) {
    const keys = Object.keys(data);
    if (!keys.length)
        throw new ValidationError('No hay datos para modificar.');
    return { text: `UPDATE ${table} SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE ${idColumn}=$1 AND deleted_at IS NULL RETURNING *`, values: [id, ...keys.map(k => data[k])] };
}
//# sourceMappingURL=sql.js.map