import multer from 'multer';
import { env } from '../../config/env.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { deleteCloudinaryImage, uploadRecordImage } from '../../services/cloudinary.service.js';
import { buildInsert } from './sql.js';
export const recordImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.MAX_IMAGE_MB * 1024 * 1024, files: 3 },
    fileFilter: (_req, file, callback) => file.mimetype.startsWith('image/')
        ? callback(null, true)
        : callback(new ValidationError('Solo se permiten imágenes.')),
});
export async function saveRecordImages(client, definition, parentId, files, userId, extra = {}, max = 3) {
    if (!files.length)
        throw new ValidationError('Selecciona al menos una fotografía.');
    const parent = (await client.query(`SELECT 1 FROM ${definition.parentTable} WHERE ${definition.parentIdColumn}=$1 AND deleted_at IS NULL FOR UPDATE`, [parentId])).rowCount;
    if (!parent)
        throw new NotFoundError('El registro relacionado no existe.');
    const scopeEntries = Object.entries(extra);
    const scopeValues = [parentId];
    const scopeWhere = scopeEntries.map(([column, value]) => {
        scopeValues.push(value);
        return `${column}=$${scopeValues.length}`;
    });
    const existing = Number((await client.query(`SELECT COUNT(*)::int total FROM ${definition.table}
     WHERE ${definition.parentColumn}=$1 AND deleted_at IS NULL${scopeWhere.length ? ` AND ${scopeWhere.join(' AND ')}` : ''}`, scopeValues)).rows[0].total);
    if (existing + files.length > max)
        throw new ValidationError(`Solo se permiten ${max} fotografías por registro.`);
    const uploaded = [];
    try {
        for (const file of files) {
            const cloud = await uploadRecordImage(file.buffer, definition.moduleName, parentId);
            uploaded.push(cloud);
            await client.query(buildInsert(definition.table, {
                [definition.parentColumn]: parentId,
                ...extra,
                public_id: cloud.public_id, url: cloud.url, secure_url: cloud.secure_url,
                formato: cloud.format, ancho: cloud.width, alto: cloud.height, bytes: cloud.bytes,
                nombre_original: file.originalname, registrado_por: userId,
            }));
        }
    }
    catch (error) {
        await Promise.all(uploaded.map((image) => deleteCloudinaryImage(image.public_id)));
        throw error;
    }
    return (await client.query(`SELECT * FROM ${definition.table} WHERE ${definition.parentColumn}=$1 AND deleted_at IS NULL ORDER BY created_at`, [parentId])).rows;
}
export async function deleteRecordImage(client, definition, imageId) {
    const image = (await client.query(`UPDATE ${definition.table} SET deleted_at=NOW() WHERE ${definition.idColumn}=$1 AND deleted_at IS NULL RETURNING public_id`, [imageId])).rows[0];
    if (!image)
        throw new NotFoundError('Fotografía no encontrada.');
    return image;
}
export function requestFiles(req) {
    if (Array.isArray(req.files))
        return req.files;
    return req.file ? [req.file] : [];
}
//# sourceMappingURL=record-images.js.map