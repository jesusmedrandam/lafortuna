import type { AuthUser } from '../types/api';

type Rule = { pattern: RegExp; permission: string | ((path: string, method: string) => string) };

const rules: Rule[] = [
  { pattern: /^\/animales(?:\/|$)/, permission: (path, method) => method === 'DELETE' ? 'ANIMAL_ELIMINAR' : method === 'POST' && path === '/animales' ? 'ANIMAL_CREAR' : path.includes('/imagenes') ? 'IMAGEN_ADMINISTRAR' : 'ANIMAL_MODIFICAR' },
  { pattern: /^\/imagenes(?:\/|$)/, permission: 'IMAGEN_ADMINISTRAR' },
  { pattern: /^\/movimientos(?:\/|$)/, permission: (path) => path.endsWith('/cancelar') ? 'MOVIMIENTO_ANULAR' : 'MOVIMIENTO_CREAR' },
  { pattern: /^\/grupos(?:\/|$)/, permission: 'GRUPO_ADMINISTRAR' },
  { pattern: /^\/potreros(?:\/|$)/, permission: 'POTRERO_ADMINISTRAR' },
  { pattern: /^\/corrales(?:\/|$)/, permission: 'CORRAL_ADMINISTRAR' },
  { pattern: /^\/ubicaciones(?:\/|$)/, permission: 'UBICACION_ADMINISTRAR' },
  { pattern: /^\/(limpiezas-potrero|operadores)(?:\/|$)/, permission: 'LIMPIEZA_ADMINISTRAR' },
  { pattern: /^\/(jornadas-sanitarias|condiciones-salud)(?:\/|$)/, permission: 'SANIDAD_ADMINISTRAR' },
  { pattern: /^\/registros\/tratamientos(?:\/|$)/, permission: 'SANIDAD_ADMINISTRAR' },
  { pattern: /^\/registros\/lactancias(?:\/|$)/, permission: 'LACTANCIA_ADMINISTRAR' },
  { pattern: /^\/registros\/(producciones|produccion-tanque)(?:\/|$)/, permission: 'PRODUCCION_ADMINISTRAR' },
  { pattern: /^\/registros\/pesajes(?:\/|$)/, permission: 'PESAJE_ADMINISTRAR' },
  { pattern: /^\/registros\/muertes(?:\/|$)/, permission: 'MUERTE_ADMINISTRAR' },
  { pattern: /^\/registros\/abortos(?:\/|$)/, permission: 'ABORTO_ADMINISTRAR' },
  { pattern: /^\/(reproduccion|partos)(?:\/|$)/, permission: 'PARTO_ADMINISTRAR' },
  { pattern: /^\/ventas(?:\/|$)/, permission: 'VENTA_ADMINISTRAR' },
  { pattern: /^\/compras(?:\/|$)/, permission: 'COMPRA_ADMINISTRAR' },
  { pattern: /^\/actividades(?:\/|$)/, permission: 'ACTIVIDAD_ADMINISTRAR' },
  { pattern: /^\/(catalogos|marquillas|configuracion)(?:\/|$)/, permission: 'CATALOGO_ADMINISTRAR' },
  { pattern: /^\/usuarios(?:\/|$)/, permission: 'USUARIO_ADMINISTRAR' },
  { pattern: /^\/roles(?:\/|$)/, permission: 'ROL_ADMINISTRAR' },
  { pattern: /^\/dashboard\/preferencias$/, permission: 'DASHBOARD_CONSULTAR' },
];

export function permissionForMutation(path: string, method: string): string | null {
  const rule = rules.find((candidate) => candidate.pattern.test(path));
  if (!rule) return null;
  return typeof rule.permission === 'function' ? rule.permission(path, method) : rule.permission;
}

export function userHasPermission(user: AuthUser, permission: string) {
  return user.roles.includes('ADMINISTRADOR') || user.permissions.includes(permission);
}
