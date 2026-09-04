import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { asyncHandler } from '../../core/async-handler.js';
import { created, noContent, ok } from '../../core/http.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { routeParam } from '../../core/route-param.js';
import { requirePermission } from '../../middleware/permission.js';
import { buildInsert } from '../shared/sql.js';
import { deleteCloudinaryImage } from '../../services/cloudinary.service.js';
import { deleteRecordImage, recordImageUpload, requestFiles, saveRecordImages } from '../shared/record-images.js';
import { notifyCleaning } from '../notifications/business-notifications.service.js';
const productSchema = z.object({
    id_producto: z.string().uuid(),
    id_unidad: z.string().uuid(),
    cantidad_por_tanque: z.number().positive(),
    observaciones: z.string().max(300).nullable().optional(),
});
const schema = z.object({
    id_potrero: z.string().uuid(),
    id_tipo_limpieza: z.string().uuid().optional(),
    id_tipos_limpieza: z.array(z.string().uuid()).max(20).default([]),
    fecha_inicio: z.string().date(),
    fecha_finalizacion: z.string().date().nullable().optional(),
    unidad_aplicacion: z.enum(['TANQUES', 'BOMBADAS']).default('TANQUES'),
    cantidad_tanques: z.number().positive().nullable().optional(),
    capacidad_tanque_litros: z.number().positive().nullable().optional(),
    tipo_area_intervenida: z.enum(['TOTAL', 'PARCIAL']).default('TOTAL'),
    estado: z.enum(['BORRADOR', 'PENDIENTE', 'EN_PROCESO', 'COMPLETADO', 'CANCELADO']).default('COMPLETADO'),
    observaciones: z.string().nullable().optional(),
    productos: z.array(productSchema).default([]),
    operadores: z.array(z.object({
        id_operador: z.string().uuid(),
        funcion: z.string().max(100).nullable().optional(),
        observaciones: z.string().max(300).nullable().optional(),
    })).default([]),
}).superRefine((input, ctx) => {
    if (!input.id_tipo_limpieza && !input.id_tipos_limpieza.length)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['id_tipos_limpieza'], message: 'Selecciona al menos una actividad de limpieza.' });
});
function cleaningTypeIds(input) {
    return [...new Set(input.id_tipos_limpieza.length ? input.id_tipos_limpieza : (input.id_tipo_limpieza ? [input.id_tipo_limpieza] : []))];
}
async function replaceCleaningTypes(client, cleaningId, ids, userId) {
    const valid = await client.query('SELECT id_tipo_limpieza FROM tipo_limpieza_potrero WHERE id_tipo_limpieza=ANY($1::uuid[]) AND activo=TRUE AND deleted_at IS NULL', [ids]);
    if (valid.rowCount !== ids.length)
        throw new ValidationError('Una o más actividades de limpieza no están disponibles.');
    await client.query('UPDATE limpieza_potrero_actividad SET deleted_at=NOW() WHERE id_limpieza=$1 AND deleted_at IS NULL', [cleaningId]);
    for (const id of ids)
        await client.query(buildInsert('limpieza_potrero_actividad', { id_limpieza: cleaningId, id_tipo_limpieza: id, registrado_por: userId }));
}
const imageDefinition = { table: 'limpieza_potrero_imagen', idColumn: 'id_limpieza_imagen', parentColumn: 'id_limpieza', parentTable: 'limpieza_potrero', parentIdColumn: 'id_limpieza', moduleName: 'limpiezas' };
function calculatedProducts(input) {
    if (input.productos.length && !input.cantidad_tanques) {
        throw new ValidationError('Ingrese la cantidad de tanques o bombadas para calcular el producto total utilizado.');
    }
    const applications = input.cantidad_tanques ?? 0;
    return input.productos.map((product) => ({
        ...product,
        cantidad_total: Number((product.cantidad_por_tanque * applications).toFixed(4)),
    }));
}
export const cleaningsRouter = Router();
cleaningsRouter.get('/', requirePermission('LIMPIEZA_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, (await pool.query(`
  SELECT l.*,u.nombre potrero,
    COALESCE((SELECT string_agg(tla.nombre,', ' ORDER BY tla.nombre)
      FROM limpieza_potrero_actividad la JOIN tipo_limpieza_potrero tla ON tla.id_tipo_limpieza=la.id_tipo_limpieza
      WHERE la.id_limpieza=l.id_limpieza AND la.deleted_at IS NULL),tl.nombre) tipo_limpieza,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id_tipo_limpieza',tla.id_tipo_limpieza,'nombre',tla.nombre) ORDER BY tla.nombre)
      FROM limpieza_potrero_actividad la JOIN tipo_limpieza_potrero tla ON tla.id_tipo_limpieza=la.id_tipo_limpieza
      WHERE la.id_limpieza=l.id_limpieza AND la.deleted_at IS NULL),jsonb_build_array(jsonb_build_object('id_tipo_limpieza',tl.id_tipo_limpieza,'nombre',tl.nombre))) tipos_limpieza,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id_producto',lp.id_producto,'producto',pa.nombre_comercial,
      'cantidad_total',lp.cantidad_total,'id_unidad',lp.id_unidad,'unidad',COALESCE(um.simbolo,um.nombre),
      'cantidad_por_tanque',lp.cantidad_por_tanque,'observaciones',lp.observaciones
    )) FROM limpieza_potrero_producto lp
      JOIN producto_agroquimico pa ON pa.id_producto=lp.id_producto
      JOIN unidad_medida um ON um.id_unidad=lp.id_unidad
      WHERE lp.id_limpieza=l.id_limpieza AND lp.deleted_at IS NULL),'[]') productos,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id_operador',o.id_operador,'nombre',concat_ws(' ',o.nombres,o.apellidos),
      'funcion',lo.funcion,'observaciones',lo.observaciones
    )) FROM limpieza_potrero_operador lo JOIN operador o ON o.id_operador=lo.id_operador
      WHERE lo.id_limpieza=l.id_limpieza AND lo.deleted_at IS NULL),'[]') operadores,
    COALESCE((SELECT jsonb_agg(to_jsonb(li) ORDER BY li.created_at)
      FROM limpieza_potrero_imagen li WHERE li.id_limpieza=l.id_limpieza AND li.deleted_at IS NULL),'[]') imagenes
  FROM limpieza_potrero l
  JOIN potrero p ON p.id_potrero=l.id_potrero
  JOIN ubicacion u ON u.id_ubicacion=p.id_ubicacion
  JOIN tipo_limpieza_potrero tl ON tl.id_tipo_limpieza=l.id_tipo_limpieza
  WHERE l.deleted_at IS NULL ORDER BY l.fecha_inicio DESC
