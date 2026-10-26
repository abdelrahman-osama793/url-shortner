import {
  LoginRequestSchema,
  RegisterRequestSchema,
  ResendVerificationRequestSchema,
  VerifyEmailRequestSchema,
} from '@shortlist/contracts';
import { Router } from 'express';

import { serviceUnavailableError } from '../../errors.js';
import { normalizeEmail } from '../../modules/accounts/email.js';
import { toUserResource } from '../../modules/accounts/repository.js';
import { SessionUnavailableError } from '../../modules/sessions/store.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { clearSessionCookie, setSessionCookie } from '../middleware/session.js';
import { validateBody } from '../middleware/validate.js';

// Authentication endpoints (api-contracts.md, "Authentication"). Every state change, including
// sign-up and sign-in, needs the CSRF token of the browser's (anonymous) session.
//
//   GET  /api/v1/auth/csrf          CSRF token; creates an anonymous session if needed
//   POST /api/v1/auth/register      202 always (no account discovery)
//   POST /api/v1/auth/email/verify  204, or 400 TOKEN_INVALID / TOKEN_EXPIRED / TOKEN_USED
//   POST /api/v1/auth/email/resend  202 always
//   POST /api/v1/auth/login         200 { user, csrfToken } with a new session; generic 401
//   GET  /api/v1/auth/me            the signed-in user
//   POST /api/v1/auth/logout        204 once the server session is deleted
//
// Rate limits run after validation on these routes because the per-account bucket needs the
// email from the body.

const ACCEPTED = Object.freeze({ status: 'accepted' });

const byAccountAndNetwork = (req) => ({ account: normalizeEmail(req.body.email), network: req.clientNetwork });

function toSessionUnavailable(error) {
  return error instanceof SessionUnavailableError ? serviceUnavailableError({ cause: error }) : error;
}

export function createAuthRouter({ store, guards, limiter, accountService }) {
  const router = Router();

  const preLogin = [guards.session, guards.csrf];

  router.get('/api/v1/auth/csrf', guards.session, async (req, res, next) => {
    if (req.sessionState === 'valid') {
      return res.json({ csrfToken: req.session.csrfToken });
    }

    try {
      const { token, session } = await store.create();

      setSessionCookie(res, token, session);
      res.json({ csrfToken: session.csrfToken });
    } catch (error) {
      next(toSessionUnavailable(error));
    }
  });

  router.post(
    '/api/v1/auth/register',
    ...preLogin,
    validateBody(RegisterRequestSchema),
    rateLimit(limiter, 'accountEmail', byAccountAndNetwork),
    async (req, res) => {
      await accountService.register(req.body);

      res.status(202).json(ACCEPTED);
    },
  );

  router.post('/api/v1/auth/email/verify', ...preLogin, validateBody(VerifyEmailRequestSchema), async (req, res) => {
    await accountService.verifyEmail(req.body);

    res.status(204).end();
  });

  router.post(
    '/api/v1/auth/email/resend',
    ...preLogin,
    validateBody(ResendVerificationRequestSchema),
    rateLimit(limiter, 'accountEmail', byAccountAndNetwork),
    async (req, res) => {
      await accountService.resendVerification(req.body);

      res.status(202).json(ACCEPTED);
    },
  );

  // A successful sign-in always gets a brand-new session and CSRF token (no session fixation).
  // Unverified users get a normal, restricted session: they can verify and sign out, but
  // registered link features answer 403 EMAIL_NOT_VERIFIED.
  router.post(
    '/api/v1/auth/login',
    ...preLogin,
    validateBody(LoginRequestSchema),
    rateLimit(limiter, 'login', byAccountAndNetwork),
    async (req, res, next) => {
      const user = await accountService.authenticate(req.body);

      try {
        const { token, session } = await store.rotate(req.sessionToken, {
          id: user.id,
          role: user.role,
          sessionVersion: user.session_version,
        });

        setSessionCookie(res, token, session);
        res.json({ user: toUserResource(user), csrfToken: session.csrfToken });
      } catch (error) {
        next(toSessionUnavailable(error));
      }
    },
  );

  router.get('/api/v1/auth/me', guards.session, guards.user, (req, res) => {
    res.json({ user: toUserResource(req.user) });
  });

  // Succeeds only once the server-side session is really gone; a failed delete is a 503,
  // never a false "logged out".
  router.post('/api/v1/auth/logout', ...preLogin, async (req, res, next) => {
    try {
      await store.destroy(req.sessionToken);
    } catch (error) {
      return next(toSessionUnavailable(error));
    }

    clearSessionCookie(res);
    res.status(204).end();
  });

  return router;
}
