import { Router } from 'express';

// Liveness only: proves the process answers HTTP.
// Readiness (PostgreSQL reachability) is added with the database in T05.
export function createHealthRouter() {
  const router = Router();

  router.get('/health/live', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'ok' });
  });

  return router;
}
