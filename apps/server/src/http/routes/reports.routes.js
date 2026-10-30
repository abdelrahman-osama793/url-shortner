import { ReportRequestSchema } from '@shortlist/contracts';
import { Router } from 'express';

import { rateLimit } from '../middleware/rate-limit.js';
import { validateBody } from '../middleware/validate.js';

const byNetwork = (req) => ({ network: req.clientNetwork });

// POST /api/v1/reports  { code, category, details? } → 202 { status: "accepted" } always.
// Open to everyone (guests use their anonymous session's CSRF token). The quota counts before
// validation, so malformed floods are limited too. The report queue itself is admin-only (T30).
export function createReportsRouter({ controller, guards, limiter }) {
  const router = Router();

  router.post(
    '/api/v1/reports',
    guards.session,
    guards.csrf,
    rateLimit(limiter, 'report', byNetwork),
    validateBody(ReportRequestSchema),
    controller.submit,
  );

  return router;
}
