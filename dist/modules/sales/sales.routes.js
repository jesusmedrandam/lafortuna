import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/async-handler.js';
import { created, ok } from '../../core/http.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { routeParam } from '../../core/route-param.js';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { requirePermission } from '../../middleware/permission.js';
import { cache } from '../../services/cache.service.js';
import { assertAnimalOperationAllowed } from '../../services/animal-operation-policy.js';
import { buildInsert } from '../shared/sql.js';
import { notifyAnimalSale, notifyProductSale } from '../notifications/business-notifications.service.js';
const detailSchema = z.object({
    id_animal: z.string().uuid(),
    precio_individual: z.number().min(0).nullable().optional(),
    observaciones: z.string().trim().max(300).nullable().optional(),
});
const saleSchema = z.object({
    fecha_venta: z.string().date(),
    id_comprador: z.string().uuid(),
    precio_total: z.number().min(0).nullable().optional(),
    moneda: z.string().trim().length(3).default('USD'),
    observaciones: z.string().trim().max(2000).nullable().optional(),
    animales: z.array(detailSchema).min(1),
});
const productDetailSchema = z.object({
    id_producto_venta: z.string().uuid(),
    cantidad: z.number().positive(),
    cantidad_complementaria: z.number().positive().nullable().optional(),
    precio_unitario: z.number().min(0),
    observaciones: z.string().trim().max(300).nullable().optional(),
});
const productSaleSchema = z.object({
    fecha_venta: z.string().date(),
    periodicidad: z.enum(['DIARIA', 'SEMANAL', 'OCASIONAL']),
    id_comprador: z.string().uuid(),
    moneda: z.string().trim().length(3).default('USD'),
    observaciones: z.string().trim().max(2000).nullable().optional(),
    productos: z.array(productDetailSchema).min(1),
});
const animalSaleUpdateSchema = saleSchema.omit({ animales: true });
export const salesRouter = Router();
salesRouter.get('/', requirePermission('VENTA_CONSULTAR'), asyncHandler(async (_req, res) => {
    const rows = (await pool.query(`SELECT v.*,
      TRIM(CONCAT(u.nombres, ' ', u.apellidos)) registrado_por_nombre,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id_venta_detalle', d.id_venta_detalle,
          'id_animal', a.id_animal,
          'animal', a.nombre,
          'codigo_arete', a.codigo_arete,
          'precio_individual', d.precio_individual,
          'observaciones', d.observaciones
        ) ORDER BY a.nombre)
        FROM venta_animal_detalle d
        JOIN animal a ON a.id_animal=d.id_animal
        WHERE d.id_venta=v.id_venta AND d.deleted_at IS NULL
      ), '[]'::jsonb) animales
     FROM venta_animal v
     JOIN usuario u ON u.id_usuario=v.registrado_por
     WHERE v.deleted_at IS NULL
     ORDER BY v.fecha_venta DESC, v.created_at DESC`)).rows;
    return ok(res, rows);
}));
salesRouter.get('/productos', requirePermission('VENTA_CONSULTAR'), asyncHandler(async (_req, res) => {
    const rows = (await pool.query(`SELECT v.*,
      TRIM(CONCAT(u.nombres, ' ', u.apellidos)) registrado_por_nombre,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id_venta_producto_detalle', d.id_venta_producto_detalle,
          'id_producto_venta', p.id_producto_venta,
          'producto', p.nombre,
          'unidad', COALESCE(um.simbolo,um.nombre,p.unidad,'Sin unidad'),
          'id_unidad_complementaria', p.id_unidad_complementaria,
          'unidad_complementaria', COALESCE(umc.simbolo,umc.nombre),
          'cantidad', d.cantidad,
          'cantidad_complementaria', d.cantidad_complementaria,
          'precio_unitario', d.precio_unitario,
          'subtotal', d.subtotal,
          'observaciones', d.observaciones
        ) ORDER BY p.nombre)
        FROM venta_producto_detalle d
        JOIN producto_venta p ON p.id_producto_venta=d.id_producto_venta
        LEFT JOIN unidad_medida um ON um.id_unidad=p.id_unidad_venta
        LEFT JOIN unidad_medida umc ON umc.id_unidad=p.id_unidad_complementaria
        WHERE d.id_venta_producto=v.id_venta_producto AND d.deleted_at IS NULL
      ), '[]'::jsonb) productos
     FROM venta_producto v
     JOIN usuario u ON u.id_usuario=v.registrado_por
     WHERE v.deleted_at IS NULL
     ORDER BY v.fecha_venta DESC, v.created_at DESC`)).rows;
    return ok(res, rows);
}));
salesRouter.post('/', requirePermission('VENTA_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const input = saleSchema.parse(req.body);
    const uniqueIds = new Set(input.animales.map((item) => item.id_animal));
    if (uniqueIds.size !== input.animales.length)
        throw new ValidationError('No repitas animales en la misma venta.');
    const sale = await transaction(async (client) => {
        const buyer = (await client.query(`SELECT id_comprador,nombre,contacto,destino
       FROM comprador
       WHERE id_comprador=$1 AND deleted_at IS NULL AND activo=TRUE`, [input.id_comprador])).rows[0];
        if (!buyer)
            throw new NotFoundError('El comprador no existe o está inactivo.');
        const animals = (await client.query(`SELECT id_animal,nombre,estado,id_grupo_actual,id_ubicacion_actual
       FROM animal
       WHERE id_animal=ANY($1::uuid[]) AND deleted_at IS NULL
       FOR UPDATE`, [[...uniqueIds]])).rows;
        if (animals.length !== uniqueIds.size)
            throw new NotFoundError('Uno o más animales no existen.');
        const unavailable = animals.filter((animal) => animal.estado !== 'ACTIVO');
        if (unavailable.length) {
            throw new ConflictError(`Solo se pueden vender animales activos. Revisa: ${unavailable.map((item) => item.nombre).join(', ')}.`);
        }
        for (const animal of animals)
            await assertAnimalOperationAllowed(client, animal.id_animal, 'VENTA');
        const { animales, ...header } = input;
        const row = (await client.query(buildInsert('venta_animal', {
            ...header,
            comprador_nombre: buyer.nombre,
            comprador_contacto: buyer.contacto ?? null,
            destino: buyer.destino ?? null,
            moneda: header.moneda.toUpperCase(),
            registrado_por: req.user.id,
        }))).rows[0];
        for (const detail of animales) {
            const animal = animals.find((item) => item.id_animal === detail.id_animal);
            const ownerSnapshot = (await client.query(`SELECT ap.id_usuario,ap.porcentaje_propiedad,ap.es_principal,
                TRIM(CONCAT(u.nombres,' ',u.apellidos)) nombre
         FROM animal_propietario ap
         JOIN usuario u ON u.id_usuario=ap.id_usuario
         WHERE ap.id_animal=$1 AND ap.fecha_hasta IS NULL AND ap.deleted_at IS NULL
         ORDER BY ap.es_principal DESC,u.nombres,u.apellidos`, [animal.id_animal])).rows;
            await client.query(buildInsert('venta_animal_detalle', {
                id_venta: row.id_venta,
                id_animal: animal.id_animal,
                precio_individual: detail.precio_individual ?? null,
                estado_anterior: animal.estado,
                id_grupo_anterior: animal.id_grupo_actual,
                id_ubicacion_anterior: animal.id_ubicacion_actual,
                propietarios_anteriores: JSON.stringify(ownerSnapshot),
                observaciones: detail.observaciones ?? null,
            }));
            await client.query(`UPDATE animal
         SET estado='VENDIDO',id_grupo_actual=NULL,id_ubicacion_actual=NULL
         WHERE id_animal=$1`, [animal.id_animal]);
            await client.query(`UPDATE animal_grupo_historial
         SET fecha_hasta=$2
         WHERE id_animal=$1 AND fecha_hasta IS NULL AND deleted_at IS NULL`, [animal.id_animal, input.fecha_venta]);
            await client.query(`UPDATE animal_ubicacion_historial
         SET fecha_hasta=$2
         WHERE id_animal=$1 AND fecha_hasta IS NULL AND deleted_at IS NULL`, [animal.id_animal, input.fecha_venta]);
            await client.query(`UPDATE animal_propietario
         SET fecha_hasta=$2::date
         WHERE id_animal=$1 AND fecha_hasta IS NULL AND deleted_at IS NULL`, [animal.id_animal, input.fecha_venta]);
        }
        await notifyAnimalSale(client, row, animales.length, req.user.id);
        return row;
    }, req.user.id);
    cache.forgetModuleVersion('ventas');
    cache.forgetModuleVersion('animales');
    return created(res, sale);
}));
salesRouter.post('/productos', requirePermission('VENTA_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const input = productSaleSchema.parse(req.body);
    const uniqueIds = new Set(input.productos.map((item) => item.id_producto_venta));
    if (uniqueIds.size !== input.productos.length)
        throw new ValidationError('No repitas productos en la misma venta.');
    const sale = await transaction(async (client) => {
        const buyer = (await client.query(`SELECT id_comprador,nombre,contacto,destino
       FROM comprador
       WHERE id_comprador=$1 AND deleted_at IS NULL AND activo=TRUE`, [input.id_comprador])).rows[0];
        if (!buyer)
            throw new NotFoundError('El comprador no existe o está inactivo.');
        const products = (await client.query(`SELECT id_producto_venta,nombre,id_unidad_complementaria
       FROM producto_venta
       WHERE id_producto_venta=ANY($1::uuid[]) AND deleted_at IS NULL AND activo=TRUE`, [[...uniqueIds]])).rows;
        if (products.length !== uniqueIds.size)
            throw new NotFoundError('Uno o más productos no existen o están inactivos.');
        const details = input.productos.map((item) => {
            const product = products.find((value) => value.id_producto_venta === item.id_producto_venta);
            if (product.id_unidad_complementaria && !item.cantidad_complementaria) {
                throw new ValidationError(`Ingresa la cantidad complementaria de ${product.nombre}.`);
            }
            return { ...item, cantidad_complementaria: product.id_unidad_complementaria ? item.cantidad_complementaria : null,
                subtotal: Number((item.cantidad * item.precio_unitario).toFixed(2)) };
        });
        const total = Number(details.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2));
        const row = (await client.query(buildInsert('venta_producto', {
            fecha_venta: input.fecha_venta,
            periodicidad: input.periodicidad,
            id_comprador: input.id_comprador,
            comprador_nombre: buyer.nombre,
            comprador_contacto: buyer.contacto ?? null,
            destino: buyer.destino ?? null,
            precio_total: total,
            moneda: input.moneda.toUpperCase(),
            observaciones: input.observaciones ?? null,
            registrado_por: req.user.id,
        }))).rows[0];
        for (const detail of details) {
            await client.query(buildInsert('venta_producto_detalle', {
                id_venta_producto: row.id_venta_producto,
                id_producto_venta: detail.id_producto_venta,
                cantidad: detail.cantidad,
                cantidad_complementaria: detail.cantidad_complementaria,
                precio_unitario: detail.precio_unitario,
                subtotal: detail.subtotal,
                observaciones: detail.observaciones ?? null,
            }));
        }
        await notifyProductSale(client, row, details.length, req.user.id);
        return { ...row, productos: details };
    }, req.user.id);
    cache.forgetModuleVersion('ventas');
    return created(res, sale);
}));
salesRouter.patch('/productos/:id', requirePermission('VENTA_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, 'id');
    const input = productSaleSchema.parse(req.body);
    const uniqueIds = new Set(input.productos.map((item) => item.id_producto_venta));
    if (uniqueIds.size !== input.productos.length)
        throw new ValidationError('No repitas productos en la misma venta.');
    const sale = await transaction(async (client) => {
        const current = (await client.query(`SELECT estado FROM venta_producto WHERE id_venta_producto=$1 AND deleted_at IS NULL FOR UPDATE`, [id])).rows[0];
        if (!current)
            throw new NotFoundError('Venta de productos no encontrada.');
        if (current.estado === 'ANULADA')
            throw new ConflictError('Una venta anulada no se puede modificar.');
        const buyer = (await client.query(`SELECT id_comprador,nombre,contacto,destino FROM comprador WHERE id_comprador=$1 AND deleted_at IS NULL AND activo=TRUE`, [input.id_comprador])).rows[0];
        if (!buyer)
            throw new NotFoundError('El comprador no existe o está inactivo.');
        const products = (await client.query(`SELECT id_producto_venta,nombre,id_unidad_complementaria FROM producto_venta WHERE id_producto_venta=ANY($1::uuid[]) AND deleted_at IS NULL AND activo=TRUE`, [[...uniqueIds]])).rows;
        if (products.length !== uniqueIds.size)
            throw new NotFoundError('Uno o más productos no existen o están inactivos.');
        const details = input.productos.map((item) => {
            const product = products.find((value) => value.id_producto_venta === item.id_producto_venta);
            if (product.id_unidad_complementaria && !item.cantidad_complementaria) {
                throw new ValidationError(`Ingresa la cantidad complementaria de ${product.nombre}.`);
            }
            return { ...item, cantidad_complementaria: product.id_unidad_complementaria ? item.cantidad_complementaria : null,
                subtotal: Number((item.cantidad * item.precio_unitario).toFixed(2)) };
        });
        const total = Number(details.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2));
        const row = (await client.query(`UPDATE venta_producto SET fecha_venta=$2,periodicidad=$3,id_comprador=$4,comprador_nombre=$5,
       comprador_contacto=$6,destino=$7,precio_total=$8,moneda=$9,observaciones=$10,updated_at=NOW()
       WHERE id_venta_producto=$1 RETURNING *`, [id, input.fecha_venta, input.periodicidad, input.id_comprador, buyer.nombre, buyer.contacto ?? null,
            buyer.destino ?? null, total, input.moneda.toUpperCase(), input.observaciones ?? null])).rows[0];
        await client.query(`DELETE FROM venta_producto_detalle WHERE id_venta_producto=$1`, [id]);
        for (const detail of details) {
            await client.query(buildInsert('venta_producto_detalle', { ...detail, id_venta_producto: id }));
        }
        return { ...row, productos: details };
    }, req.user.id);
    cache.forgetModuleVersion('ventas');
    return ok(res, sale);
}));
salesRouter.patch('/:id', requirePermission('VENTA_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, 'id');
    const input = animalSaleUpdateSchema.parse(req.body);
    const row = await transaction(async (client) => {
        const current = (await client.query(`SELECT estado FROM venta_animal WHERE id_venta=$1 AND deleted_at IS NULL FOR UPDATE`, [id])).rows[0];
        if (!current)
            throw new NotFoundError('Venta no encontrada.');
        if (current.estado === 'ANULADA')
            throw new ConflictError('Una venta anulada no se puede modificar.');
        const buyer = (await client.query(`SELECT id_comprador,nombre,contacto,destino FROM comprador WHERE id_comprador=$1 AND deleted_at IS NULL AND activo=TRUE`, [input.id_comprador])).rows[0];
        if (!buyer)
            throw new NotFoundError('El comprador no existe o está inactivo.');
        return (await client.query(`UPDATE venta_animal SET fecha_venta=$2,id_comprador=$3,comprador_nombre=$4,comprador_contacto=$5,
       destino=$6,precio_total=$7,moneda=$8,observaciones=$9,updated_at=NOW()
       WHERE id_venta=$1 RETURNING *`, [id, input.fecha_venta, input.id_comprador, buyer.nombre, buyer.contacto ?? null,
            buyer.destino ?? null, input.precio_total ?? null, input.moneda.toUpperCase(), input.observaciones ?? null])).rows[0];
    }, req.user.id);
    cache.forgetModuleVersion('ventas');
    return ok(res, row);
}));
salesRouter.patch('/productos/:id/anular', requirePermission('VENTA_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, 'id');
    const current = (await pool.query(`SELECT estado FROM venta_producto
     WHERE id_venta_producto=$1 AND deleted_at IS NULL`, [id])).rows[0];
    if (!current)
        throw new NotFoundError('Venta de productos no encontrada.');
    if (current.estado === 'ANULADA')
        throw new ConflictError('La venta ya está anulada.');
    const row = (await pool.query(`UPDATE venta_producto SET estado='ANULADA',anulado_en=NOW(),updated_at=NOW()
     WHERE id_venta_producto=$1 RETURNING *`, [id])).rows[0];
    cache.forgetModuleVersion('ventas');
    return ok(res, row);
}));
salesRouter.patch('/:id/anular', requirePermission('VENTA_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, 'id');
    const result = await transaction(async (client) => {
        const sale = (await client.query(`SELECT * FROM venta_animal
       WHERE id_venta=$1 AND deleted_at IS NULL
       FOR UPDATE`, [id])).rows[0];
        if (!sale)
            throw new NotFoundError('Venta no encontrada.');
        if (sale.estado === 'ANULADA')
            throw new ConflictError('La venta ya está anulada.');
        const details = (await client.query(`SELECT * FROM venta_animal_detalle
       WHERE id_venta=$1 AND deleted_at IS NULL`, [id])).rows;
        for (const detail of details) {
            const updated = (await client.query(`UPDATE animal
         SET estado=$2,id_grupo_actual=$3,id_ubicacion_actual=$4
         WHERE id_animal=$1 AND estado='VENDIDO' AND deleted_at IS NULL
         RETURNING id_animal`, [detail.id_animal, detail.estado_anterior, detail.id_grupo_anterior, detail.id_ubicacion_anterior])).rows[0];
            if (!updated) {
                throw new ConflictError('No se puede anular la venta porque uno de los animales ya no está marcado como vendido.');
            }
            await client.query(`UPDATE animal_grupo_historial
         SET fecha_hasta=NOW()
         WHERE id_animal=$1 AND fecha_hasta IS NULL AND deleted_at IS NULL`, [detail.id_animal]);
            await client.query(`UPDATE animal_ubicacion_historial
         SET fecha_hasta=NOW()
         WHERE id_animal=$1 AND fecha_hasta IS NULL AND deleted_at IS NULL`, [detail.id_animal]);
            await client.query(`UPDATE animal_propietario
         SET fecha_hasta=CURRENT_DATE
         WHERE id_animal=$1 AND fecha_hasta IS NULL AND deleted_at IS NULL`, [detail.id_animal]);
            if (detail.id_grupo_anterior) {
                await client.query(buildInsert('animal_grupo_historial', {
                    id_animal: detail.id_animal,
                    id_grupo: detail.id_grupo_anterior,
                    fecha_desde: new Date().toISOString(),
                    motivo: 'Restauración por anulación de venta',
                    registrado_por: req.user.id,
                }));
            }
            if (detail.id_ubicacion_anterior) {
                await client.query(buildInsert('animal_ubicacion_historial', {
                    id_animal: detail.id_animal,
                    id_ubicacion: detail.id_ubicacion_anterior,
                    fecha_desde: new Date().toISOString(),
                    motivo: 'Restauración por anulación de venta',
                    registrado_por: req.user.id,
                }));
            }
            const owners = Array.isArray(detail.propietarios_anteriores) ? detail.propietarios_anteriores : [];
            for (const owner of owners) {
                await client.query(buildInsert('animal_propietario', {
                    id_animal: detail.id_animal,
                    id_usuario: owner.id_usuario,
                    porcentaje_propiedad: owner.porcentaje_propiedad ?? null,
                    es_principal: owner.es_principal ?? false,
                    fecha_desde: new Date().toISOString().slice(0, 10),
                    registrado_por: req.user.id,
                }));
            }
        }
        return (await client.query(`UPDATE venta_animal
       SET estado='ANULADA',anulado_en=NOW()
       WHERE id_venta=$1
       RETURNING *`, [id])).rows[0];
    }, req.user.id);
    cache.forgetModuleVersion('ventas');
    cache.forgetModuleVersion('animales');
    return ok(res, result);
}));
//# sourceMappingURL=sales.routes.js.map