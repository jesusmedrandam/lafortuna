import { env } from '../../config/env.js';
import type { Queryable } from '../shared/sql.js';
import { emitNotification, type NotificationEvent } from './notifications.service.js';

type Row = Record<string, unknown>;
type Priority = NonNullable<NotificationEvent['prioridad']>;

type TickRisk = {
  id_potrero: string;
  nombre: string;
  animales_presentes: number;
  dias_descanso: number | null;
  descanso_desde: string | null;
};

type MovementNotice = {
  id: string;
  tipo: string;
  fecha: string;
  cantidad: number;
  destinoId: string;
  actor: string;
  tickRisk: TickRisk | null;
};

function text(value: unknown, fallback = '') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown, currency = 'USD') {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency }).format(number(value));
}

function animalLabel(row: Row | undefined) {
  if (!row) return 'Animal';
  const name = text(row.nombre, 'Animal');
  const tag = text(row.codigo_arete);
  return tag ? `${name} (arete ${tag})` : name;
}

async function emitBusinessNotification(
  database: Queryable,
  actor: string,
  entityId: string,
  event: Omit<NotificationEvent, 'entidadId' | 'creadoPor' | 'claveDedupe'> & { dedupe: string },
) {
  const { dedupe, ...notification } = event;
  return emitNotification(database, {
    ...notification,
    titulo: notification.titulo.slice(0, 160),
    mensaje: notification.mensaje.slice(0, 700),
    entidadId: entityId,
    creadoPor: actor,
    claveDedupe: `EVENTO:${dedupe}:${entityId}`,
  });
}

export async function notifyRecordCreated(
  database: Queryable,
  moduleName: string,
  row: Row,
  actor: string,
) {
  if (moduleName === 'producciones') return null;
  const animalId = text(row.id_animal ?? row.id_vaca);
  const animal = animalId
    ? (await database.query('SELECT nombre,codigo_arete FROM animal WHERE id_animal=$1', [animalId])).rows[0] as Row | undefined
    : undefined;
  const label = animalLabel(animal);

  if (moduleName === 'abortos') {
    return emitBusinessNotification(database, actor, text(row.id_aborto), {
      dedupe: 'ABORTO', tipo: 'ABORTO_REGISTRADO', categoria: 'REPRODUCCION', prioridad: 'URGENTE',
      titulo: 'Aborto registrado',
      mensaje: `${label} · ${text(row.fecha, 'fecha no indicada')}${text(row.causa) ? ` · ${text(row.causa)}` : ''}.`,
      permiso: 'ABORTO_CONSULTAR', entidadTipo: 'ABORTO', ruta: '/partos',
      datos: { id_animal: animalId },
    });
  }
  if (moduleName === 'muertes') {
    return emitBusinessNotification(database, actor, text(row.id_muerte), {
      dedupe: 'MUERTE', tipo: 'MUERTE_REGISTRADA', categoria: 'ANIMALES', prioridad: 'URGENTE',
      titulo: 'Muerte registrada',
      mensaje: `${label} · ${text(row.fecha, 'fecha no indicada')}${text(row.causa) ? ` · ${text(row.causa)}` : ''}.`,
      permiso: 'MUERTE_CONSULTAR', entidadTipo: 'MUERTE', ruta: '/muertes',
      datos: { id_animal: animalId },
    });
  }
  if (moduleName === 'pesajes') {
    return emitBusinessNotification(database, actor, text(row.id_pesaje), {
      dedupe: 'PESAJE', tipo: 'PESAJE_REGISTRADO', categoria: 'PESAJES', prioridad: 'INFO',
      titulo: 'Nuevo pesaje',
      mensaje: `${label} · ${number(row.peso_kg).toLocaleString('es-EC')} kg · ${text(row.fecha_pesaje)}.`,
      permiso: 'PESAJE_CONSULTAR', entidadTipo: 'PESAJE', ruta: '/pesajes',
      datos: { id_animal: animalId, peso_kg: number(row.peso_kg) },
    });
  }
  if (moduleName === 'tratamientos') {
    return emitBusinessNotification(database, actor, text(row.id_tratamiento), {
      dedupe: 'TRATAMIENTO', tipo: 'TRATAMIENTO_APLICADO', categoria: 'SANIDAD', prioridad: 'IMPORTANTE',
      titulo: 'Tratamiento aplicado',
      mensaje: `${label} · aplicación ${text(row.fecha_aplicacion)}${row.proxima_aplicacion ? ` · próxima ${text(row.proxima_aplicacion)}` : ''}.`,
      permiso: 'SANIDAD_CONSULTAR', entidadTipo: 'TRATAMIENTO', ruta: '/sanidad',
      datos: { id_animal: animalId, proxima_aplicacion: row.proxima_aplicacion ?? null },
    });
  }
  if (moduleName === 'lactancias') {
    return emitBusinessNotification(database, actor, text(row.id_lactancia), {
      dedupe: 'LACTANCIA', tipo: 'LACTANCIA_REGISTRADA', categoria: 'PRODUCCION', prioridad: 'INFO',
      titulo: row.activa === false ? 'Lactancia registrada' : 'Lactancia iniciada',
      mensaje: `${label} · inicio ${text(row.fecha_inicio)}${row.en_ordeno ? ' · incluida en ordeño' : ''}.`,
      permiso: 'LACTANCIA_CONSULTAR', entidadTipo: 'LACTANCIA', ruta: '/produccion',
      datos: { id_animal: animalId, activa: row.activa, en_ordeno: row.en_ordeno },
    });
  }
  return null;
}

