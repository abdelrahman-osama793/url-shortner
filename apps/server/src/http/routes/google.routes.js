import { GoogleSignInRequestSchema, GoogleStartRequestSchema } from '@shortlist/contracts';
import { Router } from 'express';

import { rateLimit } from '../middleware/rate-limit.js';
import { validateBody } from '../middleware/validate.js';

const byNetwork = (req) => ({ network: req.clientNetwork });

// Google Identity Services sign-in (api-contracts.md, "Authentication"). Mounted only when
// GOOGLE_CLIENT_ID is configured.
//   POST /api/v1/auth/google/start  { purpose }               → { attemptId, nonce, clientId }
//   POST /api/v1/auth/google        { attemptId, credential } → { user, csrfToken } + new session
//   POST /api/v1/auth/google/link   { attemptId, credential } → 204; signed in + recent auth
//   POST /api/v1/auth/google/reauthenticate                    → 204; the account's own Google only
export function createGoogleRouter({ controller, guards, limiter, recentAuthMs }) {
  const router = Router();

  const preLogin = [guards.session, guards.csrf];

  router.post(
    '/api/v1/auth/google/start',
    ...preLogin,
    validateBody(GoogleStartRequestSchema),
    rateLimit(limiter, 'googleAttempt', byNetwork),
    controller.start,
  );

  router.post('/api/v1/auth/google', ...preLogin, validateBody(GoogleSignInRequestSchema), controller.signIn);

  // Linking changes how the account can be entered, so the account itself must have been proven
  // recently (password or Google sign-in, or /auth/reauthenticate) as well as the Google account.
  router.post(
    '/api/v1/auth/google/link',
    ...preLogin,
    guards.user,
    guards.recentAuth(recentAuthMs),
    validateBody(GoogleSignInRequestSchema),
    controller.link,
  );

  router.post(
    '/api/v1/auth/google/reauthenticate',
    ...preLogin,
    guards.user,
    validateBody(GoogleSignInRequestSchema),
    controller.reauthenticate,
  );

  return router;
}
