import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, noContent, ok } from '../../core/http.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { requirePermission } from '../../middleware/permission.js';
import { assertAnimalOperationAllowed, type AnimalOperationCode } from '../../services/animal-operation-policy.js';
import { buildInsert, type Queryable } from '../shared/sql.js';
import { deleteCloudinaryImage } from '../../services/cloudinary.service.js';
import { deleteRecordImage, recordImageUpload, requestFiles, saveRecordImages } from '../shared/record-images.js';

const movementKind = z.enum(['UBICACION', 'GRUPO', 'PROPIEDAD', 'COMBINADO']);
const MAIN_PROPERTY = 'PROPIEDAD_PRINCIPAL';
const movementAnimal = z.object({
  id_animal: z.string().uuid(),
  seleccionado: z.boolean().default(true),
  id_ubicacion_destino: z.string().uuid().nullable().optional(),
  id_grupo_destino: z.string().uuid().nullable().optional(),
  observaciones: z.string().max(300).nullable().optional(),
});
const movement = z.object({
  tipo_movimiento: movementKind,
  propiedad_origen: z.union([z.literal(MAIN_PROPERTY), z.string().uuid()]).nullable().optional(),
  modo_seleccion: z.enum(['TODOS', 'GRUPO', 'SELECCION_MANUAL']),
  id_grupo_filtro: z.string().uuid().nullable().optional(),
  id_ubicacion_origen: z.string().uuid().nullable().optional(),
  id_ubicacion_destino: z.string().uuid().nullable().optional(),
  id_grupo_origen: z.string().uuid().nullable().optional(),
  id_grupo_destino: z.string().uuid().nullable().optional(),
  id_motivo_movimiento: z.string().uuid().nullable().optional(),
  fecha_movimiento: z.string().date(),
  motivo: z.string().max(300).nullable().optional(),
  observaciones: z.string().nullable().optional(),
  animales: z.array(movementAnimal).default([]),
});

type MovementInput = z.infer<typeof movement>;

type MovementValidation = {
  effectiveLocationId: string;
  relocateGroupId: string | null;
  destinationGroupId: string;
  destinationCategoryId: string;
  sourcePropertyId: string;
  destinationPropertyId: string;
  currentAnimals: CurrentMovementAnimal[];
};

type CurrentMovementAnimal = {
  id_animal: string;
  id_categoria_animal: string;
  id_grupo_actual: string | null;
  id_ubicacion_actual: string | null;
  id_propiedad: string | null;
};

async function resolvePropertySelector(database: Queryable, selector?: string | null) {
  if (!selector) return null;
  const row=(await database.query(
    `SELECT id_propiedad FROM propiedad_ganadera
     WHERE ${selector===MAIN_PROPERTY?'es_principal=TRUE':'id_propiedad=$1'}
       AND activa=TRUE AND deleted_at IS NULL LIMIT 1`,
    selector===MAIN_PROPERTY?[]:[selector],
  )).rows[0] as {id_propiedad:string}|undefined;
  if(!row)throw new ValidationError('La propiedad seleccionada no está disponible.');
  return row.id_propiedad;
}

async function groupOrigin(database: Queryable, groupId?: string | null) {
  if (!groupId) return null;
  return (await database.query(
    `SELECT g.id_grupo,g.id_propiedad,g.id_ubicacion_actual
     FROM grupo g
     JOIN propiedad_ganadera p ON p.id_propiedad=g.id_propiedad
     WHERE g.id_grupo=$1 AND g.deleted_at IS NULL AND g.activo=TRUE
       AND p.deleted_at IS NULL AND p.activa=TRUE`,
    [groupId],
  )).rows[0] as { id_grupo: string; id_propiedad: string; id_ubicacion_actual: string | null } | undefined;
}

async function locationProperty(database: Queryable, locationId?: string | null) {
  if(!locationId)return null;
  const row=(await database.query(
    `SELECT u.id_propiedad FROM ubicacion u
     JOIN propiedad_ganadera p ON p.id_propiedad=u.id_propiedad
     WHERE u.id_ubicacion=$1 AND u.activo=TRUE AND u.deleted_at IS NULL
       AND p.activa=TRUE AND p.deleted_at IS NULL`,
    [locationId],
  )).rows[0] as {id_propiedad:string}|undefined;
  if(!row)throw new ValidationError('La ubicación seleccionada no está disponible.');
  return row.id_propiedad;
}

