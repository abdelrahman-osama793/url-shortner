import { DeleteAccountRequestSchema } from '@shortlist/contracts';
import { Router } from 'express';

import { rateLimit } from '../middleware/rate-limit.js';
import { validateBody } from '../middleware/validate.js';

const byUser = (req) => ({ user: req.user.id });

// Closing an account (api-contracts.md, "Account closure"). Both need CSRF and a recent sign-in.
//
//   POST   /api/v1/account/deactivate   → 204, signed out; signing in again reactivates
//   DELETE /api/v1/account  { email }   → 204, account and its data deleted, signed out
export function createAccountRouter({ controller, guards, limiter, recentAuthMs }) {
  const router = Router();

  const closing = [guards.session, guards.csrf, guards.user, guards.recentAuth(recentAuthMs), rateLimit(limiter, 'accountClose', byUser)];

  router.post('/api/v1/account/deactivate', ...closing, controller.deactivate);
  router.delete('/api/v1/account', ...closing, validateBody(DeleteAccountRequestSchema), controller.deleteAccount);

  return router;
}
