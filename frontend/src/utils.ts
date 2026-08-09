export function formatDate(value?: string | null) {
  if (!value) return '—';
  const isCalendarDate = /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?Z)?$/.test(value);
  const normalized = isCalendarDate ? `${value.slice(0, 10)}T12:00:00` : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

export function dateInputValue(value?: string | null) {
  if (!value) return '';
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? '';
}

export function formatAge(value?: string | null, reference = new Date()) {
  const normalized = dateInputValue(value);
  if (!normalized) return 'Sin fecha';
  const [year, month, day] = normalized.split('-').map(Number);
  const birth = new Date(year, month - 1, day);
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  if (Number.isNaN(birth.getTime()) || birth > today) return 'Fecha inválida';
  let years = today.getFullYear() - birth.getFullYear();
  let months = today.getMonth() - birth.getMonth();
  let days = today.getDate() - birth.getDate();
  if (days < 0) {
    const previousMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    days += previousMonth.getDate();
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
  return new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
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
