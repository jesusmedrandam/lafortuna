export function formatDate(value?: string | null) {
  if (!value) return '—';
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
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
