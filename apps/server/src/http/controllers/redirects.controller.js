import { ERROR_CODES } from '@shortlist/contracts';

import { AppError, notFoundError, serviceUnavailableError } from '../../errors.js';
import { RedirectUnavailableError } from '../../modules/links/redirects.service.js';

// Maps a redirect decision to HTTP (api-contracts.md, "Redirect contract"):
//   302 + Location   active link; the stored destination exactly, incoming query not appended
//   404              unknown or malformed code
//   410              inactive: expired, disabled, blocked or owner suspended (one generic answer)
//   503              database unavailable or overloaded
//   405              any method other than GET/HEAD
// Responses are non-cacheable (no-store is set globally), including failures.

const linkInactiveError = () => new AppError(410, ERROR_CODES.LINK_INACTIVE, 'This link is no longer active.');

const methodNotAllowedError = () => new AppError(405, ERROR_CODES.METHOD_NOT_ALLOWED, 'Only GET and HEAD are allowed.', {
  headers: { Allow: 'GET, HEAD' },
});

export function createRedirectsController({ redirectService }) {
  // Express also answers HEAD with this handler and sends no body. Analytics capture (T19)
  // must only count GET requests.
  async function redirect(req, res, next) {
    try {
      const result = await redirectService.resolve(req.params.code);

      if (result.outcome === 'missing') return next(notFoundError());
      if (result.outcome === 'inactive') return next(linkInactiveError());

      res.redirect(302, result.destination);
    } catch (error) {
      next(error instanceof RedirectUnavailableError ? serviceUnavailableError({ retryAfterSeconds: 2, cause: error }) : error);
    }
  }

  function methodNotAllowed(_req, _res, next) {
    next(methodNotAllowedError());
  }

  return { redirect, methodNotAllowed };
}
