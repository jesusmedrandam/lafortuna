import { z } from 'zod';

const password = z.string()
  .min(8)
  .max(72)
  .regex(/[A-Za-z]/, 'Debe contener una letra.')
  .regex(/[0-9]/, 'Debe contener un número.');

export const registerSchema = z.object({
  nombres: z.string().trim().min(2).max(80),
  apellidos: z.string().trim().min(2).max(80),
  correo: z.string().trim().email().max(150),
  password,
  telefono: z.string().trim().max(25).optional(),
});

export const loginSchema = z.object({
  correo: z.string().trim().email(),
  password: z.string().min(1),
});

export const codeSchema = z.object({
  correo: z.string().trim().email(),
  codigo: z.string().regex(/^\d{6}$/),
});

export const emailSchema = z.object({ correo: z.string().trim().email() });
export const refreshSchema = z.object({ refreshToken: z.string().min(20) });
export const resetSchema = z.object({
  correo: z.string().trim().email(),
  codigo: z.string().regex(/^\d{6}$/),
  password,
});

export const profileSchema = z.object({
  nombres: z.string().trim().min(2).max(80).optional(),
  apellidos: z.string().trim().min(2).max(80).optional(),
  correo: z.string().trim().email().max(150).optional(),
  telefono: z.string().trim().max(25).nullable().optional(),
  fecha_nacimiento: z.string().date().nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, 'No hay cambios.');
