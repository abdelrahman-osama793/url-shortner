import express from 'express';

import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { createHealthRouter } from './routes/health.js';

// Composes the Express application from routers.
// It does not listen on a port, so tests can mount it without starting a server.
export function createApp() {
  const app = express();

  app.disable('x-powered-by');

  app.use(createHealthRouter());

  // Must stay last: catch-all 404, then the error handler.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