`)).rows)));
cleaningsRouter.get('/:id', requirePermission('LIMPIEZA_CONSULTAR'), asyncHandler(async (req, res) => {
    const row = (await pool.query(`
    SELECT l.*,u.nombre potrero,
      COALESCE((SELECT string_agg(tla.nombre,', ' ORDER BY tla.nombre)
        FROM limpieza_potrero_actividad la JOIN tipo_limpieza_potrero tla ON tla.id_tipo_limpieza=la.id_tipo_limpieza
        WHERE la.id_limpieza=l.id_limpieza AND la.deleted_at IS NULL),tl.nombre) tipo_limpieza,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id_tipo_limpieza',tla.id_tipo_limpieza,'nombre',tla.nombre) ORDER BY tla.nombre)
        FROM limpieza_potrero_actividad la JOIN tipo_limpieza_potrero tla ON tla.id_tipo_limpieza=la.id_tipo_limpieza
        WHERE la.id_limpieza=l.id_limpieza AND la.deleted_at IS NULL),jsonb_build_array(jsonb_build_object('id_tipo_limpieza',tl.id_tipo_limpieza,'nombre',tl.nombre))) tipos_limpieza,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id_producto',lp.id_producto,'producto',pa.nombre_comercial,
        'cantidad_total',lp.cantidad_total,'id_unidad',lp.id_unidad,'unidad',COALESCE(um.simbolo,um.nombre),
        'cantidad_por_tanque',lp.cantidad_por_tanque,'observaciones',lp.observaciones
      )) FROM limpieza_potrero_producto lp
        JOIN producto_agroquimico pa ON pa.id_producto=lp.id_producto
        JOIN unidad_medida um ON um.id_unidad=lp.id_unidad
        WHERE lp.id_limpieza=l.id_limpieza AND lp.deleted_at IS NULL),'[]') productos,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id_operador',o.id_operador,'nombre',concat_ws(' ',o.nombres,o.apellidos),
        'funcion',lo.funcion,'observaciones',lo.observaciones
      )) FROM limpieza_potrero_operador lo JOIN operador o ON o.id_operador=lo.id_operador
        WHERE lo.id_limpieza=l.id_limpieza AND lo.deleted_at IS NULL),'[]') operadores,
      COALESCE((SELECT jsonb_agg(to_jsonb(li) ORDER BY li.created_at)
        FROM limpieza_potrero_imagen li WHERE li.id_limpieza=l.id_limpieza AND li.deleted_at IS NULL),'[]') imagenes
    FROM limpieza_potrero l
    JOIN potrero p ON p.id_potrero=l.id_potrero
    JOIN ubicacion u ON u.id_ubicacion=p.id_ubicacion
    JOIN tipo_limpieza_potrero tl ON tl.id_tipo_limpieza=l.id_tipo_limpieza
    WHERE l.id_limpieza=$1 AND l.deleted_at IS NULL`, [routeParam(req.params.id, 'id')])).rows[0];
    if (!row)
        throw new NotFoundError('Limpieza no encontrada.');
    return ok(res, row);
}));
cleaningsRouter.post('/', requirePermission('LIMPIEZA_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const input = schema.parse(req.body);
    const result = await transaction(async (client) => {
        const { productos: _products, operadores, id_tipos_limpieza: _types, id_tipo_limpieza: _legacyType, ...head } = input;
        const types = cleaningTypeIds(input);
        const cleaning = (await client.query(buildInsert('limpieza_potrero', {
            ...head,
            id_tipo_limpieza: types[0],
            area_intervenida: null,
            id_unidad_area: null,
            registrado_por: req.user.id,
        }))).rows[0];
        await replaceCleaningTypes(client, cleaning.id_limpieza, types, req.user.id);
        for (const product of calculatedProducts(input)) {
            await client.query(buildInsert('limpieza_potrero_producto', { ...product, id_limpieza: cleaning.id_limpieza }));
        }
        for (const operator of operadores) {
            await client.query(buildInsert('limpieza_potrero_operador', { ...operator, id_limpieza: cleaning.id_limpieza }));
        }
        await notifyCleaning(client, cleaning, req.user.id);
        return cleaning;
    }, req.user.id);
    return created(res, result);
}));
cleaningsRouter.patch('/:id', requirePermission('LIMPIEZA_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, 'id');
    const input = schema.parse(req.body);
    const result = await transaction(async (client) => {
        const found = (await client.query('SELECT id_limpieza FROM limpieza_potrero WHERE id_limpieza=$1 AND deleted_at IS NULL FOR UPDATE', [id])).rows[0];
        if (!found)
            throw new NotFoundError('Limpieza no encontrada.');
        const { productos: _products, operadores, id_tipos_limpieza: _types, id_tipo_limpieza: _legacyType, ...head } = input;
        const types = cleaningTypeIds(input);
        const row = (await client.query(`UPDATE limpieza_potrero SET id_potrero=$2,id_tipo_limpieza=$3,fecha_inicio=$4,fecha_finalizacion=$5,
        unidad_aplicacion=$6,cantidad_tanques=$7,capacidad_tanque_litros=$8,tipo_area_intervenida=$9,
        area_intervenida=NULL,id_unidad_area=NULL,estado=$10,observaciones=$11,updated_at=NOW()
       WHERE id_limpieza=$1 RETURNING *`, [id, head.id_potrero, types[0], head.fecha_inicio, head.fecha_finalizacion ?? null,
            head.unidad_aplicacion, head.cantidad_tanques ?? null, head.capacidad_tanque_litros ?? null,
            head.tipo_area_intervenida, head.estado, head.observaciones ?? null])).rows[0];
        await replaceCleaningTypes(client, id, types, req.user.id);
        await client.query('DELETE FROM limpieza_potrero_producto WHERE id_limpieza=$1', [id]);
        await client.query('DELETE FROM limpieza_potrero_operador WHERE id_limpieza=$1', [id]);
        for (const product of calculatedProducts(input)) {
            await client.query(buildInsert('limpieza_potrero_producto', { ...product, id_limpieza: id }));
        }
        for (const operator of operadores) {
            await client.query(buildInsert('limpieza_potrero_operador', { ...operator, id_limpieza: id }));
        }
        return row;
    }, req.user.id);
    return ok(res, result);
}));
cleaningsRouter.post('/:id/imagenes', requirePermission('LIMPIEZA_ADMINISTRAR'), recordImageUpload.array('imagenes', 3), asyncHandler(async (req, res) => {
    const rows = await transaction(client => saveRecordImages(client, imageDefinition, routeParam(req.params.id, 'id'), requestFiles(req), req.user.id), req.user.id);
    return created(res, rows);
}));
cleaningsRouter.delete('/imagenes/:imageId', requirePermission('LIMPIEZA_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const image = await transaction(client => deleteRecordImage(client, imageDefinition, routeParam(req.params.imageId, 'imageId')), req.user.id);
    await deleteCloudinaryImage(image.public_id);
    return noContent(res);
}));
//# sourceMappingURL=cleanings.routes.js.map