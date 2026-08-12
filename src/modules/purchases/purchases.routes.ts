import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, noContent, ok } from '../../core/http.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { requirePermission } from '../../middleware/permission.js';
import { buildInsert } from '../shared/sql.js';
import { cache } from '../../services/cache.service.js';

const purchasedAnimal=z.object({
  codigo_arete:z.string().trim().max(60).nullable().optional(),
  nombre:z.string().trim().min(1).max(120),
  descripcion:z.string().trim().max(300).nullable().optional(),
  id_especie:z.string().uuid(),
  sexo:z.enum(['MACHO','HEMBRA']),
  fecha_nacimiento:z.string().date().nullable().optional(),
  id_origen:z.string().uuid(),
  id_categoria_animal:z.string().uuid(),
  id_grupo_actual:z.string().uuid().nullable().optional(),
  id_ubicacion_actual:z.string().uuid().nullable().optional(),
});

const purchaseSchema=z.object({
  id_tipo_producto_compra:z.string().uuid(),
  fecha_compra:z.string().date(),
  proveedor:z.string().trim().min(1).max(200),
  producto:z.string().trim().max(200).nullable().optional(),
  cantidad:z.number().positive().default(1),
  id_unidad:z.string().uuid().nullable().optional(),
  valor_unitario:z.number().min(0),
  moneda:z.string().trim().length(3).default('USD'),
  observaciones:z.string().nullable().optional(),
  animal:purchasedAnimal.nullable().optional(),
});

async function purchaseType(client:Parameters<Parameters<typeof transaction>[0]>[0],id:string) {
  const row=(await client.query(
    `SELECT id_tipo_producto_compra,nombre,es_animal FROM tipo_producto_compra
     WHERE id_tipo_producto_compra=$1 AND activo=TRUE AND deleted_at IS NULL`,[id],
  )).rows[0] as {id_tipo_producto_compra:string;nombre:string;es_animal:boolean}|undefined;
  if(!row)throw new ValidationError('El tipo de producto seleccionado no está disponible.');
  return row;
}

async function validateInitialLocation(client:Parameters<Parameters<typeof transaction>[0]>[0],animal:z.infer<typeof purchasedAnimal>) {
  if(animal.id_grupo_actual) {
    const group=(await client.query(
      `SELECT id_categoria_animal,id_ubicacion_actual,activo FROM grupo
       WHERE id_grupo=$1 AND deleted_at IS NULL`,[animal.id_grupo_actual],
    )).rows[0] as {id_categoria_animal:string;id_ubicacion_actual:string|null;activo:boolean}|undefined;
    if(!group?.activo)throw new ValidationError('El grupo inicial no está disponible.');
    if(group.id_categoria_animal!==animal.id_categoria_animal)throw new ValidationError('El grupo no corresponde a la categoría del animal.');
    if(group.id_ubicacion_actual!==(animal.id_ubicacion_actual??null))throw new ValidationError('La ubicación inicial debe ser la misma del grupo seleccionado.');
  }
  if(animal.id_ubicacion_actual) {
    const location=(await client.query(
      `SELECT id_categoria_animal,activo FROM ubicacion WHERE id_ubicacion=$1 AND deleted_at IS NULL`,
      [animal.id_ubicacion_actual],
    )).rows[0] as {id_categoria_animal:string;activo:boolean}|undefined;
    if(!location?.activo)throw new ValidationError('La ubicación inicial no está disponible.');
    if(location.id_categoria_animal!==animal.id_categoria_animal)throw new ValidationError('La ubicación no corresponde a la categoría del animal.');
  }
}

export const purchasesRouter=Router();

purchasesRouter.get('/',requirePermission('COMPRA_CONSULTAR'),asyncHandler(async(_req,res)=>ok(res,(await pool.query(
  `SELECT c.*,t.nombre tipo_producto,t.codigo tipo_producto_codigo,t.es_animal,
    a.nombre animal,a.codigo_arete,u.nombre unidad,u.simbolo,
    TRIM(CONCAT(us.nombres,' ',us.apellidos)) registrado_por_nombre
   FROM compra c
   JOIN tipo_producto_compra t ON t.id_tipo_producto_compra=c.id_tipo_producto_compra
   LEFT JOIN animal a ON a.id_animal=c.id_animal
   LEFT JOIN unidad_medida u ON u.id_unidad=c.id_unidad
   LEFT JOIN usuario us ON us.id_usuario=c.registrado_por
   WHERE c.deleted_at IS NULL ORDER BY c.fecha_compra DESC,c.created_at DESC`
)).rows)));

