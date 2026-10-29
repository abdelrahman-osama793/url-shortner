// Reduces a Referer header to the referring site's hostname (database-schema.md, click_events).
// Paths, queries and fragments are discarded before anything is queued. A missing or unusable
// referrer is "direct_or_unknown": it does not prove the visit was direct.

export const DIRECT_OR_UNKNOWN = 'direct_or_unknown';

export function referrerHost(referer) {
  if (typeof referer !== 'string' || referer.length === 0 || referer.length > 4096) return DIRECT_OR_UNKNOWN;

  try {
    const url = new URL(referer);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return DIRECT_OR_UNKNOWN;

    const host = url.hostname.replace(/\.$/, '').toLowerCase();

    return host.length > 0 && host.length <= 253 ? host : DIRECT_OR_UNKNOWN;
  } catch {
    return DIRECT_OR_UNKNOWN;
  }
}
