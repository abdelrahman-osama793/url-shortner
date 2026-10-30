import { z } from 'zod';

import { REPORT_CATEGORIES, REPORT_DETAILS_MAX_LENGTH } from './constants.js';

// Public abuse reports (api-contracts.md, "Reports and moderation").
// `code` is the short code exactly as in /r/{code} (case-sensitive). Any code is accepted here;
// unknown ones get the same acknowledgement and are not stored.
export const ReportRequestSchema = z.strictObject({
  code: z.string().trim().min(1).max(64),
  category: z.enum(REPORT_CATEGORIES),
  // PostgreSQL text cannot hold NUL characters; reject them here instead of failing later.
  details: z
    .string()
    .trim()
    .max(REPORT_DETAILS_MAX_LENGTH, `Use at most ${REPORT_DETAILS_MAX_LENGTH} characters.`)
    .refine((value) => !value.includes('\u0000'), 'Remove unsupported characters.')
    .optional(),
});

/** @typedef {z.infer<typeof ReportRequestSchema>} ReportRequest */
