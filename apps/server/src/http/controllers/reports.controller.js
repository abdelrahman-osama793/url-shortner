// Abuse report submission. The answer is identical for every outcome.

const ACCEPTED = Object.freeze({ status: 'accepted' });

export function createReportsController({ reportService }) {
  async function submit(req, res) {
    await reportService.submit({ ...req.body, reporterId: req.session?.userId ?? null });

    res.status(202).json(ACCEPTED);
  }

  return { submit };
}