export async function notifyTankProduction(database: Queryable, row: Row, actor: string) {
  return emitBusinessNotification(database, actor, text(row.id_produccion_tanque), {
    dedupe: 'PRODUCCION_TANQUE', tipo: 'PRODUCCION_TANQUE_REGISTRADA', categoria: 'PRODUCCION', prioridad: 'INFO',
    titulo: 'Producción de tanque registrada',
    mensaje: `${number(row.litros).toLocaleString('es-EC')} litros · ${text(row.fecha_produccion)}${row.turno ? ` · ${text(row.turno)}` : ''}.`,
    permiso: 'PRODUCCION_CONSULTAR', entidadTipo: 'PRODUCCION_TANQUE', ruta: '/produccion',
    datos: { litros: number(row.litros), fecha: row.fecha_produccion, turno: row.turno ?? null },
  });
}

export async function notifyBirth(database: Queryable, row: Row, actor: string) {
  const mother = (await database.query('SELECT nombre,codigo_arete FROM animal WHERE id_animal=$1', [row.id_madre])).rows[0] as Row | undefined;
  const children = Array.isArray(row.crias) ? row.crias as Row[] : [];
  const live = children.filter(child => text(child.estado_nacimiento) !== 'MUERTA').length;
  const dead = children.length - live;
  return emitBusinessNotification(database, actor, text(row.id_parto), {
    dedupe: 'PARTO', tipo: 'PARTO_REGISTRADO', categoria: 'REPRODUCCION', prioridad: dead ? 'IMPORTANTE' : 'INFO',
    titulo: 'Parto registrado',
    mensaje: `${animalLabel(mother)} · ${children.length} cría(s), ${live} viva(s)${dead ? ` y ${dead} muerta(s)` : ''}.`,
    permiso: 'PARTO_CONSULTAR', entidadTipo: 'PARTO', ruta: '/partos',
    datos: { id_madre: row.id_madre, crias: children.length, vivas: live, muertas: dead },
  });
}

