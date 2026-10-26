import { Router } from 'express';

// GET/HEAD /r/:code — public redirects, served by the API and never by Angular.
// Per-client 429 limits for redirects belong at the edge proxy (technical-design §6); an
// application limit would make every redirect depend on Redis.
export function createRedirectRouter({ controller }) {
  // Case-sensitive: /R/abc must not reach the /r/:code handler.
  const router = Router({ caseSensitive: true });

  router.get('/r/:code', controller.redirect);
  router.all('/r/:code', controller.methodNotAllowed);

  return router;
}
