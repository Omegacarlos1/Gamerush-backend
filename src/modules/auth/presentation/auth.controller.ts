import type { NextFunction, Request, Response } from 'express';

import type { AppConfig } from '../../../config/environment.js';
import { ForbiddenError } from '../../../shared/errors/app-error.js';
import type { AuthService } from '../application/auth.service.js';
import { parseRefreshToken } from '../infrastructure/auth-token.service.js';
import { authCookieNames, clearAuthCookies, readCookie, setAuthCookies } from './auth.cookies.js';
import { authenticatedUser, nextAsync, requestMetadata } from './auth.middleware.js';
import { loginSchema, parseBody, registerSchema, verifyEmailSchema } from './auth.schemas.js';

export class AuthController {
  public constructor(
    private readonly service: AuthService,
    private readonly config: AppConfig,
  ) {}

  public readonly register = (request: Request, response: Response, next: NextFunction): void => {
    nextAsync(async () => {
      const input = parseBody(registerSchema, request.body);
      const user = await this.service.register(input);
      response.status(201).json({ data: { user } });
    }, next);
  };

  public readonly verifyEmail = (
    request: Request,
    response: Response,
    next: NextFunction,
  ): void => {
    nextAsync(async () => {
      const { token } = parseBody(verifyEmailSchema, request.body);
      await this.service.verifyEmail(token);
      response.status(204).send();
    }, next);
  };

  public readonly login = (request: Request, response: Response, next: NextFunction): void => {
    nextAsync(async () => {
      const input = parseBody(loginSchema, request.body);
      const result = await this.service.login(
        input.email,
        input.password,
        requestMetadata(request),
      );
      setAuthCookies(response, this.config, result.tokens);
      response.status(200).json({
        data: { user: result.user, accessTokenExpiresAt: result.tokens.accessExpiresAt },
      });
    }, next);
  };

  public readonly refresh = (request: Request, response: Response, next: NextFunction): void => {
    nextAsync(async () => {
      const refreshToken = this.requireCsrf(request);
      const result = await this.service.refresh(refreshToken, requestMetadata(request));
      setAuthCookies(response, this.config, result.tokens);
      response.status(200).json({
        data: { user: result.user, accessTokenExpiresAt: result.tokens.accessExpiresAt },
      });
    }, next);
  };

  public readonly logout = (request: Request, response: Response, next: NextFunction): void => {
    nextAsync(async () => {
      const names = authCookieNames(this.config);
      const refreshToken = readCookie(request, names.refresh);
      if (refreshToken !== null) this.requireCsrf(request);
      await this.service.logout(refreshToken);
      clearAuthCookies(response, this.config);
      response.status(204).send();
    }, next);
  };

  public readonly me = (_request: Request, response: Response): void => {
    response.status(200).json({ data: { user: authenticatedUser(response) } });
  };

  public readonly adminCheck = (_request: Request, response: Response): void => {
    response.status(200).json({ data: { authorized: true } });
  };

  private requireCsrf(request: Request): string {
    const names = authCookieNames(this.config);
    const refreshToken = readCookie(request, names.refresh);
    const csrfCookie = readCookie(request, names.csrf);
    const csrfHeader = request.headers['x-csrf-token'];
    const parsed = refreshToken === null ? null : parseRefreshToken(refreshToken);
    if (
      refreshToken === null ||
      parsed === null ||
      csrfCookie === null ||
      typeof csrfHeader !== 'string' ||
      !this.service.verifyCsrf(parsed.sessionPublicId, csrfCookie, csrfHeader)
    ) {
      throw new ForbiddenError('CSRF_VALIDATION_FAILED', 'CSRF validation failed');
    }
    return refreshToken;
  }
}
