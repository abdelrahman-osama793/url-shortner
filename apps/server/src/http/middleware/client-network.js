import { networkKey } from '../../modules/abuse/rules/client-address.js';

// Sets req.clientNetwork, the per-network rate-limit key. req.ip already honours the
// configured number of trusted proxies ('trust proxy' in app.js), so a client cannot
// choose its own key by sending X-Forwarded-For directly.
// Unparseable addresses share one "unknown" key: they are limited together, not exempt.
export function clientNetwork() {
  return (req, _res, next) => {
    req.clientNetwork = networkKey(req.ip) ?? 'unknown';

    next();
  };
}
