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

// The request details analytics may use. Raw values go no further than the capture service,
// which reduces them to a device category, a referring host and a country code.
function clickHeaders(req, countryHeader) {
  return {
    userAgent: req.get('User-Agent'),
    referer: req.get('Referer'),
    country: countryHeader ? req.get(countryHeader) : undefined,
    secPurpose: req.get('Sec-Purpose'),
    purpose: req.get('Purpose'),
    xMoz: req.get('X-Moz'),
  };
}

// `clickCapture` and `countryHeader` are optional: without them redirects simply are not counted.
export function createRedirectsController({ redirectService, clickCapture, countryHeader }) {
  // Express also answers HEAD with this handler and sends no body. Only GET redirects are
  // counted, and only after the 302 has been sent: analytics never delays a redirect.
  async function redirect(req, res, next) {
    try {
      const result = await redirectService.resolve(req.params.code);

      if (result.outcome === 'missing') return next(notFoundError());
      if (result.outcome === 'inactive') return next(linkInactiveError());

      res.redirect(302, result.destination);

      if (req.method === 'GET' && clickCapture) {
        clickCapture.captureInBackground({
          linkId: result.linkId,
          linkVersion: result.linkVersion,
          headers: clickHeaders(req, countryHeader),
        });
      }
    } catch (error) {
      next(error instanceof RedirectUnavailableError ? serviceUnavailableError({ retryAfterSeconds: 2, cause: error }) : error);
    }
  }

  function methodNotAllowed(_req, _res, next) {
    next(methodNotAllowedError());
  }

  return { redirect, methodNotAllowed };
}
