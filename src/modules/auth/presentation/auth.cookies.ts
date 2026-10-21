import type { Request, Response } from 'express';

import type { AppConfig } from '../../../config/environment.js';
import type { SessionTokens } from '../application/auth.service.js';

export interface AuthCookieNames {
  readonly access: string;
  readonly refresh: string;
  readonly csrf: string;
}

export function authCookieNames(config: AppConfig): AuthCookieNames {
  const prefix = config.auth.cookieSecure ? '__Host-' : '';
  return {
    access: `${prefix}playrush_access`,
    refresh: `${prefix}playrush_refresh`,
    csrf: `${prefix}playrush_csrf`,
  };
}

export function setAuthCookies(response: Response, config: AppConfig, tokens: SessionTokens): void {
  const names = authCookieNames(config);
  const shared = {
    secure: config.auth.cookieSecure,
    sameSite: 'strict' as const,
    path: '/',
  };
  response.cookie(names.access, tokens.accessToken, {
    ...shared,
    httpOnly: true,
    expires: tokens.accessExpiresAt,
  });
  response.cookie(names.refresh, tokens.refreshToken, {
    ...shared,
    httpOnly: true,
    expires: tokens.refreshExpiresAt,
  });
  response.cookie(names.csrf, tokens.csrfToken, {
    ...shared,
    httpOnly: false,
    expires: tokens.refreshExpiresAt,
  });
}

export function clearAuthCookies(response: Response, config: AppConfig): void {
  const names = authCookieNames(config);
  const options = {
    secure: config.auth.cookieSecure,
    sameSite: 'strict' as const,
    path: '/',
  };
  response.clearCookie(names.access, { ...options, httpOnly: true });
  response.clearCookie(names.refresh, { ...options, httpOnly: true });
  response.clearCookie(names.csrf, { ...options, httpOnly: false });
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.cookie;
  if (header === undefined) return null;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    const candidate = pair.slice(0, separator).trim();
    if (candidate !== name) continue;
    try {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}
