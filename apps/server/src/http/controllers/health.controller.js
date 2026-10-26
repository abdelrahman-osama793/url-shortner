// Health checks: what each operational endpoint answers.
//   live   the process answers HTTP; nothing else is checked
//   ready  PostgreSQL is reachable, so redirect traffic can be admitted
// Redis is deliberately not part of readiness: a Redis outage must not remove every
// otherwise-working redirect instance from the load balancer (api-contracts.md).
export function createHealthController({ checkDatabase }) {
  function live(_req, res) {
    res.json({ status: 'ok' });
  }

  async function ready(_req, res) {
    const databaseUp = await checkDatabase();

    res.status(databaseUp ? 200 : 503);

    res.json({
      status: databaseUp ? 'ready' : 'unavailable',
      checks: { postgres: databaseUp ? 'up' : 'down' },
    });
  }

  return { live, ready };
}
