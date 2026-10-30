import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';

import { Session } from '../auth/session';

import { CsrfToken } from './csrf';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Adds X-CSRF-Token to every state-changing /api request. If the server rejects the token, it
// fetches a fresh one and retries exactly once, but never as someone else: fetching a token
// without a live session starts a new anonymous one, so a signed-in person's request is retried
// only after /auth/me confirms the same user is still signed in. (Otherwise POST /links would be
// replayed as a guest link.) When the session is gone, the error reaches the session-expiry
// interceptor, which sends them to Log in.
export const csrfInterceptor: HttpInterceptorFn = (request, next) => {
  if (SAFE_METHODS.has(request.method) || !request.url.startsWith('/api/')) return next(request);

  const csrf = inject(CsrfToken);
  const session = inject(Session);
  const userId = session.user()?.id ?? null;

  const send = (token: string) => next(request.clone({ setHeaders: { 'X-CSRF-Token': token } }));

  return from(csrf.get()).pipe(
    switchMap(send),
    catchError((error: unknown) => {
      const csrfRejected = error instanceof HttpErrorResponse && error.status === 403 && error.error?.error?.code === 'CSRF_INVALID';

      if (!csrfRejected) return throwError(() => error);
      if (userId === null) return from(csrf.refresh()).pipe(switchMap(send));

      return from(session.reload().catch(() => null)).pipe(
        switchMap((user) => (user?.id === userId ? from(csrf.refresh()).pipe(switchMap(send)) : throwError(() => error))),
      );
    }),
  );
};
