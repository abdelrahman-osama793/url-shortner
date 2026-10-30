import { ALIAS_PATTERN } from '@shortlist/contracts';

import * as repository from './reports.repository.js';

// Public abuse reports (api-contracts.md, "Reports and moderation"). Every report gets the same
// answer, so the endpoint reveals nothing about which codes exist or who owns them. Reports only
// enter the review queue; they never block a link on their own (an admin decides, T30–T31).
export function createReportService({ pool, logger }) {
  // Returns nothing on purpose: callers must not be able to tell stored from ignored reports.
  async function submit({ code, category, details, reporterId = null }) {
    // A code that cannot exist never reaches the database (same rule as redirects).
    if (!ALIAS_PATTERN.test(code)) return;

    const stored = await repository.insertReportForCode(pool, {
      code,
      category,
      details: details || null,
      reporterId,
    });

    logger?.info({ category, stored, signedIn: reporterId !== null }, 'abuse report received');
  }

  return { submit };
}