purchasesRouter.post('/',requirePermission('COMPRA_ADMINISTRAR'),asyncHandler(async(req,res)=>{
  const input=purchaseSchema.parse(req.body);
  try {
    const row=await transaction(async client=>{
      const type=await purchaseType(client,input.id_tipo_producto_compra);
      if(type.es_animal&&!input.animal)throw new ValidationError('Completa los datos del animal comprado.');
      if(!type.es_animal&&input.animal)throw new ValidationError('Este tipo de compra no debe crear un animal.');
      if(!type.es_animal&&!input.producto)throw new ValidationError('Indica el producto comprado.');
      let animalId:string|null=null;
      if(input.animal) {
        await validateInitialLocation(client,input.animal);
        await client.query("SELECT set_config('app.fecha_movimiento',$1,true)",[input.fecha_compra]);
        await client.query("SELECT set_config('app.motivo_cambio','Compra de animal',true)");
        const animal=(await client.query(buildInsert('animal',{
          ...input.animal,estado:'ACTIVO',registrado_por:req.user!.id,
        }))).rows[0];
        animalId=animal.id_animal;
      }
      const quantity=type.es_animal?1:input.cantidad;
      const total=Number((quantity*input.valor_unitario).toFixed(2));
      const purchase=(await client.query(buildInsert('compra',{
        id_tipo_producto_compra:input.id_tipo_producto_compra,id_animal:animalId,
        fecha_compra:input.fecha_compra,proveedor:input.proveedor,
        producto:type.es_animal?(input.animal?.nombre??type.nombre):input.producto,
        cantidad:quantity,id_unidad:type.es_animal?null:(input.id_unidad??null),
        valor_unitario:input.valor_unitario,valor_total:total,moneda:input.moneda.toUpperCase(),
        observaciones:input.observaciones??null,registrado_por:req.user!.id,
      }))).rows[0];
      return {...purchase,animal:input.animal?.nombre??null};
    },req.user!.id);
    cache.forgetModuleVersion('compras');
    cache.forgetModuleVersion('animales');
    return created(res,row);
  } catch(error) {
    const db=error as {code?:string;constraint?:string};
    if(db.code==='23505')throw new ConflictError('El arete o identificador del animal ya está registrado.');
    throw error;
  }
}));

purchasesRouter.patch('/:id',requirePermission('COMPRA_ADMINISTRAR'),asyncHandler(async(req,res)=>{
  const id=routeParam(req.params.id,'id');
  const input=purchaseSchema.omit({animal:true}).parse(req.body);
  const row=await transaction(async client=>{
    const found=(await client.query('SELECT id_animal FROM compra WHERE id_compra=$1 AND deleted_at IS NULL FOR UPDATE',[id])).rows[0];
    if(!found)throw new NotFoundError('Compra no encontrada.');
    const type=await purchaseType(client,input.id_tipo_producto_compra);
    if(Boolean(found.id_animal)!==type.es_animal)throw new ValidationError('No se puede cambiar una compra de animal a producto ni viceversa.');
    if(!type.es_animal&&!input.producto)throw new ValidationError('Indica el producto comprado.');
    const quantity=type.es_animal?1:input.cantidad;
    const total=Number((quantity*input.valor_unitario).toFixed(2));
    return (await client.query(
      `UPDATE compra SET id_tipo_producto_compra=$2,fecha_compra=$3,proveedor=$4,producto=$5,
       cantidad=$6,id_unidad=$7,valor_unitario=$8,valor_total=$9,moneda=$10,observaciones=$11,updated_at=NOW()
       WHERE id_compra=$1 RETURNING *`,
      [id,input.id_tipo_producto_compra,input.fecha_compra,input.proveedor,input.producto??null,quantity,
       type.es_animal?null:(input.id_unidad??null),input.valor_unitario,total,input.moneda.toUpperCase(),input.observaciones??null],
    )).rows[0];
  },req.user!.id);
  cache.forgetModuleVersion('compras');
  return ok(res,row);
}));

purchasesRouter.delete('/:id',requirePermission('COMPRA_ADMINISTRAR'),asyncHandler(async(req,res)=>{
  const result=await pool.query('UPDATE compra SET deleted_at=NOW(),updated_at=NOW() WHERE id_compra=$1 AND deleted_at IS NULL',[routeParam(req.params.id,'id')]);
  if(!result.rowCount)throw new NotFoundError('Compra no encontrada.');
  cache.forgetModuleVersion('compras');
  return noContent(res);
}));
