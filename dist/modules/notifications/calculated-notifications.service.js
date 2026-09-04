import { env } from '../../config/env.js';
import { transaction } from '../../database/transaction.js';
import { emitNotification } from './notifications.service.js';
import { scheduleNotificationPushDispatch } from './notifications.push.js';
let running = false;
let timer = null;
function localDate(value) {
    return String(value ?? '').slice(0, 10);
}
function dateDiff(later, earlier) {
    const a = new Date(`${later}T12:00:00Z`).getTime();
    const b = new Date(`${earlier}T12:00:00Z`).getTime();
    return Math.round((a - b) / 86_400_000);
}
function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
function animalLabel(row) {
    return String(row.nombre ?? 'Animal');
}
function countLabel(value, singular, plural) {
    return `${value.toLocaleString('es-EC')} ${value === 1 ? singular : plural}`;
}
async function currentEcuadorDate(client) {
    const row = (await client.query(`SELECT (NOW() AT TIME ZONE 'America/Guayaquil')::date::text hoy,
            ((NOW() AT TIME ZONE 'America/Guayaquil')::date-1)::text ayer`)).rows[0];
    return row;
}
async function notifyUpcomingBirths(client, today) {
    const rows = (await client.query(`SELECT pp.id_proximo_parto,pp.id_prenez,pp.fecha_tentativa::text,
            v.id_animal,v.nombre,v.codigo_arete
     FROM proximo_parto pp
     JOIN prenez p ON p.id_prenez=pp.id_prenez AND p.estado='CONFIRMADA' AND p.deleted_at IS NULL
     JOIN animal v ON v.id_animal=pp.id_vaca AND v.estado='ACTIVO' AND v.deleted_at IS NULL
     WHERE pp.estado='PENDIENTE' AND pp.deleted_at IS NULL
       AND pp.fecha_tentativa IS NOT NULL
       AND pp.fecha_tentativa BETWEEN $1::date-INTERVAL '30 days' AND $1::date+INTERVAL '14 days'`, [today])).rows;
    for (const row of rows) {
        const dueDate = localDate(row.fecha_tentativa);
        const days = dateDiff(dueDate, today);
        const stage = days < 0 ? 'ATRASADO' : days <= 2 ? 'DOS_DIAS' : days <= 7 ? 'SIETE_DIAS' : 'CATORCE_DIAS';
        const priority = days < 0 || days <= 2 ? 'URGENTE' : days <= 7 ? 'IMPORTANTE' : 'INFO';
        const timing = days < 0
            ? `La fecha estimada pasó hace ${countLabel(Math.abs(days), 'día', 'días')}`
            : days === 0 ? 'La fecha estimada es hoy' : `Faltan aproximadamente ${countLabel(days, 'día', 'días')}`;
        await emitNotification(client, {
            tipo: 'PROXIMO_PARTO', categoria: 'REPRODUCCION', prioridad: priority,
            titulo: days < 0 ? 'Parto estimado atrasado' : 'Próximo parto',
            mensaje: `${animalLabel(row)} · ${timing} (${dueDate}).`, permiso: 'PARTO_CONSULTAR',
            entidadTipo: 'PROXIMO_PARTO', entidadId: String(row.id_proximo_parto), ruta: `/partos?prenez=${row.id_prenez}&tab=pregnancies`,
            datos: { id_animal: row.id_animal, id_prenez: row.id_prenez, fecha_tentativa: dueDate, dias_restantes: days },
            claveDedupe: `CALC:PARTO:${row.id_proximo_parto}:${stage}`,
        });
    }
}
async function notifyBirthdays(client, today) {
    const rows = (await client.query(`SELECT id_animal,nombre,codigo_arete,fecha_nacimiento::text,
            DATE_PART('year',AGE($1::date,fecha_nacimiento))::int edad
     FROM animal
     WHERE estado='ACTIVO' AND deleted_at IS NULL AND fecha_nacimiento IS NOT NULL
       AND EXTRACT(MONTH FROM fecha_nacimiento)=EXTRACT(MONTH FROM $1::date)
       AND EXTRACT(DAY FROM fecha_nacimiento)=EXTRACT(DAY FROM $1::date)
       AND fecha_nacimiento<$1::date`, [today])).rows;
    const year = today.slice(0, 4);
    for (const row of rows) {
        await emitNotification(client, {
            tipo: 'CUMPLEANOS_ANIMAL', categoria: 'ANIMALES', prioridad: 'INFO',
            titulo: 'Cumpleaños del animal', mensaje: `${animalLabel(row)} cumple ${countLabel(number(row.edad), 'año', 'años')} hoy.`,
            permiso: 'ANIMAL_CONSULTAR', entidadTipo: 'ANIMAL', entidadId: String(row.id_animal),
            ruta: `/animales/${row.id_animal}`, datos: { edad: number(row.edad), fecha_nacimiento: row.fecha_nacimiento },
            claveDedupe: `CALC:CUMPLE:${row.id_animal}:${year}`,
        });
    }
}
async function notifyProductionVariation(client, yesterday) {
    const row = (await client.query(`WITH current_values AS (
       SELECT
         (SELECT COUNT(*)::int FROM produccion_tanque WHERE fecha_produccion=$1::date AND deleted_at IS NULL) tanque_registros,
         (SELECT COALESCE(SUM(litros),0) FROM produccion_tanque WHERE fecha_produccion=$1::date AND deleted_at IS NULL) tanque_total,
         (SELECT COUNT(*)::int FROM produccion_leche WHERE fecha_produccion=$1::date AND deleted_at IS NULL) vacas_registros,
         (SELECT COALESCE(SUM(litros),0) FROM produccion_leche WHERE fecha_produccion=$1::date AND deleted_at IS NULL) vacas_total
     ), history AS (
       SELECT
         (SELECT AVG(total) FROM (SELECT SUM(litros) total FROM produccion_tanque
           WHERE fecha_produccion BETWEEN $1::date-INTERVAL '7 days' AND $1::date-INTERVAL '1 day'
             AND deleted_at IS NULL GROUP BY fecha_produccion) t) tanque_promedio,
         (SELECT AVG(total) FROM (SELECT SUM(litros) total FROM produccion_leche
           WHERE fecha_produccion BETWEEN $1::date-INTERVAL '7 days' AND $1::date-INTERVAL '1 day'
             AND deleted_at IS NULL GROUP BY fecha_produccion) v) vacas_promedio
     )
     SELECT *,CASE WHEN tanque_registros>0 THEN 'TANQUE' ELSE 'VACAS' END fuente,
       CASE WHEN tanque_registros>0 THEN tanque_total ELSE vacas_total END total_actual,
       CASE WHEN tanque_registros>0 THEN tanque_promedio ELSE vacas_promedio END promedio
     FROM current_values CROSS JOIN history`, [yesterday])).rows[0];
    const records = textSource(row.fuente) === 'TANQUE' ? number(row.tanque_registros) : number(row.vacas_registros);
    const current = number(row.total_actual);
    const average = number(row.promedio);
    if (!records || average <= 0)
        return;
    const variation = ((current - average) / average) * 100;
    if (Math.abs(variation) < env.PRODUCTION_VARIATION_ALERT_PERCENT)
        return;
    const decrease = variation < 0;
    await emitNotification(client, {
        tipo: 'VARIACION_PRODUCCION', categoria: 'PRODUCCION',
        prioridad: decrease && variation <= -30 ? 'URGENTE' : 'IMPORTANTE',
        titulo: decrease ? 'Caída de producción de leche' : 'Aumento de producción de leche',
        mensaje: `${yesterday}: ${current.toLocaleString('es-EC', { maximumFractionDigits: 2 })} L, ${Math.abs(variation).toLocaleString('es-EC', { maximumFractionDigits: 1 })}% ${decrease ? 'por debajo' : 'por encima'} del promedio de días con registros.`,
        permiso: 'PRODUCCION_CONSULTAR', entidadTipo: 'PRODUCCION_DIARIA', ruta: `/produccion?fecha=${yesterday}`,
        datos: { fecha: yesterday, total_litros: current, promedio_litros: average, variacion_porcentaje: variation, fuente: row.fuente },
        claveDedupe: `CALC:PRODUCCION:${yesterday}`,
    });
}
function textSource(value) {
    return String(value ?? '');
}
async function notifyOverdueCleanings(client, today) {
    const rows = (await client.query(`SELECT p.id_potrero,u.nombre,MAX(COALESCE(l.fecha_finalizacion,l.fecha_inicio))::text ultima_limpieza,
       CASE WHEN MAX(COALESCE(l.fecha_finalizacion,l.fecha_inicio)) IS NULL THEN NULL
         ELSE ($1::date-MAX(COALESCE(l.fecha_finalizacion,l.fecha_inicio)))::int END dias
     FROM potrero p
     JOIN ubicacion u ON u.id_ubicacion=p.id_ubicacion
     LEFT JOIN limpieza_potrero l ON l.id_potrero=p.id_potrero AND l.estado='COMPLETADO' AND l.deleted_at IS NULL
     WHERE p.deleted_at IS NULL AND u.deleted_at IS NULL AND u.activo=TRUE
     GROUP BY p.id_potrero,u.nombre
     HAVING MAX(COALESCE(l.fecha_finalizacion,l.fecha_inicio)) IS NULL
       OR $1::date-MAX(COALESCE(l.fecha_finalizacion,l.fecha_inicio)) >= $2`, [today, env.CLEANING_ALERT_DAYS])).rows;
    const month = today.slice(0, 7);
    for (const row of rows) {
        const never = row.dias === null;
        await emitNotification(client, {
            tipo: 'LIMPIEZA_POTRERO_PENDIENTE', categoria: 'MANTENIMIENTO', prioridad: 'IMPORTANTE',
            titulo: never ? 'Potrero sin limpieza registrada' : 'Limpieza de potrero pendiente',
            mensaje: never
                ? `${row.nombre} no tiene una limpieza completada registrada.`
                : `${row.nombre} lleva ${countLabel(number(row.dias), 'día', 'días')} desde la última limpieza completada.`,
            permiso: 'LIMPIEZA_CONSULTAR', entidadTipo: 'POTRERO', entidadId: String(row.id_potrero), ruta: `/limpiezas?potrero=${row.id_potrero}`,
            datos: { ultima_limpieza: row.ultima_limpieza, dias: row.dias, umbral_dias: env.CLEANING_ALERT_DAYS },
            claveDedupe: `CALC:LIMPIEZA:${row.id_potrero}:${month}`,
        });
    }
}
async function notifyTreatmentDates(client, today) {
    const rows = (await client.query(`SELECT t.id_tratamiento,t.id_animal,t.id_tipo_tratamiento,t.proxima_aplicacion::text,
            a.nombre,a.codigo_arete,tt.nombre tratamiento
     FROM tratamiento_animal t
     JOIN animal a ON a.id_animal=t.id_animal AND a.estado='ACTIVO' AND a.deleted_at IS NULL
     LEFT JOIN tipo_tratamiento tt ON tt.id_tipo_tratamiento=t.id_tipo_tratamiento
     WHERE t.deleted_at IS NULL AND t.proxima_aplicacion IS NOT NULL
       AND t.proxima_aplicacion BETWEEN $1::date-INTERVAL '30 days' AND $1::date+INTERVAL '7 days'
       AND NOT EXISTS(SELECT 1 FROM tratamiento_animal newer
         WHERE newer.id_animal=t.id_animal AND newer.id_tipo_tratamiento=t.id_tipo_tratamiento
           AND newer.fecha_aplicacion>=t.proxima_aplicacion AND newer.deleted_at IS NULL
           AND newer.id_tratamiento<>t.id_tratamiento)`, [today])).rows;
    for (const row of rows) {
        const next = localDate(row.proxima_aplicacion);
        const days = dateDiff(next, today);
        const stage = days < 0 ? 'ATRASADO' : days === 0 ? 'HOY' : 'PROXIMO';
        await emitNotification(client, {
            tipo: 'TRATAMIENTO_PENDIENTE', categoria: 'SANIDAD', prioridad: days <= 0 ? 'URGENTE' : 'IMPORTANTE',
            titulo: days < 0 ? 'Tratamiento atrasado' : days === 0 ? 'Tratamiento programado para hoy' : 'Próximo tratamiento',
            mensaje: `${animalLabel(row)} · ${String(row.tratamiento ?? 'Tratamiento')} · ${next}${days > 0 ? ` (faltan ${days} días)` : days < 0 ? ` (${Math.abs(days)} días de atraso)` : ''}.`,
            permiso: 'SANIDAD_CONSULTAR', entidadTipo: 'TRATAMIENTO', entidadId: String(row.id_tratamiento), ruta: `/sanidad?tratamiento=${row.id_tratamiento}`,
            datos: { id_animal: row.id_animal, proxima_aplicacion: next, dias_restantes: days },
            claveDedupe: `CALC:TRATAMIENTO:${row.id_tratamiento}:${stage}`,
        });
    }
}
export async function generateCalculatedNotifications() {
    if (running)
        return 0;
    running = true;
    try {
        const result = await transaction(async (client) => {
            const lock = await client.query(`SELECT pg_try_advisory_xact_lock(78128433) acquired`);
            if (!lock.rows[0]?.acquired)
                return 0;
            const dates = await currentEcuadorDate(client);
            await notifyUpcomingBirths(client, dates.hoy);
            await notifyBirthdays(client, dates.hoy);
            await notifyProductionVariation(client, dates.ayer);
            await notifyOverdueCleanings(client, dates.hoy);
            await notifyTreatmentDates(client, dates.hoy);
            return 1;
        });
        if (result)
            scheduleNotificationPushDispatch();
        return result;
    }
    finally {
        running = false;
    }
}
export function startCalculatedNotificationWorker() {
    if (timer)
        return () => undefined;
    void generateCalculatedNotifications().catch(error => console.error('Error al calcular alertas:', error));
    timer = setInterval(() => {
        void generateCalculatedNotifications().catch(error => console.error('Error al calcular alertas:', error));
    }, env.CALCULATED_ALERT_INTERVAL_MS);
    timer.unref();
    return () => {
        if (timer)
            clearInterval(timer);
        timer = null;
    };
}
//# sourceMappingURL=calculated-notifications.service.js.map