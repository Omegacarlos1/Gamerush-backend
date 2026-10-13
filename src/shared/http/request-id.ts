import { randomUUID } from 'node:crypto';

import type { IncomingMessage, ServerResponse } from 'node:http';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function generateRequestId(request: IncomingMessage, response: ServerResponse): string {
  const suppliedRequestId = request.headers['x-request-id'];
  const requestId =
    typeof suppliedRequestId === 'string' && uuidPattern.test(suppliedRequestId)
      ? suppliedRequestId
      : randomUUID();

  response.setHeader('X-Request-Id', requestId);
  return requestId;
}

export function responseRequestId(response: ServerResponse): string {
  const requestId = response.getHeader('X-Request-Id');
  return typeof requestId === 'string' ? requestId : 'unavailable';
}
