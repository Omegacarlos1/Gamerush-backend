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
