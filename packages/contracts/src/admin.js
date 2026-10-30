import { z } from 'zod';

import { REPORT_CATEGORIES, REPORT_DETAILS_MAX_LENGTH } from './constants.js';
import { EffectiveStatusSchema } from './links.js';

// Administration (api-contracts.md, "Reports and moderation"). Every endpoint needs an admin
// session; every change also needs recent authentication and a reason, and commits together
// with its audit entry.

export const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'];
export const AUDIT_TARGET_TYPES = ['link', 'user', 'report'];

const ADMIN_PAGE_MAX = 100;

// Why the admin acted. Stored in the append-only audit trail, never shown to link owners.
const reason = z.string().trim().min(1, 'Give a reason.').max(2000, 'Use at most 2000 characters.')
  .refine((value) => !value.includes('\u0000'), 'Remove unsupported characters.');

const page = {
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(ADMIN_PAGE_MAX).default(20),
};

export const ReportQueueQuerySchema = z.strictObject({
  status: z.enum(REPORT_STATUSES).default('open'),
  ...page,
});

export const AdminReportSchema = z.object({
  id: z.uuid(),
  linkId: z.uuid(),
  code: z.string(),
  category: z.enum(REPORT_CATEGORIES),
  details: z.string().max(REPORT_DETAILS_MAX_LENGTH).nullable(),
  status: z.enum(REPORT_STATUSES),
  reporterId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  resolvedBy: z.uuid().nullable(),
});

export const ReportQueueResponseSchema = z.object({
  items: z.array(AdminReportSchema),
  nextCursor: z.string().nullable(),
});

// Changing a report's status never changes the link; blocking is a separate action.
export const UpdateReportRequestSchema = z.strictObject({
  status: z.enum(REPORT_STATUSES),
  note: reason,
});

export const AdminLinkQuerySchema = z.strictObject({
  code: z.string().min(1).max(64),
});

// Exact-code inspection: who owns the link and why it is or is not available.
export const AdminLinkSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  shortUrl: z.string(),
  destinationUrl: z.string(),
  ownerId: z.uuid().nullable(),
  ownerStatus: z.enum(['active', 'suspended']).nullable(),
  enabled: z.boolean(),
  expiresAt: z.iso.datetime().nullable(),
  blockedAt: z.iso.datetime().nullable(),
  blockReason: z.string().nullable(),
  effectiveStatus: EffectiveStatusSchema,
  openReports: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});

export const LinkModerationRequestSchema = z.strictObject({
  blocked: z.boolean(),
  reason,
});

export const UserModerationRequestSchema = z.strictObject({
  suspended: z.boolean(),
  reason,
});

export const AdminUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: z.enum(['user', 'admin']),
  status: z.enum(['active', 'suspended']),
});

export const AuditQuerySchema = z
  .strictObject({
    targetType: z.enum(AUDIT_TARGET_TYPES).optional(),
    targetId: z.uuid().optional(),
    ...page,
  })
  .refine((query) => (query.targetType === undefined) === (query.targetId === undefined), {
    message: 'Give targetType and targetId together.',
    path: ['targetId'],
  });

export const AuditEntrySchema = z.object({
  id: z.uuid(),
  actorUserId: z.uuid(),
  action: z.string(),
  targetType: z.enum(AUDIT_TARGET_TYPES),
  targetId: z.uuid(),
  reason: z.string(),
  requestId: z.string(),
  createdAt: z.iso.datetime(),
});

export const AuditListResponseSchema = z.object({
  items: z.array(AuditEntrySchema),
  nextCursor: z.string().nullable(),
});

/** @typedef {z.infer<typeof AdminReportSchema>} AdminReport */
/** @typedef {z.infer<typeof ReportQueueResponseSchema>} ReportQueueResponse */
/** @typedef {z.infer<typeof AdminLinkSchema>} AdminLink */
/** @typedef {z.infer<typeof AdminUserSchema>} AdminUser */
/** @typedef {z.infer<typeof AuditEntrySchema>} AuditEntry */
/** @typedef {z.infer<typeof AuditListResponseSchema>} AuditListResponse */
