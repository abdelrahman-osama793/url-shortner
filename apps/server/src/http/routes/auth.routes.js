import {
  ForgotPasswordRequestSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  ResendVerificationRequestSchema,
  ReauthenticateRequestSchema,
  ResetPasswordRequestSchema,
  VerifyEmailRequestSchema,
} from '@shortlist/contracts';
import { Router } from 'express';

import { normalizeEmail } from '../../modules/accounts/rules/email.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { validateBody } from '../middleware/validate.js';

// Authentication endpoints (api-contracts.md, "Authentication"). Every state change, including
// sign-up and sign-in, needs the CSRF token of the browser's (anonymous) session.
//
//   GET  /api/v1/auth/csrf             CSRF token; creates an anonymous session if needed
//   POST /api/v1/auth/register         202 always (no account discovery)
//   POST /api/v1/auth/email/verify     204, or 400 TOKEN_INVALID / TOKEN_EXPIRED / TOKEN_USED
//   POST /api/v1/auth/email/resend     202 always
//   POST /api/v1/auth/password/forgot  202 always
//   POST /api/v1/auth/password/reset   204; signs out every existing session of the account
//   POST /api/v1/auth/login            200 { user, csrfToken } with a new session; generic 401
//   GET  /api/v1/auth/me               the signed-in user
//   POST /api/v1/auth/reauthenticate   204 after the current password; starts the recent-auth window
//   POST /api/v1/auth/logout           204 once the server session is deleted
//
// Rate limits run after validation here because the per-account bucket needs the email.

const byAccountAndNetwork = (req) => ({ account: normalizeEmail(req.body.email), network: req.clientNetwork });
const bySignedInAccount = (req) => ({ account: normalizeEmail(req.user.email), network: req.clientNetwork });

export function createAuthRouter({ controller, guards, limiter }) {
  const router = Router();

  const preLogin = [guards.session, guards.csrf];
  const accountEmailLimit = rateLimit(limiter, 'accountEmail', byAccountAndNetwork);

  router.get('/api/v1/auth/csrf', guards.session, controller.csrf);

  router.post('/api/v1/auth/register', ...preLogin, validateBody(RegisterRequestSchema), accountEmailLimit, controller.register);
  router.post('/api/v1/auth/email/verify', ...preLogin, validateBody(VerifyEmailRequestSchema), controller.verifyEmail);
  router.post('/api/v1/auth/email/resend', ...preLogin, validateBody(ResendVerificationRequestSchema), accountEmailLimit, controller.resendVerification);

  router.post('/api/v1/auth/password/forgot', ...preLogin, validateBody(ForgotPasswordRequestSchema), accountEmailLimit, controller.forgotPassword);
  router.post('/api/v1/auth/password/reset', ...preLogin, validateBody(ResetPasswordRequestSchema), controller.resetPassword);

  router.post(
    '/api/v1/auth/login',
    ...preLogin,
    validateBody(LoginRequestSchema),
    rateLimit(limiter, 'login', byAccountAndNetwork),
    controller.login,
  );

  // Password guesses here count against the same sign-in limits as /auth/login.
  router.post(
    '/api/v1/auth/reauthenticate',
    ...preLogin,
    guards.user,
    validateBody(ReauthenticateRequestSchema),
    rateLimit(limiter, 'login', bySignedInAccount),
    controller.reauthenticate,
  );

  router.get('/api/v1/auth/me', guards.session, guards.user, controller.me);
  router.post('/api/v1/auth/logout', ...preLogin, controller.logout);

  return router;
}
