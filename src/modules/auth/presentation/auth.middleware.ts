import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { AppConfig } from '../../../config/environment.js';
import { ForbiddenError } from '../../../shared/errors/app-error.js';
import type { AuthService } from '../application/auth.service.js';
import type { AccountRole, AuthenticatedUser } from '../domain/auth.types.js';
import { parseRefreshToken } from '../infrastructure/auth-token.service.js';
import { authCookieNames, readCookie } from './auth.cookies.js';

const authenticatedUserKey = 'authenticatedUser';

export function requireAuthentication(service: AuthService, config: AppConfig): RequestHandler {
  return (request, response, next): void => {
    const accessToken = readCookie(request, authCookieNames(config).access);
    void service
      .authenticate(accessToken)
      .then((user) => {
        response.locals[authenticatedUserKey] = user;
        next();
      })
      .catch(next);
  };
}

export function requireRole(role: AccountRole): RequestHandler {
  return (_request, response, next): void => {
    const user = authenticatedUser(response);
    if (user.role !== role) {
      next(new ForbiddenError('ROLE_REQUIRED', `${role} role is required`));
      return;
    }
    next();
  };
}

export function requireCsrfProtection(service: AuthService, config: AppConfig): RequestHandler {
  return (request, _response, next): void => {
    try {
      validateCsrfRequest(request, service, config);
      next();
    } catch (error: unknown) {
      next(error);
    }
  };
}

export function validateCsrfRequest(
  request: Request,
  service: AuthService,
  config: AppConfig,
): string {
  const names = authCookieNames(config);
  const refreshToken = readCookie(request, names.refresh);
  const csrfCookie = readCookie(request, names.csrf);
  const csrfHeader = request.headers['x-csrf-token'];
  const parsed = refreshToken === null ? null : parseRefreshToken(refreshToken);
  if (
    refreshToken === null ||
    parsed === null ||
    csrfCookie === null ||
    typeof csrfHeader !== 'string' ||
    !service.verifyCsrf(parsed.sessionPublicId, csrfCookie, csrfHeader)
  ) {
    throw new ForbiddenError('CSRF_VALIDATION_FAILED', 'CSRF validation failed');
  }
  return refreshToken;
}

export function authenticatedUser(response: Response): AuthenticatedUser {
  const user = response.locals[authenticatedUserKey] as AuthenticatedUser | undefined;
  if (user === undefined) throw new ForbiddenError();
  return user;
}

export function requestMetadata(request: Request): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const ipAddress = request.ip ?? request.socket.remoteAddress ?? null;
  const header = request.headers['user-agent'];
  return {
    ipAddress,
    userAgent: typeof header === 'string' ? header.slice(0, 512) : null,
  };
}

export function nextAsync(operation: () => Promise<void>, next: NextFunction): void {
  void operation().catch(next);
}
