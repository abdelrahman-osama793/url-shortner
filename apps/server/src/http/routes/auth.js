import { Router } from 'express';

import { serviceUnavailableError } from '../../errors.js';
import { toUserResource } from '../../modules/accounts/repository.js';
import { SessionUnavailableError } from '../../modules/sessions/store.js';
import { clearSessionCookie, setSessionCookie } from '../middleware/session.js';

// Session endpoints available before any sign-in method exists (api-contracts.md):
//   GET  /api/v1/auth/csrf    returns the CSRF token, creating an anonymous session if needed
//   GET  /api/v1/auth/me      the signed-in user
//   POST /api/v1/auth/logout  ends the session (CSRF protected)
// Sign-in endpoints that create user sessions arrive with T13 (password) and T15 (Google).
export function createAuthRouter({ store, guards }) {
  const router = Router();

  router.get('/api/v1/auth/csrf', guards.session, async (req, res, next) => {
    if (req.sessionState === 'valid') {
      return res.json({ csrfToken: req.session.csrfToken });
    }

    try {
      const { token, session } = await store.create();

      setSessionCookie(res, token, session);
      res.json({ csrfToken: session.csrfToken });
    } catch (error) {
      next(error instanceof SessionUnavailableError ? serviceUnavailableError({ cause: error }) : error);
    }
  });

  router.get('/api/v1/auth/me', guards.session, guards.user, (req, res) => {
    res.json({ user: toUserResource(req.user) });
  });

  // Succeeds only once the server-side session is really gone; a failed delete is a 503,
  // never a false "logged out".
  router.post('/api/v1/auth/logout', guards.session, guards.csrf, async (req, res, next) => {
    try {
      await store.destroy(req.sessionToken);
    } catch (error) {
      return next(error instanceof SessionUnavailableError ? serviceUnavailableError({ cause: error }) : error);
    }

    clearSessionCookie(res);
    res.status(204).end();
  });

  return router;
}
