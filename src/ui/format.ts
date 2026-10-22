export const pct = (x: number | null | undefined, d = 0) => (x == null ? '—' : `${(100 * x).toFixed(d)}%`);
export const int = (n: number) => n.toLocaleString();
export const plural = (n: number, one: string, many = one + 's') => `${int(n)} ${n === 1 ? one : many}`;

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, opts);
}
export function fmtTime(iso: string) {
  return iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
}
/** Local calendar date YYYY-MM-DD (for date inputs). */
export function localYmd(d: Date) {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
