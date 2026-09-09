import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, noContent, ok } from '../../core/http.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { requirePermission } from '../../middleware/permission.js';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
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
  'motivos-movimiento': { table:'motivo_movimiento', id:'id_motivo_movimiento', columns:['codigo','nombre','descripcion','activo'], order:'nombre' },
  'categorias-agroquimicos': { table:'categoria_producto_agroquimico', id:'id_categoria_producto', columns:['codigo','nombre','descripcion','activo'], order:'nombre' },
  agroquimicos: { table:'producto_agroquimico', id:'id_producto', columns:['id_categoria_producto','nombre_comercial','principio_activo','fabricante','id_unidad_predeterminada','instrucciones','activo'], order:'nombre_comercial' },
  'tipos-tratamiento': { table:'tipo_tratamiento', id:'id_tipo_tratamiento', columns:['codigo','nombre','descripcion','activo'], order:'nombre' },
  vias: { table:'via_administracion', id:'id_via_administracion', columns:['codigo','nombre','descripcion','activo'], order:'nombre' },
  medicamentos: { table:'medicamento', id:'id_medicamento', columns:['id_tipo_tratamiento','nombre_comercial','principio_activo','fabricante','id_unidad_predeterminada','dosis_sugerida','indicaciones','dias_retiro_leche','dias_retiro_carne','activo'], order:'nombre_comercial' },
  'productos-venta': { table:'producto_venta', id:'id_producto_venta', columns:['codigo','nombre','id_unidad_venta','id_unidad_complementaria','descripcion','activo'], order:'nombre' },
  compradores: { table:'comprador', id:'id_comprador', columns:['codigo','nombre','contacto','destino','descripcion','activo'], order:'nombre' },
  'etiquetas-multimedia': { table:'etiqueta_multimedia', id:'id_etiqueta', columns:['codigo','nombre','descripcion','activo'], order:'nombre' },
  'tipos-producto-compra': { table:'tipo_producto_compra', id:'id_tipo_producto_compra', columns:['codigo','nombre','es_animal','descripcion','activo'], order:'nombre' },
  'tipos-actividad': { table:'tipo_actividad', id:'id_tipo_actividad', columns:['codigo','nombre','descripcion','activo'], order:'nombre' },
  'tipos-condicion-salud': { table:'tipo_condicion_salud', id:'id_tipo_condicion_salud', columns:['codigo','nombre','descripcion','activo'], order:'nombre' }
} as const;
type CatalogName=keyof typeof definitions;
const nameSchema=z.enum(Object.keys(definitions) as [CatalogName,...CatalogName[]]);
const protectedAnimalConditions=new Set(['ACTIVO','INACTIVO','VENDIDO','TRASLADADO','DESAPARECIDO','MUERTO']);
const medicineRoutesSchema=z.array(z.string().uuid()).min(1,'Selecciona al menos una vía de administración.');
export const catalogsRouter=Router();

function medicineRouteIds(body: Record<string, unknown>, required: boolean) {
  if (!Object.prototype.hasOwnProperty.call(body,'id_vias_administracion')) {
    if (required) throw new ValidationError('Selecciona al menos una vía de administración.');
    return null;
  }
  return [...new Set(medicineRoutesSchema.parse(body.id_vias_administracion))];
}

async function replaceMedicineRoutes(client: Parameters<Parameters<typeof transaction>[0]>[0], medicineId: string, routeIds: string[]) {
  const valid=(await client.query(
    `SELECT id_via_administracion FROM via_administracion
     WHERE id_via_administracion=ANY($1::uuid[]) AND deleted_at IS NULL AND activo=TRUE`,[routeIds],
  )).rows.map((row)=>row.id_via_administracion as string);
  if(valid.length!==routeIds.length)throw new ValidationError('Una de las vías seleccionadas no existe o está inactiva.');
  await client.query('DELETE FROM medicamento_via_administracion WHERE id_medicamento=$1',[medicineId]);
  for(const routeId of routeIds)await client.query(
    'INSERT INTO medicamento_via_administracion(id_medicamento,id_via_administracion) VALUES($1,$2)',[medicineId,routeId],
  );
}

async function assertTreatmentType(client: Parameters<Parameters<typeof transaction>[0]>[0], treatmentTypeId: unknown) {
  if(typeof treatmentTypeId!=='string')throw new ValidationError('Selecciona el tipo de tratamiento del medicamento.');
  const found=(await client.query(
    'SELECT 1 FROM tipo_tratamiento WHERE id_tipo_tratamiento=$1 AND deleted_at IS NULL AND activo=TRUE',
    [treatmentTypeId],
  )).rows[0];
  if(!found)throw new ValidationError('El tipo de tratamiento no existe o está inactivo.');
}

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
  if(name==='productos-venta') {
    if(data.id_unidad_complementaria==='')data.id_unidad_complementaria=null;
    if(data.id_unidad_venta&&data.id_unidad_complementaria===data.id_unidad_venta) {
      throw new ValidationError('La unidad complementaria debe ser diferente de la unidad principal.');
    }
  }
  if(name==='medicamentos' && typeof data.id_unidad_predeterminada!=='string') {
    throw new ValidationError('Selecciona la unidad de dosis del medicamento.');
  }
  if(name==='medicamentos' && typeof data.id_tipo_tratamiento!=='string') {
    throw new ValidationError('Selecciona el tipo de tratamiento del medicamento.');
  }
  return data;
}

