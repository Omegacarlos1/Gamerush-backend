export class AppError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly isOperational = true,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ServiceUnavailableError extends AppError {
  public constructor() {
    super(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable');
    this.name = 'ServiceUnavailableError';
  }
}

export class CorsOriginError extends AppError {
  public constructor() {
    super(403, 'CORS_ORIGIN_DENIED', 'Origin is not allowed');
    this.name = 'CorsOriginError';
  }
}

export class InvalidRequestError extends AppError {
  public constructor(message = 'Request validation failed') {
    super(400, 'INVALID_REQUEST', message);
    this.name = 'InvalidRequestError';
  }
}

export class UnauthorizedError extends AppError {
  public constructor(code = 'AUTHENTICATION_REQUIRED', message = 'Authentication required') {
    super(401, code, message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  public constructor(code = 'ACCESS_DENIED', message = 'Access denied') {
    super(403, code, message);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  public constructor(code: string, message: string) {
    super(409, code, message);
    this.name = 'ConflictError';
  }
}

export class NotFoundError extends AppError {
  public constructor(code: string, message: string) {
    super(404, code, message);
    this.name = 'NotFoundError';
  }
}