export async function notifyAnimalSale(database: Queryable, row: Row, count: number, actor: string) {
  return emitBusinessNotification(database, actor, text(row.id_venta), {
    dedupe: 'VENTA_ANIMALES', tipo: 'VENTA_ANIMALES_REGISTRADA', categoria: 'VENTAS', prioridad: 'IMPORTANTE',
    titulo: 'Venta de animales registrada',
    mensaje: `${count} animal(es) · ${text(row.comprador_nombre, 'comprador no indicado')} · ${money(row.precio_total, text(row.moneda, 'USD'))}.`,
    permiso: 'VENTA_CONSULTAR', entidadTipo: 'VENTA_ANIMAL', ruta: '/ventas',
    datos: { cantidad: count, total: number(row.precio_total), moneda: text(row.moneda, 'USD') },
  });
}

export async function notifyProductSale(database: Queryable, row: Row, count: number, actor: string) {
  return emitBusinessNotification(database, actor, text(row.id_venta_producto), {
    dedupe: 'VENTA_PRODUCTOS', tipo: 'VENTA_PRODUCTOS_REGISTRADA', categoria: 'VENTAS', prioridad: 'INFO',
    titulo: 'Venta de productos registrada',
    mensaje: `${count} producto(s) · ${text(row.comprador_nombre, 'comprador no indicado')} · ${money(row.precio_total, text(row.moneda, 'USD'))}.`,
    permiso: 'VENTA_CONSULTAR', entidadTipo: 'VENTA_PRODUCTO', ruta: '/ventas',
    datos: { cantidad: count, total: number(row.precio_total), moneda: text(row.moneda, 'USD') },
  });
}

export async function notifyPurchase(database: Queryable, row: Row, actor: string) {
  return emitBusinessNotification(database, actor, text(row.id_compra), {
    dedupe: 'COMPRA', tipo: 'COMPRA_REGISTRADA', categoria: 'COMPRAS', prioridad: 'INFO',
    titulo: 'Compra registrada',
    mensaje: `${text(row.producto ?? row.animal, 'Compra')} · ${text(row.proveedor)} · ${money(row.valor_total, text(row.moneda, 'USD'))}.`,
    permiso: 'COMPRA_CONSULTAR', entidadTipo: 'COMPRA', ruta: '/compras',
    datos: { total: number(row.valor_total), moneda: text(row.moneda, 'USD'), id_animal: row.id_animal ?? null },
  });
}

export async function notifyCleaning(database: Queryable, row: Row, actor: string) {
  const pasture = (await database.query(
    `SELECT u.nombre FROM potrero p JOIN ubicacion u ON u.id_ubicacion=p.id_ubicacion WHERE p.id_potrero=$1`,
    [row.id_potrero],
  )).rows[0] as Row | undefined;
  const state = text(row.estado, 'COMPLETADO');
  return emitBusinessNotification(database, actor, text(row.id_limpieza), {
    dedupe: 'LIMPIEZA', tipo: 'LIMPIEZA_POTRERO_REGISTRADA', categoria: 'MANTENIMIENTO',
    prioridad: state === 'COMPLETADO' ? 'INFO' : 'IMPORTANTE', titulo: 'Limpieza de potrero registrada',
    mensaje: `${text(pasture?.nombre, 'Potrero')} · ${text(row.fecha_inicio)} · estado ${state.toLowerCase().replaceAll('_', ' ')}.`,
    permiso: 'LIMPIEZA_CONSULTAR', entidadTipo: 'LIMPIEZA_POTRERO', ruta: '/limpiezas',
    datos: { id_potrero: row.id_potrero, estado: state },
  });
}

export async function notifyActivity(database: Queryable, row: Row, count: number, actor: string) {
  const type = (await database.query('SELECT nombre FROM tipo_actividad WHERE id_tipo_actividad=$1', [row.id_tipo_actividad])).rows[0] as Row | undefined;
  return emitBusinessNotification(database, actor, text(row.id_actividad), {
    dedupe: 'ACTIVIDAD', tipo: 'ACTIVIDAD_REGISTRADA', categoria: 'ACTIVIDADES', prioridad: 'INFO',
    titulo: 'Actividad registrada',
    mensaje: `${text(type?.nombre, 'Actividad')} · ${count} animal(es) · ${text(row.fecha)}.`,
    permiso: 'ACTIVIDAD_CONSULTAR', entidadTipo: 'ACTIVIDAD', ruta: '/actividades',
    datos: { cantidad_animales: count, id_tipo_actividad: row.id_tipo_actividad },
  });
}