function validateMovementMode(kind: z.infer<typeof movementKind>, mode: MovementInput['modo_seleccion'], groupFilterId?: string | null, destinationGroupId?: string | null) {
  if (kind === 'GRUPO' && groupFilterId && destinationGroupId && groupFilterId === destinationGroupId) {
    throw new ValidationError('Seleccione un grupo de destino diferente al grupo de origen.');
  }
  if (kind !== 'UBICACION') return;
  if (mode !== 'GRUPO') {
    throw new ValidationError('El cambio de potrero o corral se realiza únicamente con un grupo completo.');
  }
  if (groupFilterId && destinationGroupId && groupFilterId !== destinationGroupId) {
    throw new ValidationError('El grupo debe conservarse al cambiar de potrero o corral.');
  }
}

function defaultReasonCode(kind: z.infer<typeof movementKind>) {
  if (kind === 'UBICACION') return 'ROTACION_POTRERO';
  if (kind === 'GRUPO') return 'CAMBIO_GRUPO';
  if (kind === 'PROPIEDAD') return 'TRASLADO_PROPIEDAD';
  return 'REORGANIZACION';
}

async function movementReason(database: Queryable, id: string | null | undefined, kind?: z.infer<typeof movementKind>) {
  const value = id ?? (kind ? defaultReasonCode(kind) : null);
  if (!value) throw new ValidationError('Seleccione el motivo del movimiento.');
  const reason = (await database.query(
    `SELECT id_motivo_movimiento,nombre FROM motivo_movimiento
     WHERE ${id ? 'id_motivo_movimiento=$1' : 'codigo=$1'} AND deleted_at IS NULL`,
    [value],
  )).rows[0] as { id_motivo_movimiento: string; nombre: string } | undefined;
  if (!reason) throw new ValidationError('El motivo de movimiento seleccionado no está disponible.');
  return reason;
}

async function completeGroupAnimals(
  database: Queryable,
  groupId: string,
  provided: z.infer<typeof movementAnimal>[],
  destinationLocationId?: string | null,
  destinationGroupId?: string | null,
) {
  const observations = new Map(provided.map((item) => [item.id_animal, item.observaciones ?? null]));
  const members = (await database.query(
    `SELECT id_animal FROM animal
     WHERE id_grupo_actual=$1 AND estado='ACTIVO' AND deleted_at IS NULL
     ORDER BY nombre,id_animal`,
    [groupId],
  )).rows as Array<{ id_animal: string }>;
  return members.map((member) => ({
    id_animal: member.id_animal,
    seleccionado: true,
    id_ubicacion_destino: destinationLocationId ?? null,
    id_grupo_destino: destinationGroupId ?? groupId,
    observaciones: observations.get(member.id_animal) ?? null,
  }));
}

function movementDateValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text=String(value??'');
  const iso=text.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if(iso)return iso;
  const parsed=new Date(text);
  if(!Number.isNaN(parsed.getTime()))return parsed.toISOString().slice(0,10);
  return text;
}

