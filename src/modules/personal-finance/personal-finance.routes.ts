import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/async-handler.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { created, noContent, ok } from '../../core/http.js';
import { routeParam } from '../../core/route-param.js';
import { pool } from '../../database/pool.js';
import { transaction } from '../../database/transaction.js';
import { buildInsert } from '../shared/sql.js';

const accountTypes = ['EFECTIVO', 'BANCO', 'BILLETERA', 'OTRO'] as const;
const movementTypes = ['INGRESO', 'EGRESO', 'TRANSFERENCIA', 'AJUSTE_ENTRADA', 'AJUSTE_SALIDA'] as const;
const paymentMethods = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA_DEBITO', 'TARJETA_CREDITO', 'DEPOSITO', 'OTRO'] as const;

const configurationSchema = z.object({
  habilitadas: z.boolean(),
  permitir_saldo_negativo: z.boolean().default(false),
});
const accountSchema = z.object({
  nombre: z.string().trim().min(1).max(100),
  tipo: z.enum(accountTypes),
  saldo_inicial: z.coerce.number().min(0).max(999999999999.99).default(0),
  descripcion: z.string().trim().max(500).nullable().optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  activa: z.boolean().default(true),
});
const accountUpdateSchema = accountSchema.omit({ saldo_inicial: true }).partial()
  .refine((value) => Object.keys(value).length > 0, 'No hay cambios para guardar.');
const debtFieldsSchema = z.object({
  tipo: z.enum(['A_FAVOR', 'EN_CONTRA']),
  contraparte: z.string().trim().min(1).max(160),
  concepto: z.string().trim().min(1).max(200),
  monto_original: z.coerce.number().positive().max(999999999999.99),
  fecha_inicio: z.string().date(),
  fecha_vencimiento: z.string().date().nullable().optional(),
  observaciones: z.string().trim().max(5000).nullable().optional(),
});
function validateDebtDates(value: { fecha_inicio?: string; fecha_vencimiento?: string | null }, context: z.RefinementCtx) {
  if (value.fecha_inicio && value.fecha_vencimiento && value.fecha_vencimiento < value.fecha_inicio) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['fecha_vencimiento'], message: 'El vencimiento no puede ser anterior a la fecha inicial.' });
  }
}
const debtSchema = debtFieldsSchema.superRefine(validateDebtDates);
const debtUpdateSchema = debtFieldsSchema.partial()
  .refine((value) => Object.keys(value).length > 0, 'No hay cambios para guardar.')
  .superRefine(validateDebtDates);
const movementSchema = z.object({
  tipo: z.enum(movementTypes),
  id_cuenta_origen: z.string().uuid().nullable().optional(),
  id_cuenta_destino: z.string().uuid().nullable().optional(),
  id_deuda: z.string().uuid().nullable().optional(),
  monto: z.coerce.number().positive().max(999999999999.99),
  metodo_pago: z.enum(paymentMethods),
  categoria: z.string().trim().max(100).nullable().optional(),
  concepto: z.string().trim().min(1).max(200),
  fecha: z.string().date(),
  observaciones: z.string().trim().max(5000).nullable().optional(),
}).superRefine((value, context) => {
  const needsDestination = ['INGRESO', 'AJUSTE_ENTRADA'].includes(value.tipo);
  const needsOrigin = ['EGRESO', 'AJUSTE_SALIDA'].includes(value.tipo);
  if ((needsOrigin || value.tipo === 'TRANSFERENCIA') && !value.id_cuenta_origen) context.addIssue({ code: z.ZodIssueCode.custom, path: ['id_cuenta_origen'], message: 'Selecciona la cuenta de origen.' });
  if ((needsDestination || value.tipo === 'TRANSFERENCIA') && !value.id_cuenta_destino) context.addIssue({ code: z.ZodIssueCode.custom, path: ['id_cuenta_destino'], message: 'Selecciona la cuenta de destino.' });
  if (needsDestination && value.id_cuenta_origen) context.addIssue({ code: z.ZodIssueCode.custom, path: ['id_cuenta_origen'], message: 'Un ingreso no debe tener cuenta de origen.' });
  if (needsOrigin && value.id_cuenta_destino) context.addIssue({ code: z.ZodIssueCode.custom, path: ['id_cuenta_destino'], message: 'Un egreso no debe tener cuenta de destino.' });
  if (value.tipo === 'TRANSFERENCIA' && value.id_cuenta_origen === value.id_cuenta_destino) context.addIssue({ code: z.ZodIssueCode.custom, path: ['id_cuenta_destino'], message: 'El destino debe ser diferente del origen.' });
  if (value.tipo === 'TRANSFERENCIA' && value.id_deuda) context.addIssue({ code: z.ZodIssueCode.custom, path: ['id_deuda'], message: 'Una transferencia interna no puede pagar una deuda.' });
});

