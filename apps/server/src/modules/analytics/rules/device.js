// Reduces a User-Agent string to a coarse device category (database-schema.md, click_events).
// The User-Agent itself is never stored. Classification is approximate by design: user agents
// can lie, and unknown is a valid answer.

const BOT = /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|embedly|preview|monitor|curl\/|wget\/|python-requests|httpclient|okhttp|go-http-client|headless/i;
const TABLET = /ipad|tablet|kindle|silk\/|playbook|android(?!.*\bmobile\b)/i;
const MOBILE = /\bmobi|iphone|ipod|android.*\bmobile\b|windows phone|blackberry|opera mini/i;
const DESKTOP = /windows nt|macintosh|mac os x|x11|linux x86_64|cros\b/i;

export const DEVICE_TYPES = ['desktop', 'mobile', 'tablet', 'bot', 'unknown'];

export function classifyDevice(userAgent) {
  if (typeof userAgent !== 'string' || userAgent.trim() === '') return 'unknown';

  if (BOT.test(userAgent)) return 'bot';
  if (TABLET.test(userAgent)) return 'tablet';
  if (MOBILE.test(userAgent)) return 'mobile';
  if (DESKTOP.test(userAgent)) return 'desktop';

  return 'unknown';
}
