import { SupportMessageRequestSchema, SupportQueueQuerySchema, UpdateSupportMessageRequestSchema } from '@shortlist/contracts';
import { Router } from 'express';

import { rateLimit } from '../middleware/rate-limit.js';
import { validateBody, validateQuery } from '../middleware/validate.js';

const byNetwork = (req) => ({ network: req.clientNetwork });
const byUser = (req) => ({ user: req.user.id });

// Support (api-contracts.md, "Support").
//
//   POST  /api/v1/support                       { topic, message, email? } → 202, open to everyone
//   GET   /api/v1/admin/support?status=&cursor=&limit=   admin inbox, oldest first
//   PATCH /api/v1/admin/support/:id                     { status: open | closed }
//
// Submission is limited per network like abuse reports, counted before validation. Closing a
// message changes no one's access, so it needs an admin but not recent authentication or a reason.
export function createSupportRouter({ controller, guards, limiter }) {
  const router = Router();

  router.post('/api/v1/support', guards.session, guards.csrf, rateLimit(limiter, 'support', byNetwork), validateBody(SupportMessageRequestSchema), controller.submit);

  router.get('/api/v1/admin/support', guards.session, guards.user, guards.admin, rateLimit(limiter, 'memberRead', byUser), validateQuery(SupportQueueQuerySchema), controller.list);
  router.patch(
    '/api/v1/admin/support/:id',
    guards.session,
    guards.csrf,
    guards.user,
    guards.admin,
    rateLimit(limiter, 'adminWrite', byUser),
    validateBody(UpdateSupportMessageRequestSchema),
    controller.setStatus,
  );

  return router;
}
