import { ERROR_CODES, GUEST_CREATE_CHALLENGE_ACTION, GuestCreateLinkRequestSchema } from '@shortlist/contracts';
import { Router } from 'express';

import { AppError } from '../../errors.js';
import { requireChallengeWhenSuspicious } from '../middleware/challenge.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { validateBody } from '../middleware/validate.js';

const byNetwork = (req) => ({ network: req.clientNetwork });

// Signed-in users must not receive a guest link: registered creation (alias, expiry,
// management, idempotency) is T17. Until then the honest answer is "not implemented".
function rejectSignedInUntilRegisteredCreationExists(req, _res, next) {
  if (req.session?.userId) {
    return next(new AppError(501, ERROR_CODES.NOT_IMPLEMENTED, 'Creating links from an account is not available yet.'));
  }

  next();
}

// POST /api/v1/links — guest branch (api-contracts.md, "Links"; decision D04).
// Order matters:
//   session + CSRF   a stale or unknown session cookie fails here; it never becomes a guest
//   quota            counted before validation, so invalid attempts are limited too
//   validation       strict guest schema: only destinationUrl and challengeToken
//   challenge        only when the risk policy flags the network; never replaces the quota
// The response has no id, Location or ETag: guests get no handle to manage the link.
export function createLinksRouter({ guards, limiter, challengeGuard, linkService }) {
  const router = Router();

  router.post(
    '/api/v1/links',
    guards.session,
    guards.csrf,
    rejectSignedInUntilRegisteredCreationExists,
    rateLimit(limiter, 'guestCreate', byNetwork),
    validateBody(GuestCreateLinkRequestSchema),
    requireChallengeWhenSuspicious({
      limiter,
      guard: challengeGuard,
      riskPolicy: 'guestCreateRisk',
      action: GUEST_CREATE_CHALLENGE_ACTION,
      subjectsOf: byNetwork,
    }),
    async (req, res) => {
      const link = await linkService.createGuestLink({ destinationUrl: req.body.destinationUrl });

      res.status(201).json(link);
    },
  );

  return router;
}
