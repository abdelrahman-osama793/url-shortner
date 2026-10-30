import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';

import { Session } from './session';

// The workspace needs a signed-in user. Signed-out visitors go to Log in, which brings them back
// afterwards. If the session cannot be checked (API down), they also go to Log in, whose form
// then explains the outage: failing closed beats showing a workspace that cannot load.
export const requireUser: CanActivateFn = async (_route, state) => {
  const router = inject(Router);
  const user = await inject(Session).load().catch(() => null);

  return user ? true : router.createUrlTree(['/login'], { queryParams: { next: state.url } });
};

// Only paths inside the workspace are followed after sign-in, so a crafted ?next= cannot send
// someone to another site or an unexpected page.
export function safeNext(next: string | null | undefined): string {
  return next && /^\/app(\/|$)/.test(next) ? next : '/app/links';
}
