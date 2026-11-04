import { z } from 'zod';

import { EMAIL_MAX_LENGTH, SUPPORT_MESSAGE_MAX_LENGTH, SUPPORT_TOPICS } from './constants.js';

// Support messages (api-contracts.md, "Support"). Guests give a reply address; signed-in senders
// are answered at their account email, and any `email` they send is ignored.

const text = z
  .string()
  .trim()
  .min(1, 'Write your message.')
  .max(SUPPORT_MESSAGE_MAX_LENGTH, `Use at most ${SUPPORT_MESSAGE_MAX_LENGTH} characters.`)
  .refine((value) => !value.includes('\u0000'), 'Remove unsupported characters.');

export const SupportMessageRequestSchema = z.strictObject({
  topic: z.enum(SUPPORT_TOPICS),
  message: text,
  email: z.string().trim().max(EMAIL_MAX_LENGTH).pipe(z.email('Enter a valid email address.')).optional(),
});

export const SUPPORT_MESSAGE_STATUSES = ['open', 'closed'];

export const SupportQueueQuerySchema = z.strictObject({
  status: z.enum(SUPPORT_MESSAGE_STATUSES).default('open'),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const AdminSupportMessageSchema = z.object({
  id: z.uuid(),
  userId: z.uuid().nullable(),
  replyEmail: z.string(),
  topic: z.enum(SUPPORT_TOPICS),
  message: z.string(),
  status: z.enum(SUPPORT_MESSAGE_STATUSES),
  createdAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  closedBy: z.uuid().nullable(),
});

export const SupportQueueResponseSchema = z.object({
  items: z.array(AdminSupportMessageSchema),
  nextCursor: z.string().nullable(),
});

export const UpdateSupportMessageRequestSchema = z.strictObject({
  status: z.enum(SUPPORT_MESSAGE_STATUSES),
});

/** @typedef {z.infer<typeof SupportMessageRequestSchema>} SupportMessageRequest */
/** @typedef {z.infer<typeof AdminSupportMessageSchema>} AdminSupportMessage */
/** @typedef {z.infer<typeof SupportQueueResponseSchema>} SupportQueueResponse */
