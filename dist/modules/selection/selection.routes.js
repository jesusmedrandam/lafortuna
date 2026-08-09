import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { asyncHandler } from '../../core/async-handler.js';
import { ValidationError } from '../../core/errors.js';
import { ok } from '../../core/http.js';
import { requirePermission } from '../../middleware/permission.js';
const operation = z.enum([
    'MOVIMIENTO_UBICACION', 'MOVIMIENTO_GRUPO', 'MOVIMIENTO_PROPIEDAD', 'CELO', 'PRENEZ', 'PARTO',
    'ABORTO', 'TRATAMIENTO', 'VENTA', 'PESAJE', 'MUERTE', 'LACTANCIA', 'PRODUCCION_LECHE',
]);
const schema = z.object({
    modo: z.enum(['TODOS', 'GRUPO', 'SELECCION_MANUAL']),
    id_grupo: z.string().uuid().nullable().optional(),
    ids: z.array(z.string().uuid()).default([]),
    operaciones: z.array(operation).default([]),
    filtros: z.object({
        id_especie: z.string().uuid().optional(),
        sexo: z.enum(['MACHO', 'HEMBRA']).optional(),
        id_ubicacion: z.string().uuid().optional(),
        excluir_id_ubicacion: z.string().uuid().optional(),
        situacion_propiedad: z.enum(['EN_PROPIEDAD', 'FUERA_PROPIEDAD']).optional(),
        propiedad_origen: z.union([z.literal('PROPIEDAD_PRINCIPAL'), z.string().uuid()]).optional(),
        estado: z.string().optional(),
    }).default({}),
});
export const selectionRouter = Router();
selectionRouter.post('/animales/preview', requirePermission('ANIMAL_CONSULTAR'), asyncHandler(async (req, res) => {
    const input = schema.parse(req.body);
    const params = [];
    const where = ["a.deleted_at IS NULL", "a.estado='ACTIVO'"];
    const add = (column, value) => {
        params.push(value);
        where.push(`${column}=$${params.length}`);
    };
    if (input.modo === 'GRUPO') {
        if (!input.id_grupo)
            throw new ValidationError('El grupo es obligatorio.');
        add('a.id_grupo_actual', input.id_grupo);
    }
    if (input.modo === 'SELECCION_MANUAL') {
        params.push(input.ids);
        where.push(`a.id_animal=ANY($${params.length}::uuid[])`);
    }
    if (input.filtros.id_especie)
        add('a.id_especie', input.filtros.id_especie);
    if (input.filtros.sexo)
        add('a.sexo', input.filtros.sexo);
    if (input.filtros.id_ubicacion)
        add('a.id_ubicacion_actual', input.filtros.id_ubicacion);
    if (input.filtros.excluir_id_ubicacion) {
        params.push(input.filtros.excluir_id_ubicacion);
        where.push(`a.id_ubicacion_actual IS DISTINCT FROM $${params.length}::uuid`);
    }
    if (input.filtros.situacion_propiedad === 'EN_PROPIEDAD')
        where.push("ca.codigo='EN_PROPIEDAD'");
    if (input.filtros.situacion_propiedad === 'FUERA_PROPIEDAD')
        where.push("ca.codigo<>'EN_PROPIEDAD'");
    if (input.filtros.propiedad_origen === 'PROPIEDAD_PRINCIPAL') {
        where.push("u.tipo<>'OTRO' AND u.id_propiedad_padre IS NULL");
    }
    else if (input.filtros.propiedad_origen) {
        params.push(input.filtros.propiedad_origen);
        where.push(`(u.id_ubicacion=$${params.length} OR u.id_propiedad_padre=$${params.length})`);
    }
    if (input.filtros.estado)
        add('a.estado', input.filtros.estado);
    if (input.operaciones.length) {
        params.push(input.operaciones);
        where.push(`NOT EXISTS (
      SELECT 1 FROM unnest($${params.length}::text[]) op(codigo)
      WHERE COALESCE((
        SELECT oca.permitido FROM operacion_categoria_animal oca
        WHERE oca.id_categoria_animal=a.id_categoria_animal
          AND oca.codigo_operacion=op.codigo AND oca.deleted_at IS NULL LIMIT 1
      ),TRUE)=FALSE
    )`);
    }
    const rows = (await pool.query(`SELECT a.id_animal,a.codigo_arete,a.nombre,a.sexo,a.id_categoria_animal,
      ca.nombre categoria,ca.codigo categoria_codigo,a.id_grupo_actual,g.nombre grupo,
      a.id_ubicacion_actual,u.nombre ubicacion,TRUE seleccionado
     FROM animal a
     JOIN categoria_animal ca ON ca.id_categoria_animal=a.id_categoria_animal
     LEFT JOIN grupo g ON g.id_grupo=a.id_grupo_actual
     LEFT JOIN ubicacion u ON u.id_ubicacion=a.id_ubicacion_actual
     WHERE ${where.join(' AND ')} ORDER BY a.nombre`, params)).rows;
    return ok(res, rows, { total: rows.length });
}));
//# sourceMappingURL=selection.routes.js.map