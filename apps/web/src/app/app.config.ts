import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';

import { routes } from './app.routes';
import { csrfInterceptor } from './core/http/csrf.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Same-origin API (the dev server proxies /api), so the session cookie is sent automatically.
    provideHttpClient(withFetch(), withInterceptors([csrfInterceptor])),
    provideRouter(
      routes,
      // Route data and parameters arrive as component inputs.
      withComponentInputBinding(),
      // Links with a #fragment (e.g. "Shorten a link") scroll to it; back/forward restore position.
      withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' }),
    ),
  ],
};
