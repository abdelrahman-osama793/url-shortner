import { ERROR_CODES } from '@shortlist/contracts';

import { AppError, serviceUnavailableError } from '../../errors.js';
import { withTransaction } from '../../infra/postgres.js';

import * as accountsRepository from './accounts.repository.js';
import { GoogleAttemptsUnavailableError } from './google-attempts.service.js';
import { GoogleCredentialRejectedError, GoogleUnavailableError } from './google-identity.service.js';
import { normalizeEmail } from './rules/email.js';
import { issueTokenWithEmail, TOKEN_PURPOSES } from './tokens.service.js';

// Google sign-in (decisions D05, D06; technical-design §4, "Sign in").
//
//   1. The attempt must exist, be for this purpose and come from the same browser session.
//   2. Google's ID token must be valid for our client ID and carry the attempt's nonce.
//   3. Accounts are found by Google subject only, never by email. If the Google email matches
//      an existing account, the answer is 409 ACCOUNT_LINK_REQUIRED: the user signs in to that
//      account and links Google explicitly (T16). This happens only after a valid Google proof.
//   4. A new Google identity gets a new password-less account. Google's email counts as
//      verified only where Google is authoritative for it (gmail.com, googlemail.com, or a
//      Workspace domain, signalled by the hd claim); otherwise the account is restricted until
//      the contact email is verified through our own email link.

const GOOGLE = 'google';
const GOOGLE_MAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

const signInFailed = () => new AppError(401, ERROR_CODES.GOOGLE_SIGN_IN_FAILED, 'Google sign-in failed. Please try again.');

function isEmailAuthoritative(profile, emailNormalized) {
  if (!profile.emailVerified) return false;

  const domain = emailNormalized.slice(emailNormalized.lastIndexOf('@') + 1);

  return GOOGLE_MAIL_DOMAINS.has(domain) || Boolean(profile.hostedDomain);
}

export function createGoogleSignInService({ pool, attempts, identity, outboxKey, tokenLifetimes, logger }) {
  // Turns attempt and token problems into the one generic 401, and outages into 503.
  async function verifyAttempt({ attemptId, credential, sessionToken, purpose }) {
    try {
      const attempt = await attempts.consume(attemptId, { purpose, sessionToken });

      if (!attempt) throw signInFailed();

      const profile = await identity.verify(credential, { nonce: attempt.nonce });

      return { attempt, profile };
    } catch (error) {
      if (error instanceof GoogleCredentialRejectedError) {
        logger?.info({ reason: error.reason }, 'google credential rejected');
        throw signInFailed();
      }

      if (error instanceof GoogleUnavailableError || error instanceof GoogleAttemptsUnavailableError) {
        throw serviceUnavailableError({ cause: error });
      }

      throw error;
    }
  }

  async function createGoogleAccount(client, profile, emailNormalized) {
    const emailVerified = isEmailAuthoritative(profile, emailNormalized);

    const user = await accountsRepository.insertUserWithoutPassword(client, {
      email: profile.email,
      emailNormalized,
      emailVerified,
    });

    if (!user) return null;

    await accountsRepository.insertIdentity(client, { userId: user.id, provider: GOOGLE, subject: profile.subject });

    if (!emailVerified) {
      await issueTokenWithEmail(client, {
        key: outboxKey,
        user,
        purpose: TOKEN_PURPOSES.verification,
        lifetimeMs: tokenLifetimes.verificationMs,
      });
    }

    logger?.info({ emailVerified }, 'google account created');

    return user;
  }

  // Finds the account for this Google identity, or creates one. Serialised per Google subject.
  async function findOrCreateAccount(profile) {
    if (!profile.email) throw signInFailed();

    const emailNormalized = normalizeEmail(profile.email);

    return withTransaction(pool, async (client) => {
      await accountsRepository.lockIdentity(client, { provider: GOOGLE, subject: profile.subject });

      const linked = await accountsRepository.findUserByIdentity(client, { provider: GOOGLE, subject: profile.subject });

      if (linked) return linked;

      const created = await createGoogleAccount(client, profile, emailNormalized);

      if (!created) {
        throw new AppError(409, ERROR_CODES.ACCOUNT_LINK_REQUIRED,
          'An account with this email already exists. Sign in with your password, then link Google from your account settings.');
      }

      return created;
    }, { logger });
  }

  // Returns the user row to start a session for. Suspended accounts are refused after the
  // Google proof, like password sign-in.
  async function signIn({ attemptId, credential, sessionToken }) {
    const { profile } = await verifyAttempt({ attemptId, credential, sessionToken, purpose: 'login' });
    const user = await findOrCreateAccount(profile);

    if (user.status !== 'active') {
      throw new AppError(403, ERROR_CODES.ACCOUNT_SUSPENDED, 'This account is suspended.');
    }

    return user;
  }

  return { signIn, verifyAttempt };
}
