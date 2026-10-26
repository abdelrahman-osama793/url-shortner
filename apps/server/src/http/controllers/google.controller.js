import { ERROR_CODES } from '@shortlist/contracts';

import { AppError, serviceUnavailableError } from '../../errors.js';
import { toUserResource } from '../../modules/accounts/accounts.presenter.js';
import { GoogleAttemptsUnavailableError } from '../../modules/accounts/google-attempts.service.js';
import { SessionUnavailableError } from '../../modules/sessions/sessions.service.js';
import { setSessionCookie } from '../middleware/session.js';

// Google sign-in endpoints: start an attempt, then exchange Google's credential for a session.

function toUnavailable(error) {
  const unavailable = error instanceof SessionUnavailableError || error instanceof GoogleAttemptsUnavailableError;

  return unavailable ? serviceUnavailableError({ cause: error }) : error;
}

export function createGoogleController({ googleAttempts, googleSignIn, sessionService }) {
  // Linking and re-authentication act on the signed-in account, so they need a user session.
  // Sign-in only needs the browser's (anonymous) session, which the attempt is bound to.
  async function start(req, res, next) {
    const { purpose } = req.body;

    if (purpose !== 'login' && !req.session.userId) {
      return next(new AppError(401, ERROR_CODES.AUTHENTICATION_REQUIRED, 'Please sign in to continue.'));
    }

    try {
      const attempt = await googleAttempts.create({
        purpose,
        sessionToken: req.sessionToken,
        userId: req.session.userId ?? null,
      });

      res.json(attempt);
    } catch (error) {
      next(toUnavailable(error));
    }
  }

  // Like password sign-in: a valid proof always gets a brand-new session and CSRF token.
  async function signIn(req, res, next) {
    const user = await googleSignIn.signIn({ ...req.body, sessionToken: req.sessionToken });

    try {
      const { token, session } = await sessionService.rotate(req.sessionToken, {
        id: user.id,
        role: user.role,
        sessionVersion: user.session_version,
      });

      setSessionCookie(res, token, session);
      res.json({ user: toUserResource(user), csrfToken: session.csrfToken });
    } catch (error) {
      next(toUnavailable(error));
    }
  }

  return { start, signIn };
}