async function validateMovementSelection(database: Queryable, input: MovementInput): Promise<MovementValidation> {
  validateMovementMode(input.tipo_movimiento, input.modo_seleccion, input.id_grupo_filtro, input.id_grupo_destino);
  if (input.tipo_movimiento === 'UBICACION' && !input.id_grupo_filtro) {
    throw new ValidationError('Seleccione el grupo completo que cambiará de potrero o corral.');
  }
  const selected = input.animales.filter((item) => item.seleccionado);
  if (!selected.length) throw new ValidationError('Seleccione al menos un animal.');

  if (!input.id_grupo_destino) throw new ValidationError('Seleccione el grupo de destino.');
  const group = (await database.query(
    `SELECT id_grupo,id_categoria_animal,id_propiedad,id_ubicacion_actual
     FROM grupo WHERE id_grupo=$1 AND deleted_at IS NULL AND activo=TRUE`,
    [input.id_grupo_destino],
  )).rows[0] as { id_grupo: string; id_categoria_animal: string; id_propiedad: string; id_ubicacion_actual: string | null } | undefined;
  if (!group) throw new ValidationError('El grupo de destino no está disponible.');

  const effectiveLocationId = input.id_ubicacion_destino ?? group.id_ubicacion_actual;
  if (!effectiveLocationId) throw new ValidationError('Seleccione la ubicación de destino del grupo.');
  const location = (await database.query(
    `SELECT u.id_ubicacion,u.tipo,u.id_categoria_animal,u.id_propiedad
     FROM ubicacion u
     JOIN propiedad_ganadera p ON p.id_propiedad=u.id_propiedad
     WHERE u.id_ubicacion=$1 AND u.deleted_at IS NULL AND u.activo=TRUE
       AND p.deleted_at IS NULL AND p.activa=TRUE`,
    [effectiveLocationId],
  )).rows[0] as { id_ubicacion: string; tipo: string; id_categoria_animal: string; id_propiedad: string } | undefined;
  if (!location) throw new ValidationError('La ubicación de destino no está disponible.');
  if (location.id_categoria_animal !== group.id_categoria_animal) {
    throw new ValidationError('El grupo de destino debe pertenecer a la misma situación de propiedad que la ubicación.');
  }
  if(location.id_propiedad!==group.id_propiedad){
    throw new ValidationError('El grupo de destino debe pertenecer a la propiedad de destino.');
  }
  if (input.tipo_movimiento === 'UBICACION' && location.tipo === 'OTRO') {
    throw new ValidationError('Para una propiedad externa utilice el traslado entre propiedades.');
  }

  const animalIds = selected.map((item) => item.id_animal);
  const currentAnimals = (await database.query(
    `SELECT a.id_animal,a.id_categoria_animal,a.id_grupo_actual,a.id_ubicacion_actual,
       u.id_propiedad
     FROM animal a LEFT JOIN ubicacion u ON u.id_ubicacion=a.id_ubicacion_actual
     WHERE a.id_animal=ANY($1::uuid[]) AND a.deleted_at IS NULL AND a.estado='ACTIVO' FOR UPDATE OF a`,
    [animalIds],
  )).rows as CurrentMovementAnimal[];
  if (currentAnimals.length !== animalIds.length) throw new ValidationError('Uno o más animales ya no están activos o disponibles.');

  const sourceProperties = new Set(currentAnimals.map((animal) => animal.id_propiedad).filter((value):value is string=>Boolean(value)));
  const destinationProperty = location.id_propiedad;
  if(sourceProperties.size!==1)throw new ValidationError('Todos los animales seleccionados deben pertenecer a una misma propiedad de origen.');
  const sourceProperty=[...sourceProperties][0];
  const requestedSourceProperty=await resolvePropertySelector(database,input.propiedad_origen);
  if(requestedSourceProperty&&requestedSourceProperty!==sourceProperty){
    throw new ValidationError('Los animales seleccionados no pertenecen a la propiedad de origen indicada.');
  }
  if (input.tipo_movimiento === 'UBICACION') {
    if (!group.id_ubicacion_actual || currentAnimals.some((animal) => animal.id_ubicacion_actual !== group.id_ubicacion_actual)) {
      throw new ValidationError('Todos los animales deben encontrarse en la ubicación actual registrada para el grupo.');
    }
    if (sourceProperty !== destinationProperty) {
      throw new ValidationError('El cambio de potrero o corral debe realizarse dentro de la misma propiedad.');
    }
    if(group.id_ubicacion_actual===effectiveLocationId)throw new ValidationError('Seleccione un potrero o corral diferente al actual.');
  }

  let relocateGroupId: string | null = null;
  const movesTheSelectedGroup = input.modo_seleccion === 'GRUPO'
    && Boolean(input.id_grupo_filtro)
    && input.id_grupo_filtro === input.id_grupo_destino
    && group.id_ubicacion_actual !== effectiveLocationId;
  if (movesTheSelectedGroup) {
    const groupMembers = (await database.query(
      `SELECT id_animal FROM animal
       WHERE id_grupo_actual=$1 AND estado='ACTIVO' AND deleted_at IS NULL FOR SHARE`,
      [input.id_grupo_destino],
    )).rows as Array<{ id_animal: string }>;
    const selectedIds = new Set(animalIds);
    if (groupMembers.length !== selectedIds.size || groupMembers.some((item) => !selectedIds.has(item.id_animal))) {
      throw new ValidationError('Para cambiar la ubicación fija del grupo debe incluir todos sus animales activos.');
    }
    relocateGroupId = group.id_grupo;
  } else if (group.id_ubicacion_actual !== effectiveLocationId) {
    throw new ValidationError('El grupo de destino pertenece a otra ubicación. Seleccione un grupo de la ubicación elegida.');
  }

  const operations: AnimalOperationCode[] = input.tipo_movimiento === 'UBICACION'
    ? ['MOVIMIENTO_UBICACION']
    : input.tipo_movimiento === 'GRUPO'
      ? ['MOVIMIENTO_GRUPO']
      : input.tipo_movimiento === 'PROPIEDAD'
        ? ['MOVIMIENTO_PROPIEDAD', 'MOVIMIENTO_GRUPO']
        : [location?.tipo === 'OTRO' ? 'MOVIMIENTO_PROPIEDAD' : 'MOVIMIENTO_UBICACION', 'MOVIMIENTO_GRUPO'];

  for (const animal of selected) {
    for (const operation of operations) await assertAnimalOperationAllowed(database, animal.id_animal, operation);
    const current = currentAnimals.find((item) => item.id_animal === animal.id_animal)!;
    if (current.id_categoria_animal !== group.id_categoria_animal && input.tipo_movimiento !== 'PROPIEDAD') {
      throw new ValidationError('El grupo de destino debe tener la misma situación de propiedad que el animal.');
    }
    if (input.tipo_movimiento === 'GRUPO' && current.id_propiedad !== destinationProperty) {
      throw new ValidationError('El cambio de grupo solo puede hacerse dentro de la misma propiedad.');
    }
    if (input.tipo_movimiento === 'GRUPO' && current.id_grupo_actual === group.id_grupo) {
      throw new ValidationError(`${currentAnimals.length === 1 ? 'El animal seleccionado ya pertenece' : 'Uno de los animales seleccionados ya pertenece'} al grupo de destino.`);
    }
    if (input.tipo_movimiento === 'PROPIEDAD') {
      if (current.id_propiedad === destinationProperty) {
        throw new ValidationError('No puede trasladar un animal desde y hacia la misma propiedad.');
      }
    }
  }

  return {
    effectiveLocationId,
    relocateGroupId,
    destinationGroupId: group.id_grupo,
    destinationCategoryId: group.id_categoria_animal,
    sourcePropertyId:sourceProperty,
    destinationPropertyId:destinationProperty,
    currentAnimals,
  };
}

