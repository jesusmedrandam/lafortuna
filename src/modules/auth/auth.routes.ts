import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { asyncHandler } from '../../core/async-handler.js';
import { ValidationError } from '../../core/errors.js';
import { created, ok } from '../../core/http.js';
import { env } from '../../config/env.js';
import { pool } from '../../database/pool.js';
import { authenticate } from '../../middleware/auth.js';
import { cache } from '../../services/cache.service.js';
import { uploadUserProfileImage } from '../../services/cloudinary.service.js';
import { codeSchema, emailSchema, loginSchema, profileSchema, refreshSchema, registerSchema, resetSchema } from './auth.schemas.js';
import * as service from './auth.service.js';

export const authRouter = Router();
const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false });
const profilePhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_IMAGE_MB * 1024 * 1024 },
  fileFilter: (_req, file, callback) => file.mimetype.startsWith('image/')
    ? callback(null, true)
    : callback(new ValidationError('Solo se permiten imágenes.')),
});

authRouter.use(limiter);
authRouter.post('/register', asyncHandler(async (req, res) => created(res, await service.register(registerSchema.parse(req.body)))));
authRouter.post('/verify-email', asyncHandler(async (req, res) => {
  const input = codeSchema.parse(req.body);
  return ok(res, await service.verifyEmail(input.correo, input.codigo));
}));
authRouter.post('/resend-verification', asyncHandler(async (req, res) => {
  const input = emailSchema.parse(req.body);
  return ok(res, await service.resendVerification(input.correo));
}));
authRouter.post('/login', asyncHandler(async (req, res) => {
  const input = loginSchema.parse(req.body);
  return ok(res, await service.login(input.correo, input.password, { ip: req.ip, userAgent: req.get('user-agent') }));
}));
authRouter.post('/refresh', asyncHandler(async (req, res) => {
  const input = refreshSchema.parse(req.body);
  return ok(res, await service.refresh(input.refreshToken, { ip: req.ip, userAgent: req.get('user-agent') }));
}));
authRouter.post('/logout', asyncHandler(async (req, res) => {
  const input = refreshSchema.parse(req.body);
  return ok(res, await service.logout(input.refreshToken));
}));
authRouter.post('/forgot-password', asyncHandler(async (req, res) => {
  const input = emailSchema.parse(req.body);
  return ok(res, await service.forgotPassword(input.correo));
}));
authRouter.post('/reset-password', asyncHandler(async (req, res) => {
  const input = resetSchema.parse(req.body);
  return ok(res, await service.resetPassword(input.correo, input.codigo, input.password));
}));
authRouter.get('/me', authenticate, asyncHandler(async (req, res) => ok(res, await service.profile(req.user!.id))));
authRouter.patch('/me', authenticate, asyncHandler(async (req, res) => ok(res, await service.updateProfile(req.user!.id, profileSchema.parse(req.body)))));
authRouter.post('/me/photo', authenticate, profilePhotoUpload.single('imagen'), asyncHandler(async (req, res) => {
  if (!req.file) throw new ValidationError('Debes seleccionar una imagen.');
  const uploaded = await uploadUserProfileImage(req.file.buffer, req.user!.id);
  const result = await pool.query(
    `UPDATE usuario
     SET foto_perfil_url=$2, foto_perfil_public_id=$3, updated_at=NOW(), version=version+1
     WHERE id_usuario=$1 AND deleted_at IS NULL
     RETURNING id_usuario,foto_perfil_url`,
    [req.user!.id, uploaded.secure_url, uploaded.public_id],
  );
  cache.forgetModuleVersion('usuarios');
  return ok(res, result.rows[0]);
}));
