import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';
import { AppError } from '../core/errors.js';
const enabled = Boolean(env.CLOUDINARY_CLOUD_NAME &&
    env.CLOUDINARY_API_KEY &&
    env.CLOUDINARY_API_SECRET);
const configuredFolder = env.CLOUDINARY_FOLDER.trim().replace(/^\/+|\/+$/g, '') || 'mm-ganaderia/animales';
const rootFolder = configuredFolder.endsWith('/animales')
    ? configuredFolder.slice(0, -'/animales'.length)
    : configuredFolder;
if (enabled) {
    cloudinary.config({
        cloud_name: env.CLOUDINARY_CLOUD_NAME,
        api_key: env.CLOUDINARY_API_KEY,
        api_secret: env.CLOUDINARY_API_SECRET,
        secure: true,
    });
}
function ensureEnabled() {
    if (!enabled) {
        throw new AppError(503, 'Cloudinary todavía no está configurado en el servidor.', 'CLOUDINARY_NOT_CONFIGURED');
    }
}
function cloudinaryErrorMessage(error) {
    if (error instanceof Error && error.message)
        return error.message;
    if (typeof error === 'object' && error !== null && 'message' in error) {
        const message = error.message;
        if (typeof message === 'string' && message.trim())
            return message;
    }
    return 'Cloudinary rechazó la carga sin devolver una descripción.';
}
function uploadBuffer(buffer, options) {
    ensureEnabled();
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
            if (error || !result) {
                reject(new AppError(502, `No se pudo guardar la imagen en Cloudinary: ${cloudinaryErrorMessage(error)}`, 'CLOUDINARY_UPLOAD_FAILED'));
                return;
            }
            resolve(result);
        });
        stream.on('error', (error) => {
            reject(new AppError(502, `No se pudo enviar la imagen a Cloudinary: ${cloudinaryErrorMessage(error)}`, 'CLOUDINARY_UPLOAD_FAILED'));
        });
        stream.end(buffer);
    });
}
const storedPhotoTransformation = [{
        width: 2048,
        height: 2048,
        crop: 'limit',
        quality: 'auto:good',
    }];
const storedVideoTransformation = [{
        width: 1920,
        height: 1920,
        crop: 'limit',
        quality: 'auto:good',
        video_codec: 'h264',
        audio_codec: 'aac',
    }];
export function uploadAnimalImage(buffer, animalId) {
    return uploadBuffer(buffer, {
        folder: `${configuredFolder}/${animalId}`,
        resource_type: 'image',
        overwrite: false,
        unique_filename: true,
        use_filename: false,
        transformation: storedPhotoTransformation,
    });
}
export function uploadAnimalMedia(buffer, animalId, mimeType) {
    const isVideo = mimeType.toLowerCase().startsWith('video/');
    return uploadBuffer(buffer, {
        folder: `${configuredFolder}/${animalId}`,
        resource_type: isVideo ? 'video' : 'image',
        overwrite: false,
        unique_filename: true,
        use_filename: false,
        transformation: isVideo ? storedVideoTransformation : storedPhotoTransformation,
    });
}
export function uploadMarkImage(buffer, markId) {
    return uploadBuffer(buffer, {
        public_id: `${rootFolder}/fierros/${markId}-${Date.now()}`,
        resource_type: 'image',
        overwrite: true,
        invalidate: true,
        transformation: [{ width: 1200, height: 900, crop: 'fill', gravity: 'auto', quality: 'auto:good' }],
    });
}
export function uploadUserProfileImage(buffer, userId) {
    return uploadBuffer(buffer, {
        public_id: `${rootFolder}/usuarios/${userId}/perfil`,
        resource_type: 'image',
        overwrite: true,
        invalidate: true,
        transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto:good' }],
    });
}
export function uploadRecordImage(buffer, moduleName, recordId) {
    const safeModule = moduleName.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    return uploadBuffer(buffer, {
        folder: `${rootFolder}/${safeModule}/${recordId}`,
        resource_type: 'image',
        overwrite: false,
        unique_filename: true,
        use_filename: false,
        transformation: storedPhotoTransformation,
    });
}
export function cloudinaryThumbnailUrl(publicId, resourceType = 'image') {
    if (!enabled || !publicId || resourceType !== 'image')
        return null;
    return cloudinary.url(publicId, {
        secure: true,
        resource_type: resourceType,
        type: 'upload',
        transformation: [{
                width: 480,
                height: 480,
                crop: 'limit',
                fetch_format: 'auto',
                quality: 'auto:eco',
            }],
    });
}
export async function deleteCloudinaryImage(publicId) {
    if (!enabled || !publicId)
        return;
    try {
        await cloudinary.uploader.destroy(publicId, {
            invalidate: true,
            resource_type: 'image',
        });
    }
    catch (error) {
        throw new AppError(502, `No se pudo eliminar la imagen de Cloudinary: ${cloudinaryErrorMessage(error)}`, 'CLOUDINARY_DELETE_FAILED');
    }
}
export async function deleteCloudinaryMedia(publicId, resourceType = 'image') {
    if (!enabled || !publicId)
        return;
    try {
        await cloudinary.uploader.destroy(publicId, {
            invalidate: true,
            resource_type: resourceType,
        });
    }
    catch (error) {
        throw new AppError(502, `No se pudo eliminar el archivo de Cloudinary: ${cloudinaryErrorMessage(error)}`, 'CLOUDINARY_DELETE_FAILED');
    }
}
//# sourceMappingURL=cloudinary.service.js.map