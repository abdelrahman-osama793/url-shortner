import {
  GUEST_CREATE_CHALLENGE_ACTION,
  GuestCreateLinkRequestSchema,
  ListLinksQuerySchema,
  RegisteredCreateLinkRequestSchema,
  UpdateLinkRequestSchema,
} from '@shortlist/contracts';
import { Router } from 'express';

import { requireChallengeWhenSuspicious } from '../middleware/challenge.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { validateBody, validateQuery } from '../middleware/validate.js';

const byNetwork = (req) => ({ network: req.clientNetwork });
const byUser = (req) => ({ user: req.user.id });
const byUserAndNetwork = (req) => ({ user: req.user.id, network: req.clientNetwork });

// Signed-in callers skip the guest route and continue to the registered one.
const anonymousOnly = (req, _res, next) => next(req.session?.userId ? 'route' : undefined);

// Links (api-contracts.md, "Links").
//   POST  /api/v1/links          guest: generated code, 7-day expiry, no management handle
//   POST  /api/v1/links          signed-in, verified: optional alias and expiry; 201 + ETag
//   GET   /api/v1/links          the owner's links, newest first, cursor-paginated
//   GET   /api/v1/links/:id      one owned link + ETag (others' links are 404)
//   PATCH /api/v1/links/:id      destination / expiry / enabled; needs If-Match
//
// Every /api/v1/links request loads the session and, for writes, checks CSRF first: a stale or
// unknown session cookie fails there and is never treated as a guest.
export function createLinksRouter({ controller, guards, limiter, challengeGuard }) {
  const router = Router();

  router.use('/api/v1/links', guards.session, guards.csrf);

  // Guest branch. Quota is counted before validation, so invalid attempts are limited too; the
  // challenge applies only when the network looks suspicious and never replaces the quota.
  router.post(
    '/api/v1/links',
    anonymousOnly,
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

  // Registered branch: active account with a verified email.
  router.post(
    '/api/v1/links',
    guards.user,
    guards.verified,
    rateLimit(limiter, 'registeredCreate', byUserAndNetwork),
    validateBody(RegisteredCreateLinkRequestSchema),
    controller.createOwnedLink,
  );

  router.get(
    '/api/v1/links',
    guards.user,
    rateLimit(limiter, 'memberRead', byUser),
    validateQuery(ListLinksQuerySchema),
    controller.listOwnedLinks,
  );

  router.get('/api/v1/links/:id', guards.user, rateLimit(limiter, 'memberRead', byUser), controller.getOwnedLink);

  router.patch(
    '/api/v1/links/:id',
    guards.user,
    guards.verified,
    rateLimit(limiter, 'linkUpdate', byUser),
    validateBody(UpdateLinkRequestSchema),
    controller.updateOwnedLink,
  );

  return router;
}
