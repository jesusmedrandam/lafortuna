import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, noContent, ok } from '../../core/http.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { assertPermission, requirePermission } from '../../middleware/permission.js';
import { buildInsert, buildUpdate } from '../shared/sql.js';

type Def = {
  table: string;
  id: string;
  animalColumn: 'id_animal' | 'id_vaca';
  read: string;
  write: string;
  columns: string[];
  order: string;
};

const defs: Record<string, Def> = {
  abortos: { table: 'aborto', id: 'id_aborto', animalColumn: 'id_vaca', read: 'ABORTO_CONSULTAR', write: 'ABORTO_ADMINISTRAR', columns: ['id_vaca','fecha','causa','meses_gestacion','descripcion'], order: 'fecha DESC NULLS LAST' },
  lactancias: { table: 'lactancia', id: 'id_lactancia', animalColumn: 'id_vaca', read: 'LACTANCIA_CONSULTAR', write: 'LACTANCIA_ADMINISTRAR', columns: ['id_vaca','id_parto','fecha_inicio','fecha_fin','activa','observaciones'], order: 'fecha_inicio DESC' },
  producciones: { table: 'produccion_leche', id: 'id_produccion', animalColumn: 'id_vaca', read: 'PRODUCCION_CONSULTAR', write: 'PRODUCCION_ADMINISTRAR', columns: ['id_vaca','id_lactancia','fecha_produccion','turno','litros','observaciones'], order: 'fecha_produccion DESC' },
  pesajes: { table: 'pesaje', id: 'id_pesaje', animalColumn: 'id_animal', read: 'PESAJE_CONSULTAR', write: 'PESAJE_ADMINISTRAR', columns: ['id_animal','fecha_pesaje','peso_kg','metodo','observaciones'], order: 'fecha_pesaje DESC' },
  muertes: { table: 'muerte', id: 'id_muerte', animalColumn: 'id_animal', read: 'MUERTE_CONSULTAR', write: 'MUERTE_ADMINISTRAR', columns: ['id_animal','fecha','causa','descripcion'], order: 'fecha DESC' },
  tratamientos: { table: 'tratamiento_animal', id: 'id_tratamiento', animalColumn: 'id_animal', read: 'SANIDAD_CONSULTAR', write: 'SANIDAD_ADMINISTRAR', columns: ['id_animal','id_tipo_tratamiento','id_medicamento','id_via_administracion','dosis','id_unidad_dosis','fecha_aplicacion','proxima_aplicacion','aplicado_por','descripcion','observaciones'], order: 'fecha_aplicacion DESC' }
};

function definition(moduleName: string | undefined) {
  const value = moduleName ? defs[moduleName] : undefined;
  if (!value) throw new NotFoundError('Módulo no encontrado.');
  return value;
}
function allowedBody(body: Record<string, unknown>, columns: string[]) {
  const data = Object.fromEntries(Object.entries(body).filter(([key]) => columns.includes(key)));
  if (!Object.keys(data).length) throw new ValidationError('No hay campos válidos para guardar.');
  return data;
}

export const recordsRouter = Router();
recordsRouter.get('/:module', asyncHandler(async (req, res) => {
  const d = definition(routeParam(req.params.module, 'module'));
  assertPermission(req.user, d.read);
  const rows = (await pool.query(
    `SELECT r.*, a.nombre animal, a.codigo_arete
     FROM ${d.table} r
     LEFT JOIN animal a ON a.id_animal = r.${d.animalColumn}
     WHERE r.deleted_at IS NULL
     ORDER BY r.${d.order}`
  )).rows;
  return ok(res, rows);
}));
recordsRouter.post('/:module', asyncHandler(async (req, res) => {
  const d = definition(routeParam(req.params.module, 'module'));
  assertPermission(req.user, d.write);
  const data = allowedBody(req.body as Record<string, unknown>, d.columns);
  const row = (await pool.query(buildInsert(d.table, { ...data, registrado_por: req.user!.id }))).rows[0];
  return created(res, row);
}));
recordsRouter.patch('/:module/:id', asyncHandler(async (req, res) => {
  const d = definition(routeParam(req.params.module, 'module'));
  assertPermission(req.user, d.write);
  const data = allowedBody(req.body as Record<string, unknown>, d.columns);
  const row = (await pool.query(buildUpdate(d.table, d.id, routeParam(req.params.id, 'id'), data))).rows[0];
  if (!row) throw new NotFoundError();
  return ok(res, row);
}));
recordsRouter.delete('/:module/:id', asyncHandler(async (req, res) => {
  const d = definition(routeParam(req.params.module, 'module'));
  assertPermission(req.user, d.write);
  const result = await pool.query(`UPDATE ${d.table} SET deleted_at=NOW() WHERE ${d.id}=$1 AND deleted_at IS NULL`, [routeParam(req.params.id, 'id')]);
  if (!result.rowCount) throw new NotFoundError();
  return noContent(res);
}));

