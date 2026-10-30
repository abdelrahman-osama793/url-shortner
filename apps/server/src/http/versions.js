import { ERROR_CODES } from '@shortlist/contracts';

import { AppError } from '../errors.js';

// Links carry their version as a strong ETag ("v3"); edits by owners and admins send it back in
// If-Match, so a change made in the meantime is answered 412 instead of being overwritten.

export const etagOf = (link) => `"v${link.version}"`;

// Returns the version number from `If-Match: "v3"`, or throws 428 when it is missing or malformed.
export function expectedVersion(req) {
  const match = /^"v([1-9][0-9]{0,9})"$/.exec(req.get('If-Match') ?? '');

  if (!match) {
    throw new AppError(428, ERROR_CODES.PRECONDITION_REQUIRED, 'Send the If-Match header with the version you are editing.');
  }

  return Number(match[1]);
}
