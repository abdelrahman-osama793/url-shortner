import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';

import { CsrfToken } from './csrf';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Adds X-CSRF-Token to every state-changing /api request. If the server rejects the token
// (the session expired or was replaced), it fetches a fresh one and retries exactly once.
export const csrfInterceptor: HttpInterceptorFn = (request, next) => {
  if (SAFE_METHODS.has(request.method) || !request.url.startsWith('/api/')) return next(request);

  const csrf = inject(CsrfToken);

  const send = (token: string) => next(request.clone({ setHeaders: { 'X-CSRF-Token': token } }));

  return from(csrf.get()).pipe(
    switchMap(send),
    catchError((error: unknown) => {
      const csrfRejected = error instanceof HttpErrorResponse && error.status === 403 && error.error?.error?.code === 'CSRF_INVALID';

      return csrfRejected ? from(csrf.refresh()).pipe(switchMap(send)) : throwError(() => error);
    }),
  );
};
