import { ERROR_CODES } from '@shortlist/contracts';

import { AppError, validationError } from '../../errors.js';
import { withTransaction } from '../../infra/postgres.js';

import * as repository from './account-closure.repository.js';
import { normalizeEmail } from './rules/email.js';

// Closing an account (T45, owner-approved 4 Nov 2026). Routes require a signed-in, recently
// authenticated user and CSRF; this service enforces the rest.
//
//   deactivate  pauses the account: every session ends and every link answers 410. Nothing is
//               deleted, and signing in again reactivates it.
//   delete      removes the account and everything it owns (see account-closure.repository.js).
//               Codes are retired, never reused. Moderation records are kept.
//
// Both take the account-status lock, like admin suspensions, so the last active administrator
// can never close their account, and administrators cannot delete theirs at all (the role is
// removed by an operator first, then the person can delete the account).

const lastAdminError = () => new AppError(409, ERROR_CODES.LAST_ACTIVE_ADMIN, 'You are the last active administrator, so this account must stay active.');

export function createAccountClosureService({ pool, logger }) {
  async function deactivate({ userId }) {
    await withTransaction(pool, async (client) => {
      await repository.lockAccountStatus(client);

      const user = await repository.findUserForUpdate(client, userId);

      if (user.role === 'admin' && (await repository.countOtherActiveAdmins(client, userId)) === 0) throw lastAdminError();

      await repository.deactivate(client, userId);
    }, { logger });

    logger?.info({ userId }, 'account deactivated by its owner');
  }

  // `email` is the confirmation the person typed; it must be this account's address.
  async function deleteAccount({ userId, email }) {
    const result = await withTransaction(pool, async (client) => {
      await repository.lockAccountStatus(client);

      const user = await repository.findUserForUpdate(client, userId);

      if (normalizeEmail(email) !== user.email_normalized) {
        throw validationError([{ path: 'email', message: "That isn't your account email." }]);
      }

      if (user.role === 'admin') {
        throw new AppError(403, ERROR_CODES.FORBIDDEN, 'Administrators can’t delete their account. Ask an operator to remove the admin role first.');
      }

      const removed = await repository.deleteOwnedData(client, userId);

      return { removed, user: await repository.deleteOrAnonymizeUser(client, userId) };
    }, { logger });

    // Counts only: no identifiers beyond the internal id.
    logger?.info({ userId, ...result }, 'account deleted by its owner');

    return result;
  }

  return { deactivate, deleteAccount };
}
