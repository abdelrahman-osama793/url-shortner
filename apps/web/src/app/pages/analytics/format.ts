// Labels, numbers and date ranges for the analytics view. Counts arrive as decimal strings
// (PostgreSQL bigints), so they are formatted as BigInt and never rounded through Number.

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

const isoDate = (time: number) => new Date(time).toISOString().slice(0, 10);

// The last `days` UTC dates including today: `from` inclusive, `to` exclusive (api-contracts.md).
export function rangeFor(days: RangeDays, now = Date.now()): { from: string; to: string } {
  const today = Date.parse(isoDate(now));

  return { from: isoDate(today - (days - 1) * DAY_MS), to: isoDate(today + DAY_MS) };
}

export function parseRange(value: string | undefined): RangeDays {
  const days = Number(value);

  return (RANGES as readonly number[]).includes(days) ? (days as RangeDays) : 30;
}

const numberFormat = new Intl.NumberFormat('en');

export function formatCount(count: string): string {
  return numberFormat.format(BigInt(count));
}

// Share of the range total, for bar widths and "42%" labels. Precision does not matter here.
export function share(count: string, total: string): number {
  return total === '0' ? 0 : Number(count) / Number(total);
}

const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fullDayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// "29 Oct" for a UTC date string.
export function shortDay(date: string): string {
  return dayFormat.format(new Date(`${date}T00:00:00Z`));
}

// "1 October – 29 October 2026" from the API's inclusive `from` and exclusive `to`.
export function describeRange(from: string, to: string): string {
  const last = isoDate(Date.parse(to) - DAY_MS);

  return `${fullDayFormat.format(new Date(`${from}T00:00:00Z`))} – ${fullDayFormat.format(new Date(`${last}T00:00:00Z`))}`;
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

export function countryLabel(country: string): string {
  if (country === 'unknown') return 'Unknown';

  try {
    return regionNames.of(country) ?? country;
  } catch {
    return country;
  }
}

const DEVICE_LABELS: Record<string, string> = {
  desktop: 'Desktop',
  mobile: 'Mobile',
  tablet: 'Tablet',
  bot: 'Bots and crawlers',
  unknown: 'Unknown',
};

export function deviceLabel(device: string): string {
  return DEVICE_LABELS[device] ?? device;
}

export function referrerLabel(host: string): string {
  if (host === 'direct_or_unknown') return 'Direct or unknown';
  if (host === 'other') return 'Other sites';

  return host;
}

// "just now", "4 minutes ago", "3 hours ago", or a date for older updates.
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));

  if (seconds < 45) return 'just now';

  const minutes = Math.max(1, Math.round(seconds / 60));

  if (minutes < 90) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  if (seconds < 36 * 3600) return `${Math.round(seconds / 3600)} hours ago`;

  return fullDayFormat.format(new Date(iso));
}
