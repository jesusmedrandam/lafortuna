import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { env } from '../../config/env.js';
import { transaction } from '../../database/transaction.js';
import { asyncHandler } from '../../core/async-handler.js';
import { routeParam } from '../../core/route-param.js';
import { created, noContent, ok } from '../../core/http.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { assertPermission, requirePermission } from '../../middleware/permission.js';
import { buildInsert, buildUpdate } from '../shared/sql.js';
import { deleteCloudinaryImage, uploadAnimalImage } from '../../services/cloudinary.service.js';
const defs = {
    abortos: { table: 'aborto', id: 'id_aborto', animalColumn: 'id_vaca', read: 'ABORTO_CONSULTAR', write: 'ABORTO_ADMINISTRAR', columns: ['id_vaca', 'fecha', 'causa', 'meses_gestacion', 'descripcion'], order: 'fecha DESC NULLS LAST' },
    lactancias: { table: 'lactancia', id: 'id_lactancia', animalColumn: 'id_vaca', read: 'LACTANCIA_CONSULTAR', write: 'LACTANCIA_ADMINISTRAR', columns: ['id_vaca', 'id_parto', 'fecha_inicio', 'fecha_fin', 'activa', 'observaciones'], order: 'fecha_inicio DESC' },
    producciones: { table: 'produccion_leche', id: 'id_produccion', animalColumn: 'id_vaca', read: 'PRODUCCION_CONSULTAR', write: 'PRODUCCION_ADMINISTRAR', columns: ['id_vaca', 'id_lactancia', 'fecha_produccion', 'turno', 'litros', 'observaciones'], order: 'fecha_produccion DESC' },
    pesajes: { table: 'pesaje', id: 'id_pesaje', animalColumn: 'id_animal', read: 'PESAJE_CONSULTAR', write: 'PESAJE_ADMINISTRAR', columns: ['id_animal', 'fecha_pesaje', 'peso_kg', 'metodo', 'observaciones'], order: 'fecha_pesaje DESC' },
    muertes: { table: 'muerte', id: 'id_muerte', animalColumn: 'id_animal', read: 'MUERTE_CONSULTAR', write: 'MUERTE_ADMINISTRAR', columns: ['id_animal', 'fecha', 'causa', 'descripcion'], order: 'fecha DESC' },
    tratamientos: { table: 'tratamiento_animal', id: 'id_tratamiento', animalColumn: 'id_animal', read: 'SANIDAD_CONSULTAR', write: 'SANIDAD_ADMINISTRAR', columns: ['id_animal', 'id_tipo_tratamiento', 'id_medicamento', 'id_via_administracion', 'dosis', 'id_unidad_dosis', 'fecha_aplicacion', 'proxima_aplicacion', 'aplicado_por', 'descripcion', 'observaciones'], order: 'fecha_aplicacion DESC' }
};
function definition(moduleName) {
    const value = moduleName ? defs[moduleName] : undefined;
    if (!value)
        throw new NotFoundError('Módulo no encontrado.');
    return value;
}
function allowedBody(body, columns) {
    const data = Object.fromEntries(Object.entries(body).filter(([key]) => columns.includes(key)));
    if (!Object.keys(data).length)
        throw new ValidationError('No hay campos válidos para guardar.');
    return data;
}
export const recordsRouter = Router();
recordsRouter.get('/:module', asyncHandler(async (req, res) => {
    const d = definition(routeParam(req.params.module, 'module'));
    assertPermission(req.user, d.read);
    const rows = (await pool.query(`SELECT r.*, a.nombre animal, a.codigo_arete
     FROM ${d.table} r
     LEFT JOIN animal a ON a.id_animal = r.${d.animalColumn}
     WHERE r.deleted_at IS NULL
     ORDER BY r.${d.order}`)).rows;
    return ok(res, rows);
}));
recordsRouter.post('/:module', asyncHandler(async (req, res) => {
    const d = definition(routeParam(req.params.module, 'module'));
    assertPermission(req.user, d.write);
    const data = allowedBody(req.body, d.columns);
    const row = (await pool.query(buildInsert(d.table, { ...data, registrado_por: req.user.id }))).rows[0];
    return created(res, row);
}));
recordsRouter.patch('/:module/:id', asyncHandler(async (req, res) => {
    const d = definition(routeParam(req.params.module, 'module'));
    assertPermission(req.user, d.write);
    const data = allowedBody(req.body, d.columns);
    const row = (await pool.query(buildUpdate(d.table, d.id, routeParam(req.params.id, 'id'), data))).rows[0];
    if (!row)
        throw new NotFoundError();
    return ok(res, row);
}));
recordsRouter.delete('/:module/:id', asyncHandler(async (req, res) => {
    const d = definition(routeParam(req.params.module, 'module'));
    assertPermission(req.user, d.write);
    const result = await pool.query(`UPDATE ${d.table} SET deleted_at=NOW() WHERE ${d.id}=$1 AND deleted_at IS NULL`, [routeParam(req.params.id, 'id')]);
    if (!result.rowCount)
        throw new NotFoundError();
    return noContent(res);
}));
const partoSchema = z.object({
    id_prenez: z.string().uuid(),
    fecha_parto: z.string().datetime(),
    fecha_parto_local: z.string().date().optional(),
    tipo_parto: z.enum(['NORMAL', 'ASISTIDO', 'CESAREA', 'DESCONOCIDO']).default('NORMAL'),
    observaciones: z.string().nullable().optional(),
    crias: z.array(z.object({
        animal: z.object({
            codigo_arete: z.string().max(60).nullable().optional(),
            nombre: z.string().trim().min(1).max(120),
            id_especie: z.string().uuid(),
            sexo: z.enum(['MACHO', 'HEMBRA']),
            id_origen: z.string().uuid(),
            id_grupo_actual: z.string().uuid().nullable().optional(),
            id_ubicacion_actual: z.string().uuid().nullable().optional(),
            estado: z.enum(['ACTIVO', 'MUERTO']).default('ACTIVO')
        }),
        estado_nacimiento: z.enum(['VIVA', 'MUERTA', 'DEBIL', 'DESCONOCIDO']).default('VIVA'),
        peso_nacimiento_kg: z.number().positive().nullable().optional(),
        observaciones: z.string().max(300).nullable().optional()
    })).min(1)
});
const partoUpdateSchema = z.object({
    fecha_parto: z.string().datetime(),
    tipo_parto: z.enum(['NORMAL', 'ASISTIDO', 'CESAREA', 'DESCONOCIDO']),
    observaciones: z.string().nullable().optional(),
});
const birthImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.MAX_IMAGE_MB * 1024 * 1024 },
    fileFilter: (_req, file, callback) => file.mimetype.startsWith('image/')
        ? callback(null, true)
        : callback(new ValidationError('Solo se permiten imágenes.')),
});
export const birthsRouter = Router();
birthsRouter.get('/', requirePermission('PARTO_CONSULTAR'), asyncHandler(async (_req, res) => ok(res, (await pool.query(`SELECT p.*, m.nombre madre,m.codigo_arete madre_arete,pa.nombre padre,pa.codigo_arete padre_arete,pr.fecha_confirmacion,pr.fecha_parto_tentativa,
   COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id_parto_cria',pc.id_parto_cria,'id_cria',c.id_animal,'cria',c.nombre,
      'codigo_arete',c.codigo_arete,'sexo',c.sexo,'estado_nacimiento',pc.estado_nacimiento,
      'peso_nacimiento_kg',pc.peso_nacimiento_kg,'orden_nacimiento',pc.orden_nacimiento,
      'foto_perfil',(SELECT ai.secure_url FROM animal_imagen ai WHERE ai.id_animal=c.id_animal AND ai.deleted_at IS NULL ORDER BY ai.es_perfil DESC,ai.created_at DESC LIMIT 1)
   ) ORDER BY pc.orden_nacimiento)
   FROM parto_cria pc JOIN animal c ON c.id_animal=pc.id_cria
   WHERE pc.id_parto=p.id_parto AND pc.deleted_at IS NULL),'[]') crias
   FROM parto p JOIN animal m ON m.id_animal=p.id_madre
   LEFT JOIN animal pa ON pa.id_animal=p.id_padre
   LEFT JOIN prenez pr ON pr.id_prenez=p.id_prenez
   WHERE p.deleted_at IS NULL ORDER BY p.fecha_parto DESC`)).rows)));