catalogsRouter.get('/:catalog',requirePermission('CATALOGO_CONSULTAR'),asyncHandler(async(req,res)=>{
  const name=nameSchema.parse(routeParam(req.params.catalog, 'catalog')); const def=definitions[name];
  const rows=(await pool.query(name==='medicamentos'
    ? `SELECT m.*,tt.nombre tipo_tratamiento,
        COALESCE((SELECT jsonb_agg(mva.id_via_administracion ORDER BY va.nombre)
          FROM medicamento_via_administracion mva
          JOIN via_administracion va ON va.id_via_administracion=mva.id_via_administracion
          WHERE mva.id_medicamento=m.id_medicamento AND va.deleted_at IS NULL),'[]'::jsonb) id_vias_administracion,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id_via_administracion',va.id_via_administracion,'nombre',va.nombre) ORDER BY va.nombre)
          FROM medicamento_via_administracion mva
          JOIN via_administracion va ON va.id_via_administracion=mva.id_via_administracion
          WHERE mva.id_medicamento=m.id_medicamento AND va.deleted_at IS NULL),'[]'::jsonb) vias_administracion
       FROM medicamento m
       LEFT JOIN tipo_tratamiento tt ON tt.id_tipo_tratamiento=m.id_tipo_tratamiento AND tt.deleted_at IS NULL
       WHERE m.deleted_at IS NULL ORDER BY m.activo DESC,m.nombre_comercial`
    : `SELECT * FROM ${def.table} WHERE deleted_at IS NULL ORDER BY activo DESC, ${def.order}`)).rows;
  res.set('Cache-Control','no-store');
  return ok(res,rows);
}));
catalogsRouter.post('/:catalog',requirePermission('CATALOGO_ADMINISTRAR'),asyncHandler(async(req,res)=>{
  const name=nameSchema.parse(routeParam(req.params.catalog, 'catalog'));const def=definitions[name];const data=normalizeCatalogData(name,req.body);
  if(!Object.keys(data).length)throw new ValidationError('No hay campos válidos.');
  if(name!=='medicamentos')return created(res,(await pool.query(buildInsert(def.table,data))).rows[0]);
  const routeIds=medicineRouteIds(req.body,true)!;
  const row=await transaction(async(client)=>{await assertTreatmentType(client,data.id_tipo_tratamiento);const saved=(await client.query(buildInsert(def.table,data))).rows[0];await replaceMedicineRoutes(client,saved.id_medicamento,routeIds);return {...saved,id_vias_administracion:routeIds};},req.user!.id);
  return created(res,row);
}));
catalogsRouter.patch('/:catalog/:id',requirePermission('CATALOGO_ADMINISTRAR'),asyncHandler(async(req,res)=>{
  const name=nameSchema.parse(routeParam(req.params.catalog, 'catalog'));const def=definitions[name];const id=routeParam(req.params.id, 'id');const data=normalizeCatalogData(name,req.body);
  if(name==='condiciones-animales') {
    const current=(await pool.query('SELECT codigo FROM condicion_animal WHERE id_condicion_animal=$1 AND deleted_at IS NULL',[id])).rows[0] as {codigo:string}|undefined;
    if(!current)throw new NotFoundError();
    if(protectedAnimalConditions.has(current.codigo) && ((typeof data.codigo==='string' && data.codigo!==current.codigo) || data.activo===false)) {
      throw new ValidationError('Las condiciones principales del sistema pueden cambiar de nombre o descripción, pero no su código ni desactivarse.');
    }
  }
  if(name==='medicamentos') {
    const routeIds=medicineRouteIds(req.body,false);
    const row=await transaction(async(client)=>{
      await assertTreatmentType(client,data.id_tipo_tratamiento);
      const saved=Object.keys(data).length?(await client.query(buildUpdate(def.table,def.id,id,data))).rows[0]:(await client.query(`SELECT * FROM medicamento WHERE id_medicamento=$1 AND deleted_at IS NULL`,[id])).rows[0];
      if(!saved)throw new NotFoundError();
      if(routeIds)await replaceMedicineRoutes(client,id,routeIds);
      return {...saved,id_vias_administracion:routeIds??undefined};
    },req.user!.id);
    return ok(res,row);
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
