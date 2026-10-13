import { Router } from 'express';

import type { HealthService } from '../application/health.service.js';
import { createHealthController } from './health.controller.js';

export function createHealthRouter(healthService: HealthService): Router {
  const router = Router();
  router.get('/', createHealthController(healthService));
  return router;
}
