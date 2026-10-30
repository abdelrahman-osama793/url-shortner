// Link expiry is chosen as a date: the link works until the end of that day in the person's own
// time zone. The API stores an exact instant (ISO 8601, UTC).

const pad = (value: number) => String(value).padStart(2, '0');

function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Today as an <input type="date"> value, e.g. "2026-10-30".
export function todayInput(now = new Date()): string {
  return localDate(now);
}

// "" for no expiry; otherwise the local date the instant falls on.
export function toDateInput(expiresAt: string | null): string {
  return expiresAt ? localDate(new Date(expiresAt)) : '';
}

// null for no expiry; otherwise the last millisecond of that local day.
export function fromDateInput(value: string): string | null {
  return value ? new Date(`${value}T23:59:59.999`).toISOString() : null;
}
