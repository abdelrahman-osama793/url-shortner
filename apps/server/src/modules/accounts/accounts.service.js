import { ERROR_CODES } from '@shortlist/contracts';

import { AppError } from '../../errors.js';
import { withTransaction } from '../../infra/postgres.js';

import { normalizeEmail } from './rules/email.js';
import { hashPassword, verifyPassword } from './rules/passwords.js';
import * as repository from './accounts.repository.js';
import { consumeToken, issueTokenWithEmail, TOKEN_PURPOSES } from './tokens.service.js';

// Email/password accounts (decisions D05, D06; api-contracts.md, "Authentication").
// Responses that could reveal whether an account exists (register, resend) look identical
// for every outcome; the HTTP layer always answers 202.

const TOKEN_ERRORS = {
  invalid: () => new AppError(400, ERROR_CODES.TOKEN_INVALID, 'This link is not valid. Request a new one.'),
  expired: () => new AppError(400, ERROR_CODES.TOKEN_EXPIRED, 'This link has expired. Request a new one.'),
  used: () => new AppError(400, ERROR_CODES.TOKEN_USED, 'This link has already been used.'),
};

export function createAccountService({ pool, outboxKey, tokenLifetimes, logger }) {
  function queueVerificationEmail(client, user) {
    return issueTokenWithEmail(client, {
      key: outboxKey,
      user,
      purpose: TOKEN_PURPOSES.verification,
      lifetimeMs: tokenLifetimes.verificationMs,
    });
  }

  // Creates an account with a verification email, or does nothing if the email is taken.
  // The password is hashed first in both cases, so timing does not reveal existing accounts,
  // and an existing account's credentials are never overwritten.
  async function register({ email, password }) {
    const passwordHash = await hashPassword(password);
    const emailNormalized = normalizeEmail(email);

    const created = await withTransaction(pool, async (client) => {
      const user = await repository.insertUserWithPassword(client, { email: email.trim(), emailNormalized, passwordHash });

      if (user) await queueVerificationEmail(client, user);

      return Boolean(user);
    }, { logger });

    logger?.info({ created }, 'registration processed');
  }

  // Consumes a verification token and marks the email verified. Does not sign anyone in.
  async function verifyEmail({ token }) {
    await withTransaction(pool, async (client) => {
      const result = await consumeToken(client, { token, purpose: TOKEN_PURPOSES.verification });

      if (!result.ok) throw TOKEN_ERRORS[result.reason]();

      await repository.markEmailVerified(client, result.userId);
    }, { logger });
  }

  // Sends a fresh verification link only to an existing, active, unverified password account.
  // Issuing it revokes earlier links. Silent in every other case.
  async function resendVerification({ email }) {
    await withTransaction(pool, async (client) => {
      const user = await repository.findUserWithPasswordByEmail(client, normalizeEmail(email));

      const eligible = user && user.password_hash && !user.email_verified_at && user.status === 'active';

      if (eligible) await queueVerificationEmail(client, user);
    }, { logger });
  }

  // Emails a reset link only to an existing, active account that has a password. Silent in
  // every other case; issuing a link revokes earlier reset links.
  async function requestPasswordReset({ email }) {
    await withTransaction(pool, async (client) => {
      const user = await repository.findUserWithPasswordByEmail(client, normalizeEmail(email));

      if (!user || !user.password_hash || user.status !== 'active') return;

      await issueTokenWithEmail(client, {
        key: outboxKey,
        user,
        purpose: TOKEN_PURPOSES.reset,
        lifetimeMs: tokenLifetimes.resetMs,
      });
    }, { logger });
  }

  // Consumes the reset token, sets the new password and signs out every existing session, in
  // one transaction. The new password is hashed first so the transaction stays short.
  async function resetPassword({ token, newPassword }) {
    const passwordHash = await hashPassword(newPassword);

    await withTransaction(pool, async (client) => {
      const result = await consumeToken(client, { token, purpose: TOKEN_PURPOSES.reset });

      if (!result.ok) throw TOKEN_ERRORS[result.reason]();

      const changed = await repository.resetPasswordAndRevokeSessions(client, result.userId, passwordHash);

      if (!changed) throw TOKEN_ERRORS.invalid();
    }, { logger });

    logger?.info('password reset completed');
  }

  // Returns the user row for valid credentials, otherwise throws a generic 401. Wrong email,
  // wrong password and Google-only accounts are indistinguishable (same error, similar time).
  // A correct password for a suspended account gets 403: the caller already proved ownership.
  async function authenticate({ email, password }) {
    const user = await repository.findUserWithPasswordByEmail(pool, normalizeEmail(email));
    const { valid, rehash } = await verifyPassword(user?.password_hash ?? null, password);

    if (!valid) {
      throw new AppError(401, ERROR_CODES.INVALID_CREDENTIALS, 'The email or password is incorrect.');
    }

    if (user.status !== 'active') {
      throw new AppError(403, ERROR_CODES.ACCOUNT_SUSPENDED, 'This account is suspended.');
    }

    if (rehash) await repository.updatePasswordHash(pool, user.id, rehash);

    return user;
  }

  // Recent authentication with the current password, for a signed-in user (T16). Same Argon2
  // check as sign-in; a Google-only account has no password to confirm with.
  async function reauthenticate({ userId, password }) {
    const passwordHash = await repository.findPasswordHash(pool, userId);

    if (!passwordHash) {
      throw new AppError(401, ERROR_CODES.INVALID_CREDENTIALS, 'This account has no password. Confirm with Google instead.');
    }

    const { valid, rehash } = await verifyPassword(passwordHash, password);

    if (!valid) throw new AppError(401, ERROR_CODES.INVALID_CREDENTIALS, 'The password is incorrect.');

    if (rehash) await repository.updatePasswordHash(pool, userId, rehash);
  }

  async function signInMethods(userId) {
    return repository.findSignInMethods(pool, userId);
  }

  return { register, verifyEmail, resendVerification, requestPasswordReset, resetPassword, authenticate, reauthenticate, signInMethods };
}
