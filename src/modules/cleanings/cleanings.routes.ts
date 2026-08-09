import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { asyncHandler } from '../../core/async-handler.js';
import { created, ok } from '../../core/http.js';
import { NotFoundError } from '../../core/errors.js';
import { routeParam } from '../../core/route-param.js';
import { requirePermission } from '../../middleware/permission.js';
import { buildInsert } from '../shared/sql.js';
const schema=z.object({id_potrero:z.string().uuid(),id_tipo_limpieza:z.string().uuid(),fecha_inicio:z.string().datetime(),fecha_finalizacion:z.string().datetime().nullable().optional(),unidad_aplicacion:z.enum(['TANQUES','BOMBADAS']).default('TANQUES'),cantidad_tanques:z.number().min(0).nullable().optional(),capacidad_tanque_litros:z.number().positive().nullable().optional(),area_intervenida:z.number().positive().nullable().optional(),id_unidad_area:z.string().uuid().nullable().optional(),estado:z.enum(['BORRADOR','PENDIENTE','EN_PROCESO','COMPLETADO','CANCELADO']).default('COMPLETADO'),observaciones:z.string().nullable().optional(),productos:z.array(z.object({id_producto:z.string().uuid(),cantidad_total:z.number().positive(),id_unidad:z.string().uuid(),cantidad_por_tanque:z.number().positive().nullable().optional(),valor_unitario:z.number().min(0),observaciones:z.string().max(300).nullable().optional()})).default([]),operadores:z.array(z.object({id_operador:z.string().uuid(),funcion:z.string().max(100).nullable().optional(),horas_trabajadas:z.number().min(0).nullable().optional(),observaciones:z.string().max(300).nullable().optional()})).default([])});
export const cleaningsRouter=Router();
cleaningsRouter.get('/',requirePermission('LIMPIEZA_CONSULTAR'),asyncHandler(async(_req,res)=>ok(res,(await pool.query(`
  SELECT l.*,u.nombre potrero,tl.nombre tipo_limpieza,COALESCE(ua.simbolo,ua.nombre) unidad_area,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id_producto',lp.id_producto,'producto',pa.nombre_comercial,'cantidad_total',lp.cantidad_total,'id_unidad',lp.id_unidad,'unidad',um.simbolo,
      'cantidad_por_tanque',lp.cantidad_por_tanque,'valor_unitario',lp.valor_unitario,'valor_total',lp.valor_total,'observaciones',lp.observaciones
    )) FROM limpieza_potrero_producto lp
      JOIN producto_agroquimico pa ON pa.id_producto=lp.id_producto
      JOIN unidad_medida um ON um.id_unidad=lp.id_unidad
      WHERE lp.id_limpieza=l.id_limpieza AND lp.deleted_at IS NULL),'[]') productos,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id_operador',o.id_operador,'nombre',concat_ws(' ',o.nombres,o.apellidos),
      'funcion',lo.funcion,'horas_trabajadas',lo.horas_trabajadas,'observaciones',lo.observaciones
    )) FROM limpieza_potrero_operador lo JOIN operador o ON o.id_operador=lo.id_operador
      WHERE lo.id_limpieza=l.id_limpieza AND lo.deleted_at IS NULL),'[]') operadores
  FROM limpieza_potrero l
  JOIN potrero p ON p.id_potrero=l.id_potrero
  JOIN ubicacion u ON u.id_ubicacion=p.id_ubicacion
  JOIN tipo_limpieza_potrero tl ON tl.id_tipo_limpieza=l.id_tipo_limpieza
  LEFT JOIN unidad_medida ua ON ua.id_unidad=l.id_unidad_area
  WHERE l.deleted_at IS NULL ORDER BY l.fecha_inicio DESC
`)).rows)));
cleaningsRouter.post('/',requirePermission('LIMPIEZA_ADMINISTRAR'),asyncHandler(async(req,res)=>{const x=schema.parse(req.body);const result=await transaction(async c=>{const {productos,operadores,...head}=x;const l=(await c.query(buildInsert('limpieza_potrero',{...head,registrado_por:req.user!.id}))).rows[0];for(const p of productos)await c.query(buildInsert('limpieza_potrero_producto',{...p,id_limpieza:l.id_limpieza}));for(const o of operadores)await c.query(buildInsert('limpieza_potrero_operador',{...o,id_limpieza:l.id_limpieza}));return l;},req.user!.id);return created(res,result);}));
cleaningsRouter.patch('/:id',requirePermission('LIMPIEZA_ADMINISTRAR'),asyncHandler(async(req,res)=>{const id=routeParam(req.params.id,'id');const x=schema.parse(req.body);const result=await transaction(async c=>{const found=(await c.query('SELECT id_limpieza FROM limpieza_potrero WHERE id_limpieza=$1 AND deleted_at IS NULL FOR UPDATE',[id])).rows[0];if(!found)throw new NotFoundError('Limpieza no encontrada.');const {productos,operadores,...head}=x;const row=(await c.query(`UPDATE limpieza_potrero SET id_potrero=$2,id_tipo_limpieza=$3,fecha_inicio=$4,fecha_finalizacion=$5,unidad_aplicacion=$6,cantidad_tanques=$7,capacidad_tanque_litros=$8,area_intervenida=$9,id_unidad_area=$10,estado=$11,observaciones=$12,updated_at=NOW() WHERE id_limpieza=$1 RETURNING *`,[id,head.id_potrero,head.id_tipo_limpieza,head.fecha_inicio,head.fecha_finalizacion??null,head.unidad_aplicacion,head.cantidad_tanques??null,head.capacidad_tanque_litros??null,head.area_intervenida??null,head.id_unidad_area??null,head.estado,head.observaciones??null])).rows[0];await c.query('DELETE FROM limpieza_potrero_producto WHERE id_limpieza=$1',[id]);await c.query('DELETE FROM limpieza_potrero_operador WHERE id_limpieza=$1',[id]);for(const p of productos)await c.query(buildInsert('limpieza_potrero_producto',{...p,id_limpieza:id}));for(const o of operadores)await c.query(buildInsert('limpieza_potrero_operador',{...o,id_limpieza:id}));return row;},req.user!.id);return ok(res,result);}));