async function loadMovementForValidation(database: Queryable, id: string): Promise<MovementInput> {
  const head = (await database.query('SELECT * FROM movimiento_animal WHERE id_movimiento=$1 AND deleted_at IS NULL FOR UPDATE', [id])).rows[0];
  if (!head) throw new NotFoundError('Movimiento no encontrado.');
  if (head.estado !== 'BORRADOR') throw new ConflictError('Solo puede aplicarse un movimiento que esté en borrador.');
  const animals = (await database.query(
    `SELECT id_animal,seleccionado,id_ubicacion_destino,id_grupo_destino,observaciones
     FROM movimiento_animal_detalle WHERE id_movimiento=$1 AND deleted_at IS NULL`,
    [id],
  )).rows;
  return movement.parse({
    ...head,
    propiedad_origen: head.id_propiedad_origen,
    fecha_movimiento: movementDateValue(head.fecha_movimiento),
    animales: animals,
  });
}

async function applyValidatedMovement(
  database: Queryable,
  id: string,
  input: MovementInput,
  validation: MovementValidation,
) {
  await database.query("SELECT set_config('app.fecha_movimiento', $1, true)", [input.fecha_movimiento]);
  await database.query("SELECT set_config('app.motivo_cambio', $1, true)", [input.motivo ?? 'Movimiento de animales']);
  await database.query("SELECT set_config('app.movimiento_id', $1, true)", [id]);

  if (validation.relocateGroupId) {
    const relocated = await database.query(
      'UPDATE grupo SET id_ubicacion_actual=$2,updated_at=NOW() WHERE id_grupo=$1 AND activo=TRUE AND deleted_at IS NULL',
      [validation.relocateGroupId, validation.effectiveLocationId],
    );
    if (!relocated.rowCount) throw new ConflictError('El grupo dejó de estar disponible antes de aplicar el movimiento.');
  }

  for (const animal of validation.currentAnimals) {
    const updated = await database.query(
      `UPDATE animal
       SET id_categoria_animal=$2,id_grupo_actual=$3,id_ubicacion_actual=$4,updated_at=NOW()
       WHERE id_animal=$1 AND estado='ACTIVO' AND deleted_at IS NULL`,
      [animal.id_animal, validation.destinationCategoryId, validation.destinationGroupId, validation.effectiveLocationId],
    );
    if (!updated.rowCount) throw new ConflictError('Uno de los animales dejó de estar disponible antes de aplicar el movimiento.');
    await database.query(
      `UPDATE movimiento_animal_detalle
       SET id_grupo_anterior=$3,id_ubicacion_anterior=$4,id_grupo_destino=$5,id_ubicacion_destino=$6,
           estado='APLICADO',aplicado_en=NOW(),mensaje_error=NULL
       WHERE id_movimiento=$1 AND id_animal=$2 AND seleccionado=TRUE AND deleted_at IS NULL`,
      [id, animal.id_animal, animal.id_grupo_actual, animal.id_ubicacion_actual, validation.destinationGroupId, validation.effectiveLocationId],
    );
  }

  const completed = await database.query(
    `UPDATE movimiento_animal
     SET estado='COMPLETADO',total_seleccionados=$2,id_propiedad_origen=$3,
         id_propiedad_destino=$4,aplicado_en=NOW(),updated_at=NOW()
     WHERE id_movimiento=$1 AND estado='BORRADOR'`,
    [id,validation.currentAnimals.length,validation.sourcePropertyId,validation.destinationPropertyId],
  );
  if (!completed.rowCount) throw new ConflictError('El movimiento ya no está disponible para aplicarse.');
  return { cantidad: validation.currentAnimals.length };
}

