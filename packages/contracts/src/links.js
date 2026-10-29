import { z } from 'zod';

import { ALIAS_PATTERN, DESTINATION_MAX_LENGTH, LINKS_PAGE_DEFAULT, LINKS_PAGE_MAX } from './constants.js';

// Link request/response shapes (api-contracts.md, Links).
// Write schemas are strict: unknown fields such as ownerId or role are rejected.

const destinationUrl = z.string().max(DESTINATION_MAX_LENGTH);

export const GuestCreateLinkRequestSchema = z.strictObject({
  destinationUrl,
  challengeToken: z.string().optional(),
});

export const GuestCreateLinkResponseSchema = z.object({
  code: z.string(),
  shortUrl: z.string(),
  expiresAt: z.iso.datetime(),
});

export const RegisteredCreateLinkRequestSchema = z.strictObject({
  destinationUrl,
  customAlias: z.string().regex(ALIAS_PATTERN).nullish(),
  expiresAt: z.iso.datetime().nullish(),
});

// Priority order matters: the first matching state wins.
export const EffectiveStatusSchema = z.enum([
  'blocked',
  'ownerSuspended',
  'disabled',
  'expired',
  'active',
]);

export const LinkSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  shortUrl: z.string(),
  destinationUrl: z.string(),
  expiresAt: z.iso.datetime().nullable(),
  enabled: z.boolean(),
  effectiveStatus: EffectiveStatusSchema,
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});

/** @typedef {z.infer<typeof GuestCreateLinkRequestSchema>} GuestCreateLinkRequest */
/** @typedef {z.infer<typeof GuestCreateLinkResponseSchema>} GuestCreateLinkResponse */
/** @typedef {z.infer<typeof RegisteredCreateLinkRequestSchema>} RegisteredCreateLinkRequest */
/** @typedef {z.infer<typeof EffectiveStatusSchema>} EffectiveStatus */
/** @typedef {z.infer<typeof LinkSchema>} Link */

// Changing an owned link (PATCH /api/v1/links/{id}). Omitted fields stay as they are;
// expiresAt: null removes the expiry. Code, alias and owner can never change.
export const UpdateLinkRequestSchema = z
  .strictObject({
    destinationUrl: destinationUrl.optional(),
    expiresAt: z.iso.datetime().nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Change at least one field.' });

export const ListLinksQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(LINKS_PAGE_MAX).default(LINKS_PAGE_DEFAULT),
});

export const LinkListResponseSchema = z.object({
  items: z.array(LinkSchema),
  nextCursor: z.string().nullable(),
});

/** @typedef {z.infer<typeof UpdateLinkRequestSchema>} UpdateLinkRequest */
/** @typedef {z.infer<typeof LinkListResponseSchema>} LinkListResponse */
