import type { Queryable } from '../modules/shared/sql.js';
import { NotFoundError, ValidationError } from '../core/errors.js';

export const animalOperationDefinitions = [
  { codigo: 'MOVIMIENTO_UBICACION', nombre: 'Cambios de potrero o corral', grupo: 'Movimientos' },
  { codigo: 'MOVIMIENTO_GRUPO', nombre: 'Cambios de grupo', grupo: 'Movimientos' },
  { codigo: 'MOVIMIENTO_PROPIEDAD', nombre: 'Traslados entre propiedades', grupo: 'Movimientos' },
  { codigo: 'CELO', nombre: 'Celos', grupo: 'Reproducción' },
  { codigo: 'PRENEZ', nombre: 'Preñeces', grupo: 'Reproducción' },
  { codigo: 'PARTO', nombre: 'Partos', grupo: 'Reproducción' },
  { codigo: 'ABORTO', nombre: 'Abortos', grupo: 'Reproducción' },
  { codigo: 'TRATAMIENTO', nombre: 'Tratamientos y sanidad', grupo: 'Sanidad' },
  { codigo: 'VENTA', nombre: 'Ventas', grupo: 'Comercial' },
  { codigo: 'PESAJE', nombre: 'Pesajes', grupo: 'Manejo' },
  { codigo: 'MUERTE', nombre: 'Registro de muerte', grupo: 'Manejo' },
  { codigo: 'LACTANCIA', nombre: 'Lactancias', grupo: 'Producción' },
  { codigo: 'PRODUCCION_LECHE', nombre: 'Ordeño y producción de leche', grupo: 'Producción' },
] as const;

export type AnimalOperationCode = typeof animalOperationDefinitions[number]['codigo'];

export async function assertAnimalOperationAllowed(
  database: Queryable,
  animalId: string,
  operation: AnimalOperationCode,
) {
  const row = (await database.query(
    `SELECT a.nombre,a.estado,ca.nombre categoria,
      COALESCE(pg.es_principal,pu.es_principal,FALSE) propiedad_principal,
      COALESCE((SELECT oca.permitido
        FROM operacion_categoria_animal oca
        WHERE oca.id_categoria_animal=a.id_categoria_animal
          AND oca.codigo_operacion=$2
          AND oca.deleted_at IS NULL
        LIMIT 1),TRUE) permitido
     FROM animal a
     JOIN categoria_animal ca ON ca.id_categoria_animal=a.id_categoria_animal
     LEFT JOIN grupo g ON g.id_grupo=a.id_grupo_actual
     LEFT JOIN propiedad_ganadera pg ON pg.id_propiedad=g.id_propiedad
     LEFT JOIN ubicacion u ON u.id_ubicacion=a.id_ubicacion_actual
     LEFT JOIN propiedad_ganadera pu ON pu.id_propiedad=u.id_propiedad
     WHERE a.id_animal=$1 AND a.deleted_at IS NULL`,
    [animalId, operation],
  )).rows[0] as { nombre: string; estado: string; categoria: string; propiedad_principal: boolean; permitido: boolean } | undefined;
  if (!row) throw new NotFoundError('Animal no encontrado.');
  if (row.estado !== 'ACTIVO') throw new ValidationError(`${row.nombre} no está activo y no admite nuevas operaciones.`);
  if (['LACTANCIA', 'PRODUCCION_LECHE'].includes(operation) && !row.propiedad_principal) {
    throw new ValidationError(`${operationLabel(operation)} solo está disponible para animales de la propiedad principal.`);
  }
  if (!row.permitido) throw new ValidationError(`${operationLabel(operation)} no está disponible para animales de la categoría ${row.categoria}.`);
  return row;
}

export function operationLabel(code: AnimalOperationCode) {
  return animalOperationDefinitions.find((item) => item.codigo === code)?.nombre ?? code;
}