birthsRouter.patch('/:id', requirePermission('PARTO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, 'id');
    const input = partoUpdateSchema.parse(req.body);
    const row = (await pool.query(`UPDATE parto SET fecha_parto=$2,tipo_parto=$3,observaciones=$4,updated_at=NOW()
     WHERE id_parto=$1 AND deleted_at IS NULL RETURNING *`, [id, input.fecha_parto, input.tipo_parto, input.observaciones ?? null])).rows[0];
    if (!row)
        throw new NotFoundError('Parto no encontrado.');
    return ok(res, row);
}));
birthsRouter.post('/', requirePermission('PARTO_ADMINISTRAR'), asyncHandler(async (req, res) => {
    const input = partoSchema.parse(req.body);
    try {
        const result = await transaction(async (client) => {
            const pregnancy = (await client.query(`SELECT p.id_prenez,p.id_vaca,p.id_padre,p.estado,
          v.id_animal,v.id_especie,v.id_categoria_animal,v.sexo,v.estado animal_estado
         FROM prenez p JOIN animal v ON v.id_animal=p.id_vaca AND v.deleted_at IS NULL
         WHERE p.id_prenez=$1 AND p.deleted_at IS NULL FOR UPDATE OF p`, [input.id_prenez])).rows[0];
            if (!pregnancy || pregnancy.estado !== 'CONFIRMADA') {
                throw new ValidationError('El parto debe registrarse desde una preñez confirmada y pendiente.');
            }
            const mother = {
                id_animal: pregnancy.id_animal,
                id_especie: pregnancy.id_especie,
                id_categoria_animal: pregnancy.id_categoria_animal,
                sexo: pregnancy.sexo,
                estado: pregnancy.animal_estado,
            };
            const motherId = pregnancy.id_vaca;
            const fatherId = pregnancy.id_padre;
            if (!mother || mother.sexo !== 'HEMBRA') {
                throw new ValidationError('La madre seleccionada no existe o no es hembra.');
            }
            if (mother.estado !== 'ACTIVO') {
                throw new ValidationError('La madre debe estar activa para registrar el parto.');
            }
            if (fatherId) {
                const father = (await client.query(`SELECT id_animal,id_especie,sexo,estado
           FROM animal
           WHERE id_animal=$1 AND deleted_at IS NULL
           FOR SHARE`, [fatherId])).rows[0];
                if (!father || father.sexo !== 'MACHO') {
                    throw new ValidationError('El padre seleccionado no existe o no es macho.');
                }
                if (father.id_especie !== mother.id_especie) {
                    throw new ValidationError('El padre y la madre deben pertenecer a la misma especie.');
                }
            }
            const birthDate = new Date(input.fecha_parto);
            if (Number.isNaN(birthDate.getTime()))
                throw new ValidationError('La fecha del parto no es válida.');
            const birthDay = input.fecha_parto_local ?? new Intl.DateTimeFormat('en-CA', {
                timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit',
            }).format(birthDate);
            await client.query("SELECT set_config('app.fecha_movimiento', $1, true)", [input.fecha_parto]);
            await client.query("SELECT set_config('app.motivo_cambio', 'Nacimiento', true)");
            const { crias, fecha_parto_local: _fechaPartoLocal, ...head } = input;
            const parto = (await client.query(buildInsert('parto', {
                ...head,
                id_madre: motherId,
                id_padre: fatherId,
                registrado_por: req.user.id,
            }))).rows[0];
            const createdChildren = [];
            let order = 1;
            for (const item of crias) {
                if (item.animal.id_especie !== mother.id_especie) {
                    throw new ValidationError(`La especie de la cría ${order} debe coincidir con la de la madre.`);
                }
                if (item.animal.id_grupo_actual) {
                    const group = (await client.query(`SELECT id_especie,activo FROM grupo WHERE id_grupo=$1 AND deleted_at IS NULL`, [item.animal.id_grupo_actual])).rows[0];
                    if (!group || !group.activo)
                        throw new ValidationError(`El grupo de la cría ${order} no está disponible.`);
                    if (group.id_especie && group.id_especie !== mother.id_especie) {
                        throw new ValidationError(`El grupo de la cría ${order} no corresponde a su especie.`);
                    }
                }
                if (item.animal.id_ubicacion_actual) {
                    const location = (await client.query(`SELECT activo,id_categoria_animal FROM ubicacion WHERE id_ubicacion=$1 AND deleted_at IS NULL`, [item.animal.id_ubicacion_actual])).rows[0];
                    if (!location || !location.activo)
                        throw new ValidationError(`El corral o potrero de la cría ${order} no está disponible.`);
                    if (location.id_categoria_animal !== mother.id_categoria_animal)
                        throw new ValidationError(`La ubicación de la cría ${order} no coincide con la categoría de la madre.`);
                }
                const childState = item.estado_nacimiento === 'MUERTA' ? 'MUERTO' : item.animal.estado;
                const cria = (await client.query(buildInsert('animal', {
                    ...item.animal,
                    id_especie: mother.id_especie,
                    id_categoria_animal: mother.id_categoria_animal,
                    estado: childState,
                    fecha_nacimiento: birthDay,
                    fecha_ingreso: birthDay,
                    id_madre: motherId,
                    id_padre: fatherId,
                    registrado_por: req.user.id,
                }))).rows[0];
                const partoCria = (await client.query(buildInsert('parto_cria', {
                    id_parto: parto.id_parto,
                    id_cria: cria.id_animal,
                    estado_nacimiento: item.estado_nacimiento,
                    peso_nacimiento_kg: item.peso_nacimiento_kg ?? null,
                    orden_nacimiento: order,
                    observaciones: item.observaciones ?? null,
                }))).rows[0];
                if (item.peso_nacimiento_kg) {
                    await client.query(buildInsert('pesaje', {
                        id_animal: cria.id_animal,
                        fecha_pesaje: input.fecha_parto,
                        peso_kg: item.peso_nacimiento_kg,
                        metodo: 'PESO_AL_NACER',
                        observaciones: item.observaciones ?? null,
                        registrado_por: req.user.id,
                    }));
                }
                createdChildren.push({
                    id_parto_cria: partoCria.id_parto_cria,
                    id_cria: cria.id_animal,
                    cria: cria.nombre,
                    sexo: cria.sexo,
                    estado_nacimiento: item.estado_nacimiento,
                    peso_nacimiento_kg: item.peso_nacimiento_kg ?? null,
                    orden_nacimiento: order,
                });
                order += 1;
            }
            await client.query(`UPDATE prenez SET estado='FINALIZADA',updated_at=NOW() WHERE id_prenez=$1`, [pregnancy.id_prenez]);
            await client.query(`UPDATE proximo_parto SET estado='REGISTRADO',updated_at=NOW()
         WHERE id_prenez=$1 AND deleted_at IS NULL`, [pregnancy.id_prenez]);
            return { ...parto, crias: createdChildren };
        }, req.user.id);
        return created(res, result);
    }
    catch (error) {
        const databaseError = error;
        if (databaseError.code === 'P0001') {
            throw new ValidationError(databaseError.message || 'El parto no cumple las reglas del sistema.');
        }
        throw error;
    }
}));
birthsRouter.post('/:id/crias/:childId/imagenes', requirePermission('PARTO_ADMINISTRAR'), birthImageUpload.single('imagen'), asyncHandler(async (req, res) => {
    if (!req.file)
        throw new ValidationError('Debes seleccionar una imagen.');
    const birthId = routeParam(req.params.id, 'id');
    const childId = routeParam(req.params.childId, 'childId');
    const relation = await pool.query(`SELECT p.id_madre
       FROM parto_cria pc
       JOIN parto p ON p.id_parto=pc.id_parto AND p.deleted_at IS NULL
       JOIN animal a ON a.id_animal=pc.id_cria AND a.deleted_at IS NULL
       WHERE pc.id_parto=$1 AND pc.id_cria=$2 AND pc.deleted_at IS NULL`, [birthId, childId]);
    if (!relation.rowCount)
        throw new NotFoundError('La cría no pertenece al parto indicado.');
    const cloud = await uploadAnimalImage(req.file.buffer, childId);
    try {
        const profile = req.body.es_perfil === 'true' || req.body.es_perfil === true;
        const row = await transaction(async (client) => {
            if (profile) {
                await client.query('UPDATE animal_imagen SET es_perfil=FALSE WHERE id_animal=$1 AND deleted_at IS NULL', [childId]);
            }
            const image = (await client.query(buildInsert('animal_imagen', {
                id_animal: childId,
                public_id: cloud.public_id,
                url: cloud.url,
                secure_url: cloud.secure_url,
                formato: cloud.format,
                ancho: cloud.width,
                alto: cloud.height,
                bytes: cloud.bytes,
                tipo_archivo: 'IMAGEN',
                mime_type: req.file.mimetype,
                nombre_original: req.file.originalname,
                es_perfil: profile,
                descripcion: req.body.descripcion || null,
                registrado_por: req.user.id,
            }))).rows[0];
            const relatedIds = profile ? [childId] : [...new Set([childId, relation.rows[0].id_madre])];
            for (const relatedId of relatedIds) {
                await client.query(buildInsert('animal_imagen_relacion', {
                    id_imagen: image.id_imagen, id_animal: relatedId, registrado_por: req.user.id,
                }));
            }
            return image;
        }, req.user.id);
        return created(res, row);
    }
    catch (error) {
        await deleteCloudinaryImage(cloud.public_id);
        throw error;
    }
}));
//# sourceMappingURL=records.routes.js.map