type DbClient = Parameters<Parameters<typeof transaction>[0]>[0];
type Queryable = Pick<DbClient, 'query'>;
const accountBalanceSql = `c.saldo_inicial
  + COALESCE(SUM(CASE WHEN m.id_cuenta_destino=c.id_cuenta THEN m.monto ELSE 0 END),0)
  - COALESCE(SUM(CASE WHEN m.id_cuenta_origen=c.id_cuenta THEN m.monto ELSE 0 END),0)`;

async function configuration(client: Queryable, userId: string) {
  return (await client.query(
    `SELECT habilitadas,permitir_saldo_negativo,moneda,updated_at
     FROM finanzas_usuario_configuracion WHERE id_usuario=$1`, [userId],
  )).rows[0] ?? { habilitadas: false, permitir_saldo_negativo: false, moneda: 'USD', updated_at: null };
}

async function assertEnabled(client: Queryable, userId: string) {
  const config = await configuration(client, userId);
  if (!config.habilitadas) throw new ConflictError('Mis finanzas está desactivado. Actívalo desde Configuración.');
  return config;
}

async function accountForUser(client: DbClient, userId: string, id: string, lock = false) {
  const row = (await client.query(
    `SELECT * FROM cuenta_financiera
     WHERE id_cuenta=$1 AND id_usuario=$2 AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`,
    [id, userId],
  )).rows[0];
  if (!row) throw new ValidationError('La cuenta seleccionada no existe o no pertenece a tu usuario.');
  if (!row.activa) throw new ConflictError(`La cuenta “${row.nombre}” está inactiva.`);
  return row;
}

async function availableBalance(client: DbClient, userId: string, accountId: string, excludeId?: string) {
  const row = (await client.query(
    `SELECT c.saldo_inicial
      +COALESCE(SUM(CASE WHEN m.id_cuenta_destino=c.id_cuenta THEN m.monto ELSE 0 END),0)
      -COALESCE(SUM(CASE WHEN m.id_cuenta_origen=c.id_cuenta THEN m.monto ELSE 0 END),0) saldo
     FROM cuenta_financiera c
     LEFT JOIN movimiento_financiero m ON (m.id_cuenta_origen=c.id_cuenta OR m.id_cuenta_destino=c.id_cuenta)
       AND m.deleted_at IS NULL AND ($3::uuid IS NULL OR m.id_movimiento_financiero<>$3::uuid)
     WHERE c.id_cuenta=$1 AND c.id_usuario=$2 AND c.deleted_at IS NULL GROUP BY c.id_cuenta`,
    [accountId, userId, excludeId ?? null],
  )).rows[0];
  if (!row) throw new ValidationError('La cuenta seleccionada no está disponible.');
  return Number(row.saldo ?? 0);
}