export async function notifySanitaryCampaign(database: Queryable, id: string, count: number, actor: string) {
  const campaign = (await database.query(
    `SELECT j.fecha_aplicacion,tt.nombre tipo,m.nombre_comercial medicamento
     FROM jornada_sanitaria j
     JOIN tipo_tratamiento tt ON tt.id_tipo_tratamiento=j.id_tipo_tratamiento
     JOIN medicamento m ON m.id_medicamento=j.id_medicamento
     WHERE j.id_jornada=$1`, [id],
  )).rows[0] as Row | undefined;
  return emitBusinessNotification(database, actor, id, {
    dedupe: 'JORNADA_SANITARIA', tipo: 'JORNADA_SANITARIA_APLICADA', categoria: 'SANIDAD', prioridad: 'IMPORTANTE',
    titulo: 'Jornada sanitaria aplicada',
    mensaje: `${text(campaign?.tipo, 'Tratamiento')} · ${text(campaign?.medicamento)} · ${count} animal(es).`,
    permiso: 'SANIDAD_CONSULTAR', entidadTipo: 'JORNADA_SANITARIA', ruta: '/sanidad',
    datos: { cantidad_animales: count, fecha: campaign?.fecha_aplicacion ?? null },
  });
}

export async function notifyHealthCondition(
  database: Queryable,
  row: Row,
  actor: string,
  resolved = false,
) {
  const context = (await database.query(
    `SELECT a.nombre,a.codigo_arete,t.nombre tipo
     FROM animal a
     LEFT JOIN tipo_condicion_salud t ON t.id_tipo_condicion_salud=$2
     WHERE a.id_animal=$1`,
    [row.id_animal,row.id_tipo_condicion_salud ?? null],
  )).rows[0] as Row | undefined;
  return emitBusinessNotification(database, actor, text(row.id_condicion_salud), {
    dedupe: resolved ? 'CONDICION_RESUELTA' : 'CONDICION_DETECTADA',
    tipo: resolved ? 'CONDICION_SALUD_RESUELTA' : 'CONDICION_SALUD_DETECTADA',
    categoria: 'SANIDAD', prioridad: resolved ? 'INFO' : 'URGENTE',
    titulo: resolved ? 'Condición de salud resuelta' : 'Condición de salud detectada',
    mensaje: `${animalLabel(context)} · ${text(context?.tipo, text(row.descripcion, 'condición sin clasificar'))}${resolved ? ' · marcada como resuelta' : ''}.`,
    permiso: 'SANIDAD_CONSULTAR', entidadTipo: 'CONDICION_SALUD', ruta: '/sanidad',
    datos: { id_animal: row.id_animal, estado: resolved ? 'RESUELTA' : row.estado },
  });
}

