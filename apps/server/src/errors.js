import { ERROR_CODES } from '@shortlist/contracts';

// An error that is safe to show to API clients: its status, code and message are part of
// the documented contract. Any other thrown error becomes a generic 500 response.
export class AppError extends Error {
  constructor(status, code, message, { fields, headers, cause } = {}) {
    super(message, { cause });

    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.headers = headers;
  }
}

export function validationError(fields) {
  return new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Some fields are invalid.', { fields });
}

export function notFoundError() {
  return new AppError(404, ERROR_CODES.NOT_FOUND, 'The requested resource does not exist.');
}


// A dependency (PostgreSQL, Redis) cannot be used safely right now. Never a quota error.
export function serviceUnavailableError({ retryAfterSeconds = 5, cause } = {}) {
  return new AppError(503, ERROR_CODES.SERVICE_UNAVAILABLE, 'The service is temporarily unavailable.', {
    headers: { 'Retry-After': String(retryAfterSeconds) },
    cause,
  });
}
