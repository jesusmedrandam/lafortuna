import { env } from '../../config/env.js';
import { emitNotification } from './notifications.service.js';
import { scheduleNotificationPushDispatch } from './notifications.push.js';
function text(value, fallback = '') {
    const result = String(value ?? '').trim();
    return result || fallback;
}
function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
function money(value, currency = 'USD') {
    return new Intl.NumberFormat('es-EC', { style: 'currency', currency }).format(number(value));
}
function animalLabel(row) {
    if (!row)
        return 'Animal';
    return text(row.nombre, 'Animal');
}
function countLabel(value, singular, plural) {
    return `${value.toLocaleString('es-EC')} ${value === 1 ? singular : plural}`;
}
function joinNames(values) {
    const names = values.map(value => text(value)).filter(Boolean);
    if (names.length < 2)
        return names[0] ?? '';
    if (names.length === 2)
        return `${names[0]} y ${names[1]}`;
    return `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`;
}
function animalSubject(count, values) {
    const names = Array.isArray(values) ? values.map(value => text(value)).filter(Boolean) : [];
    return count <= 3 && names.length === count
        ? joinNames(names)
        : countLabel(count, 'animal', 'animales');
}
function detailRoute(base, key, id, extra = '') {
    return `${base}?${key}=${encodeURIComponent(text(id))}${extra}`;
}
async function emitBusinessNotification(database, actor, entityId, event) {
    const { dedupe, ...notification } = event;
    const notificationId = await emitNotification(database, {
        ...notification,
        titulo: notification.titulo.slice(0, 160),
        mensaje: notification.mensaje.slice(0, 700),
        entidadId: entityId,
        creadoPor: actor,
        claveDedupe: `EVENTO:${dedupe}:${entityId}`,
    });
    if (notificationId)
        scheduleNotificationPushDispatch();
    return notificationId;
}
export async function notifyRecordCreated(database, moduleName, row, actor) {
    const animalId = text(row.id_animal ?? row.id_vaca);
    const animal = animalId
        ? (await database.query('SELECT nombre,codigo_arete FROM animal WHERE id_animal=$1', [animalId])).rows[0]
        : undefined;
    const label = animalLabel(animal);
    if (moduleName === 'producciones') {
        return emitBusinessNotification(database, actor, text(row.id_produccion), {
            dedupe: 'PRODUCCION_VACA', tipo: 'PRODUCCION_VACA_REGISTRADA', categoria: 'PRODUCCION', prioridad: 'INFO',
            titulo: 'Producción de leche registrada',
            mensaje: `${label} · ${number(row.litros).toLocaleString('es-EC')} litros · ${text(row.fecha_produccion)}${row.turno ? ` · ${text(row.turno).toLowerCase()}` : ''}.`,
            permiso: 'PRODUCCION_CONSULTAR', entidadTipo: 'PRODUCCION_LECHE', ruta: detailRoute('/produccion', 'registro', row.id_produccion),
            datos: { id_animal: animalId, litros: number(row.litros), fecha: row.fecha_produccion, turno: row.turno ?? null },
        });
    }
    if (moduleName === 'abortos') {
        return emitBusinessNotification(database, actor, text(row.id_aborto), {
            dedupe: 'ABORTO', tipo: 'ABORTO_REGISTRADO', categoria: 'REPRODUCCION', prioridad: 'URGENTE',
            titulo: 'Aborto registrado',
            mensaje: `${label} · ${text(row.fecha, 'fecha no indicada')}${text(row.causa) ? ` · ${text(row.causa)}` : ''}.`,
            permiso: 'ABORTO_CONSULTAR', entidadTipo: 'ABORTO', ruta: detailRoute('/partos', 'aborto', row.id_aborto, '&tab=abortions'),
            datos: { id_animal: animalId },
        });
    }
    if (moduleName === 'muertes') {
        return emitBusinessNotification(database, actor, text(row.id_muerte), {
            dedupe: 'MUERTE', tipo: 'MUERTE_REGISTRADA', categoria: 'ANIMALES', prioridad: 'URGENTE',
            titulo: 'Muerte registrada',
            mensaje: `${label} · ${text(row.fecha, 'fecha no indicada')}${text(row.causa) ? ` · ${text(row.causa)}` : ''}.`,
            permiso: 'MUERTE_CONSULTAR', entidadTipo: 'MUERTE', ruta: detailRoute('/muertes', 'registro', row.id_muerte),
            datos: { id_animal: animalId },
        });
    }
    if (moduleName === 'pesajes') {
        return emitBusinessNotification(database, actor, text(row.id_pesaje), {
            dedupe: 'PESAJE', tipo: 'PESAJE_REGISTRADO', categoria: 'PESAJES', prioridad: 'INFO',
            titulo: 'Nuevo pesaje',
            mensaje: `${label} · ${number(row.peso_kg).toLocaleString('es-EC')} kg · ${text(row.fecha_pesaje)}.`,
            permiso: 'PESAJE_CONSULTAR', entidadTipo: 'PESAJE', ruta: detailRoute('/pesajes', 'registro', row.id_pesaje),
            datos: { id_animal: animalId, peso_kg: number(row.peso_kg) },
        });
    }
    if (moduleName === 'tratamientos') {
        return emitBusinessNotification(database, actor, text(row.id_tratamiento), {
            dedupe: 'TRATAMIENTO', tipo: 'TRATAMIENTO_APLICADO', categoria: 'SANIDAD', prioridad: 'IMPORTANTE',
            titulo: 'Tratamiento aplicado',
            mensaje: `${label} · aplicación ${text(row.fecha_aplicacion)}${row.proxima_aplicacion ? ` · próxima ${text(row.proxima_aplicacion)}` : ''}.`,
            permiso: 'SANIDAD_CONSULTAR', entidadTipo: 'TRATAMIENTO', ruta: detailRoute('/sanidad', 'tratamiento', row.id_tratamiento),
            datos: { id_animal: animalId, proxima_aplicacion: row.proxima_aplicacion ?? null },
        });
    }
    if (moduleName === 'lactancias') {
        return emitBusinessNotification(database, actor, text(row.id_lactancia), {
            dedupe: 'LACTANCIA', tipo: 'LACTANCIA_REGISTRADA', categoria: 'PRODUCCION', prioridad: 'INFO',
            titulo: row.activa === false ? 'Lactancia registrada' : 'Lactancia iniciada',
            mensaje: `${label} · inicio ${text(row.fecha_inicio)}${row.en_ordeno ? ' · incluida en ordeño' : ''}.`,
            permiso: 'LACTANCIA_CONSULTAR', entidadTipo: 'LACTANCIA', ruta: detailRoute('/produccion', 'lactancia', row.id_lactancia, '&tab=lactations'),
            datos: { id_animal: animalId, activa: row.activa, en_ordeno: row.en_ordeno },
        });
    }
    return null;
}
export async function notifyTankProduction(database, row, actor) {
    return emitBusinessNotification(database, actor, text(row.id_produccion_tanque), {
        dedupe: 'PRODUCCION_TANQUE', tipo: 'PRODUCCION_TANQUE_REGISTRADA', categoria: 'PRODUCCION', prioridad: 'INFO',
        titulo: 'Producción de tanque registrada',
        mensaje: `${number(row.litros).toLocaleString('es-EC')} litros · ${text(row.fecha_produccion)}${row.turno ? ` · ${text(row.turno)}` : ''}.`,
        permiso: 'PRODUCCION_CONSULTAR', entidadTipo: 'PRODUCCION_TANQUE', ruta: detailRoute('/produccion', 'tanque', row.id_produccion_tanque),
        datos: { litros: number(row.litros), fecha: row.fecha_produccion, turno: row.turno ?? null },
    });
}
export async function notifyBirth(database, row, actor) {
    const mother = (await database.query('SELECT nombre,codigo_arete FROM animal WHERE id_animal=$1', [row.id_madre])).rows[0];
    const children = Array.isArray(row.crias) ? row.crias : [];
    const live = children.filter(child => text(child.estado_nacimiento) !== 'MUERTA').length;
    const dead = children.length - live;
    const result = [
        live ? countLabel(live, 'cría viva', 'crías vivas') : '',
        dead ? countLabel(dead, 'cría muerta', 'crías muertas') : '',
    ].filter(Boolean).join(' y ');
    return emitBusinessNotification(database, actor, text(row.id_parto), {
        dedupe: 'PARTO', tipo: 'PARTO_REGISTRADO', categoria: 'REPRODUCCION', prioridad: dead ? 'IMPORTANTE' : 'INFO',
        titulo: 'Parto registrado',
        mensaje: `${animalLabel(mother)} · ${result || 'sin crías registradas'}.`,
        permiso: 'PARTO_CONSULTAR', entidadTipo: 'PARTO', ruta: detailRoute('/partos', 'parto', row.id_parto, '&tab=births'),
        datos: { id_madre: row.id_madre, crias: children.length, vivas: live, muertas: dead },
    });
}
export async function notifyAnimalSale(database, row, count, actor) {
    return emitBusinessNotification(database, actor, text(row.id_venta), {
        dedupe: 'VENTA_ANIMALES', tipo: 'VENTA_ANIMALES_REGISTRADA', categoria: 'VENTAS', prioridad: 'IMPORTANTE',
        titulo: 'Venta de animales registrada',
        mensaje: `${countLabel(count, 'animal', 'animales')} · ${text(row.comprador_nombre, 'comprador no indicado')} · ${money(row.precio_total, text(row.moneda, 'USD'))}.`,
        permiso: 'VENTA_CONSULTAR', entidadTipo: 'VENTA_ANIMAL', ruta: detailRoute('/ventas', 'venta', row.id_venta, '&tipo=animales'),
        datos: { cantidad: count, total: number(row.precio_total), moneda: text(row.moneda, 'USD') },
    });
}
export async function notifyProductSale(database, row, count, actor) {
    const products = (await database.query(`SELECT d.cantidad,p.nombre,COALESCE(um.simbolo,um.nombre,p.unidad,'unidad') unidad
     FROM venta_producto_detalle d
     JOIN producto_venta p ON p.id_producto_venta=d.id_producto_venta
     LEFT JOIN unidad_medida um ON um.id_unidad=p.id_unidad_venta
     WHERE d.id_venta_producto=$1 AND d.deleted_at IS NULL
     ORDER BY p.nombre`, [row.id_venta_producto])).rows;
    const productSummary = products.length <= 3
        ? products.map(product => `${number(product.cantidad).toLocaleString('es-EC')} ${text(product.unidad)} ${text(product.nombre)}`).join(' · ')
        : countLabel(count, 'producto', 'productos');
    return emitBusinessNotification(database, actor, text(row.id_venta_producto), {
        dedupe: 'VENTA_PRODUCTOS', tipo: 'VENTA_PRODUCTOS_REGISTRADA', categoria: 'VENTAS', prioridad: 'INFO',
        titulo: 'Venta de productos registrada',
        mensaje: `${productSummary} · ${text(row.comprador_nombre, 'comprador no indicado')} · ${money(row.precio_total, text(row.moneda, 'USD'))}.`,
        permiso: 'VENTA_CONSULTAR', entidadTipo: 'VENTA_PRODUCTO', ruta: detailRoute('/ventas', 'venta_producto', row.id_venta_producto, '&tipo=productos'),
        datos: { cantidad: count, total: number(row.precio_total), moneda: text(row.moneda, 'USD') },
    });
}
export async function notifyPurchase(database, row, actor) {
    return emitBusinessNotification(database, actor, text(row.id_compra), {
        dedupe: 'COMPRA', tipo: 'COMPRA_REGISTRADA', categoria: 'COMPRAS', prioridad: 'INFO',
        titulo: 'Compra registrada',
        mensaje: `${text(row.producto ?? row.animal, 'Compra')} · ${text(row.proveedor)} · ${money(row.valor_total, text(row.moneda, 'USD'))}.`,
        permiso: 'COMPRA_CONSULTAR', entidadTipo: 'COMPRA', ruta: detailRoute('/compras', 'compra', row.id_compra),
        datos: { total: number(row.valor_total), moneda: text(row.moneda, 'USD'), id_animal: row.id_animal ?? null },
    });
}
export async function notifyCleaning(database, row, actor) {
    const pasture = (await database.query(`SELECT u.nombre FROM potrero p JOIN ubicacion u ON u.id_ubicacion=p.id_ubicacion WHERE p.id_potrero=$1`, [row.id_potrero])).rows[0];
    const state = text(row.estado, 'COMPLETADO');
    return emitBusinessNotification(database, actor, text(row.id_limpieza), {
        dedupe: 'LIMPIEZA', tipo: 'LIMPIEZA_POTRERO_REGISTRADA', categoria: 'MANTENIMIENTO',
        prioridad: state === 'COMPLETADO' ? 'INFO' : 'IMPORTANTE', titulo: 'Limpieza de potrero registrada',
        mensaje: `${text(pasture?.nombre, 'Potrero')} · ${text(row.fecha_inicio)} · estado ${state.toLowerCase().replaceAll('_', ' ')}.`,
        permiso: 'LIMPIEZA_CONSULTAR', entidadTipo: 'LIMPIEZA_POTRERO', ruta: detailRoute('/limpiezas', 'limpieza', row.id_limpieza),
        datos: { id_potrero: row.id_potrero, estado: state },
    });
}
export async function notifyActivity(database, row, count, actor) {
    const type = (await database.query('SELECT nombre FROM tipo_actividad WHERE id_tipo_actividad=$1', [row.id_tipo_actividad])).rows[0];
    return emitBusinessNotification(database, actor, text(row.id_actividad), {
        dedupe: 'ACTIVIDAD', tipo: 'ACTIVIDAD_REGISTRADA', categoria: 'ACTIVIDADES', prioridad: 'INFO',
        titulo: 'Actividad registrada',
        mensaje: `${text(type?.nombre, 'Actividad')} · ${countLabel(count, 'animal', 'animales')} · ${text(row.fecha)}.`,
        permiso: 'ACTIVIDAD_CONSULTAR', entidadTipo: 'ACTIVIDAD', ruta: detailRoute('/actividades', 'actividad', row.id_actividad),
        datos: { cantidad_animales: count, id_tipo_actividad: row.id_tipo_actividad },
    });
}
export async function notifySanitaryCampaign(database, id, count, actor) {
    const campaign = (await database.query(`SELECT j.fecha_aplicacion,tt.nombre tipo,m.nombre_comercial medicamento
     FROM jornada_sanitaria j
     JOIN tipo_tratamiento tt ON tt.id_tipo_tratamiento=j.id_tipo_tratamiento
     JOIN medicamento m ON m.id_medicamento=j.id_medicamento
     WHERE j.id_jornada=$1`, [id])).rows[0];
    return emitBusinessNotification(database, actor, id, {
        dedupe: 'JORNADA_SANITARIA', tipo: 'JORNADA_SANITARIA_APLICADA', categoria: 'SANIDAD', prioridad: 'IMPORTANTE',
        titulo: 'Jornada sanitaria aplicada',
        mensaje: `${text(campaign?.tipo, 'Tratamiento')} · ${text(campaign?.medicamento)} · ${countLabel(count, 'animal', 'animales')}.`,
        permiso: 'SANIDAD_CONSULTAR', entidadTipo: 'JORNADA_SANITARIA', ruta: detailRoute('/sanidad', 'jornada', id),
        datos: { cantidad_animales: count, fecha: campaign?.fecha_aplicacion ?? null },
    });
}
export async function notifyHealthCondition(database, row, actor, resolved = false) {
    const context = (await database.query(`SELECT a.nombre,a.codigo_arete,t.nombre tipo
     FROM animal a
     LEFT JOIN tipo_condicion_salud t ON t.id_tipo_condicion_salud=$2
     WHERE a.id_animal=$1`, [row.id_animal, row.id_tipo_condicion_salud ?? null])).rows[0];
    return emitBusinessNotification(database, actor, text(row.id_condicion_salud), {
        dedupe: resolved ? 'CONDICION_RESUELTA' : 'CONDICION_DETECTADA',
        tipo: resolved ? 'CONDICION_SALUD_RESUELTA' : 'CONDICION_SALUD_DETECTADA',
        categoria: 'SANIDAD', prioridad: resolved ? 'INFO' : 'URGENTE',
        titulo: resolved ? 'Condición de salud resuelta' : 'Condición de salud detectada',
        mensaje: `${animalLabel(context)} · ${text(context?.tipo, text(row.descripcion, 'condición sin clasificar'))}${resolved ? ' · marcada como resuelta' : ''}.`,
        permiso: 'SANIDAD_CONSULTAR', entidadTipo: 'CONDICION_SALUD', ruta: detailRoute('/sanidad', 'condicion', row.id_condicion_salud),
        datos: { id_animal: row.id_animal, estado: resolved ? 'RESUELTA' : row.estado },
    });
}
export async function notifyReproductionEvent(database, kind, row, actor) {
    const animalId = text(row.id_vaca);
    const animal = (await database.query('SELECT nombre,codigo_arete FROM animal WHERE id_animal=$1', [animalId])).rows[0];
    if (kind === 'CELO') {
        return emitBusinessNotification(database, actor, text(row.id_celo), {
            dedupe: 'CELO', tipo: 'CELO_REGISTRADO', categoria: 'REPRODUCCION', prioridad: 'INFO',
            titulo: 'Celo registrado', mensaje: `${animalLabel(animal)} · inicio ${text(row.fecha_inicio)}.`,
            permiso: 'PARTO_CONSULTAR', entidadTipo: 'CELO', ruta: detailRoute('/partos', 'celo', row.id_celo, '&tab=heats'), datos: { id_animal: animalId },
        });
    }
    return emitBusinessNotification(database, actor, text(row.id_prenez), {
        dedupe: 'PRENEZ', tipo: 'PRENEZ_CONFIRMADA', categoria: 'REPRODUCCION', prioridad: 'IMPORTANTE',
        titulo: 'Preñez confirmada',
        mensaje: `${animalLabel(animal)}${row.fecha_parto_tentativa ? ` · parto estimado ${text(row.fecha_parto_tentativa)}` : ' · sin fecha estimada de parto'}.`,
        permiso: 'PARTO_CONSULTAR', entidadTipo: 'PRENEZ', ruta: detailRoute('/partos', 'prenez', row.id_prenez, '&tab=pregnancies'),
        datos: { id_animal: animalId, fecha_parto_tentativa: row.fecha_parto_tentativa ?? null },
    });
}
export async function assessPastureTickRisk(database, destinationLocationId, movementDate) {
    const row = (await database.query(`SELECT p.id_potrero,u.nombre,
       COALESCE(cp.alertas_garrapata,TRUE) alertas_garrapata,
       COALESCE(cp.inicio_eclosion_dias,$3)::int inicio_eclosion_dias,
       COALESCE(cp.descanso_minimo_dias,$4)::int descanso_minimo_dias,
       COALESCE(cp.riesgo_reducido_dias,$5)::int riesgo_reducido_dias,
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
     FROM potrero p
     JOIN ubicacion u ON u.id_ubicacion=p.id_ubicacion
     LEFT JOIN configuracion_propiedad cp ON cp.id_propiedad=u.id_propiedad
     WHERE u.id_ubicacion=$1 AND u.tipo='POTRERO' AND u.activo=TRUE
       AND u.deleted_at IS NULL AND p.deleted_at IS NULL`, [
        destinationLocationId, movementDate, env.TICK_EARLIEST_HATCH_DAYS,
        env.TICK_MINIMUM_REST_DAYS, env.TICK_REDUCED_RISK_DAYS,
    ])).rows[0];
    return row?.alertas_garrapata ? row : null;
}
function tickMessage(risk) {
    const minimumRest = number(risk.descanso_minimo_dias);
    const earliestHatch = Math.min(number(risk.inicio_eclosion_dias), minimumRest - 1);
    const reducedRisk = Math.max(number(risk.riesgo_reducido_dias), minimumRest + 1);
    if (risk.animales_presentes > 0)
        return {
            title: `Riesgo alto de garrapata: ${risk.nombre}`, priority: 'URGENTE', level: 'ALTO',
            message: `${risk.nombre} ya está ocupado; no corresponde a un potrero en descanso. Si se trata de una rotación, revise la selección antes de ingresar el grupo.`,
        };
    if (risk.dias_descanso === null)
        return {
            title: `Riesgo alto de garrapata: ${risk.nombre}`, priority: 'URGENTE', level: 'ALTO',
            message: `No existe información suficiente para comprobar el descanso de ${risk.nombre}. Considere que los animales podrían infestarse y realice inspección de garrapatas.`,
        };
    if (risk.dias_descanso < earliestHatch)
        return {
            title: `Fase previa a la eclosión: ${risk.nombre}`, priority: 'IMPORTANTE', level: 'PRE_ECLOSION',
            message: `${risk.nombre} lleva ${countLabel(risk.dias_descanso, 'día', 'días')} desocupado. Está en la fase inicial: es probable que las larvas todavía no hayan emergido, aunque pueden quedar huevos que eclosionen mientras el grupo permanezca allí.`,
        };
    if (risk.dias_descanso < minimumRest)
        return {
            title: `Riesgo alto de garrapata: ${risk.nombre}`, priority: 'URGENTE', level: 'ALTO',
            message: `${risk.nombre} lleva ${countLabel(risk.dias_descanso, 'día', 'días')} desocupado y está dentro de la ventana en que pueden comenzar a emerger larvas. Los animales podrían infestarse.`,
        };
    if (risk.dias_descanso < reducedRisk)
        return {
            title: `Riesgo moderado de garrapata: ${risk.nombre}`, priority: 'IMPORTANTE', level: 'MODERADO',
            message: `${risk.nombre} descansó ${countLabel(risk.dias_descanso, 'día', 'días')}. Un descanso de ${countLabel(minimumRest, 'día', 'días')} puede reducir la carga, pero todavía pueden persistir larvas capaces de infestar hasta el margen conservador de ${countLabel(reducedRisk, 'día', 'días')}.`,
        };
    return {
        title: `Riesgo reducido de garrapata: ${risk.nombre}`, priority: 'INFO', level: 'REDUCIDO',
        message: `${risk.nombre} descansó ${countLabel(risk.dias_descanso, 'día', 'días')} y superó el margen conservador de ${countLabel(reducedRisk, 'día', 'días')}. El riesgo baja, pero el potrero no se considera libre de garrapatas.`,
    };
}
export async function notifyMovementApplied(database, input) {
    const context = (await database.query(`SELECT m.tipo_movimiento,u1.nombre ubicacion_origen,COALESCE(u2.nombre,ud.nombre) ubicacion_destino,
       g1.nombre grupo_origen,g2.nombre grupo_destino,p1.nombre propiedad_origen,p2.nombre propiedad_destino,
       route.origen_descripcion,route.destino_descripcion
       ,route.animal_nombres
     FROM movimiento_animal m
     LEFT JOIN ubicacion u1 ON u1.id_ubicacion=m.id_ubicacion_origen
     LEFT JOIN ubicacion u2 ON u2.id_ubicacion=m.id_ubicacion_destino
     LEFT JOIN ubicacion ud ON ud.id_ubicacion=$2
     LEFT JOIN grupo g1 ON g1.id_grupo=m.id_grupo_origen
     LEFT JOIN grupo g2 ON g2.id_grupo=m.id_grupo_destino
     LEFT JOIN propiedad_ganadera p1 ON p1.id_propiedad=m.id_propiedad_origen
     LEFT JOIN propiedad_ganadera p2 ON p2.id_propiedad=m.id_propiedad_destino
     LEFT JOIN LATERAL (
       SELECT
         STRING_AGG(DISTINCT CASE
           WHEN go.nombre IS NOT NULL AND uo.nombre IS NOT NULL THEN go.nombre||' ('||uo.nombre||')'
           WHEN go.nombre IS NOT NULL THEN go.nombre
           ELSE uo.nombre END,', ') origen_descripcion,
         STRING_AGG(DISTINCT CASE
           WHEN gd.nombre IS NOT NULL AND udd.nombre IS NOT NULL THEN gd.nombre||' ('||udd.nombre||')'
           WHEN gd.nombre IS NOT NULL THEN gd.nombre
           ELSE udd.nombre END,', ') destino_descripcion,
         ARRAY_AGG(DISTINCT ma.nombre ORDER BY ma.nombre) FILTER (WHERE ma.nombre IS NOT NULL) animal_nombres
       FROM movimiento_animal_detalle md
       JOIN animal ma ON ma.id_animal=md.id_animal
       LEFT JOIN grupo go ON go.id_grupo=COALESCE(md.id_grupo_anterior,ma.id_grupo_actual,m.id_grupo_origen,m.id_grupo_filtro)
       LEFT JOIN ubicacion uo ON uo.id_ubicacion=COALESCE(md.id_ubicacion_anterior,ma.id_ubicacion_actual,m.id_ubicacion_origen)
       LEFT JOIN grupo gd ON gd.id_grupo=COALESCE(md.id_grupo_destino,m.id_grupo_destino)
       LEFT JOIN ubicacion udd ON udd.id_ubicacion=COALESCE(md.id_ubicacion_destino,m.id_ubicacion_destino,$2)
       WHERE md.id_movimiento=m.id_movimiento AND md.seleccionado=TRUE AND md.deleted_at IS NULL
     ) route ON TRUE
     WHERE m.id_movimiento=$1`, [input.id, input.destinoId])).rows[0];
    const kind = text(context?.tipo_movimiento, input.tipo);
    const subject = animalSubject(input.cantidad, context?.animal_nombres);
    let title = 'Movimiento aplicado';
    let message = `${subject} trasladado${input.cantidad === 1 ? '' : 's'}.`;
    if (kind === 'UBICACION') {
        title = 'Cambio de potrero aplicado';
        message = `${subject} · ${text(context?.ubicacion_origen, 'potrero de origen no indicado')} → ${text(context?.ubicacion_destino, 'potrero de destino no indicado')}.`;
    }
    else if (kind === 'GRUPO') {
        title = 'Cambio de grupo aplicado';
        message = `${subject} · ${text(context?.origen_descripcion, 'grupo de origen no indicado')} → ${text(context?.destino_descripcion, `${text(context?.grupo_destino, 'grupo de destino no indicado')} (${text(context?.ubicacion_destino, 'potrero no indicado')})`)}.`;
    }
    else if (kind === 'PROPIEDAD') {
        title = 'Traslado de propiedad aplicado';
        message = `${subject} · ${text(context?.propiedad_origen, 'propiedad de origen no indicada')} → ${text(context?.propiedad_destino, 'propiedad de destino no indicada')} (${text(context?.grupo_destino, 'grupo no indicado')}).`;
    }
    else if (kind === 'COMBINADO') {
        title = 'Traslado de propiedad aplicado';
        message = `${subject} · ${text(context?.propiedad_origen, 'propiedad de origen no indicada')} → ${text(context?.propiedad_destino, 'propiedad de destino no indicada')} (${text(context?.grupo_destino, 'grupo no indicado')}).`;
    }
    await emitBusinessNotification(database, input.actor, input.id, {
        dedupe: 'MOVIMIENTO', tipo: 'MOVIMIENTO_APLICADO', categoria: 'MOVIMIENTOS', prioridad: 'INFO',
        titulo: title, mensaje: message,
        permiso: 'MOVIMIENTO_CONSULTAR', entidadTipo: 'MOVIMIENTO', ruta: detailRoute('/movimientos', 'movimiento', input.id),
        datos: { tipo: input.tipo, fecha: input.fecha, cantidad: input.cantidad },
    });
    if (!input.tickRisk)
        return;
    const risk = tickMessage(input.tickRisk);
    await emitBusinessNotification(database, input.actor, input.id, {
        dedupe: 'RIESGO_GARRAPATA', tipo: 'RIESGO_GARRAPATA_POTRERO', categoria: 'SANIDAD',
        prioridad: risk.priority, titulo: risk.title, mensaje: risk.message,
        permiso: 'MOVIMIENTO_CONSULTAR', entidadTipo: 'MOVIMIENTO', ruta: detailRoute('/movimientos', 'movimiento', input.id),
        datos: {
            id_potrero: input.tickRisk.id_potrero,
            id_ubicacion: input.destinoId,
            dias_descanso: input.tickRisk.dias_descanso,
            nivel_riesgo: risk.level,
            referencia_inicio_eclosion_dias: input.tickRisk.inicio_eclosion_dias,
            referencia_descanso_minimo_dias: input.tickRisk.descanso_minimo_dias,
            referencia_riesgo_reducido_dias: input.tickRisk.riesgo_reducido_dias,
            criterio: 'Regla preventiva para clima tropical cálido-húmedo; no sustituye inspección ni criterio veterinario.',
        },
    });
}
//# sourceMappingURL=business-notifications.service.js.map