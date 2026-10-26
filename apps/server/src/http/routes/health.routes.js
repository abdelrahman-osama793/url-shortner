import { Router } from 'express';

// GET /health/live, GET /health/ready (api-contracts.md, "Operational endpoints").
export function createHealthRouter({ controller }) {
  const router = Router();

  router.get('/health/live', controller.live);
  router.get('/health/ready', controller.ready);

  return router;
}
