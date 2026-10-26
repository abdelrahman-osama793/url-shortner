import { ERROR_CODES } from '@shortlist/contracts';

import { AppError } from '../../errors.js';
import { ChallengeUnavailableError } from '../../modules/abuse/challenge.js';
import { RateLimitUnavailableError } from '../../modules/abuse/rate-limiter.js';

import { protectionUnavailableError } from './rate-limit.js';

function challengeRequired(message) {
  return new AppError(403, ERROR_CODES.CHALLENGE_REQUIRED, message);
}

// Requires a valid challenge token only when the risk policy says the caller looks
// suspicious (e.g. a burst of guest creations from one network).
// Mount it after rateLimit(...) and validateBody(...): passing a challenge never skips quotas,
// and the token is read from the validated body (`challengeToken`), then removed from it.
export function requireChallengeWhenSuspicious({ limiter, guard, riskPolicy, action, subjectsOf }) {
  return async (req, _res, next) => {
    const token = req.body?.challengeToken;

    if (req.body) delete req.body.challengeToken;

    try {
      const { allowed: looksNormal } = await limiter.consume(riskPolicy, subjectsOf(req));

      if (looksNormal) return next();

      if (!token) {
        return next(challengeRequired('Please complete the verification to continue.'));
      }

      const passed = await guard.check(token, { action });

      next(passed ? undefined : challengeRequired('The verification failed or expired. Please try again.'));
    } catch (error) {
      const unavailable = error instanceof RateLimitUnavailableError || error instanceof ChallengeUnavailableError;

      next(unavailable ? protectionUnavailableError(error) : error);
    }
  };
}
