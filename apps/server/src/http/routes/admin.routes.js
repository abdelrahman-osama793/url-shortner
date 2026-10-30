import {
  AdminLinkQuerySchema,
  AuditQuerySchema,
  LinkModerationRequestSchema,
  ReportQueueQuerySchema,
  UpdateReportRequestSchema,
  UserModerationRequestSchema,
} from '@shortlist/contracts';
import { Router } from 'express';

import { rateLimit } from '../middleware/rate-limit.js';
import { validateBody, validateQuery } from '../middleware/validate.js';

const byUser = (req) => ({ user: req.user.id });

// Administration (api-contracts.md, "Reports and moderation"). The role comes from the current
// users row on every request (guards.admin), never from the session or the request.
//
//   GET   /api/v1/admin/reports?status=&cursor=&limit=   report queue, oldest first
//   PATCH /api/v1/admin/reports/:id                       { status, note }
//   GET   /api/v1/admin/links?code=                       exact-code inspection + ETag
//   PATCH /api/v1/admin/links/:id/moderation              { blocked, reason } + If-Match
//   PATCH /api/v1/admin/users/:id/moderation              { suspended, reason }
//   GET   /api/v1/admin/audit?targetType=&targetId=&cursor=&limit=
//
// Changes also need CSRF and recent authentication (password or Google within the window).
export function createAdminRouter({ controller, guards, limiter, recentAuthMs }) {
  const router = Router();

  const read = [guards.session, guards.user, guards.admin, rateLimit(limiter, 'memberRead', byUser)];
  const write = [guards.session, guards.csrf, guards.user, guards.admin, guards.recentAuth(recentAuthMs), rateLimit(limiter, 'adminWrite', byUser)];

  router.get('/api/v1/admin/reports', ...read, validateQuery(ReportQueueQuerySchema), controller.listReports);
  router.patch('/api/v1/admin/reports/:id', ...write, validateBody(UpdateReportRequestSchema), controller.updateReport);

  router.get('/api/v1/admin/links', ...read, validateQuery(AdminLinkQuerySchema), controller.inspectLink);
  router.patch('/api/v1/admin/links/:id/moderation', ...write, validateBody(LinkModerationRequestSchema), controller.moderateLink);

  router.patch('/api/v1/admin/users/:id/moderation', ...write, validateBody(UserModerationRequestSchema), controller.moderateUser);

  router.get('/api/v1/admin/audit', ...read, validateQuery(AuditQuerySchema), controller.listAudit);

  return router;
}
