import { ANALYTICS_DEFAULT_RANGE_DAYS, ANALYTICS_MAX_RANGE_DAYS, ANALYTICS_TOP_REFERRERS } from '@shortlist/contracts';

import { notFoundError, validationError } from '../../errors.js';
import { withTransaction } from '../../infra/postgres.js';
import * as linksRepository from '../links/links.repository.js';

import * as repository from './analytics.repository.js';

// Owner analytics for one link (api-contracts.md, "Analytics contract").
//   * Dates are UTC; `from` is inclusive and `to` exclusive. Default: the last 30 dates
//     including today. At most 90 dates, none older than the aggregate retention.
//   * Every date in the range appears in `daily`, with zero where nothing was counted.
//   * Each breakdown adds up to rangeClicks: unknown countries, unknown devices,
//     direct_or_unknown referrers and "other" are all included. Referrers list the top 20
//     hosts; the rest, plus the worker's own "other" bucket, are summed into one "other" entry.
//   * Counts are approximate (bots and repeats can count, lost events cannot) and say so.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

const UNKNOWN_PIPELINE = Object.freeze({ status: 'unknown', heartbeatAt: null, oldestPendingAt: null });

const toDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const toMs = (date) => Date.parse(`${date}T00:00:00Z`);

// Largest count first; ties broken by name so the order is stable.
function byClicksThenName(nameKey) {
  return (a, b) => (BigInt(b.clicks) > BigInt(a.clicks) ? 1 : BigInt(b.clicks) < BigInt(a.clicks) ? -1 : a[nameKey].localeCompare(b[nameKey]));
}

function sumOf(items) {
  return items.reduce((total, item) => total + BigInt(item.clicks), 0n);
}

export function createAnalyticsQueryService({ pool, retentionDays = 365, getPipelineStatus = async () => UNKNOWN_PIPELINE, clock = () => Date.now() }) {
  // Resolves and validates the requested range. Returns { from, to } as YYYY-MM-DD strings.
  function resolveRange({ from, to }) {
    const todayMs = toMs(toDate(clock()));
    const toMsValue = to ? toMs(to) : todayMs + DAY_MS;
    const fromMsValue = from ? toMs(from) : toMsValue - ANALYTICS_DEFAULT_RANGE_DAYS * DAY_MS;
    const earliestMs = todayMs - (retentionDays - 1) * DAY_MS;

    if (fromMsValue >= toMsValue) {
      throw validationError([{ path: 'from', message: 'The start date must be before the end date.' }]);
    }

    if ((toMsValue - fromMsValue) / DAY_MS > ANALYTICS_MAX_RANGE_DAYS) {
      throw validationError([{ path: 'to', message: `Choose a range of at most ${ANALYTICS_MAX_RANGE_DAYS} days.` }]);
    }

    if (fromMsValue < earliestMs) {
      throw validationError([{ path: 'from', message: `Daily analytics are kept for ${retentionDays} days; choose ${toDate(earliestMs)} or later.` }]);
    }

    return { from: toDate(fromMsValue), to: toDate(toMsValue) };
  }

  function zeroFilledDaily(rows, { from, to }) {
    const counted = new Map(rows.map((row) => [row.day, row.clicks]));
    const daily = [];

    for (let ms = toMs(from); ms < toMs(to); ms += DAY_MS) {
      const date = toDate(ms);

      daily.push({ date, clicks: counted.get(date) ?? '0' });
    }

    return daily;
  }

  function topReferrers(rows) {
    const named = rows.filter((row) => row.bucket !== 'other').map((row) => ({ host: row.bucket, clicks: row.clicks }));
    const existingOther = sumOf(rows.filter((row) => row.bucket === 'other'));

    named.sort(byClicksThenName('host'));

    const top = named.slice(0, ANALYTICS_TOP_REFERRERS);
    const other = existingOther + sumOf(named.slice(ANALYTICS_TOP_REFERRERS));

    return other > 0n ? [...top, { host: 'other', clicks: other.toString() }] : top;
  }

  function breakdown(rows, dimension, nameKey) {
    return rows
      .filter((row) => row.dimension === dimension)
      .map((row) => ({ [nameKey]: row.bucket, clicks: row.clicks }))
      .sort(byClicksThenName(nameKey));
  }

  // Throws 404 for links that do not exist, are not this owner's, or are guest links.
  async function getLinkAnalytics({ ownerId, linkId, from, to }) {
    if (!UUID.test(linkId)) throw notFoundError();

    const range = resolveRange({ from, to });

    const snapshot = await withTransaction(pool, async (client) => {
      const link = await linksRepository.findOwnedLink(client, { ownerId, id: linkId });

      if (!link) throw notFoundError();

      return {
        lifetime: await repository.findLifetimeTotal(client, linkId),
        dailyRows: await repository.findDailyTotals(client, { linkId, ...range }),
        breakdownRows: await repository.findBreakdowns(client, { linkId, ...range }),
      };
    }, { isolationLevel: 'REPEATABLE READ', readOnly: true });

    const daily = zeroFilledDaily(snapshot.dailyRows, range);

    return {
      linkId,
      from: range.from,
      to: range.to,
      timezone: 'UTC',
      totalClicks: snapshot.lifetime?.clicks ?? '0',
      rangeClicks: sumOf(daily).toString(),
      daily,
      countries: breakdown(snapshot.breakdownRows, 'country', 'country'),
      devices: breakdown(snapshot.breakdownRows, 'device', 'device'),
      referrers: topReferrers(snapshot.breakdownRows.filter((row) => row.dimension === 'referrer')),
      lastUpdatedAt: snapshot.lifetime?.updated_at?.toISOString() ?? null,
      pipeline: await getPipelineStatus(),
      approximate: true,
    };
  }

  return { getLinkAnalytics };
}
