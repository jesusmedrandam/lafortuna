import { v2 as cloudinary, type UploadApiOptions, type UploadApiResponse } from 'cloudinary';
import { env } from '../config/env.js';
import { AppError } from '../core/errors.js';

const enabled = Boolean(
  env.CLOUDINARY_CLOUD_NAME &&
  env.CLOUDINARY_API_KEY &&
  env.CLOUDINARY_API_SECRET,
);

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
    throw new AppError(
      503,
      'Cloudinary todavía no está configurado en el servidor.',
      'CLOUDINARY_NOT_CONFIGURED',
    );
  }
}

function cloudinaryErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return 'Cloudinary rechazó la carga sin devolver una descripción.';
}

function uploadBuffer(buffer: Buffer, options: UploadApiOptions): Promise<UploadApiResponse> {
  ensureEnabled();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error || !result) {
        reject(new AppError(
          502,
          `No se pudo guardar la imagen en Cloudinary: ${cloudinaryErrorMessage(error)}`,
          'CLOUDINARY_UPLOAD_FAILED',
        ));
        return;
      }
      resolve(result);
    });

    stream.on('error', (error) => {
      reject(new AppError(
        502,
        `No se pudo enviar la imagen a Cloudinary: ${cloudinaryErrorMessage(error)}`,
        'CLOUDINARY_UPLOAD_FAILED',
      ));
    });

    stream.end(buffer);
  });
}

export function uploadAnimalImage(buffer: Buffer, animalId: string): Promise<UploadApiResponse> {
  // f_auto/fetch_format se aplica al entregar la imagen, no durante la carga.
  // Guardamos el original y Cloudinary optimiza las URLs derivadas cuando se soliciten.
  return uploadBuffer(buffer, {
    folder: `${configuredFolder}/${animalId}`,
    resource_type: 'image',
    overwrite: false,
    unique_filename: true,
    use_filename: false,
  });
}

export function uploadAnimalMedia(buffer: Buffer, animalId: string): Promise<UploadApiResponse> {
  return uploadBuffer(buffer, {
    folder: `${configuredFolder}/${animalId}`,
    resource_type: 'auto',
    overwrite: false,
    unique_filename: true,
    use_filename: false,
  });
}

export function uploadUserProfileImage(buffer: Buffer, userId: string): Promise<UploadApiResponse> {
  return uploadBuffer(buffer, {
    public_id: `${rootFolder}/usuarios/${userId}/perfil`,
    resource_type: 'image',
    overwrite: true,
    invalidate: true,
  });
}

export async function deleteCloudinaryImage(publicId: string) {
  if (!enabled || !publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, {
      invalidate: true,
      resource_type: 'image',
    });
  } catch (error) {
    throw new AppError(
      502,
      `No se pudo eliminar la imagen de Cloudinary: ${cloudinaryErrorMessage(error)}`,
      'CLOUDINARY_DELETE_FAILED',
    );
  }
}

export async function deleteCloudinaryMedia(publicId: string, resourceType: 'image' | 'video' = 'image') {
  if (!enabled || !publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, {
      invalidate: true,
      resource_type: resourceType,
    });
  } catch (error) {
    throw new AppError(
      502,
      `No se pudo eliminar el archivo de Cloudinary: ${cloudinaryErrorMessage(error)}`,
      'CLOUDINARY_DELETE_FAILED',
    );
  }
}