async function refreshDebtState(client: Queryable, userId: string, debtId: string) {
  await client.query(
    `UPDATE deuda_personal d SET estado=CASE
       WHEN d.estado='CANCELADA' THEN 'CANCELADA'
       WHEN COALESCE((SELECT SUM(m.monto) FROM movimiento_financiero m WHERE m.id_deuda=d.id_deuda AND m.deleted_at IS NULL),0)>=d.monto_original THEN 'PAGADA'
       ELSE 'PENDIENTE' END,updated_at=NOW()
     WHERE d.id_deuda=$1 AND d.id_usuario=$2`,
    [debtId, userId],
  );
}

async function validateMovement(client: DbClient, userId: string, input: z.infer<typeof movementSchema>, excludeId?: string) {
  const config = await assertEnabled(client, userId);
  const origin = input.id_cuenta_origen ? await accountForUser(client, userId, input.id_cuenta_origen, true) : null;
  const destination = input.id_cuenta_destino ? await accountForUser(client, userId, input.id_cuenta_destino) : null;
  const paymentAccount = ['EGRESO', 'AJUSTE_SALIDA'].includes(input.tipo) ? origin : ['INGRESO', 'AJUSTE_ENTRADA'].includes(input.tipo) ? destination : null;
  if (paymentAccount?.tipo === 'EFECTIVO' && input.metodo_pago !== 'EFECTIVO') throw new ValidationError('Los movimientos de una cuenta de efectivo deben usar el método Efectivo.');
  if (paymentAccount && paymentAccount.tipo !== 'EFECTIVO' && input.metodo_pago === 'EFECTIVO') throw new ValidationError('Para una cuenta no efectiva selecciona Transferencia, Tarjeta, Depósito u Otro.');
  if (input.tipo === 'TRANSFERENCIA' && input.metodo_pago !== 'TRANSFERENCIA') throw new ValidationError('Entre cuentas se utiliza el método Transferencia.');
  if (origin && !config.permitir_saldo_negativo) {
    const balance = await availableBalance(client, userId, origin.id_cuenta, excludeId);
    if (balance < input.monto) throw new ConflictError(`Saldo insuficiente en “${origin.nombre}”. Disponible: $${balance.toFixed(2)}.`);
  }
  if (input.id_deuda) {
    const debt = (await client.query(
      `SELECT * FROM deuda_personal WHERE id_deuda=$1 AND id_usuario=$2 AND deleted_at IS NULL FOR UPDATE`,
      [input.id_deuda, userId],
    )).rows[0];
    if (!debt) throw new ValidationError('La deuda seleccionada no existe o no pertenece a tu usuario.');
    if (debt.estado === 'CANCELADA') throw new ConflictError('La deuda está cancelada.');
    const paid = Number((await client.query(
      `SELECT COALESCE(SUM(monto),0) total FROM movimiento_financiero
       WHERE id_deuda=$1 AND id_usuario=$2 AND deleted_at IS NULL
         AND ($3::uuid IS NULL OR id_movimiento_financiero<>$3::uuid)`,
      [input.id_deuda, userId, excludeId ?? null],
    )).rows[0]?.total ?? 0);
    const outstanding = Number(debt.monto_original) - paid;
    if (debt.tipo === 'A_FAVOR' && input.tipo !== 'INGRESO') throw new ValidationError('Un abono a una deuda a favor debe registrarse como ingreso.');
    if (debt.tipo === 'EN_CONTRA' && input.tipo !== 'EGRESO') throw new ValidationError('Un pago de una deuda en contra debe registrarse como egreso.');
    if (input.monto > outstanding + 0.001) throw new ConflictError(`El abono supera el saldo pendiente de $${outstanding.toFixed(2)}.`);
  }
}

export const personalFinanceRouter = Router();

