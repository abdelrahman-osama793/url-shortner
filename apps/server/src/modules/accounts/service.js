import { ERROR_CODES } from '@shortlist/contracts';

import { AppError } from '../../errors.js';
import { withTransaction } from '../../infra/postgres.js';

import { normalizeEmail } from './email.js';
import { hashPassword, verifyPassword } from './passwords.js';
import * as repository from './repository.js';
import { consumeToken, issueTokenWithEmail, TOKEN_PURPOSES } from './tokens.js';

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

  return { register, verifyEmail, resendVerification, authenticate };
}
