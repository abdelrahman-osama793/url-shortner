import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { Session } from './session';

// A member request that fails because the session ended (idle or absolute expiry, a password
// reset, sign-out elsewhere) sends them to Log in with an explanation and a way back. A
// suspended account is signed out by the server on its next request; it goes to Log in too,
// with its own explanation. Reads
// answer 401; writes answer 403 CSRF_INVALID, which the CSRF interceptor passes on once /auth/me
// confirms the session is gone. Authentication endpoints answer 401 for wrong passwords, so they
// are left to their own screens.
export const sessionExpiryInterceptor: HttpInterceptorFn = (request, next) => {
  const session = inject(Session);
  const router = inject(Router);

  // Captured before sending: the CSRF interceptor may already have found the session gone.
  const wasSignedIn = session.signedIn();

  return next(request).pipe(
    catchError((error: unknown) => {
      const code = error instanceof HttpErrorResponse ? error.error?.error?.code : null;
      const suspended = code === 'ACCOUNT_SUSPENDED';
      const ended = error instanceof HttpErrorResponse && (error.status === 401 || code === 'CSRF_INVALID' || suspended);
      const expired = ended && wasSignedIn && (suspended || !request.url.startsWith('/api/v1/auth/'));

      if (expired) {
        session.forget();
        const reason = suspended ? { suspended: 1 } : { next: router.url, expired: 1 };

        router.navigate(['/login'], { queryParams: reason }).catch(() => false);
      }

      return throwError(() => error);
    }),
  );
};