const partoSchema = z.object({
  id_madre: z.string().uuid(),
  id_padre: z.string().uuid().nullable().optional(),
  fecha_parto: z.string().datetime(),
  tipo_parto: z.enum(['NORMAL','ASISTIDO','CESAREA','DESCONOCIDO']).default('NORMAL'),
  observaciones: z.string().nullable().optional(),
  crias: z.array(z.object({
    animal: z.object({
      codigo_arete: z.string().max(60).nullable().optional(),
      nombre: z.string().trim().min(1).max(120),
      id_especie: z.string().uuid(),
      sexo: z.enum(['MACHO','HEMBRA']),
      id_origen: z.string().uuid(),
      id_grupo_actual: z.string().uuid().nullable().optional(),
      id_ubicacion_actual: z.string().uuid().nullable().optional(),
      estado: z.enum(['ACTIVO','MUERTO']).default('ACTIVO')
    }),
    estado_nacimiento: z.enum(['VIVA','MUERTA','DEBIL','DESCONOCIDO']).default('VIVA'),
    peso_nacimiento_kg: z.number().positive().nullable().optional(),
    observaciones: z.string().max(300).nullable().optional()
  })).min(1)
});

export const birthsRouter = Router();
birthsRouter.get('/', requirePermission('PARTO_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, (await pool.query(
  `SELECT p.*, m.nombre madre, pa.nombre padre,
   COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id_parto_cria',pc.id_parto_cria,'id_cria',c.id_animal,'cria',c.nombre,
      'sexo',c.sexo,'estado_nacimiento',pc.estado_nacimiento,
      'peso_nacimiento_kg',pc.peso_nacimiento_kg,'orden_nacimiento',pc.orden_nacimiento
   ) ORDER BY pc.orden_nacimiento)
   FROM parto_cria pc JOIN animal c ON c.id_animal=pc.id_cria
   WHERE pc.id_parto=p.id_parto AND pc.deleted_at IS NULL),'[]') crias
   FROM parto p JOIN animal m ON m.id_animal=p.id_madre
   LEFT JOIN animal pa ON pa.id_animal=p.id_padre
   WHERE p.deleted_at IS NULL ORDER BY p.fecha_parto DESC`
)).rows)));

birthsRouter.post('/', requirePermission('PARTO_ADMINISTRAR'), asyncHandler(async (req, res) => {
  const input = partoSchema.parse(req.body);
  const result = await transaction(async (client) => {
    const { crias, ...head } = input;
    const parto = (await client.query(buildInsert('parto', { ...head, registrado_por: req.user!.id }))).rows[0];
    let order = 1;
    for (const item of crias) {
      const cria = (await client.query(buildInsert('animal', {
        ...item.animal,
        fecha_nacimiento: input.fecha_parto.slice(0, 10),
        id_madre: input.id_madre,
        id_padre: input.id_padre ?? null,
        registrado_por: req.user!.id
      }))).rows[0];
      await client.query(buildInsert('parto_cria', {
        id_parto: parto.id_parto,
        id_cria: cria.id_animal,
        estado_nacimiento: item.estado_nacimiento,
        peso_nacimiento_kg: item.peso_nacimiento_kg ?? null,
        orden_nacimiento: order++,
        observaciones: item.observaciones ?? null
      }));
    }
    return parto;
  }, req.user!.id);
  return created(res, result);
}));
