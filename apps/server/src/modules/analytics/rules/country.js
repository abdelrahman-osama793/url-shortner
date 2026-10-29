// Country of a click, taken only from a header set by a trusted edge proxy (for example a CDN's
// country header), named in configuration. Without one, or with a value that is not an ISO
// 3166-1 alpha-2 code, the answer is "unknown". A client can send any header it likes, so the
// header must only be configured behind a proxy that overwrites it (technical-design §5).

const ISO_ALPHA2 = /^[A-Z]{2}$/;

// Codes some providers use for "no country": unknown (XX), Tor (T1), anonymous proxy (A1).
const NOT_A_COUNTRY = new Set(['XX', 'T1', 'A1', 'A2', 'O1', 'ZZ']);

export function countryCode(headerValue) {
  if (typeof headerValue !== 'string') return 'unknown';

  const code = headerValue.trim().toUpperCase();

  return ISO_ALPHA2.test(code) && !NOT_A_COUNTRY.has(code) ? code : 'unknown';
}
