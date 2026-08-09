import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../core/errors.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ ok: false, error: { code: 'ROUTE_NOT_FOUND', message: `Ruta no encontrada: ${req.method} ${req.originalUrl}` } });
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof ZodError) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Datos inválidos.', details: error.flatten() }, requestId: req.requestId });
  }
  if (error instanceof AppError) {
    return res.status(error.status).json({ ok: false, error: { code: error.code, message: error.message, details: error.details }, requestId: req.requestId });
  }
  const pgError = error as { code?: string; constraint?: string; detail?: string; message?: string; column?: string };
  if (pgError.code === '23505') {
    return res.status(409).json({ ok: false, error: { code: 'DUPLICATE', message: 'Ya existe un registro con esos datos.', details: pgError.constraint }, requestId: req.requestId });
  }
  if (pgError.code === '23503') {
    return res.status(409).json({ ok: false, error: { code: 'REFERENCE_CONFLICT', message: 'El registro está relacionado con otros datos o la referencia no existe.', details: pgError.detail }, requestId: req.requestId });
  }
  if (pgError.code === '23514' || pgError.code === '22P02') {
    return res.status(400).json({ ok: false, error: { code: 'DATABASE_VALIDATION', message: pgError.message || 'Los datos no cumplen las reglas del sistema.' }, requestId: req.requestId });
  }
  if (pgError.code === '23502') {
    const field = pgError.column ? ` “${pgError.column}”` : '';
    return res.status(400).json({ ok: false, error: { code: 'REQUIRED_DATABASE_FIELD', message: `Falta completar el campo obligatorio${field}.`, details: pgError.detail }, requestId: req.requestId });
  }
  if (pgError.code === 'P0001') {
    return res.status(400).json({ ok: false, error: { code: 'DATABASE_RULE', message: pgError.message || 'La operación no cumple una regla del sistema.' }, requestId: req.requestId });
  }
  if (pgError.code === '42P01' || pgError.code === '42703' || pgError.code === '42883') {
    return res.status(503).json({ ok: false, error: { code: 'DATABASE_MIGRATION_REQUIRED', message: 'La base de datos no tiene aplicada la última migración requerida para esta función.' }, requestId: req.requestId });
  }
  console.error(`[${req.requestId}]`, error);
  return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error interno.' }, requestId: req.requestId });
};
