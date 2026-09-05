import type { PoolClient } from 'pg';
import { env } from '../../config/env.js';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { emitNotification } from './notifications.service.js';
import { scheduleNotificationPushDispatch } from './notifications.push.js';

type Row = Record<string, unknown>;

let running = false;
let timer: NodeJS.Timeout | null = null;

function localDate(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '';
}

function shortDate(value: unknown) {
  const date = localDate(value);
  if (!date) return 'fecha no indicada';
  return new Intl.DateTimeFormat('es-EC', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`)).replaceAll('.', '');
}

function decimal(value: unknown, maximumFractionDigits = 2) {
  return number(value).toLocaleString('es-EC', { maximumFractionDigits });
}

function notificationData(data: Record<string, unknown>, row: Row) {
  const original = String(row.foto_perfil ?? '').trim();
  const image = original.includes('/image/upload/')
    ? original.replace('/image/upload/', '/image/upload/c_fill,w_192,h_192,q_auto/')
    : original;
  return image ? { ...data, imagen_url: image } : data;
}

function dateDiff(later: string, earlier: string) {
  const a = new Date(`${later}T12:00:00Z`).getTime();
  const b = new Date(`${earlier}T12:00:00Z`).getTime();
  return Math.round((a - b) / 86_400_000);
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function animalLabel(row: Row) {
  return String(row.nombre ?? 'Animal');
}

function countLabel(value: number, singular: string, plural: string) {
  return `${value.toLocaleString('es-EC')} ${value === 1 ? singular : plural}`;
}

async function currentEcuadorDate(client: PoolClient) {
  const row = (await client.query(
    `SELECT (NOW() AT TIME ZONE 'America/Guayaquil')::date::text hoy,
            ((NOW() AT TIME ZONE 'America/Guayaquil')::date-1)::text ayer`,
  )).rows[0] as { hoy: string; ayer: string };
  return row;
}

async function notifyUpcomingBirths(client: PoolClient, today: string) {
  const rows = (await client.query(
    `SELECT pp.id_proximo_parto,pp.id_prenez,pp.fecha_tentativa::text,
            v.id_animal,v.nombre,v.codigo_arete,
            (SELECT ai.secure_url FROM animal_imagen ai WHERE ai.id_animal=v.id_animal AND ai.deleted_at IS NULL
             ORDER BY ai.es_perfil DESC,ai.created_at DESC LIMIT 1) foto_perfil
     FROM proximo_parto pp
     JOIN prenez p ON p.id_prenez=pp.id_prenez AND p.estado='CONFIRMADA' AND p.deleted_at IS NULL
     JOIN animal v ON v.id_animal=pp.id_vaca AND v.estado='ACTIVO' AND v.deleted_at IS NULL
     WHERE pp.estado='PENDIENTE' AND pp.deleted_at IS NULL
       AND pp.fecha_tentativa IS NOT NULL
       AND pp.fecha_tentativa BETWEEN $1::date-INTERVAL '30 days' AND $1::date+INTERVAL '14 days'`,
    [today],
  )).rows as Row[];
  for (const row of rows) {
    const dueDate = localDate(row.fecha_tentativa);
    const days = dateDiff(dueDate, today);
    const stage = days < 0 ? 'ATRASADO' : days <= 2 ? 'DOS_DIAS' : days <= 7 ? 'SIETE_DIAS' : 'CATORCE_DIAS';
    const priority = days < 0 || days <= 2 ? 'URGENTE' : days <= 7 ? 'IMPORTANTE' : 'INFO';
    const timing = days < 0
      ? `La fecha estimada pasó hace ${countLabel(Math.abs(days),'día','días')}`
      : days === 0 ? 'La fecha estimada es hoy' : `Faltan aproximadamente ${countLabel(days,'día','días')}`;
    await emitNotification(client, {
      tipo: 'PROXIMO_PARTO', categoria: 'REPRODUCCION', prioridad: priority,
      titulo: days < 0 ? `El parto de ${animalLabel(row)} está atrasado` : `Se acerca el parto de ${animalLabel(row)}`,
      mensaje: `${timing} · Fecha estimada: ${shortDate(dueDate)}.`, permiso: 'PARTO_CONSULTAR',
      entidadTipo: 'PROXIMO_PARTO', entidadId: String(row.id_proximo_parto), ruta: `/partos?prenez=${row.id_prenez}&tab=pregnancies`,
      datos: notificationData({ id_animal: row.id_animal, id_prenez: row.id_prenez, fecha_tentativa: dueDate, dias_restantes: days }, row),
      claveDedupe: `CALC:PARTO:${row.id_proximo_parto}:${stage}`,
    });
  }
}

async function notifyBirthdays(client: PoolClient, today: string) {
  const rows = (await client.query(
    `SELECT a.id_animal,a.nombre,a.codigo_arete,a.fecha_nacimiento::text,
            DATE_PART('year',AGE($1::date,a.fecha_nacimiento))::int edad_anios,
            (DATE_PART('year',AGE($1::date,a.fecha_nacimiento))*12+DATE_PART('month',AGE($1::date,a.fecha_nacimiento)))::int edad_meses,
            CASE
              WHEN (a.fecha_nacimiento+INTERVAL '1 month')::date=$1::date THEN '1_MES'
              WHEN (a.fecha_nacimiento+INTERVAL '3 months')::date=$1::date THEN '3_MESES'
              WHEN (a.fecha_nacimiento+INTERVAL '6 months')::date=$1::date THEN '6_MESES'
              ELSE 'ANUAL'
            END hito,
            (SELECT ai.secure_url FROM animal_imagen ai WHERE ai.id_animal=a.id_animal AND ai.deleted_at IS NULL
             ORDER BY ai.es_perfil DESC,ai.created_at DESC LIMIT 1) foto_perfil
     FROM animal a
     WHERE a.estado='ACTIVO' AND a.deleted_at IS NULL AND a.fecha_nacimiento IS NOT NULL
       AND a.fecha_nacimiento<$1::date
       AND (
         (a.fecha_nacimiento+INTERVAL '1 month')::date=$1::date
         OR (a.fecha_nacimiento+INTERVAL '3 months')::date=$1::date
         OR (a.fecha_nacimiento+INTERVAL '6 months')::date=$1::date
         OR (EXTRACT(MONTH FROM a.fecha_nacimiento)=EXTRACT(MONTH FROM $1::date)
             AND EXTRACT(DAY FROM a.fecha_nacimiento)=EXTRACT(DAY FROM $1::date)
             AND DATE_PART('year',AGE($1::date,a.fecha_nacimiento))>=1)
       )`,
    [today],
  )).rows as Row[];
  for (const row of rows) {
    const months = number(row.edad_meses);
    const years = number(row.edad_anios);
    const age = years >= 1 ? countLabel(years,'año','años') : countLabel(months,'mes','meses');
    const dedupe = row.hito === 'ANUAL'
      ? `CALC:CUMPLE:${row.id_animal}:${today.slice(0,4)}`
      : `CALC:CUMPLE:${row.id_animal}:${row.hito}:${today}`;
    await emitNotification(client, {
      tipo: 'CUMPLEANOS_ANIMAL', categoria: 'ANIMALES', prioridad: 'INFO',
      titulo: `${animalLabel(row)} cumple ${age}`, mensaje: `Fecha de nacimiento: ${shortDate(row.fecha_nacimiento)}.`,
      permiso: 'ANIMAL_CONSULTAR', entidadTipo: 'ANIMAL', entidadId: String(row.id_animal),
      ruta: `/animales/${row.id_animal}`, datos: notificationData({ edad_anios: years, edad_meses: months, fecha_nacimiento: localDate(row.fecha_nacimiento) }, row),
      claveDedupe: dedupe,
    });
  }
}

async function notifyProductionVariation(client: PoolClient, yesterday: string) {
  const row = (await client.query(
    `WITH values_by_day AS (
       SELECT
         (SELECT COUNT(*)::int FROM produccion_tanque WHERE fecha_produccion=$1::date AND deleted_at IS NULL) tanque_registros,
         (SELECT COALESCE(SUM(litros),0) FROM produccion_tanque WHERE fecha_produccion=$1::date AND deleted_at IS NULL) tanque_total,
         (SELECT COALESCE(SUM(litros),0) FROM produccion_tanque WHERE fecha_produccion=$1::date-1 AND deleted_at IS NULL) tanque_anterior,
         (SELECT COUNT(*)::int FROM produccion_leche WHERE fecha_produccion=$1::date AND deleted_at IS NULL) vacas_registros,
         (SELECT COALESCE(SUM(litros),0) FROM produccion_leche WHERE fecha_produccion=$1::date AND deleted_at IS NULL) vacas_total,
         (SELECT COALESCE(SUM(litros),0) FROM produccion_leche WHERE fecha_produccion=$1::date-1 AND deleted_at IS NULL) vacas_anterior
     )
     SELECT *,CASE WHEN tanque_registros>0 THEN 'TANQUE' ELSE 'VACAS' END fuente,
       CASE WHEN tanque_registros>0 THEN tanque_total ELSE vacas_total END total_actual,
       CASE WHEN tanque_registros>0 THEN tanque_anterior ELSE vacas_anterior END total_anterior
     FROM values_by_day`,
    [yesterday],
  )).rows[0] as Row;
  const records = textSource(row.fuente) === 'TANQUE' ? number(row.tanque_registros) : number(row.vacas_registros);
  const current = number(row.total_actual);
  const previous = number(row.total_anterior);
  if (!records || previous <= 0) return;
  const difference = current - previous;
  const variation = (difference / previous) * 100;
  if (Math.abs(variation) < env.PRODUCTION_VARIATION_ALERT_PERCENT) return;
  const decrease = variation < 0;
  await emitNotification(client, {
    tipo: 'VARIACION_PRODUCCION', categoria: 'PRODUCCION',
    prioridad: decrease && variation <= -30 ? 'URGENTE' : 'IMPORTANTE',
    titulo: decrease ? 'La producción de leche disminuyó' : 'La producción de leche aumentó',
    mensaje: `Ayer se registraron ${decimal(current)} L, ${decimal(Math.abs(difference))} L ${decrease ? 'menos' : 'más'} que el día anterior.`,
    permiso: 'PRODUCCION_CONSULTAR', entidadTipo: 'PRODUCCION_DIARIA', ruta: `/produccion?fecha=${yesterday}`,
    datos: { fecha: yesterday, total_litros: current, total_anterior_litros: previous, diferencia_litros: difference, variacion_porcentaje: variation, fuente: row.fuente },
    claveDedupe: `CALC:PRODUCCION:${yesterday}`,
  });
}

function textSource(value: unknown) {
  return String(value ?? '');
}

async function notifyOverdueCleanings(client: PoolClient, today: string) {
  const rows = (await client.query(
    `SELECT p.id_potrero,u.nombre,MAX(COALESCE(l.fecha_finalizacion,l.fecha_inicio))::text ultima_limpieza,
       CASE WHEN MAX(COALESCE(l.fecha_finalizacion,l.fecha_inicio)) IS NULL THEN NULL
         ELSE ($1::date-MAX(COALESCE(l.fecha_finalizacion,l.fecha_inicio)))::int END dias
     FROM potrero p
     JOIN ubicacion u ON u.id_ubicacion=p.id_ubicacion
     LEFT JOIN limpieza_potrero l ON l.id_potrero=p.id_potrero AND l.estado='COMPLETADO' AND l.deleted_at IS NULL
     WHERE p.deleted_at IS NULL AND u.deleted_at IS NULL AND u.activo=TRUE
     GROUP BY p.id_potrero,u.nombre
     HAVING MAX(COALESCE(l.fecha_finalizacion,l.fecha_inicio)) IS NULL
       OR $1::date-MAX(COALESCE(l.fecha_finalizacion,l.fecha_inicio)) >= $2`,
    [today, env.CLEANING_ALERT_DAYS],
  )).rows as Row[];
  const month = today.slice(0, 7);
  for (const row of rows) {
    const never = row.dias === null;
    await emitNotification(client, {
      tipo: 'LIMPIEZA_POTRERO_PENDIENTE', categoria: 'MANTENIMIENTO', prioridad: 'IMPORTANTE',
      titulo: never ? 'Potrero sin limpieza registrada' : 'Limpieza de potrero pendiente',
      mensaje: never
        ? `${row.nombre} no tiene una limpieza completada registrada.`
        : `${row.nombre} lleva ${countLabel(number(row.dias),'día','días')} desde la última limpieza completada.`,
      permiso: 'LIMPIEZA_CONSULTAR', entidadTipo: 'POTRERO', entidadId: String(row.id_potrero), ruta: `/limpiezas?potrero=${row.id_potrero}`,
      datos: { ultima_limpieza: row.ultima_limpieza, dias: row.dias, umbral_dias: env.CLEANING_ALERT_DAYS },
      claveDedupe: `CALC:LIMPIEZA:${row.id_potrero}:${month}`,
    });
  }
}

async function notifyTreatmentDates(client: PoolClient, today: string) {
  const rows = (await client.query(
    `SELECT t.id_tratamiento,t.id_animal,t.id_tipo_tratamiento,t.proxima_aplicacion::text,
            a.nombre,a.codigo_arete,tt.nombre tratamiento,
            (SELECT ai.secure_url FROM animal_imagen ai WHERE ai.id_animal=a.id_animal AND ai.deleted_at IS NULL
             ORDER BY ai.es_perfil DESC,ai.created_at DESC LIMIT 1) foto_perfil
     FROM tratamiento_animal t
     JOIN animal a ON a.id_animal=t.id_animal AND a.estado='ACTIVO' AND a.deleted_at IS NULL
     LEFT JOIN tipo_tratamiento tt ON tt.id_tipo_tratamiento=t.id_tipo_tratamiento
     WHERE t.deleted_at IS NULL AND t.proxima_aplicacion IS NOT NULL
       AND t.proxima_aplicacion BETWEEN $1::date-INTERVAL '30 days' AND $1::date+INTERVAL '7 days'
       AND NOT EXISTS(SELECT 1 FROM tratamiento_animal newer
         WHERE newer.id_animal=t.id_animal AND newer.id_tipo_tratamiento=t.id_tipo_tratamiento
           AND newer.fecha_aplicacion>=t.proxima_aplicacion AND newer.deleted_at IS NULL
           AND newer.id_tratamiento<>t.id_tratamiento)`,
    [today],
  )).rows as Row[];
  for (const row of rows) {
    const next = localDate(row.proxima_aplicacion);
    const days = dateDiff(next, today);
    const stage = days < 0 ? 'ATRASADO' : days === 0 ? 'HOY' : 'PROXIMO';
    await emitNotification(client, {
      tipo: 'TRATAMIENTO_PENDIENTE', categoria: 'SANIDAD', prioridad: days <= 0 ? 'URGENTE' : 'IMPORTANTE',
      titulo: days < 0 ? `${animalLabel(row)} tiene un tratamiento atrasado` : days === 0 ? `${animalLabel(row)} tiene tratamiento hoy` : `Se acerca el tratamiento de ${animalLabel(row)}`,
      mensaje: `${String(row.tratamiento ?? 'Tratamiento')} · ${shortDate(next)}${days > 0 ? ` · Faltan ${countLabel(days,'día','días')}` : days < 0 ? ` · ${countLabel(Math.abs(days),'día','días')} de atraso` : ''}.`,
      permiso: 'SANIDAD_CONSULTAR', entidadTipo: 'TRATAMIENTO', entidadId: String(row.id_tratamiento), ruta: `/sanidad?tratamiento=${row.id_tratamiento}`,
      datos: notificationData({ id_animal: row.id_animal, proxima_aplicacion: next, dias_restantes: days }, row),
      claveDedupe: `CALC:TRATAMIENTO:${row.id_tratamiento}:${stage}`,
    });
  }
}

export async function generateCalculatedNotifications() {
  if (running) return 0;
  running = true;
  try {
    const result=await transaction(async client => {
      const lock = await client.query(`SELECT pg_try_advisory_xact_lock(78128433) acquired`);
      if (!lock.rows[0]?.acquired) return 0;
      const dates = await currentEcuadorDate(client);
      await notifyUpcomingBirths(client, dates.hoy);
      await notifyBirthdays(client, dates.hoy);
      await notifyProductionVariation(client, dates.ayer);
      await notifyOverdueCleanings(client, dates.hoy);
      await notifyTreatmentDates(client, dates.hoy);
      return 1;
    });
    if(result)scheduleNotificationPushDispatch();
    return result;
  } finally {
    running = false;
  }
}

export function startCalculatedNotificationWorker() {
  if (timer) return () => undefined;
  void generateCalculatedNotifications().catch(error => console.error('Error al calcular alertas:', error));
  timer = setInterval(() => {
    void generateCalculatedNotifications().catch(error => console.error('Error al calcular alertas:', error));
  }, env.CALCULATED_ALERT_INTERVAL_MS);
  timer.unref();
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}
