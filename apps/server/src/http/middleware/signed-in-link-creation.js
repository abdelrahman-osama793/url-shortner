import { ERROR_CODES } from '@shortlist/contracts';

import { AppError } from '../../errors.js';

// Signed-in users never receive a guest link. Their account must be active and verified
// (unverified accounts are restricted, T13); registered creation itself is T17, so until then
// a verified user gets an honest "not implemented". Anonymous sessions continue as guests.
export function restrictSignedInLinkCreation(guards) {
  return (req, res, next) => {
    if (!req.session?.userId) return next();

    guards.user(req, res, (userError) => {
      if (userError) return next(userError);

      guards.verified(req, res, (verifiedError) => {
        next(verifiedError ?? new AppError(501, ERROR_CODES.NOT_IMPLEMENTED, 'Creating links from an account is not available yet.'));
      });
    });
  };
}
