import type { Request, Response } from 'express';

import { responseRequestId } from './request-id.js';

export function notFoundHandler(_request: Request, response: Response): void {
  response.status(404).json({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: 'Route not found',
      requestId: responseRequestId(response),
    },
  });
}
