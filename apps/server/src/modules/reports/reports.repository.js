// SQL for abuse reports (database-schema.md, "Moderation and audits").

// Stores a report for the link with this exact code, in one statement. Returns false (and
// stores nothing) when no link has the code, so unknown codes never leave orphaned rows.
export async function insertReportForCode(db, { code, category, details, reporterId }) {
  const { rowCount } = await db.query(
    `INSERT INTO abuse_reports (link_id, reporter_id, category, details)
     SELECT id, $2, $3, $4 FROM links WHERE code = $1`,
    [code, reporterId, category, details],
  );

  return rowCount === 1;
}
