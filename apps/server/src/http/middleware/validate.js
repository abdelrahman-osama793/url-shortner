import { ERROR_CODES } from '@shortlist/contracts';

import { AppError, validationError } from '../../errors.js';

// Converts zod issues into the public `fields` list. Only the path and zod's message are
// exposed, never the submitted value. Unknown keys are reported under their own names.
function toFieldErrors(issues) {
  return issues.flatMap((issue) => {
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        path: [...issue.path, key].join('.'),
        message: 'Unknown field.',
      }));
    }

    return [{ path: issue.path.join('.') || '(body)', message: issue.message }];
  });
}

// Replaces req.body with the parsed value, so handlers only ever see validated, typed data.
export function validateBody(schema) {
  return (req, _res, next) => {
    if (!req.is('application/json')) {
      return next(new AppError(415, ERROR_CODES.UNSUPPORTED_MEDIA_TYPE, 'Send the request body as application/json.'));
    }

    const result = schema.safeParse(req.body);

    if (!result.success) {
      return next(validationError(toFieldErrors(result.error.issues)));
    }

    req.body = result.data;

    next();
  };
}

// Query strings are read-only in Express 5, so the parsed query goes to req.validatedQuery.
export function validateQuery(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      return next(validationError(toFieldErrors(result.error.issues)));
    }

    req.validatedQuery = result.data;

    next();
  };
}