export const movementsRouter = Router();
const movementImageDefinition={table:'movimiento_imagen',idColumn:'id_movimiento_imagen',parentColumn:'id_movimiento',parentTable:'movimiento_animal',parentIdColumn:'id_movimiento',moduleName:'movimientos'};

movementsRouter.get('/', requirePermission('MOVIMIENTO_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, (await pool.query(
  `SELECT m.*,COALESCE(mm.nombre,m.motivo) motivo_catalogo,
    u1.nombre ubicacion_origen,u2.nombre ubicacion_destino,g1.nombre grupo_origen,g2.nombre grupo_destino,
    p1.nombre propiedad_origen,p1.es_principal propiedad_origen_es_principal,
    p2.nombre propiedad_destino,p2.es_principal propiedad_destino_es_principal,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id_detalle',d.id_movimiento_detalle,'id_animal',a.id_animal,'animal',a.nombre,'nombre',a.nombre,
      'arete',a.codigo_arete,'codigo_arete',a.codigo_arete,'sexo',a.sexo,
      'id_categoria_animal',a.id_categoria_animal,'categoria',ca.nombre,
      'id_grupo_actual',a.id_grupo_actual,'grupo',ga.nombre,'id_ubicacion_actual',a.id_ubicacion_actual,'ubicacion',ua.nombre,
      'seleccionado',d.seleccionado,'estado',d.estado,'mensaje_error',d.mensaje_error,'observaciones',d.observaciones))
      FROM movimiento_animal_detalle d
      JOIN animal a ON a.id_animal=d.id_animal
      JOIN categoria_animal ca ON ca.id_categoria_animal=a.id_categoria_animal
      LEFT JOIN grupo ga ON ga.id_grupo=a.id_grupo_actual
      LEFT JOIN ubicacion ua ON ua.id_ubicacion=a.id_ubicacion_actual
      WHERE d.id_movimiento=m.id_movimiento AND d.deleted_at IS NULL),'[]') detalles,
    COALESCE((SELECT jsonb_agg(to_jsonb(mi) ORDER BY mi.created_at)
      FROM movimiento_imagen mi WHERE mi.id_movimiento=m.id_movimiento AND mi.lado='ORIGEN' AND mi.deleted_at IS NULL),'[]') fotos_origen,
    COALESCE((SELECT jsonb_agg(to_jsonb(mi) ORDER BY mi.created_at)
      FROM movimiento_imagen mi WHERE mi.id_movimiento=m.id_movimiento AND mi.lado='DESTINO' AND mi.deleted_at IS NULL),'[]') fotos_destino
   FROM movimiento_animal m
   LEFT JOIN ubicacion u1 ON u1.id_ubicacion=m.id_ubicacion_origen
   LEFT JOIN ubicacion u2 ON u2.id_ubicacion=m.id_ubicacion_destino
   LEFT JOIN grupo g1 ON g1.id_grupo=m.id_grupo_origen
   LEFT JOIN grupo g2 ON g2.id_grupo=m.id_grupo_destino
   LEFT JOIN propiedad_ganadera p1 ON p1.id_propiedad=m.id_propiedad_origen
   LEFT JOIN propiedad_ganadera p2 ON p2.id_propiedad=m.id_propiedad_destino
   LEFT JOIN motivo_movimiento mm ON mm.id_motivo_movimiento=m.id_motivo_movimiento
   WHERE m.deleted_at IS NULL ORDER BY m.fecha_movimiento DESC`,
)).rows)));

