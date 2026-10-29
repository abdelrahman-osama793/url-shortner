import { DEVICE_TYPES } from './device.js';

// Turns a raw stream entry into a validated click event, or explains why it is unusable.
// The worker never trusts stream contents: anything malformed goes to the dead-letter stream.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COUNTRY = /^([A-Z]{2}|unknown)$/;
const DEVICES = new Set(DEVICE_TYPES);

// Clocks drift between API instances; an event "from the future" beyond this is rejected.
const MAX_FUTURE_SKEW_MS = 60 * 60 * 1000;

// Returns { ok: true, event } or { ok: false, reason }.
export function parseClickEvent(fields, { now }) {
  const occurredAtMs = Number(fields.t);
  const linkVersion = Number(fields.lv);

  if (fields.v !== '1') return { ok: false, reason: 'unknown_version' };
  if (!UUID.test(fields.e ?? '') || !UUID.test(fields.l ?? '')) return { ok: false, reason: 'bad_id' };
  if (!Number.isInteger(linkVersion) || linkVersion < 1) return { ok: false, reason: 'bad_version' };
  if (!Number.isSafeInteger(occurredAtMs) || occurredAtMs > now + MAX_FUTURE_SKEW_MS) return { ok: false, reason: 'bad_time' };
  if (!COUNTRY.test(fields.c ?? '')) return { ok: false, reason: 'bad_country' };
  if (!DEVICES.has(fields.d)) return { ok: false, reason: 'bad_device' };
  if (typeof fields.r !== 'string' || fields.r.length === 0 || fields.r.length > 253) return { ok: false, reason: 'bad_referrer' };
  if (fields.b !== '0' && fields.b !== '1') return { ok: false, reason: 'bad_bot_flag' };

  return {
    ok: true,
    event: {
      eventId: fields.e.toLowerCase(),
      linkId: fields.l.toLowerCase(),
      linkVersion,
      occurredAt: new Date(occurredAtMs),
      country: fields.c,
      device: fields.d,
      referrer: fields.r,
      suspectedBot: fields.b === '1',
    },
  };
}
