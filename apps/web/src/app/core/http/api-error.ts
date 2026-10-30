import { HttpErrorResponse } from '@angular/common/http';
import type { FieldError } from '@shortlist/contracts';

// One error type for every API failure, built from the documented error envelope
// (api-contracts.md, Conventions). Screens decide what to show from `code`, `fields` and
// `retryAfterSeconds`; they never parse HTTP responses themselves.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: FieldError[] = [],
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  // The server's message for one field, if it reported one.
  fieldMessage(path: string): string | null {
    return this.fields.find((field) => field.path === path)?.message ?? null;
  }
}

// Status 0 means the request never got an HTTP answer (offline, DNS, server down).
const NETWORK_ERROR = 'NETWORK_ERROR';

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (!(error instanceof HttpErrorResponse)) {
    return new ApiError(0, 'UNEXPECTED', 'Something went wrong. Please try again.');
  }

  if (error.status === 0) {
    return new ApiError(0, NETWORK_ERROR, "We couldn't reach Shortlist. Check your connection and try again.");
  }

  const body = error.error?.error;
  const retryAfter = Number(error.headers.get('Retry-After'));

  return new ApiError(
    error.status,
    typeof body?.code === 'string' ? body.code : 'UNEXPECTED',
    typeof body?.message === 'string' ? body.message : 'Something went wrong. Please try again.',
    Array.isArray(body?.fields) ? body.fields : [],
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
  );
}

// "about 3 minutes", "about 2 hours": for rate-limit messages.
export function describeWait(seconds: number): string {
  if (seconds < 90) return 'about a minute';
  if (seconds < 90 * 60) return `about ${Math.round(seconds / 60)} minutes`;

  return `about ${Math.round(seconds / 3600)} hours`;
}

// The message for failures every form handles the same way: limits, outages and network errors.
// Screens handle their own codes (wrong password, used token, …) before falling back to this.
export function commonMessage(error: ApiError): string {
  switch (error.code) {
    case 'RATE_LIMITED':
      return `Too many attempts. Please try again in ${describeWait(error.retryAfterSeconds ?? 60)}.`;
    case 'SERVICE_UNAVAILABLE':
      return 'Shortlist is briefly unavailable. Please try again in a moment.';
    default:
      return error.message;
  }
}
