import { timingSafeEqual } from 'node:crypto';

import { ERROR_CODES } from '@shortlist/contracts';

import { AppError, serviceUnavailableError } from '../../errors.js';
import { findUserById } from '../../modules/accounts/accounts.repository.js';
import { SessionUnavailableError } from '../../modules/sessions/sessions.service.js';

// Session, CSRF and authorization guards for /api/v1 routes. Routes compose the guards they
// need, e.g. [guards.session, guards.csrf, guards.user, guards.verified].
// They are never mounted globally: redirects and health checks must not depend on Redis.

export const SESSION_COOKIE = '__Host-session';

// __Host- prefix: the browser only accepts this cookie with Secure, Path=/ and no Domain,
// so a sibling subdomain cannot set or overwrite it. Browsers treat http://localhost as
// secure, so this also works in local development.
const COOKIE_OPTIONS = Object.freeze({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const authenticationRequired = () => new AppError(401, ERROR_CODES.AUTHENTICATION_REQUIRED, 'Please sign in to continue.');

function readCookie(req, name) {
  const header = req.get('Cookie');

  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');

    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }

  return null;
}

export function setSessionCookie(res, token, session) {
  res.cookie(SESSION_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: session.absoluteExpiresAt - session.createdAt });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
}

function tokensMatch(expected, actual) {
  if (typeof actual !== 'string') return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(actual);

  return a.length === b.length && timingSafeEqual(a, b);
}

export function createAuthGuards({ sessionService, pool }) {
  // Loads the session named by the cookie. Sets:
  //   req.sessionToken, req.session (or null) and
  //   req.sessionState: 'none' (no cookie) | 'valid' | 'invalid' (unknown or expired) | 'unavailable'
  // It never rejects by itself; the guards below decide what each state means.
  async function session(req, _res, next) {
    req.sessionToken = readCookie(req, SESSION_COOKIE);
    req.session = null;

    if (!req.sessionToken) {
      req.sessionState = 'none';
      return next();
    }

    try {
      req.session = await sessionService.get(req.sessionToken);
      req.sessionState = req.session ? 'valid' : 'invalid';
      next();
    } catch (error) {
      if (!(error instanceof SessionUnavailableError)) return next(error);

      req.sessionState = 'unavailable';
      req.sessionError = error;
      next();
    }
  }

  // Synchronizer-token CSRF check for state-changing requests, including pre-login ones.
  // Runs in addition to the global Origin check.
  function csrf(req, _res, next) {
    if (SAFE_METHODS.has(req.method)) return next();

    if (req.sessionState === 'unavailable') return next(serviceUnavailableError({ cause: req.sessionError }));

    if (!req.session || !tokensMatch(req.session.csrfToken, req.get('X-CSRF-Token'))) {
      return next(new AppError(403, ERROR_CODES.CSRF_INVALID, 'Your session has expired. Refresh the page and try again.'));
    }

    next();
  }

  // Best-effort cleanup of a session the users row has already invalidated (revoked or
  // suspended). If Redis fails here the session is still unusable, and its TTL removes it.
  async function discardRejectedSession(req, res) {
    clearSessionCookie(res);

    try {
      await sessionService.destroy(req.sessionToken);
    } catch {
      // Intentionally ignored: see above.
    }
  }

  // Requires a signed-in user whose account is still active and whose session version is
  // current. Both are read from PostgreSQL on every protected request, so suspension and
  // password-reset revocation take effect immediately (technical-design §4).
  async function user(req, res, next) {
    if (req.sessionState === 'unavailable') return next(serviceUnavailableError({ cause: req.sessionError }));

    if (req.sessionState === 'invalid') clearSessionCookie(res);

    if (!req.session?.userId) return next(authenticationRequired());

    let row;

    try {
      row = await findUserById(pool, req.session.userId);
    } catch (error) {
      return next(serviceUnavailableError({ cause: error }));
    }

    if (!row || row.session_version !== req.session.sessionVersion) {
      await discardRejectedSession(req, res);
      return next(authenticationRequired());
    }

    if (row.status !== 'active') {
      await discardRejectedSession(req, res);
      return next(new AppError(403, ERROR_CODES.ACCOUNT_SUSPENDED, 'This account is suspended.'));
    }

    req.user = row;
    next();
  }

  // Registered link features need a verified email (technical-design §4, "Create a link").
  function verified(req, _res, next) {
    if (!req.user?.email_verified_at) {
      return next(new AppError(403, ERROR_CODES.EMAIL_NOT_VERIFIED, 'Please verify your email address first.'));
    }

    next();
  }

  // Role comes from the current users row, never from the session or the request.
  function admin(req, _res, next) {
    if (req.user?.role !== 'admin') {
      return next(new AppError(403, ERROR_CODES.FORBIDDEN, 'You do not have permission to do that.'));
    }

    next();
  }

  // Destructive or identity-changing actions need a password or Google proof within the window.
  function recentAuth(windowMs) {
    return (req, _res, next) => {
      const recentAuthAt = req.session?.recentAuthAt ?? 0;

      if (Date.now() - recentAuthAt > windowMs) {
        return next(new AppError(403, ERROR_CODES.REAUTHENTICATION_REQUIRED, 'Please confirm your identity to continue.'));
      }

      next();
    };
  }

  return { session, csrf, user, verified, admin, recentAuth };
}

// A private resource owned by someone else is reported as missing (api-contracts.md), so its
// existence is not revealed.
export function isOwnedBy(resourceOwnerId, user) {
  return Boolean(user) && resourceOwnerId === user.id;
}