personalFinanceRouter.get('/configuracion', asyncHandler(async (req, res) => ok(res, await configuration(pool, req.user!.id))));
personalFinanceRouter.put('/configuracion', asyncHandler(async (req, res) => {
  const input = configurationSchema.parse(req.body);
  const row = (await pool.query(
    `INSERT INTO finanzas_usuario_configuracion(id_usuario,habilitadas,permitir_saldo_negativo)
     VALUES($1,$2,$3) ON CONFLICT(id_usuario) DO UPDATE SET
       habilitadas=EXCLUDED.habilitadas,permitir_saldo_negativo=EXCLUDED.permitir_saldo_negativo,updated_at=NOW()
     RETURNING habilitadas,permitir_saldo_negativo,moneda,updated_at`,
    [req.user!.id, input.habilitadas, input.permitir_saldo_negativo],
  )).rows[0];
  return ok(res, row);
}));

personalFinanceRouter.get('/cuentas', asyncHandler(async (req, res) => ok(res, (await pool.query(
  `SELECT c.*,(${accountBalanceSql})::numeric(14,2) saldo_actual
   FROM cuenta_financiera c
   LEFT JOIN movimiento_financiero m ON (m.id_cuenta_origen=c.id_cuenta OR m.id_cuenta_destino=c.id_cuenta) AND m.deleted_at IS NULL
   WHERE c.id_usuario=$1 AND c.deleted_at IS NULL GROUP BY c.id_cuenta ORDER BY c.activa DESC,c.nombre`,
  [req.user!.id],
)).rows)));

personalFinanceRouter.post('/cuentas', asyncHandler(async (req, res) => {
  const input = accountSchema.parse(req.body);
  await assertEnabled(pool, req.user!.id);
  try {
    return created(res, (await pool.query(buildInsert('cuenta_financiera', {
      ...input, descripcion: input.descripcion ?? null, color: input.color ?? null, id_usuario: req.user!.id,
    }))).rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new ConflictError('Ya tienes una cuenta con ese nombre.');
    throw error;
  }
}));

personalFinanceRouter.patch('/cuentas/:id', asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, 'id');
  const input = accountUpdateSchema.parse(req.body);
  await assertEnabled(pool, req.user!.id);
  const values = Object.entries(input);
  const sets = values.map(([key], index) => `${key}=$${index + 3}`);
  try {
    const row = (await pool.query(
      `UPDATE cuenta_financiera SET ${sets.join(',')},updated_at=NOW()
       WHERE id_cuenta=$1 AND id_usuario=$2 AND deleted_at IS NULL RETURNING *`,
      [id, req.user!.id, ...values.map(([, value]) => value ?? null)],
    )).rows[0];
    if (!row) throw new NotFoundError('Cuenta no encontrada.');
    return ok(res, row);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new ConflictError('Ya tienes una cuenta con ese nombre.');
    throw error;
  }
}));

personalFinanceRouter.delete('/cuentas/:id', asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, 'id');
  await assertEnabled(pool, req.user!.id);
  const used = await pool.query(
    `SELECT 1 FROM movimiento_financiero WHERE id_usuario=$1 AND deleted_at IS NULL
     AND (id_cuenta_origen=$2 OR id_cuenta_destino=$2) LIMIT 1`, [req.user!.id, id],
  );
  if (used.rowCount) throw new ConflictError('La cuenta tiene movimientos. Puedes desactivarla, pero no eliminarla.');
  const result = await pool.query(
    `UPDATE cuenta_financiera SET deleted_at=NOW(),activa=FALSE,updated_at=NOW()
     WHERE id_cuenta=$1 AND id_usuario=$2 AND deleted_at IS NULL`, [id, req.user!.id],
  );
  if (!result.rowCount) throw new NotFoundError('Cuenta no encontrada.');
  return noContent(res);
}));

personalFinanceRouter.get('/movimientos', asyncHandler(async (req, res) => ok(res, (await pool.query(
  `SELECT m.*,o.nombre cuenta_origen,d.nombre cuenta_destino,dp.tipo deuda_tipo,dp.contraparte deuda_contraparte
   FROM movimiento_financiero m
   LEFT JOIN cuenta_financiera o ON o.id_cuenta=m.id_cuenta_origen
   LEFT JOIN cuenta_financiera d ON d.id_cuenta=m.id_cuenta_destino
   LEFT JOIN deuda_personal dp ON dp.id_deuda=m.id_deuda
   WHERE m.id_usuario=$1 AND m.deleted_at IS NULL ORDER BY m.fecha DESC,m.created_at DESC`, [req.user!.id],
)).rows)));

