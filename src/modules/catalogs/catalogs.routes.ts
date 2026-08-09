import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, noContent, ok } from '../../core/http.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { requirePermission } from '../../middleware/permission.js';
import { pool } from '../../database/pool.js';
import { buildInsert, buildUpdate, pick } from '../shared/sql.js';

const definitions = {
  unidades: { table:'unidad_medida', id:'id_unidad', columns:['codigo','nombre','simbolo','magnitud','activo'], order:'nombre' },
  especies: { table:'especie', id:'id_especie', columns:['codigo','nombre','descripcion','activo'], order:'nombre' },
  origenes: { table:'origen_animal', id:'id_origen', columns:['codigo','nombre','descripcion','activo'], order:'nombre' },
  'condiciones-animales': { table:'condicion_animal', id:'id_condicion_animal', columns:['codigo','nombre','descripcion','activo'], order:'nombre' },
  'categorias-animales': { table:'categoria_animal', id:'id_categoria_animal', columns:['codigo','nombre','descripcion','activo'], order:'nombre' },
  colores: { table:'color_animal', id:'id_color', columns:['codigo','nombre','descripcion','activo'], order:'nombre' },
  razas: { table:'raza_animal', id:'id_raza', columns:['id_especie','codigo','nombre','descripcion','activo'], order:'nombre' },
  'tipos-grupo': { table:'tipo_grupo', id:'id_tipo_grupo', columns:['id_especie','codigo','nombre','descripcion','activo'], order:'nombre' },
  pastos: { table:'tipo_pasto', id:'id_tipo_pasto', columns:['codigo','nombre','descripcion','activo'], order:'nombre' },
  'usos-potrero': { table:'tipo_uso_potrero', id:'id_tipo_uso_potrero', columns:['codigo','nombre','descripcion','activo'], order:'nombre' },
  'tipos-corral': { table:'tipo_corral', id:'id_tipo_corral', columns:['codigo','nombre','descripcion','activo'], order:'nombre' },
  'tipos-limpieza': { table:'tipo_limpieza_potrero', id:'id_tipo_limpieza', columns:['codigo','nombre','requiere_productos','descripcion','activo'], order:'nombre' },
  'categorias-agroquimicos': { table:'categoria_producto_agroquimico', id:'id_categoria_producto', columns:['codigo','nombre','descripcion','activo'], order:'nombre' },
  agroquimicos: { table:'producto_agroquimico', id:'id_producto', columns:['id_categoria_producto','nombre_comercial','principio_activo','fabricante','id_unidad_predeterminada','instrucciones','activo'], order:'nombre_comercial' },
  'tipos-tratamiento': { table:'tipo_tratamiento', id:'id_tipo_tratamiento', columns:['codigo','nombre','descripcion','activo'], order:'nombre' },
  vias: { table:'via_administracion', id:'id_via_administracion', columns:['codigo','nombre','descripcion','activo'], order:'nombre' },
  medicamentos: { table:'medicamento', id:'id_medicamento', columns:['nombre_comercial','principio_activo','fabricante','id_unidad_predeterminada','dias_retiro_leche','dias_retiro_carne','activo'], order:'nombre_comercial' },
  'productos-venta': { table:'producto_venta', id:'id_producto_venta', columns:['codigo','nombre','id_unidad_venta','descripcion','activo'], order:'nombre' },
  compradores: { table:'comprador', id:'id_comprador', columns:['codigo','nombre','contacto','destino','descripcion','activo'], order:'nombre' }
} as const;
type CatalogName=keyof typeof definitions;
const nameSchema=z.enum(Object.keys(definitions) as [CatalogName,...CatalogName[]]);
const protectedAnimalConditions=new Set(['ACTIVO','INACTIVO','VENDIDO','TRASLADADO','DESAPARECIDO','MUERTO']);
export const catalogsRouter=Router();

function normalizeCatalogData(name: CatalogName, body: Record<string, unknown>) {
  const def=definitions[name];
  const data=pick(body,def.columns);
  if(name==='condiciones-animales' && typeof data.codigo==='string') {
    const code=data.codigo.trim().toUpperCase().replace(/\s+/g,'_');
    data.codigo=code;
    if(!/^[A-Z0-9_]+$/.test(code)) {
      throw new ValidationError('El código solo puede contener letras, números y guion bajo.');
    }
  }
  return data;
}

catalogsRouter.get('/:catalog',requirePermission('CATALOGO_CONSULTAR'),asyncHandler(async(req,res)=>{
  const name=nameSchema.parse(routeParam(req.params.catalog, 'catalog')); const def=definitions[name];
  const rows=(await pool.query(`SELECT * FROM ${def.table} WHERE deleted_at IS NULL ORDER BY activo DESC, ${def.order}`)).rows;
  res.set('Cache-Control','no-store');
  return ok(res,rows);
}));
catalogsRouter.post('/:catalog',requirePermission('CATALOGO_ADMINISTRAR'),asyncHandler(async(req,res)=>{const name=nameSchema.parse(routeParam(req.params.catalog, 'catalog'));const def=definitions[name];const data=normalizeCatalogData(name,req.body);if(!Object.keys(data).length)throw new ValidationError('No hay campos válidos.');const row=(await pool.query(buildInsert(def.table,data))).rows[0];return created(res,row);}));
catalogsRouter.patch('/:catalog/:id',requirePermission('CATALOGO_ADMINISTRAR'),asyncHandler(async(req,res)=>{
  const name=nameSchema.parse(routeParam(req.params.catalog, 'catalog'));const def=definitions[name];const id=routeParam(req.params.id, 'id');const data=normalizeCatalogData(name,req.body);
  if(name==='condiciones-animales') {
    const current=(await pool.query('SELECT codigo FROM condicion_animal WHERE id_condicion_animal=$1 AND deleted_at IS NULL',[id])).rows[0] as {codigo:string}|undefined;
    if(!current)throw new NotFoundError();
    if(protectedAnimalConditions.has(current.codigo) && ((typeof data.codigo==='string' && data.codigo!==current.codigo) || data.activo===false)) {
      throw new ValidationError('Las condiciones principales del sistema pueden cambiar de nombre o descripción, pero no su código ni desactivarse.');
    }
  }
  const row=(await pool.query(buildUpdate(def.table,def.id,id,data))).rows[0];if(!row)throw new NotFoundError();return ok(res,row);
}));
catalogsRouter.delete('/:catalog/:id',requirePermission('CATALOGO_ADMINISTRAR'),asyncHandler(async(req,res)=>{
  const name=nameSchema.parse(routeParam(req.params.catalog, 'catalog'));const def=definitions[name];const id=routeParam(req.params.id, 'id');
  if(name==='condiciones-animales') {
    const current=(await pool.query('SELECT codigo FROM condicion_animal WHERE id_condicion_animal=$1 AND deleted_at IS NULL',[id])).rows[0] as {codigo:string}|undefined;
    if(!current)throw new NotFoundError();
    if(protectedAnimalConditions.has(current.codigo))throw new ValidationError('Esta condición es necesaria para el funcionamiento del sistema y no puede desactivarse.');
    await pool.query('UPDATE condicion_animal SET activo=FALSE,updated_at=NOW() WHERE id_condicion_animal=$1',[id]);
    return noContent(res);
  }
  const result=await pool.query(`UPDATE ${def.table} SET deleted_at=NOW(),activo=FALSE WHERE ${def.id}=$1 AND deleted_at IS NULL`,[id]);if(!result.rowCount)throw new NotFoundError();return noContent(res);
}));