export async function notifyReproductionEvent(
  database: Queryable,
  kind: 'CELO' | 'PRENEZ',
  row: Row,
  actor: string,
) {
  const animalId = text(row.id_vaca);
  const animal = (await database.query('SELECT nombre,codigo_arete FROM animal WHERE id_animal=$1', [animalId])).rows[0] as Row | undefined;
  if (kind === 'CELO') {
    return emitBusinessNotification(database, actor, text(row.id_celo), {
      dedupe: 'CELO', tipo: 'CELO_REGISTRADO', categoria: 'REPRODUCCION', prioridad: 'INFO',
      titulo: 'Celo registrado', mensaje: `${animalLabel(animal)} · inicio ${text(row.fecha_inicio)}.`,
      permiso: 'PARTO_CONSULTAR', entidadTipo: 'CELO', ruta: '/partos', datos: { id_animal: animalId },
    });
  }
  return emitBusinessNotification(database, actor, text(row.id_prenez), {
    dedupe: 'PRENEZ', tipo: 'PRENEZ_CONFIRMADA', categoria: 'REPRODUCCION', prioridad: 'IMPORTANTE',
    titulo: 'Preñez confirmada',
    mensaje: `${animalLabel(animal)}${row.fecha_parto_tentativa ? ` · parto estimado ${text(row.fecha_parto_tentativa)}` : ' · sin fecha estimada de parto'}.`,
    permiso: 'PARTO_CONSULTAR', entidadTipo: 'PRENEZ', ruta: '/partos',
    datos: { id_animal: animalId, fecha_parto_tentativa: row.fecha_parto_tentativa ?? null },
  });
}

export async function assessPastureTickRisk(
  database: Queryable,
  destinationLocationId: string,
  movementDate: string,
): Promise<TickRisk | null> {
  const row = (await database.query(
    `SELECT p.id_potrero,u.nombre,
       (SELECT COUNT(*)::int FROM animal a
        WHERE a.id_ubicacion_actual=u.id_ubicacion AND a.estado='ACTIVO' AND a.deleted_at IS NULL) animales_presentes,
       COALESCE((SELECT MAX(h.fecha_hasta)::date FROM animal_ubicacion_historial h
         WHERE h.id_ubicacion=u.id_ubicacion AND h.fecha_hasta IS NOT NULL AND h.deleted_at IS NULL),
         p.fecha_ultimo_descanso::date)::text descanso_desde,
       CASE WHEN EXISTS(SELECT 1 FROM animal a
          WHERE a.id_ubicacion_actual=u.id_ubicacion AND a.estado='ACTIVO' AND a.deleted_at IS NULL)
         THEN 0
         WHEN COALESCE((SELECT MAX(h.fecha_hasta)::date FROM animal_ubicacion_historial h
           WHERE h.id_ubicacion=u.id_ubicacion AND h.fecha_hasta IS NOT NULL AND h.deleted_at IS NULL),
           p.fecha_ultimo_descanso::date) IS NULL THEN NULL
         ELSE GREATEST(0,$2::date-COALESCE((SELECT MAX(h.fecha_hasta)::date FROM animal_ubicacion_historial h
           WHERE h.id_ubicacion=u.id_ubicacion AND h.fecha_hasta IS NOT NULL AND h.deleted_at IS NULL),
           p.fecha_ultimo_descanso::date))::int END dias_descanso
     FROM potrero p JOIN ubicacion u ON u.id_ubicacion=p.id_ubicacion
     WHERE u.id_ubicacion=$1 AND u.tipo='POTRERO' AND u.activo=TRUE
       AND u.deleted_at IS NULL AND p.deleted_at IS NULL`,
    [destinationLocationId, movementDate],
  )).rows[0] as TickRisk | undefined;
  return row ?? null;
}