movementsRouter.get('/:id', requirePermission('MOVIMIENTO_CONSULTAR'), asyncHandler(async (req, res) => {
  const row=(await pool.query(
    `SELECT m.*,COALESCE(mm.nombre,m.motivo) motivo_catalogo,
      u1.nombre ubicacion_origen,u2.nombre ubicacion_destino,g1.nombre grupo_origen,g2.nombre grupo_destino,
      p1.nombre propiedad_origen,p1.es_principal propiedad_origen_es_principal,
      p2.nombre propiedad_destino,p2.es_principal propiedad_destino_es_principal,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id_detalle',d.id_movimiento_detalle,'id_animal',a.id_animal,'animal',a.nombre,'nombre',a.nombre,
        'arete',a.codigo_arete,'codigo_arete',a.codigo_arete,'sexo',a.sexo,
        'id_categoria_animal',a.id_categoria_animal,'categoria',ca.nombre,
        'id_grupo_actual',a.id_grupo_actual,'grupo',ga.nombre,'id_ubicacion_actual',a.id_ubicacion_actual,'ubicacion',ua.nombre,
        'seleccionado',d.seleccionado,'estado',d.estado,'mensaje_error',d.mensaje_error,'observaciones',d.observaciones))
        FROM movimiento_animal_detalle d
        JOIN animal a ON a.id_animal=d.id_animal
        JOIN categoria_animal ca ON ca.id_categoria_animal=a.id_categoria_animal
        LEFT JOIN grupo ga ON ga.id_grupo=a.id_grupo_actual
        LEFT JOIN ubicacion ua ON ua.id_ubicacion=a.id_ubicacion_actual
        WHERE d.id_movimiento=m.id_movimiento AND d.deleted_at IS NULL),'[]') detalles,
      COALESCE((SELECT jsonb_agg(to_jsonb(mi) ORDER BY mi.created_at)
        FROM movimiento_imagen mi WHERE mi.id_movimiento=m.id_movimiento AND mi.lado='ORIGEN' AND mi.deleted_at IS NULL),'[]') fotos_origen,
      COALESCE((SELECT jsonb_agg(to_jsonb(mi) ORDER BY mi.created_at)
        FROM movimiento_imagen mi WHERE mi.id_movimiento=m.id_movimiento AND mi.lado='DESTINO' AND mi.deleted_at IS NULL),'[]') fotos_destino
     FROM movimiento_animal m
     LEFT JOIN ubicacion u1 ON u1.id_ubicacion=m.id_ubicacion_origen
     LEFT JOIN ubicacion u2 ON u2.id_ubicacion=m.id_ubicacion_destino
     LEFT JOIN grupo g1 ON g1.id_grupo=m.id_grupo_origen
     LEFT JOIN grupo g2 ON g2.id_grupo=m.id_grupo_destino
     LEFT JOIN propiedad_ganadera p1 ON p1.id_propiedad=m.id_propiedad_origen
     LEFT JOIN propiedad_ganadera p2 ON p2.id_propiedad=m.id_propiedad_destino
     LEFT JOIN motivo_movimiento mm ON mm.id_motivo_movimiento=m.id_motivo_movimiento
     WHERE m.id_movimiento=$1 AND m.deleted_at IS NULL`,[routeParam(req.params.id,'id')])).rows[0];
  if(!row)throw new NotFoundError('Movimiento no encontrado.');
  return ok(res,row);
}));

movementsRouter.post('/', requirePermission('MOVIMIENTO_CREAR'), asyncHandler(async (req, res) => {
  const input = movement.parse(req.body);
  validateMovementMode(input.tipo_movimiento, input.modo_seleccion, input.id_grupo_filtro, input.id_grupo_destino);
  const result = await transaction(async (client) => {
    const reason = await movementReason(client, input.id_motivo_movimiento, input.tipo_movimiento);
    const sourceGroupId = input.id_grupo_filtro ?? input.id_grupo_origen;
    const source = await groupOrigin(client, sourceGroupId);
    const requestedSourceProperty=await resolvePropertySelector(client,input.propiedad_origen);
    if (source && input.propiedad_origen) {
      if (source.id_propiedad !== requestedSourceProperty) {
        throw new ValidationError('El grupo seleccionado no pertenece a la propiedad de origen.');
      }
    }
    const destinationGroupId = input.tipo_movimiento === 'UBICACION' && input.id_grupo_filtro
      ? input.id_grupo_filtro
      : input.id_grupo_destino;
    const destinationGroup=await groupOrigin(client,destinationGroupId);
    const destinationLocationProperty=await locationProperty(client,input.id_ubicacion_destino);
    if(destinationGroup&&destinationLocationProperty&&destinationGroup.id_propiedad!==destinationLocationProperty){
      throw new ValidationError('El grupo y la ubicación de destino pertenecen a propiedades diferentes.');
    }
    const destinationPropertyId=destinationLocationProperty??destinationGroup?.id_propiedad??null;
    const animals = input.tipo_movimiento === 'UBICACION' && input.id_grupo_filtro
      ? await completeGroupAnimals(client, input.id_grupo_filtro, input.animales, input.id_ubicacion_destino, destinationGroupId)
      : input.animales;
    const { animales: _animals, propiedad_origen: _propertyOrigin, ...head } = input;
    const row = (await client.query(buildInsert('movimiento_animal', {
      ...head,
      id_ubicacion_origen: input.id_ubicacion_origen ?? source?.id_ubicacion_actual ?? null,
      id_grupo_origen: input.tipo_movimiento === 'UBICACION' ? input.id_grupo_filtro ?? null : input.id_grupo_origen ?? null,
      id_grupo_destino: destinationGroupId ?? null,
      id_propiedad_origen:requestedSourceProperty??source?.id_propiedad??null,
      id_propiedad_destino:destinationPropertyId,
      id_motivo_movimiento: reason.id_motivo_movimiento,
      motivo: reason.nombre,
      estado: 'BORRADOR',
      total_candidatos: animals.length,
      total_seleccionados: animals.filter((animal) => animal.seleccionado).length,
      registrado_por: req.user!.id,
    }))).rows[0];
    for (const animal of animals) await client.query(buildInsert('movimiento_animal_detalle', {
      ...animal,
      id_ubicacion_destino: input.id_ubicacion_destino ?? null,
      id_grupo_destino: destinationGroupId ?? null,
      id_movimiento: row.id_movimiento,
    }));
    return row;
  }, req.user!.id);
  return created(res, result);
}));

