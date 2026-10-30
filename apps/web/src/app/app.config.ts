import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';

import { routes } from './app.routes';
import { sessionExpiryInterceptor } from './core/auth/session-expiry.interceptor';
import { csrfInterceptor } from './core/http/csrf.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Same-origin API (the dev server proxies /api), so the session cookie is sent automatically.
    // The expiry check wraps the CSRF retry, so it only sees what remains after that retry.
    provideHttpClient(withFetch(), withInterceptors([sessionExpiryInterceptor, csrfInterceptor])),
    provideRouter(
      routes,
      // Route data and parameters arrive as component inputs.
      withComponentInputBinding(),
      // Links with a #fragment (e.g. "Shorten a link") scroll to it; back/forward restore position.
      withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' }),
    ),
  ],
};
