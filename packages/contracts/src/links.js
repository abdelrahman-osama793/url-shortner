import { z } from 'zod';

// Link request/response shapes (api-contracts.md, Links).
// Write schemas are strict: unknown fields such as ownerId or role are rejected.

export const DESTINATION_MAX_LENGTH = 4096;

// Custom aliases: 4-32 ASCII letters, digits, hyphens or underscores. Case-sensitive.
export const ALIAS_PATTERN = /^[A-Za-z0-9_-]{4,32}$/;

// Generated codes: this many random Base62 characters.
export const GENERATED_CODE_LENGTH = 8;

// Guest links expire this long after creation (decision D04).
export const GUEST_LINK_LIFETIME_DAYS = 7;

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
