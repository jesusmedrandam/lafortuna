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
function decimal(value, maximumFractionDigits = 2) {
    return number(value).toLocaleString('es-EC', { maximumFractionDigits });
}
function isoDate(value) {
    if (value instanceof Date && Number.isFinite(value.getTime()))
        return value.toISOString().slice(0, 10);
    const raw = String(value ?? '').trim();
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match)
        return match[1];
    const parsed = new Date(raw);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '';
}
function shortDate(value) {
    const date = isoDate(value);
    if (!date)
        return 'fecha no indicada';
    return new Intl.DateTimeFormat('es-EC', {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    }).format(new Date(`${date}T12:00:00Z`)).replaceAll('.', '');
}
function ecuadorToday() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
}
function addDays(value, days) {
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}
function dayLabel(value) {
    const date = isoDate(value);
    const today = ecuadorToday();
    if (date === today)
        return 'Hoy';
    if (date === addDays(today, -1))
        return 'Ayer';
    return shortDate(date);
}
function enumLabel(value, fallback = '') {
    const raw = text(value, fallback).toLocaleLowerCase('es').replaceAll('_', ' ');
    return raw ? raw.charAt(0).toLocaleUpperCase('es') + raw.slice(1) : '';
}
function profileUrl(row) {
    const url = text(row?.foto_perfil);
    if (!url)
        return null;
    return url.includes('/image/upload/')
        ? url.replace('/image/upload/', '/image/upload/c_fill,w_192,h_192,q_auto/')
        : url;
}
function withProfile(data, animal) {
    const image = profileUrl(animal);
    return image ? { ...data, imagen_url: image } : data;
}
async function animalContext(database, animalId) {
    if (!animalId)
        return undefined;
    return (await database.query(`SELECT a.id_animal,a.nombre,a.codigo_arete,a.sexo,e.nombre especie,
       (SELECT ai.secure_url FROM animal_imagen ai
        WHERE ai.id_animal=a.id_animal AND ai.deleted_at IS NULL
        ORDER BY ai.es_perfil DESC,ai.created_at DESC LIMIT 1) foto_perfil
     FROM animal a
     LEFT JOIN especie e ON e.id_especie=a.id_especie
     WHERE a.id_animal=$1`, [animalId])).rows[0];
}
function productionComparison(current, previous, previousLabel = 'ayer') {
    if (previous <= 0)
        return '';
    const difference = current - previous;
    if (Math.abs(difference) < 0.005)
        return `, igual que ${previousLabel}`;
    return `, ${decimal(Math.abs(difference))} L ${difference > 0 ? 'más' : 'menos'} que ${previousLabel}`;
}
function productionTitle(subject, current, previous) {
    if (previous <= 0)
        return `${subject} registró su producción`;
    const difference = current - previous;
    if (Math.abs(difference) < 0.005)
        return `${subject} mantuvo su producción`;
    return `${subject} ${difference > 0 ? 'aumentó' : 'redujo'} su producción`;
}
function animalLabel(row) {
    if (!row)
        return 'Animal';
    return text(row.nombre, 'Animal');
}
function countLabel(value, singular, plural) {
    return `${value.toLocaleString('es-EC')} ${value === 1 ? singular : plural}`;
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
    const animal = await animalContext(database, animalId);
    const label = animalLabel(animal);
    if (moduleName === 'producciones') {
        const productionDate = isoDate(row.fecha_produccion);
        const totals = (await database.query(`SELECT
         COALESCE(SUM(litros) FILTER(WHERE fecha_produccion=$2::date),0) actual,
         COALESCE(SUM(litros) FILTER(WHERE fecha_produccion=$2::date-1),0) anterior
       FROM produccion_leche
       WHERE id_vaca=$1 AND fecha_produccion BETWEEN $2::date-1 AND $2::date
         AND deleted_at IS NULL`, [animalId, productionDate])).rows[0];
        const current = number(totals.actual);
        const previous = number(totals.anterior);
        const previousLabel = productionDate === ecuadorToday() ? 'ayer' : 'el día anterior';
        return emitBusinessNotification(database, actor, text(row.id_produccion), {
            dedupe: 'PRODUCCION_VACA', tipo: 'PRODUCCION_VACA_REGISTRADA', categoria: 'PRODUCCION', prioridad: 'INFO',
            titulo: productionTitle(label, current, previous),
            mensaje: `${dayLabel(productionDate)} registró ${decimal(current)} L${productionComparison(current, previous, previousLabel)}.`,
            permiso: 'PRODUCCION_CONSULTAR', entidadTipo: 'PRODUCCION_LECHE', ruta: detailRoute('/produccion', 'registro', row.id_produccion),
            datos: withProfile({ id_animal: animalId, litros: number(row.litros), total_dia: current, diferencia_dia_anterior: previous > 0 ? current - previous : null, fecha: productionDate, turno: row.turno ?? null }, animal),
        });
    }
    if (moduleName === 'abortos') {
        return emitBusinessNotification(database, actor, text(row.id_aborto), {
            dedupe: 'ABORTO', tipo: 'ABORTO_REGISTRADO', categoria: 'REPRODUCCION', prioridad: 'URGENTE',
            titulo: `${label} perdió su cría`,
            mensaje: `Aborto registrado el ${shortDate(row.fecha)}${text(row.causa) ? ` · ${text(row.causa)}` : ''}.`,
            permiso: 'ABORTO_CONSULTAR', entidadTipo: 'ABORTO', ruta: detailRoute('/partos', 'aborto', row.id_aborto, '&tab=abortions'),
            datos: withProfile({ id_animal: animalId }, animal),
        });
    }
    if (moduleName === 'muertes') {
        return emitBusinessNotification(database, actor, text(row.id_muerte), {
            dedupe: 'MUERTE', tipo: 'MUERTE_REGISTRADA', categoria: 'ANIMALES', prioridad: 'URGENTE',
            titulo: `${label} falleció`,
            mensaje: `${shortDate(row.fecha)}${text(row.causa) ? ` · ${text(row.causa)}` : ''}.`,
            permiso: 'MUERTE_CONSULTAR', entidadTipo: 'MUERTE', ruta: detailRoute('/muertes', 'registro', row.id_muerte),
            datos: withProfile({ id_animal: animalId }, animal),
        });
    }
    if (moduleName === 'pesajes') {
        return emitBusinessNotification(database, actor, text(row.id_pesaje), {
            dedupe: 'PESAJE', tipo: 'PESAJE_REGISTRADO', categoria: 'PESAJES', prioridad: 'INFO',
            titulo: `${label} fue pesad${text(animal?.sexo) === 'MACHO' ? 'o' : 'a'}`,
            mensaje: `Registró ${decimal(row.peso_kg)} kg el ${shortDate(row.fecha_pesaje)}.`,
            permiso: 'PESAJE_CONSULTAR', entidadTipo: 'PESAJE', ruta: detailRoute('/pesajes', 'registro', row.id_pesaje),
            datos: withProfile({ id_animal: animalId, peso_kg: number(row.peso_kg) }, animal),
        });
    }
    if (moduleName === 'tratamientos') {
        const treatment = (await database.query(`SELECT tt.nombre tipo,m.nombre_comercial medicamento
       FROM tratamiento_animal t
       LEFT JOIN tipo_tratamiento tt ON tt.id_tipo_tratamiento=t.id_tipo_tratamiento
       LEFT JOIN medicamento m ON m.id_medicamento=t.id_medicamento
       WHERE t.id_tratamiento=$1`, [row.id_tratamiento])).rows[0];
        return emitBusinessNotification(database, actor, text(row.id_tratamiento), {
            dedupe: 'TRATAMIENTO', tipo: 'TRATAMIENTO_APLICADO', categoria: 'SANIDAD', prioridad: 'IMPORTANTE',
            titulo: `${label} recibió tratamiento`,
            mensaje: `${text(treatment?.tipo, 'Tratamiento')}${text(treatment?.medicamento) ? ` · ${text(treatment?.medicamento)}` : ''} · ${shortDate(row.fecha_aplicacion)}${row.proxima_aplicacion ? ` · Próxima: ${shortDate(row.proxima_aplicacion)}` : ''}.`,
            permiso: 'SANIDAD_CONSULTAR', entidadTipo: 'TRATAMIENTO', ruta: detailRoute('/sanidad', 'tratamiento', row.id_tratamiento),
            datos: withProfile({ id_animal: animalId, proxima_aplicacion: isoDate(row.proxima_aplicacion) || null }, animal),
        });
    }
    if (moduleName === 'lactancias') {
        const start = isoDate(row.fecha_inicio);
        const end = isoDate(row.fecha_fin);
        let duration = '';
        if (row.activa === false && start && end) {
            const age = (await database.query(`SELECT (DATE_PART('year',AGE($2::date,$1::date))*12+DATE_PART('month',AGE($2::date,$1::date)))::int meses,
                DATE_PART('day',AGE($2::date,$1::date))::int dias`, [start, end])).rows[0];
            const parts = [number(age.meses) ? countLabel(number(age.meses), 'mes', 'meses') : '', number(age.dias) ? countLabel(number(age.dias), 'día', 'días') : ''].filter(Boolean);
            duration = parts.join(' y ') || 'menos de un día';
        }
        return emitBusinessNotification(database, actor, text(row.id_lactancia), {
            dedupe: row.activa === false ? 'LACTANCIA_FIN' : 'LACTANCIA_INICIO', tipo: row.activa === false ? 'LACTANCIA_FINALIZADA' : 'LACTANCIA_INICIADA', categoria: 'PRODUCCION', prioridad: 'INFO',
            titulo: row.activa === false ? `${label} finalizó su lactancia` : `${label} inició su lactancia`,
            mensaje: row.activa === false
                ? `Estuvo en lactancia durante ${duration}.`
                : `Comenzó el ${shortDate(start)}${row.en_ordeno ? ' · Incluida en ordeño' : ''}.`,
            permiso: 'LACTANCIA_CONSULTAR', entidadTipo: 'LACTANCIA', ruta: detailRoute('/produccion', 'lactancia', row.id_lactancia, '&tab=lactations'),
            datos: withProfile({ id_animal: animalId, activa: row.activa, en_ordeno: row.en_ordeno, fecha_inicio: start, fecha_fin: end || null }, animal),
        });
    }
    return null;
}
export async function notifyTankProduction(database, row, actor) {
    const productionDate = isoDate(row.fecha_produccion);
    const totals = (await database.query(`SELECT
       COALESCE(SUM(litros) FILTER(WHERE fecha_produccion=$1::date),0) actual,
       COALESCE(SUM(litros) FILTER(WHERE fecha_produccion=$1::date-1),0) anterior
     FROM produccion_tanque
     WHERE fecha_produccion BETWEEN $1::date-1 AND $1::date AND deleted_at IS NULL`, [productionDate])).rows[0];
    const current = number(totals.actual);
    const previous = number(totals.anterior);
    const difference = current - previous;
    const title = previous <= 0 ? 'Producción de leche registrada'
        : Math.abs(difference) < 0.005 ? 'Producción de leche se mantuvo'
            : `Producción de leche ${difference > 0 ? 'aumentó' : 'disminuyó'}`;
    const previousLabel = productionDate === ecuadorToday() ? 'ayer' : 'el día anterior';
    return emitBusinessNotification(database, actor, text(row.id_produccion_tanque), {
        dedupe: 'PRODUCCION_TANQUE', tipo: 'PRODUCCION_TANQUE_REGISTRADA', categoria: 'PRODUCCION', prioridad: 'INFO',
        titulo: title,
        mensaje: `${dayLabel(productionDate)} se registraron ${decimal(current)} L${productionComparison(current, previous, previousLabel)}.`,
        permiso: 'PRODUCCION_CONSULTAR', entidadTipo: 'PRODUCCION_TANQUE', ruta: detailRoute('/produccion', 'tanque', row.id_produccion_tanque),
        datos: { litros: number(row.litros), total_dia: current, diferencia_dia_anterior: previous > 0 ? difference : null, fecha: productionDate, turno: row.turno ?? null },
    });
}
export async function notifyBirth(database, row, actor) {
    const mother = await animalContext(database, text(row.id_madre));
    const children = Array.isArray(row.crias) ? row.crias : [];
    const live = children.filter(child => text(child.estado_nacimiento) !== 'MUERTA').length;
    const dead = children.length - live;
    const species = text(mother?.especie).toLocaleUpperCase('es');
    const groups = new Map();
    for (const child of children) {
        const female = text(child.sexo) === 'HEMBRA';
        const state = text(child.estado_nacimiento, 'DESCONOCIDO');
        const noun = species.includes('CAPR') ? (female ? 'chiva' : 'chivo')
            : species.includes('BOV') ? (female ? 'ternera' : 'ternero')
                : female ? 'cría hembra' : text(child.sexo) === 'MACHO' ? 'cría macho' : 'cría';
        const plural = species.includes('CAPR') ? (female ? 'chivas' : 'chivos')
            : species.includes('BOV') ? (female ? 'terneras' : 'terneros')
                : female ? 'crías hembras' : text(child.sexo) === 'MACHO' ? 'crías machos' : 'crías';
        const adjective = state === 'MUERTA' ? (female ? 'muerta' : 'muerto')
            : state === 'DEBIL' ? 'débil' : state === 'DESCONOCIDO' ? 'con estado desconocido' : (female ? 'viva' : 'vivo');
        const pluralAdjective = state === 'MUERTA' ? (female ? 'muertas' : 'muertos')
            : state === 'DEBIL' ? 'débiles' : state === 'DESCONOCIDO' ? 'con estado desconocido' : (female ? 'vivas' : 'vivos');
        const key = `${noun}:${state}`;
        const current = groups.get(key);
        groups.set(key, current ? { ...current, count: current.count + 1 } : { count: 1, noun, plural, adjective, pluralAdjective });
    }
    const result = [...groups.values()].map(item => `${item.count} ${item.count === 1 ? item.noun : item.plural} ${item.count === 1 ? item.adjective : item.pluralAdjective}`).join(' y ');
    const birthType = enumLabel(row.tipo_parto, 'DESCONOCIDO').toLocaleLowerCase('es');
    return emitBusinessNotification(database, actor, text(row.id_parto), {
        dedupe: 'PARTO', tipo: 'PARTO_REGISTRADO', categoria: 'REPRODUCCION', prioridad: dead ? 'IMPORTANTE' : 'INFO',
        titulo: `${animalLabel(mother)} parió`,
        mensaje: `${result || 'Sin crías registradas'} · Parto ${birthType} · ${shortDate(row.fecha_parto)}.`,
        permiso: 'PARTO_CONSULTAR', entidadTipo: 'PARTO', ruta: detailRoute('/partos', 'parto', row.id_parto, '&tab=births'),
        datos: withProfile({ id_madre: row.id_madre, crias: children.length, vivas: live, muertas: dead, tipo_parto: row.tipo_parto, fecha: isoDate(row.fecha_parto) }, mother),
    });
}
export async function notifyAnimalSale(database, row, count, actor) {
    const animals = (await database.query(`SELECT a.id_animal,a.nombre,a.sexo,
       (SELECT ai.secure_url FROM animal_imagen ai WHERE ai.id_animal=a.id_animal AND ai.deleted_at IS NULL
        ORDER BY ai.es_perfil DESC,ai.created_at DESC LIMIT 1) foto_perfil
     FROM venta_animal_detalle d JOIN animal a ON a.id_animal=d.id_animal
     WHERE d.id_venta=$1 AND d.deleted_at IS NULL ORDER BY a.nombre`, [row.id_venta])).rows;
    const single = count === 1 ? animals[0] : undefined;
    const subject = single ? animalLabel(single) : countLabel(count, 'animal', 'animales');
    return emitBusinessNotification(database, actor, text(row.id_venta), {
        dedupe: 'VENTA_ANIMALES', tipo: 'VENTA_ANIMALES_REGISTRADA', categoria: 'VENTAS', prioridad: 'IMPORTANTE',
        titulo: single ? `${subject} fue vendido${text(single.sexo) === 'HEMBRA' ? 'a' : ''}` : `${subject} vendidos`,
        mensaje: `${text(row.comprador_nombre, 'Comprador no indicado')} · ${money(row.precio_total, text(row.moneda, 'USD'))} · ${shortDate(row.fecha_venta)}.`,
        permiso: 'VENTA_CONSULTAR', entidadTipo: 'VENTA_ANIMAL', ruta: detailRoute('/ventas', 'venta', row.id_venta, '&tipo=animales'),
        datos: withProfile({ cantidad: count, total: number(row.precio_total), moneda: text(row.moneda, 'USD'), id_animal: single?.id_animal ?? null }, single),
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
        titulo: products.length === 1 ? `${text(products[0]?.nombre, 'Producto')} vendido` : 'Venta de productos registrada',
        mensaje: `${productSummary} · ${text(row.comprador_nombre, 'Comprador no indicado')} · ${money(row.precio_total, text(row.moneda, 'USD'))}.`,
        permiso: 'VENTA_CONSULTAR', entidadTipo: 'VENTA_PRODUCTO', ruta: detailRoute('/ventas', 'venta_producto', row.id_venta_producto, '&tipo=productos'),
        datos: { cantidad: count, total: number(row.precio_total), moneda: text(row.moneda, 'USD') },
    });
}
export async function notifyPurchase(database, row, actor) {
    const animal = row.id_animal ? await animalContext(database, text(row.id_animal)) : undefined;
    const context = (await database.query(`SELECT t.nombre tipo,COALESCE(u.simbolo,u.nombre,'unidades') unidad
     FROM compra c JOIN tipo_producto_compra t ON t.id_tipo_producto_compra=c.id_tipo_producto_compra
     LEFT JOIN unidad_medida u ON u.id_unidad=c.id_unidad WHERE c.id_compra=$1`, [row.id_compra])).rows[0];
    const product = text(row.producto ?? row.animal, text(context?.tipo, 'Compra'));
    return emitBusinessNotification(database, actor, text(row.id_compra), {
        dedupe: 'COMPRA', tipo: 'COMPRA_REGISTRADA', categoria: 'COMPRAS', prioridad: 'INFO',
        titulo: animal ? `${animalLabel(animal)} fue comprado${text(animal.sexo) === 'HEMBRA' ? 'a' : ''}` : `Compra de ${product}`,
        mensaje: `${animal ? '' : `${decimal(row.cantidad)} ${text(context?.unidad)} · `}${text(row.proveedor, 'Proveedor no indicado')} · ${money(row.valor_total, text(row.moneda, 'USD'))}.`,
        permiso: 'COMPRA_CONSULTAR', entidadTipo: 'COMPRA', ruta: detailRoute('/compras', 'compra', row.id_compra),
        datos: withProfile({ total: number(row.valor_total), moneda: text(row.moneda, 'USD'), id_animal: row.id_animal ?? null }, animal),
    });
}
export async function notifyCleaning(database, row, actor) {
    const pasture = (await database.query(`SELECT u.nombre FROM potrero p JOIN ubicacion u ON u.id_ubicacion=p.id_ubicacion WHERE p.id_potrero=$1`, [row.id_potrero])).rows[0];
    const state = text(row.estado, 'COMPLETADO');
    return emitBusinessNotification(database, actor, text(row.id_limpieza), {
        dedupe: 'LIMPIEZA', tipo: 'LIMPIEZA_POTRERO_REGISTRADA', categoria: 'MANTENIMIENTO',
        prioridad: state === 'COMPLETADO' ? 'INFO' : 'IMPORTANTE', titulo: `${text(pasture?.nombre, 'Potrero')} recibió mantenimiento`,
        mensaje: `${shortDate(row.fecha_inicio)} · ${enumLabel(state)}.`,
        permiso: 'LIMPIEZA_CONSULTAR', entidadTipo: 'LIMPIEZA_POTRERO', ruta: detailRoute('/limpiezas', 'limpieza', row.id_limpieza),
        datos: { id_potrero: row.id_potrero, estado: state },
    });
}
export async function notifyActivity(database, row, count, actor) {
    const type = (await database.query('SELECT nombre FROM tipo_actividad WHERE id_tipo_actividad=$1', [row.id_tipo_actividad])).rows[0];
    const animals = count === 1 ? (await database.query(`SELECT a.id_animal,a.nombre,a.sexo,
       (SELECT ai.secure_url FROM animal_imagen ai WHERE ai.id_animal=a.id_animal AND ai.deleted_at IS NULL
        ORDER BY ai.es_perfil DESC,ai.created_at DESC LIMIT 1) foto_perfil
     FROM actividad_animal aa JOIN animal a ON a.id_animal=aa.id_animal
     WHERE aa.id_actividad=$1 AND aa.deleted_at IS NULL LIMIT 1`, [row.id_actividad])).rows : [];
    const single = animals[0];
    const activity = text(type?.nombre, 'Actividad');
    return emitBusinessNotification(database, actor, text(row.id_actividad), {
        dedupe: 'ACTIVIDAD', tipo: 'ACTIVIDAD_REGISTRADA', categoria: 'ACTIVIDADES', prioridad: 'INFO',
        titulo: single ? `${activity} para ${animalLabel(single)}` : `${activity} para ${countLabel(count, 'animal', 'animales')}`,
        mensaje: `${shortDate(row.fecha)}${text(row.descripcion) ? ` · ${text(row.descripcion)}` : ''}.`,
        permiso: 'ACTIVIDAD_CONSULTAR', entidadTipo: 'ACTIVIDAD', ruta: detailRoute('/actividades', 'actividad', row.id_actividad),
        datos: withProfile({ cantidad_animales: count, id_tipo_actividad: row.id_tipo_actividad, id_animal: single?.id_animal ?? null }, single),
    });
}
export async function notifySanitaryCampaign(database, id, count, actor) {
    const campaign = (await database.query(`SELECT j.fecha_aplicacion,tt.nombre tipo,m.nombre_comercial medicamento
     FROM jornada_sanitaria j
     JOIN tipo_tratamiento tt ON tt.id_tipo_tratamiento=j.id_tipo_tratamiento
     JOIN medicamento m ON m.id_medicamento=j.id_medicamento
     WHERE j.id_jornada=$1`, [id])).rows[0];
    const animals = count === 1 ? (await database.query(`SELECT a.id_animal,a.nombre,a.sexo,
       (SELECT ai.secure_url FROM animal_imagen ai WHERE ai.id_animal=a.id_animal AND ai.deleted_at IS NULL
        ORDER BY ai.es_perfil DESC,ai.created_at DESC LIMIT 1) foto_perfil
     FROM jornada_sanitaria_detalle d JOIN animal a ON a.id_animal=d.id_animal
     WHERE d.id_jornada=$1 AND d.seleccionado=TRUE AND d.deleted_at IS NULL LIMIT 1`, [id])).rows : [];
    const single = animals[0];
    return emitBusinessNotification(database, actor, id, {
        dedupe: 'JORNADA_SANITARIA', tipo: 'JORNADA_SANITARIA_APLICADA', categoria: 'SANIDAD', prioridad: 'IMPORTANTE',
        titulo: single ? `${animalLabel(single)} recibió ${text(campaign?.tipo, 'tratamiento').toLocaleLowerCase('es')}` : `${text(campaign?.tipo, 'Tratamiento')} aplicado a ${countLabel(count, 'animal', 'animales')}`,
        mensaje: `${text(campaign?.medicamento)} · ${shortDate(campaign?.fecha_aplicacion)}.`,
        permiso: 'SANIDAD_CONSULTAR', entidadTipo: 'JORNADA_SANITARIA', ruta: detailRoute('/sanidad', 'jornada', id),
        datos: withProfile({ cantidad_animales: count, fecha: isoDate(campaign?.fecha_aplicacion), id_animal: single?.id_animal ?? null }, single),
    });
}
export async function notifyHealthCondition(database, row, actor, resolved = false) {
    const context = (await database.query(`SELECT a.nombre,a.codigo_arete,a.sexo,t.nombre tipo,
       (SELECT ai.secure_url FROM animal_imagen ai WHERE ai.id_animal=a.id_animal AND ai.deleted_at IS NULL
        ORDER BY ai.es_perfil DESC,ai.created_at DESC LIMIT 1) foto_perfil
     FROM animal a
     LEFT JOIN tipo_condicion_salud t ON t.id_tipo_condicion_salud=$2
     WHERE a.id_animal=$1`, [row.id_animal, row.id_tipo_condicion_salud ?? null])).rows[0];
    return emitBusinessNotification(database, actor, text(row.id_condicion_salud), {
        dedupe: resolved ? 'CONDICION_RESUELTA' : 'CONDICION_DETECTADA',
        tipo: resolved ? 'CONDICION_SALUD_RESUELTA' : 'CONDICION_SALUD_DETECTADA',
        categoria: 'SANIDAD', prioridad: resolved ? 'INFO' : 'URGENTE',
        titulo: resolved
            ? `${animalLabel(context)} se recuperó de ${text(context?.tipo, 'su condición').toLocaleLowerCase('es')}`
            : `${animalLabel(context)} presenta ${text(context?.tipo, 'una condición de salud').toLocaleLowerCase('es')}`,
        mensaje: resolved ? 'La condición fue marcada como resuelta.' : `${text(row.descripcion, 'Requiere revisión')}.`,
        permiso: 'SANIDAD_CONSULTAR', entidadTipo: 'CONDICION_SALUD', ruta: detailRoute('/sanidad', 'condicion', row.id_condicion_salud),
        datos: withProfile({ id_animal: row.id_animal, estado: resolved ? 'RESUELTA' : row.estado }, context),
    });
}
export async function notifyReproductionEvent(database, kind, row, actor) {
    const animalId = text(row.id_vaca);
    const animal = await animalContext(database, animalId);
    if (kind === 'CELO') {
        return emitBusinessNotification(database, actor, text(row.id_celo), {
            dedupe: 'CELO', tipo: 'CELO_REGISTRADO', categoria: 'REPRODUCCION', prioridad: 'INFO',
            titulo: `${animalLabel(animal)} entró en celo`, mensaje: `Inició el ${shortDate(row.fecha_inicio)}.`,
            permiso: 'PARTO_CONSULTAR', entidadTipo: 'CELO', ruta: detailRoute('/partos', 'celo', row.id_celo, '&tab=heats'), datos: withProfile({ id_animal: animalId }, animal),
        });
    }
    return emitBusinessNotification(database, actor, text(row.id_prenez), {
        dedupe: 'PRENEZ', tipo: 'PRENEZ_CONFIRMADA', categoria: 'REPRODUCCION', prioridad: 'IMPORTANTE',
        titulo: `${animalLabel(animal)} está preñada`,
        mensaje: `${row.fecha_parto_tentativa ? `Parto estimado: ${shortDate(row.fecha_parto_tentativa)}` : 'Sin fecha estimada de parto'} · ${enumLabel(row.metodo_confirmacion, 'Método no indicado')}.`,
        permiso: 'PARTO_CONSULTAR', entidadTipo: 'PRENEZ', ruta: detailRoute('/partos', 'prenez', row.id_prenez, '&tab=pregnancies'),
        datos: withProfile({ id_animal: animalId, fecha_parto_tentativa: isoDate(row.fecha_parto_tentativa) || null, metodo_confirmacion: row.metodo_confirmacion ?? null }, animal),
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
       ,route.animal_nombres,route.animal_ids
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
         ,ARRAY_AGG(DISTINCT ma.id_animal) FILTER (WHERE ma.id_animal IS NOT NULL) animal_ids
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
    const animalIds = Array.isArray(context?.animal_ids) ? context.animal_ids.map(value => text(value)).filter(Boolean) : [];
    const singleAnimal = input.cantidad === 1 && animalIds[0] ? await animalContext(database, animalIds[0]) : undefined;
    const singleName = animalLabel(singleAnimal);
    let title = 'Movimiento aplicado';
    let message = `${countLabel(input.cantidad, 'animal trasladado', 'animales trasladados')}.`;
    if (kind === 'UBICACION') {
        const groupName = text(context?.grupo_origen, 'El grupo');
        title = `${groupName} fueron cambiad${/^\S*as\b/i.test(groupName) ? 'as' : 'os'} de potrero`;
        message = `${countLabel(input.cantidad, 'animal', 'animales')} · ${text(context?.ubicacion_origen, 'potrero de origen no indicado')} → ${text(context?.ubicacion_destino, 'potrero de destino no indicado')}.`;
    }
    else if (kind === 'GRUPO') {
        title = input.cantidad === 1 ? `${singleName} se cambió de grupo` : `${countLabel(input.cantidad, 'animal cambiado', 'animales cambiados')} de grupo`;
        message = `${text(context?.origen_descripcion, 'grupo de origen no indicado')} → ${text(context?.destino_descripcion, `${text(context?.grupo_destino, 'grupo de destino no indicado')} (${text(context?.ubicacion_destino, 'potrero no indicado')})`)}.`;
    }
    else if (kind === 'PROPIEDAD') {
        title = input.cantidad === 1 ? `${singleName} se cambió de propiedad` : `${countLabel(input.cantidad, 'animal cambiado', 'animales cambiados')} de propiedad`;
        message = `${text(context?.propiedad_origen, 'propiedad de origen no indicada')} → ${text(context?.propiedad_destino, 'propiedad de destino no indicada')} (${text(context?.grupo_destino, 'grupo no indicado')}).`;
    }
    else if (kind === 'COMBINADO') {
        title = input.cantidad === 1 ? `${singleName} se cambió de propiedad` : `${countLabel(input.cantidad, 'animal cambiado', 'animales cambiados')} de propiedad`;
        message = `${text(context?.propiedad_origen, 'propiedad de origen no indicada')} → ${text(context?.propiedad_destino, 'propiedad de destino no indicada')} (${text(context?.grupo_destino, 'grupo no indicado')}).`;
    }
    await emitBusinessNotification(database, input.actor, input.id, {
        dedupe: 'MOVIMIENTO', tipo: 'MOVIMIENTO_APLICADO', categoria: 'MOVIMIENTOS', prioridad: 'INFO',
        titulo: title, mensaje: message,
        permiso: 'MOVIMIENTO_CONSULTAR', entidadTipo: 'MOVIMIENTO', ruta: detailRoute('/movimientos', 'movimiento', input.id),
        datos: withProfile({ tipo: input.tipo, fecha: isoDate(input.fecha), cantidad: input.cantidad, id_animal: singleAnimal?.id_animal ?? null }, singleAnimal),
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