function tickMessage(risk: TickRisk): { title: string; message: string; priority: Priority; level: string } {
  const minimumRest = env.TICK_MINIMUM_REST_DAYS;
  const reducedRisk = Math.max(env.TICK_REDUCED_RISK_DAYS, minimumRest + 1);
  if (risk.animales_presentes > 0) return {
    title: `Riesgo alto de garrapata: ${risk.nombre}`, priority: 'URGENTE', level: 'ALTO',
    message: `${risk.nombre} ya estaba ocupado y no tuvo descanso verificable. Los animales que ingresan podrían infestarse; inspeccione y aplique el manejo sanitario definido por su veterinario.`,
  };
  if (risk.dias_descanso === null) return {
    title: `Riesgo alto de garrapata: ${risk.nombre}`, priority: 'URGENTE', level: 'ALTO',
    message: `No existe información suficiente para comprobar el descanso de ${risk.nombre}. Considere que los animales podrían infestarse y realice inspección de garrapatas.`,
  };
  if (risk.dias_descanso < minimumRest) return {
    title: `Riesgo alto de garrapata: ${risk.nombre}`, priority: 'URGENTE', level: 'ALTO',
    message: `${risk.nombre} descansó ${risk.dias_descanso} día(s): aún no cumple la referencia mínima preventiva de ${minimumRest} días. Los animales podrían infestarse.`,
  };
  if (risk.dias_descanso < reducedRisk) return {
    title: `Riesgo moderado de garrapata: ${risk.nombre}`, priority: 'IMPORTANTE', level: 'MODERADO',
    message: `${risk.nombre} descansó ${risk.dias_descanso} día(s). Superó la referencia mínima de ${minimumRest} días, pero todavía no los ${reducedRisk} días usados como margen ambiental conservador.`,
  };
  return {
    title: `Riesgo reducido de garrapata: ${risk.nombre}`, priority: 'INFO', level: 'REDUCIDO',
    message: `${risk.nombre} descansó ${risk.dias_descanso} día(s) y superó el margen conservador de ${reducedRisk} días. El riesgo baja, pero el potrero no se considera libre de garrapatas.`,
  };
}

export async function notifyMovementApplied(database: Queryable, input: MovementNotice) {
  const context = (await database.query(
    `SELECT m.tipo_movimiento,u1.nombre origen,COALESCE(u2.nombre,ud.nombre) destino,g2.nombre grupo_destino
     FROM movimiento_animal m
     LEFT JOIN ubicacion u1 ON u1.id_ubicacion=m.id_ubicacion_origen
     LEFT JOIN ubicacion u2 ON u2.id_ubicacion=m.id_ubicacion_destino
     LEFT JOIN ubicacion ud ON ud.id_ubicacion=$2
     LEFT JOIN grupo g2 ON g2.id_grupo=m.id_grupo_destino
     WHERE m.id_movimiento=$1`, [input.id,input.destinoId],
  )).rows[0] as Row | undefined;
  await emitBusinessNotification(database, input.actor, input.id, {
    dedupe: 'MOVIMIENTO', tipo: 'MOVIMIENTO_APLICADO', categoria: 'MOVIMIENTOS', prioridad: 'INFO',
    titulo: 'Movimiento aplicado',
    mensaje: `${input.cantidad} animal(es) · ${text(context?.origen, 'origen no indicado')} → ${text(context?.destino ?? context?.grupo_destino, 'destino no indicado')}.`,
    permiso: 'MOVIMIENTO_CONSULTAR', entidadTipo: 'MOVIMIENTO', ruta: '/movimientos',
    datos: { tipo: input.tipo, fecha: input.fecha, cantidad: input.cantidad },
  });
  if (!input.tickRisk) return;
  const risk = tickMessage(input.tickRisk);
  await emitBusinessNotification(database, input.actor, input.id, {
    dedupe: 'RIESGO_GARRAPATA', tipo: 'RIESGO_GARRAPATA_POTRERO', categoria: 'SANIDAD',
    prioridad: risk.priority, titulo: risk.title, mensaje: risk.message,
    permiso: 'MOVIMIENTO_CONSULTAR', entidadTipo: 'MOVIMIENTO', ruta: '/potreros',
    datos: {
      id_potrero: input.tickRisk.id_potrero,
      id_ubicacion: input.destinoId,
      dias_descanso: input.tickRisk.dias_descanso,
      nivel_riesgo: risk.level,
      referencia_descanso_minimo_dias: env.TICK_MINIMUM_REST_DAYS,
      referencia_riesgo_reducido_dias: Math.max(env.TICK_REDUCED_RISK_DAYS, env.TICK_MINIMUM_REST_DAYS + 1),
      criterio: 'Regla preventiva para clima tropical cálido-húmedo; no sustituye inspección ni criterio veterinario.',
    },
  });
}
