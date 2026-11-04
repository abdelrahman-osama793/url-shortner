import { clearSessionCookie } from '../middleware/session.js';

// Closing an account (T45). The account change has committed before the session is ended, so
// a session-store error afterwards cannot undo it; the session is unusable anyway (the account
// is inactive or gone), and the cookie is cleared regardless.
export function createAccountController({ accountClosure, sessionService, logger }) {
  async function endSession(req, res) {
    try {
      await sessionService.destroy(req.sessionToken);
    } catch (error) {
      logger?.warn({ err: error }, 'session not deleted after closing an account; it is already unusable');
    }

    clearSessionCookie(res);
    res.status(204).end();
  }

  async function deactivate(req, res) {
    await accountClosure.deactivate({ userId: req.user.id });
    await endSession(req, res);
  }

  async function deleteAccount(req, res) {
    await accountClosure.deleteAccount({ userId: req.user.id, email: req.body.email });
    await endSession(req, res);
  }

  return { deactivate, deleteAccount };
}
