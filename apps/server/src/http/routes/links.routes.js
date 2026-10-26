import { GUEST_CREATE_CHALLENGE_ACTION, GuestCreateLinkRequestSchema } from '@shortlist/contracts';
import { Router } from 'express';

import { requireChallengeWhenSuspicious } from '../middleware/challenge.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { restrictSignedInLinkCreation } from '../middleware/signed-in-link-creation.js';
import { validateBody } from '../middleware/validate.js';

const byNetwork = (req) => ({ network: req.clientNetwork });

// POST /api/v1/links (api-contracts.md, "Links"). The middleware order matters:
//   session + CSRF   a stale or unknown session cookie fails here; it never becomes a guest
//   signed-in check  accounts must be active and verified
//   quota            counted before validation, so invalid attempts are limited too
//   validation       strict guest schema: only destinationUrl and challengeToken
//   challenge        only when the risk policy flags the network; never replaces the quota
export function createLinksRouter({ controller, guards, limiter, challengeGuard }) {
  const router = Router();

  router.post(
    '/api/v1/links',
    guards.session,
    guards.csrf,
    restrictSignedInLinkCreation(guards),
    rateLimit(limiter, 'guestCreate', byNetwork),
    validateBody(GuestCreateLinkRequestSchema),
    requireChallengeWhenSuspicious({
      limiter,
      guard: challengeGuard,
      riskPolicy: 'guestCreateRisk',
      action: GUEST_CREATE_CHALLENGE_ACTION,
      subjectsOf: byNetwork,
    }),
    controller.createGuestLink,
  );

  return router;
}