movementsRouter.patch('/:id', requirePermission('MOVIMIENTO_CREAR'), asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, 'id');
  const input = movement.omit({ animales: true }).partial().parse(req.body);
  const row = await transaction(async (client) => {
    const found = (await client.query('SELECT * FROM movimiento_animal WHERE id_movimiento=$1 AND deleted_at IS NULL FOR UPDATE', [id])).rows[0];
    if (!found) throw new NotFoundError('Movimiento no encontrado.');
    if (found.estado === 'CANCELADO') throw new ConflictError('Un movimiento cancelado no puede modificarse.');
    const nextReasonId = input.id_motivo_movimiento ?? found.id_motivo_movimiento;
    const reason = await movementReason(client, nextReasonId);
    if (found.estado === 'BORRADOR') {
      const nextKind = input.tipo_movimiento ?? found.tipo_movimiento;
      const nextMode = input.modo_seleccion ?? found.modo_seleccion;
      const nextGroupFilter = input.id_grupo_filtro === undefined ? found.id_grupo_filtro : input.id_grupo_filtro;
      const requestedDestinationGroup = input.id_grupo_destino === undefined ? found.id_grupo_destino : input.id_grupo_destino;
      const nextDestinationGroup = nextKind === 'UBICACION' && nextGroupFilter ? nextGroupFilter : requestedDestinationGroup;
      const requestedOriginGroup = input.id_grupo_origen === undefined ? found.id_grupo_origen : input.id_grupo_origen;
      const nextOriginGroup = nextKind === 'UBICACION' && nextGroupFilter ? nextGroupFilter : requestedOriginGroup;
      const source = await groupOrigin(client, nextGroupFilter ?? nextOriginGroup);
      const nextSourceProperty=await resolvePropertySelector(client,input.propiedad_origen)??source?.id_propiedad??found.id_propiedad_origen??null;
      if (source && input.propiedad_origen) {
        if (source.id_propiedad !== nextSourceProperty) {
          throw new ValidationError('El grupo seleccionado no pertenece a la propiedad de origen.');
        }
      }
      const nextOriginLocation = input.id_ubicacion_origen === undefined
        ? found.id_ubicacion_origen ?? source?.id_ubicacion_actual ?? null
        : input.id_ubicacion_origen;
      validateMovementMode(
        nextKind,
        nextMode,
        nextGroupFilter,
        nextDestinationGroup,
      );
      const nextDestinationLocation=input.id_ubicacion_destino===undefined?found.id_ubicacion_destino:input.id_ubicacion_destino;
      const destinationGroup=await groupOrigin(client,nextDestinationGroup);
      const destinationLocationProperty=await locationProperty(client,nextDestinationLocation);
      if(destinationGroup&&destinationLocationProperty&&destinationGroup.id_propiedad!==destinationLocationProperty){
        throw new ValidationError('El grupo y la ubicación de destino pertenecen a propiedades diferentes.');
      }
      const nextDestinationProperty=destinationLocationProperty??destinationGroup?.id_propiedad??found.id_propiedad_destino??null;
      return (await client.query(
        `UPDATE movimiento_animal SET tipo_movimiento=$2,modo_seleccion=$3,id_grupo_filtro=$4,id_ubicacion_origen=$5,
          id_ubicacion_destino=$6,id_grupo_origen=$7,id_grupo_destino=$8,fecha_movimiento=$9,
          id_motivo_movimiento=$10,motivo=$11,observaciones=$12,id_propiedad_origen=$13,id_propiedad_destino=$14,updated_at=NOW()
         WHERE id_movimiento=$1 RETURNING *`,
        [id, nextKind,nextMode,
          nextGroupFilter,
          nextOriginLocation,
          nextDestinationLocation,
          nextOriginGroup,
          nextDestinationGroup,
          input.fecha_movimiento ?? found.fecha_movimiento,nextReasonId,reason.nombre,
          input.observaciones === undefined ? found.observaciones : input.observaciones,
          nextSourceProperty,nextDestinationProperty],
      )).rows[0];
    }
    return (await client.query(
      `UPDATE movimiento_animal SET fecha_movimiento=$2,id_motivo_movimiento=$3,motivo=$4,observaciones=$5,updated_at=NOW()
       WHERE id_movimiento=$1 RETURNING *`,
      [id,input.fecha_movimiento ?? found.fecha_movimiento,nextReasonId,reason.nombre,
        input.observaciones === undefined ? found.observaciones : input.observaciones],
    )).rows[0];
  }, req.user!.id);
  return ok(res, row);
}));

