import express from 'express';

import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { noStore } from './middleware/no-store.js';
import { requireAllowedOrigin } from './middleware/origin.js';
import { requestId } from './middleware/request-id.js';
import { requestLogger } from './middleware/request-logger.js';

export const JSON_BODY_LIMIT = '16kb';

// Applies the API conventions (request IDs, logging, no-store, origin check, JSON limits,
// error envelopes) around the given routers. The caller decides which routers to mount,
// so new features plug in without editing this file, and tests can mount their own.
export function createApp({ config, logger, routers }) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops);

  app.use(requestId());
  app.use(requestLogger(logger));
  app.use(noStore());
  app.use(requireAllowedOrigin(config.allowedOrigins));
  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));

  for (const router of routers) {
    app.use(router);
  }

  // Must stay last: catch-all 404, then the error handler.
  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
