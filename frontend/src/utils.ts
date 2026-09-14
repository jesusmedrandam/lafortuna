export const APP_TIME_ZONE = 'America/Guayaquil';

function dateInAppTimeZone(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function formatCalendarDate(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (!match) return null;
  const [, year, month, day] = match;
  const probe = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (probe.getUTCFullYear() !== Number(year)
      || probe.getUTCMonth() + 1 !== Number(month)
      || probe.getUTCDate() !== Number(day)) return null;
  return `${day}/${month}/${year}`;
}

export function formatDate(value?: string | null) {
  if (!value) return '—';
  // Nacimientos, compras, movimientos y demás fechas del negocio representan
  // un día de calendario, no un instante. Conservamos ese día aunque la API
  // agregue medianoche, UTC u otro sufijo al serializarlo.
  const calendarDate = formatCalendarDate(value);
  if (calendarDate) return calendarDate;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: APP_TIME_ZONE }).format(date);
}

export function dateInputValue(value?: string | null) {
  if (!value) return '';
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? '';
}

export function currentDateInput() {
  return dateInAppTimeZone(new Date());
}

export function formatAge(value?: string | null, reference = new Date()) {
  const normalized = dateInputValue(value);
  if (!normalized) return 'Sin fecha';
  const [year, month, day] = normalized.split('-').map(Number);
  const [referenceYear, referenceMonth, referenceDay] = dateInAppTimeZone(reference).split('-').map(Number);
  const birth = new Date(Date.UTC(year, month - 1, day));
  const today = new Date(Date.UTC(referenceYear, referenceMonth - 1, referenceDay));
  if (Number.isNaN(birth.getTime()) || birth > today) return 'Fecha inválida';
  let years = today.getUTCFullYear() - birth.getUTCFullYear();
  let months = today.getUTCMonth() - birth.getUTCMonth();
  let days = today.getUTCDate() - birth.getUTCDate();
  if (days < 0) {
    const previousMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    days += previousMonth.getUTCDate();
    months -= 1;
  }
  if (months < 0) {
    months += 12;
    years -= 1;
  }
  return [
    `${years} ${years === 1 ? 'año' : 'años'}`,
    `${months} ${months === 1 ? 'mes' : 'meses'}`,
    `${days} ${days === 1 ? 'día' : 'días'}`,
  ].join(', ');
}

export function isAtLeastOneYear(value?: string | null) {
  if (!value) return true;
  const date = dateInputValue(value);
  if (!date) return true;
  const [year, month, day] = date.split('-').map(Number);
  const threshold = new Date();
  threshold.setHours(0, 0, 0, 0);
  threshold.setFullYear(threshold.getFullYear() - 1);
  return new Date(year, month - 1, day) <= threshold;
}

export function formatAgeCompact(value?: string | null) {
  const full = formatAge(value);
  if (full === 'Sin fecha' || full === 'Fecha inválida') return full;
  return full.replace(/ años?/, 'a').replace(/ meses?/, 'm').replace(/ días?/, 'd').replaceAll(', ', ' ');
}

export function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeStyle: 'short', timeZone: APP_TIME_ZONE }).format(date);
}

export function formatNumber(value?: number | string | null, maximumFractionDigits = 2) {
  const numeric = Number(value ?? 0);
  return new Intl.NumberFormat('es-EC', { maximumFractionDigits }).format(numeric);
}

export function nullIfEmpty(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function numberOrNull(value: string) {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function humanizeCode(value: string) {
  return value.toLowerCase().split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}
