import type { ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';

import { AppError } from '../errors/app-error.js';
import { responseRequestId } from './request-id.js';

interface HttpParserError extends Error {
  readonly status?: number;
  readonly type?: string;
}

function isHttpParserError(error: unknown): error is HttpParserError {
  return error instanceof Error && ('status' in error || 'type' in error);
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, request, response, _next): void => {
    const requestId = responseRequestId(response);
    let statusCode = 500;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred';

    if (error instanceof AppError) {
      statusCode = error.statusCode;
      code = error.code;
      message = error.message;
    } else if (isHttpParserError(error) && error.status === 413) {
      statusCode = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'Request payload is too large';
    } else if (isHttpParserError(error) && error.status === 400) {
      statusCode = 400;
      code = 'INVALID_JSON';
      message = 'Request body contains invalid JSON';
    }

    const logContext = {
      event: 'http.request.failed',
      requestId,
      method: request.method,
      path: request.path,
      statusCode,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    };

    if (statusCode >= 500) {
      logger.error(logContext, 'Request failed');
    } else {
      logger.warn(logContext, 'Request rejected');
    }

    if (response.headersSent) {
      return;
    }

    response.status(statusCode).json({
      error: {
        code,
        message,
        requestId,
      },
    });
  };
}
