import { serviceUnavailableError } from '../../errors.js';
import { toUserResource } from '../../modules/accounts/accounts.presenter.js';
import { SessionUnavailableError } from '../../modules/sessions/sessions.service.js';
import { clearSessionCookie, setSessionCookie } from '../middleware/session.js';

// Authentication endpoints: read the validated request, call the account or session service,
// send the result. Answers that could reveal whether an account exists (register, resend,
// forgot) are the same for every outcome.

const ACCEPTED = Object.freeze({ status: 'accepted' });

function toSessionUnavailable(error) {
  return error instanceof SessionUnavailableError ? serviceUnavailableError({ cause: error }) : error;
}

export function createAuthController({ sessionService, accountService }) {
  // Returns the session's CSRF token, creating an anonymous session first if needed.
  async function csrf(req, res, next) {
    if (req.sessionState === 'valid') {
      return res.json({ csrfToken: req.session.csrfToken });
    }

    try {
      const { token, session } = await sessionService.create();

      setSessionCookie(res, token, session);
      res.json({ csrfToken: session.csrfToken });
    } catch (error) {
      next(toSessionUnavailable(error));
    }
  }

  async function register(req, res) {
    await accountService.register(req.body);

    res.status(202).json(ACCEPTED);
  }

  async function verifyEmail(req, res) {
    await accountService.verifyEmail(req.body);

    res.status(204).end();
  }

  async function resendVerification(req, res) {
    await accountService.resendVerification(req.body);

    res.status(202).json(ACCEPTED);
  }

  async function forgotPassword(req, res) {
    await accountService.requestPasswordReset(req.body);

    res.status(202).json(ACCEPTED);
  }

  // Does not sign in: the user signs in with the new password, on a fresh session.
  async function resetPassword(req, res) {
    await accountService.resetPassword(req.body);

    res.status(204).end();
  }

  // A successful sign-in always gets a brand-new session and CSRF token (no session fixation).
  // Unverified users get a normal, restricted session.
  async function login(req, res, next) {
    const user = await accountService.authenticate(req.body);

    try {
      const { token, session } = await sessionService.rotate(req.sessionToken, {
        id: user.id,
        role: user.role,
        sessionVersion: user.session_version,
      });

      setSessionCookie(res, token, session);
      res.json({ user: toUserResource(user), csrfToken: session.csrfToken });
    } catch (error) {
      next(toSessionUnavailable(error));
    }
  }

  function me(req, res) {
    res.json({ user: toUserResource(req.user) });
  }

  // Succeeds only once the server-side session is really gone; a failed delete is a 503,
  // never a false "logged out".
  async function logout(req, res, next) {
    try {
      await sessionService.destroy(req.sessionToken);
    } catch (error) {
      return next(toSessionUnavailable(error));
    }

    clearSessionCookie(res);
    res.status(204).end();
  }

  return { csrf, register, verifyEmail, resendVerification, forgotPassword, resetPassword, login, me, logout };
}
