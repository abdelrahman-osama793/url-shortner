import { ERROR_CODES } from '@shortlist/contracts';

import { AppError, notFoundError, serviceUnavailableError } from '../../errors.js';
import { isDatabaseUnavailable } from '../../infra/postgres.js';

// Errors raised by express.json() before any route runs, identified by their `type`.
const BODY_PARSER_ERRORS = {
  'entity.too.large': () => new AppError(413, ERROR_CODES.PAYLOAD_TOO_LARGE, 'The request body is too large.'),
  'entity.parse.failed': () => new AppError(400, ERROR_CODES.INVALID_JSON, 'The request body is not valid JSON.'),
  'encoding.unsupported': () => new AppError(415, ERROR_CODES.UNSUPPORTED_MEDIA_TYPE, 'Unsupported content encoding.'),
  'charset.unsupported': () => new AppError(415, ERROR_CODES.UNSUPPORTED_MEDIA_TYPE, 'Unsupported character set.'),
};

function toAppError(error) {
  if (error instanceof AppError) return error;

  // Express's router raises this for malformed percent-encoding in a path parameter.
  if (error instanceof URIError && error.status === 400) {
    return new AppError(400, ERROR_CODES.BAD_REQUEST, 'The request path is not valid.');
  }

  const fromBodyParser = BODY_PARSER_ERRORS[error?.type];

  if (fromBodyParser) return fromBodyParser();

  // A database outage is a dependency failure (503), not a bug (500).
  if (isDatabaseUnavailable(error)) return serviceUnavailableError({ cause: error });

  return null;
}

function sendError(req, res, appError) {
  res.status(appError.status);

  if (appError.headers) res.set(appError.headers);

  res.json({
    error: {
      code: appError.code,
      message: appError.message,
      requestId: req.id,
      fields: appError.fields,
    },
  });
}

export function notFoundHandler(_req, _res, next) {
  next(notFoundError());
}

// Express 5 forwards both thrown errors and rejected promises from route handlers here,
// so handlers do not need their own try/catch. Expected errors (AppError, malformed bodies)
// are returned as-is. Anything else is logged and becomes a generic 500 with no details.
export function errorHandler(logger) {
  // Express identifies error middleware by its four parameters, so `_next` must stay.
  return (error, req, res, _next) => {
    const appError = toAppError(error);

    if (appError) {
      // Expected server-side failures (e.g. a dependency outage) are still worth an operator's attention.
      if (appError.status >= 500) {
        logger.warn({ err: appError.cause ?? appError, requestId: req.id, path: req.path, code: appError.code }, 'request failed with a known server error');
      }

      return sendError(req, res, appError);
    }

    logger.error({ err: error, requestId: req.id, method: req.method, path: req.path }, 'request failed');

    sendError(req, res, new AppError(500, ERROR_CODES.INTERNAL_ERROR, 'Something went wrong.'));
  };
}