movementsRouter.put('/:id/seleccion', requirePermission('MOVIMIENTO_CREAR'), asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, 'id');
  const requestedItems = z.array(movementAnimal).parse(req.body.animales);
  await transaction(async (client) => {
    const found = (await client.query('SELECT * FROM movimiento_animal WHERE id_movimiento=$1 AND deleted_at IS NULL FOR UPDATE', [id])).rows[0];
    if (!found) throw new NotFoundError();
    if (found.estado !== 'BORRADOR') throw new ConflictError('Solo puede editarse un movimiento en borrador.');
    validateMovementMode(found.tipo_movimiento, found.modo_seleccion, found.id_grupo_filtro, found.id_grupo_destino);
    const items = found.tipo_movimiento === 'UBICACION' && found.id_grupo_filtro
      ? await completeGroupAnimals(client, found.id_grupo_filtro, requestedItems, found.id_ubicacion_destino, found.id_grupo_destino)
      : requestedItems;
    await client.query('DELETE FROM movimiento_animal_detalle WHERE id_movimiento=$1', [id]);
    for (const animal of items) await client.query(buildInsert('movimiento_animal_detalle', {
      ...animal,
      id_ubicacion_destino: found.id_ubicacion_destino ?? null,
      id_grupo_destino: found.id_grupo_destino ?? null,
      id_movimiento: id,
    }));
    await client.query('UPDATE movimiento_animal SET total_candidatos=$2,total_seleccionados=$3 WHERE id_movimiento=$1', [id, items.length, items.filter((item) => item.seleccionado).length]);
  }, req.user!.id);
  return ok(res, { message: 'Selección actualizada.' });
}));

movementsRouter.post('/:id/aplicar', requirePermission('MOVIMIENTO_CREAR'), asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, 'id');
  const row = await transaction(async (client) => {
    const input = await loadMovementForValidation(client, id);
    const validation = await validateMovementSelection(client, input);
    return applyValidatedMovement(client, id, input, validation);
  }, req.user!.id);
  return ok(res, row);
}));

movementsRouter.post('/:id/cancelar', requirePermission('MOVIMIENTO_ANULAR'), asyncHandler(async (req, res) => {
  const row = (await pool.query(
    "UPDATE movimiento_animal SET estado='CANCELADO' WHERE id_movimiento=$1 AND estado NOT IN('COMPLETADO','CANCELADO') AND deleted_at IS NULL RETURNING *",
    [routeParam(req.params.id, 'id')],
  )).rows[0];
  if (!row) throw new NotFoundError();
  return ok(res, row);
}));

movementsRouter.post('/:id/imagenes/:lado',requirePermission('MOVIMIENTO_CREAR'),recordImageUpload.array('imagenes',3),asyncHandler(async(req,res)=>{
  const id=routeParam(req.params.id,'id');
  const side=z.enum(['ORIGEN','DESTINO']).parse(routeParam(req.params.lado,'lado').toUpperCase());
  const rows=await transaction(async client=>{
    const movement=(await client.query(
      `SELECT tipo_movimiento FROM movimiento_animal WHERE id_movimiento=$1 AND deleted_at IS NULL FOR SHARE`,[id],
    )).rows[0] as {tipo_movimiento:string}|undefined;
    if(!movement)throw new NotFoundError('Movimiento no encontrado.');
    if(movement.tipo_movimiento!=='UBICACION')throw new ValidationError('Las fotografías de origen y destino corresponden únicamente a cambios de potrero o corral.');
    return saveRecordImages(client,movementImageDefinition,id,requestFiles(req),req.user!.id,{lado:side});
  },req.user!.id);
  return created(res,rows);
}));

movementsRouter.delete('/imagenes/:imageId',requirePermission('MOVIMIENTO_CREAR'),asyncHandler(async(req,res)=>{
  const image=await transaction(client=>deleteRecordImage(client,movementImageDefinition,routeParam(req.params.imageId,'imageId')),req.user!.id);
  await deleteCloudinaryImage(image.public_id);
  return noContent(res);
}));
