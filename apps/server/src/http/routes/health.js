import { Router } from 'express';

// GET /health/live: the process answers HTTP. Nothing else is checked.
// GET /health/ready: PostgreSQL is reachable, so redirect traffic can be admitted.
// Redis is deliberately not part of readiness: a Redis outage must not remove every
// otherwise-working redirect instance from the load balancer (api-contracts.md).
export function createHealthRouter({ checkDatabase }) {
  const router = Router();

  router.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/health/ready', async (_req, res) => {
    const databaseUp = await checkDatabase();

    res.status(databaseUp ? 200 : 503);

    res.json({
      status: databaseUp ? 'ready' : 'unavailable',
      checks: { postgres: databaseUp ? 'up' : 'down' },
    });
  });

  return router;
}
