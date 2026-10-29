import { z } from 'zod';

// Link analytics (api-contracts.md, "Analytics contract"). Counters are decimal strings: they are
// PostgreSQL bigints and JavaScript numbers lose precision above 2^53.

export const ANALYTICS_MAX_RANGE_DAYS = 90;
export const ANALYTICS_DEFAULT_RANGE_DAYS = 30;
export const ANALYTICS_TOP_REFERRERS = 20;

const isoDate = z.iso.date();
const count = z.string().regex(/^[0-9]+$/);

// `from` is inclusive and `to` exclusive, both UTC dates (YYYY-MM-DD).
export const AnalyticsQuerySchema = z.strictObject({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const PipelineStatusSchema = z.object({
  status: z.enum(['healthy', 'delayed', 'degraded', 'unknown']),
  heartbeatAt: z.iso.datetime().nullable(),
  oldestPendingAt: z.iso.datetime().nullable(),
});

export const LinkAnalyticsSchema = z.object({
  linkId: z.uuid(),
  from: isoDate,
  to: isoDate,
  timezone: z.literal('UTC'),
  totalClicks: count,
  rangeClicks: count,
  daily: z.array(z.object({ date: isoDate, clicks: count })),
  countries: z.array(z.object({ country: z.string(), clicks: count })),
  devices: z.array(z.object({ device: z.string(), clicks: count })),
  referrers: z.array(z.object({ host: z.string(), clicks: count })),
  lastUpdatedAt: z.iso.datetime().nullable(),
  pipeline: PipelineStatusSchema,
  approximate: z.literal(true),
});

/** @typedef {z.infer<typeof LinkAnalyticsSchema>} LinkAnalytics */
