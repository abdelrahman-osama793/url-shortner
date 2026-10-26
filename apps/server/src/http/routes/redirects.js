import { ERROR_CODES } from '@shortlist/contracts';
import { Router } from 'express';

import { AppError, notFoundError } from '../../errors.js';
import { RedirectUnavailableError } from '../../modules/links/redirects.js';

// Public redirect endpoint (api-contracts.md, "Redirect contract"). Served by the API, never
// by Angular. Responses are non-cacheable (no-store is set globally), including failures,
// so a later activation or edit is never hidden by a cached answer.
//
//   302 + Location   active link; the stored destination exactly, incoming query not appended
//   404              unknown or malformed code
//   410              inactive: expired, disabled, blocked or owner suspended (one generic answer)
//   503              database unavailable or overloaded
//   405              any method other than GET/HEAD
//
// Per-client 429 limits for redirects belong at the edge proxy (technical-design §6); an
// application limit would make every redirect depend on Redis.

const linkInactiveError = () => new AppError(410, ERROR_CODES.LINK_INACTIVE, 'This link is no longer active.');

const unavailableError = (cause) => new AppError(503, ERROR_CODES.SERVICE_UNAVAILABLE, 'The service is temporarily unavailable.', {
  headers: { 'Retry-After': '2' },
  cause,
});

const methodNotAllowedError = () => new AppError(405, ERROR_CODES.METHOD_NOT_ALLOWED, 'Only GET and HEAD are allowed.', {
  headers: { Allow: 'GET, HEAD' },
});

export function createRedirectRouter({ resolver }) {
  // Case-sensitive: /R/abc must not reach the /r/:code handler.
  const router = Router({ caseSensitive: true });

  // Express answers HEAD with this GET handler and sends no body. Analytics capture (T19)
  // must only count GET requests.
  router.get('/r/:code', async (req, res, next) => {
    try {
      const result = await resolver.resolve(req.params.code);

      if (result.outcome === 'missing') return next(notFoundError());
      if (result.outcome === 'inactive') return next(linkInactiveError());

      res.redirect(302, result.destination);
    } catch (error) {
      next(error instanceof RedirectUnavailableError ? unavailableError(error) : error);
    }
  });

  router.all('/r/:code', (_req, _res, next) => next(methodNotAllowedError()));

  return router;
}
