import { ERROR_CODES } from '@shortlist/contracts';

import { AppError } from '../../errors.js';
import { RateLimitUnavailableError } from '../../modules/abuse/rate-limiter.js';

// Quota exceeded and quota service down are different answers (api-contracts.md):
//   429 RATE_LIMITED + Retry-After        the caller must slow down
//   503 SERVICE_UNAVAILABLE + Retry-After  we cannot enforce limits, so we refuse safely

export function rateLimitedError(retryAfterSeconds) {
  return new AppError(429, ERROR_CODES.RATE_LIMITED, 'Too many requests. Please wait and try again.', {
    headers: { 'Retry-After': String(retryAfterSeconds) },
  });
}

export function protectionUnavailableError(cause) {
  return new AppError(503, ERROR_CODES.SERVICE_UNAVAILABLE, 'The service is temporarily unavailable.', {
    headers: { 'Retry-After': '5' },
    cause,
  });
}

// `subjectsOf(req)` returns the subjects the policy needs, e.g. { network: req.clientNetwork }.
export function rateLimit(limiter, policyName, subjectsOf) {
  return async (req, _res, next) => {
    try {
      const { allowed, retryAfterSeconds } = await limiter.consume(policyName, subjectsOf(req));

      next(allowed ? undefined : rateLimitedError(retryAfterSeconds));
    } catch (error) {
      next(error instanceof RateLimitUnavailableError ? protectionUnavailableError(error) : error);
    }
  };
}