personalFinanceRouter.post('/movimientos', asyncHandler(async (req, res) => {
  const input = movementSchema.parse(req.body);
  const row = await transaction(async (client) => {
    await validateMovement(client, req.user!.id, input);
    const saved = (await client.query(buildInsert('movimiento_financiero', {
      ...input, id_cuenta_origen: input.id_cuenta_origen ?? null, id_cuenta_destino: input.id_cuenta_destino ?? null,
      id_deuda: input.id_deuda ?? null, categoria: input.categoria ?? null, observaciones: input.observaciones ?? null,
      id_usuario: req.user!.id,
    }))).rows[0];
    if (input.id_deuda) await refreshDebtState(client, req.user!.id, input.id_deuda);
    return saved;
  }, req.user!.id);
  return created(res, row);
}));

personalFinanceRouter.patch('/movimientos/:id', asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, 'id');
  const input = movementSchema.parse(req.body);
  const row = await transaction(async (client) => {
    const previous = (await client.query(
      `SELECT * FROM movimiento_financiero WHERE id_movimiento_financiero=$1 AND id_usuario=$2 AND deleted_at IS NULL FOR UPDATE`,
      [id, req.user!.id],
    )).rows[0];
    if (!previous) throw new NotFoundError('Movimiento no encontrado.');
    await validateMovement(client, req.user!.id, input, id);
    const values = {
      ...input, id_cuenta_origen: input.id_cuenta_origen ?? null, id_cuenta_destino: input.id_cuenta_destino ?? null,
      id_deuda: input.id_deuda ?? null, categoria: input.categoria ?? null, observaciones: input.observaciones ?? null,
    };
    const entries = Object.entries(values);
    const sets = entries.map(([key], index) => `${key}=$${index + 3}`);
    const saved = (await client.query(
      `UPDATE movimiento_financiero SET ${sets.join(',')},updated_at=NOW()
       WHERE id_movimiento_financiero=$1 AND id_usuario=$2 RETURNING *`,
      [id, req.user!.id, ...entries.map(([, value]) => value)],
    )).rows[0];
    for (const debtId of new Set([previous.id_deuda, input.id_deuda].filter(Boolean))) await refreshDebtState(client, req.user!.id, String(debtId));
    return saved;
  }, req.user!.id);
  return ok(res, row);
}));

personalFinanceRouter.delete('/movimientos/:id', asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, 'id');
  await assertEnabled(pool, req.user!.id);
  await transaction(async (client) => {
    const row = (await client.query(
      `UPDATE movimiento_financiero SET deleted_at=NOW(),updated_at=NOW()
       WHERE id_movimiento_financiero=$1 AND id_usuario=$2 AND deleted_at IS NULL RETURNING id_deuda`,
      [id, req.user!.id],
    )).rows[0];
    if (!row) throw new NotFoundError('Movimiento no encontrado.');
    if (row.id_deuda) await refreshDebtState(client, req.user!.id, row.id_deuda);
  }, req.user!.id);
  return noContent(res);
}));

personalFinanceRouter.get('/deudas', asyncHandler(async (req, res) => ok(res, (await pool.query(
  `SELECT d.*,COALESCE(SUM(m.monto) FILTER(WHERE m.deleted_at IS NULL),0)::numeric(14,2) monto_abonado,
     GREATEST(d.monto_original-COALESCE(SUM(m.monto) FILTER(WHERE m.deleted_at IS NULL),0),0)::numeric(14,2) saldo_pendiente
   FROM deuda_personal d LEFT JOIN movimiento_financiero m ON m.id_deuda=d.id_deuda
   WHERE d.id_usuario=$1 AND d.deleted_at IS NULL GROUP BY d.id_deuda
   ORDER BY CASE d.estado WHEN 'PENDIENTE' THEN 0 WHEN 'PAGADA' THEN 1 ELSE 2 END,d.fecha_vencimiento NULLS LAST,d.created_at DESC`,
  [req.user!.id],
)).rows)));

