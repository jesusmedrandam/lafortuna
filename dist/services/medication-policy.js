import { NotFoundError, ValidationError } from '../core/errors.js';
export async function assertMedicationApplication(client, medicationId, routeId, unitId, treatmentTypeId) {
    if (typeof medicationId !== 'string' || typeof routeId !== 'string')
        throw new ValidationError('Selecciona el medicamento y una vía permitida.');
    const medicine = (await client.query(`SELECT id_medicamento,id_tipo_tratamiento,nombre_comercial,id_unidad_predeterminada,dosis_sugerida,indicaciones
     FROM medicamento WHERE id_medicamento=$1 AND deleted_at IS NULL AND activo=TRUE FOR SHARE`, [medicationId])).rows[0];
    if (!medicine)
        throw new NotFoundError('El medicamento no existe o está inactivo.');
    if (typeof treatmentTypeId === 'string' && medicine.id_tipo_tratamiento !== treatmentTypeId) {
        throw new ValidationError('El medicamento no corresponde al tipo de tratamiento seleccionado.');
    }
    const route = (await client.query(`SELECT 1 FROM medicamento_via_administracion mva
     JOIN via_administracion va ON va.id_via_administracion=mva.id_via_administracion
     WHERE mva.id_medicamento=$1 AND mva.id_via_administracion=$2
       AND va.deleted_at IS NULL AND va.activo=TRUE`, [medicationId, routeId])).rows[0];
    if (!route)
        throw new ValidationError('La vía seleccionada no está permitida para este medicamento.');
    if (medicine.id_unidad_predeterminada && unitId !== medicine.id_unidad_predeterminada) {
        throw new ValidationError('La unidad de dosis debe ser la configurada para el medicamento.');
    }
    if (!medicine.id_unidad_predeterminada && typeof unitId !== 'string')
        throw new ValidationError('Selecciona la unidad de dosis.');
    return medicine;
}
//# sourceMappingURL=medication-policy.js.map