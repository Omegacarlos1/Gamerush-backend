import type { NextFunction, Request, Response } from 'express';

import type { HealthService } from '../application/health.service.js';

export function createHealthController(healthService: HealthService) {
  return async (_request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const health = await healthService.getStatus();
      response.status(200).json(health);
    } catch (error: unknown) {
      next(error);
    }
  };
}