personalFinanceRouter.post('/deudas', asyncHandler(async (req, res) => {
  const input = debtSchema.parse(req.body);
  await assertEnabled(pool, req.user!.id);
  return created(res, (await pool.query(buildInsert('deuda_personal', {
    ...input, fecha_vencimiento: input.fecha_vencimiento ?? null, observaciones: input.observaciones ?? null,
    id_usuario: req.user!.id,
  }))).rows[0]);
}));

personalFinanceRouter.patch('/deudas/:id', asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, 'id');
  const input = debtUpdateSchema.parse(req.body);
  const row = await transaction(async (client) => {
    await assertEnabled(client, req.user!.id);
    const current = (await client.query(
      `SELECT tipo,contraparte,concepto,monto_original,fecha_inicio::text,fecha_vencimiento::text,observaciones
       FROM deuda_personal WHERE id_deuda=$1 AND id_usuario=$2 AND deleted_at IS NULL AND estado<>'CANCELADA' FOR UPDATE`,
      [id, req.user!.id],
    )).rows[0];
    if (!current) throw new NotFoundError('Deuda no encontrada o cancelada.');
    const complete = debtSchema.parse({ ...current, ...input });
    const paid = Number((await client.query(
      `SELECT COALESCE(SUM(monto),0) total,COUNT(*)::int cantidad
       FROM movimiento_financiero WHERE id_deuda=$1 AND id_usuario=$2 AND deleted_at IS NULL`,
      [id, req.user!.id],
    )).rows[0]?.total ?? 0);
    if (complete.monto_original + 0.001 < paid) throw new ConflictError(`El monto no puede ser menor a los abonos registrados ($${paid.toFixed(2)}).`);
    if (complete.tipo !== current.tipo && paid > 0) throw new ConflictError('No puedes cambiar el tipo de una deuda que ya tiene abonos.');
    const values = Object.entries(input);
    const sets = values.map(([key], index) => `${key}=$${index + 3}`);
    const saved = (await client.query(
      `UPDATE deuda_personal SET ${sets.join(',')},updated_at=NOW()
       WHERE id_deuda=$1 AND id_usuario=$2 AND deleted_at IS NULL AND estado<>'CANCELADA' RETURNING *`,
      [id, req.user!.id, ...values.map(([, value]) => value ?? null)],
    )).rows[0];
    if (!saved) throw new NotFoundError('Deuda no encontrada o cancelada.');
    await refreshDebtState(client, req.user!.id, id);
    return (await client.query(`SELECT * FROM deuda_personal WHERE id_deuda=$1 AND id_usuario=$2`, [id, req.user!.id])).rows[0];
  }, req.user!.id);
  return ok(res, row);
}));

personalFinanceRouter.delete('/deudas/:id', asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, 'id');
  await assertEnabled(pool, req.user!.id);
  const payments = await pool.query(
    `SELECT 1 FROM movimiento_financiero WHERE id_usuario=$1 AND id_deuda=$2 AND deleted_at IS NULL LIMIT 1`,
    [req.user!.id, id],
  );
  if (payments.rowCount) throw new ConflictError('La deuda tiene abonos. Elimina primero esos movimientos para cancelarla.');
  const result = await pool.query(
    `UPDATE deuda_personal SET estado='CANCELADA',deleted_at=NOW(),updated_at=NOW()
     WHERE id_deuda=$1 AND id_usuario=$2 AND deleted_at IS NULL`, [id, req.user!.id],
  );
  if (!result.rowCount) throw new NotFoundError('Deuda no encontrada.');
  return noContent(res);
}));
