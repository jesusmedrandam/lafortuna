import type { Queryable } from '../modules/shared/sql.js';
import { NotFoundError, ValidationError } from '../core/errors.js';

export const animalOperationDefinitions = [
  { codigo: 'MOVIMIENTO_UBICACION', nombre: 'Cambios de potrero o corral', grupo: 'Movimientos' },
  { codigo: 'MOVIMIENTO_GRUPO', nombre: 'Cambios de grupo', grupo: 'Movimientos' },
  { codigo: 'MOVIMIENTO_PROPIEDAD', nombre: 'Traslados entre propiedades', grupo: 'Movimientos' },
  { codigo: 'CELO', nombre: 'Celos', grupo: 'Reproducción' },
  { codigo: 'INSEMINACION_ARTIFICIAL', nombre: 'Inseminación artificial', grupo: 'Reproducción' },
  { codigo: 'TRANSFERENCIA_EMBRIONES', nombre: 'Implantación de embriones', grupo: 'Reproducción' },
  { codigo: 'PRENEZ', nombre: 'Preñeces', grupo: 'Reproducción' },
  { codigo: 'PARTO', nombre: 'Partos', grupo: 'Reproducción' },
  { codigo: 'ABORTO', nombre: 'Abortos', grupo: 'Reproducción' },
  { codigo: 'TRATAMIENTO', nombre: 'Tratamientos y sanidad', grupo: 'Sanidad' },
  { codigo: 'LIMPIEZA_POTRERO', nombre: 'Limpieza de potreros', grupo: 'Mantenimiento' },
  { codigo: 'COMPRA', nombre: 'Compras', grupo: 'Comercial' },
  { codigo: 'VENTA', nombre: 'Ventas', grupo: 'Comercial' },
  { codigo: 'PESAJE', nombre: 'Pesajes', grupo: 'Manejo' },
  { codigo: 'HERRAJE', nombre: 'Herraje', grupo: 'Manejo' },
  { codigo: 'DESCORNE', nombre: 'Descorne', grupo: 'Manejo' },
  { codigo: 'MUERTE', nombre: 'Registro de muerte', grupo: 'Manejo' },
  { codigo: 'LACTANCIA', nombre: 'Lactancias', grupo: 'Producción' },
  { codigo: 'PRODUCCION_LECHE', nombre: 'Ordeño y producción de leche', grupo: 'Producción' },
] as const;

export type AnimalOperationCode = typeof animalOperationDefinitions[number]['codigo'];

export async function assertPropertyOperationAllowed(
  database: Queryable,
  propertyId: string,
  operation: AnimalOperationCode,
) {
  const row = (await database.query(
    `SELECT p.nombre,
      COALESCE((SELECT opa.permitido
        FROM operacion_propiedad_animal opa
        WHERE opa.id_propiedad=p.id_propiedad
          AND opa.codigo_operacion=$2
          AND opa.deleted_at IS NULL
        LIMIT 1),TRUE) permitido
     FROM propiedad_ganadera p
     WHERE p.id_propiedad=$1 AND p.deleted_at IS NULL`,
    [propertyId, operation],
  )).rows[0] as { nombre:string; permitido:boolean }|undefined;
  if(!row)throw new NotFoundError('Propiedad no encontrada.');
  if(!row.permitido)throw new ValidationError(`${operationLabel(operation)} no está disponible en ${row.nombre}.`);
  return row;
}

export async function principalPropertyId(database:Queryable) {
  const row=(await database.query(
    `SELECT id_propiedad FROM propiedad_ganadera
     WHERE deleted_at IS NULL AND activa=TRUE
     ORDER BY es_principal DESC,nombre LIMIT 1`,
  )).rows[0] as {id_propiedad:string}|undefined;
  if(!row)throw new NotFoundError('No hay una propiedad activa configurada.');
  return row.id_propiedad;
}

export async function assertAnimalOperationAllowed(
  database: Queryable,
  animalId: string,
  operation: AnimalOperationCode,
) {
  const row = (await database.query(
    `SELECT a.nombre,a.estado,ca.nombre categoria,
      property.id_propiedad,property.nombre propiedad,
      COALESCE((SELECT opa.permitido
        FROM operacion_propiedad_animal opa
        WHERE opa.id_propiedad=property.id_propiedad
          AND opa.codigo_operacion=$2
          AND opa.deleted_at IS NULL
        LIMIT 1),(SELECT oca.permitido
        FROM operacion_categoria_animal oca
        WHERE oca.id_categoria_animal=a.id_categoria_animal
          AND oca.codigo_operacion=$2
          AND oca.deleted_at IS NULL
        LIMIT 1),TRUE) permitido
     FROM animal a
     JOIN categoria_animal ca ON ca.id_categoria_animal=a.id_categoria_animal
     LEFT JOIN grupo g ON g.id_grupo=a.id_grupo_actual
     LEFT JOIN ubicacion u ON u.id_ubicacion=a.id_ubicacion_actual
     LEFT JOIN LATERAL(
       SELECT p.id_propiedad,p.nombre
       FROM propiedad_ganadera p
       WHERE p.deleted_at IS NULL
         AND (p.id_propiedad=COALESCE(g.id_propiedad,u.id_propiedad)
           OR COALESCE(g.id_propiedad,u.id_propiedad) IS NULL)
       ORDER BY (p.id_propiedad=COALESCE(g.id_propiedad,u.id_propiedad)) DESC,
         p.es_principal DESC,p.activa DESC,p.nombre
       LIMIT 1
     ) property ON TRUE
     WHERE a.id_animal=$1 AND a.deleted_at IS NULL`,
    [animalId, operation],
  )).rows[0] as { nombre: string; estado: string; categoria: string; id_propiedad:string|null; propiedad:string|null; permitido: boolean } | undefined;
  if (!row) throw new NotFoundError('Animal no encontrado.');
  if (row.estado !== 'ACTIVO') throw new ValidationError(`${row.nombre} no está activo y no admite nuevas operaciones.`);
  if (!row.permitido) throw new ValidationError(`${operationLabel(operation)} no está disponible en ${row.propiedad ?? `la categoría ${row.categoria}`}.`);
  return row;
}

export function operationLabel(code: AnimalOperationCode) {
  return animalOperationDefinitions.find((item) => item.codigo === code)?.nombre ?? code;
}
