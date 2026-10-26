import { ERROR_CODES } from '@shortlist/contracts';

import { AppError } from '../../errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// State-changing requests must come from one of our own origins (api-contracts.md, Conventions).
// Browsers always send Origin on these requests. The API has no non-browser clients in v1,
// so a missing Origin is rejected too. CSRF tokens are added on top of this in T11.
export function requireAllowedOrigin(allowedOrigins) {
  const allowed = new Set(allowedOrigins);

  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.get('Origin');

    if (!origin || !allowed.has(origin)) {
      return next(new AppError(403, ERROR_CODES.ORIGIN_NOT_ALLOWED, 'This request origin is not allowed.'));
    }

    next();
  };
}
