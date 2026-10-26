import { GoogleSignInRequestSchema, GoogleStartRequestSchema } from '@shortlist/contracts';
import { Router } from 'express';

import { rateLimit } from '../middleware/rate-limit.js';
import { validateBody } from '../middleware/validate.js';

const byNetwork = (req) => ({ network: req.clientNetwork });

// Google Identity Services sign-in (api-contracts.md, "Authentication"). Mounted only when
// GOOGLE_CLIENT_ID is configured.
//   POST /api/v1/auth/google/start  { purpose }               → { attemptId, nonce }
//   POST /api/v1/auth/google        { attemptId, credential } → { user, csrfToken } + new session
// Account linking and re-authentication endpoints are T16.
export function createGoogleRouter({ controller, guards, limiter }) {
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

  return router;
}
