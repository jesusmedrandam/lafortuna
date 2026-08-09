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
];
export async function assertAnimalOperationAllowed(database, animalId, operation) {
    const row = (await database.query(`SELECT a.nombre,a.estado,ca.nombre categoria,
      COALESCE((SELECT oca.permitido
        FROM operacion_categoria_animal oca
        WHERE oca.id_categoria_animal=a.id_categoria_animal
          AND oca.codigo_operacion=$2
          AND oca.deleted_at IS NULL
        LIMIT 1),TRUE) permitido
     FROM animal a
     JOIN categoria_animal ca ON ca.id_categoria_animal=a.id_categoria_animal
     WHERE a.id_animal=$1 AND a.deleted_at IS NULL`, [animalId, operation])).rows[0];
    if (!row)
        throw new NotFoundError('Animal no encontrado.');
    if (row.estado !== 'ACTIVO')
        throw new ValidationError(`${row.nombre} no está activo y no admite nuevas operaciones.`);
    if (!row.permitido)
        throw new ValidationError(`${operationLabel(operation)} no está disponible para animales de la categoría ${row.categoria}.`);
    return row;
}
export function operationLabel(code) {
    return animalOperationDefinitions.find((item) => item.codigo === code)?.nombre ?? code;
}
//# sourceMappingURL=animal-operation-policy.js.map