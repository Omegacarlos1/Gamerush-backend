import type { NextFunction, Request, Response } from 'express';

import type { PlayerService } from '../application/player.service.js';
import { authenticatedUser, nextAsync } from '../../auth/presentation/auth.middleware.js';
import { parseInput, profilePatchSchema, xpHistoryQuerySchema } from './player.schemas.js';

export class PlayerController {
  public constructor(private readonly service: PlayerService) {}

  public readonly me = (_request: Request, response: Response, next: NextFunction): void => {
    nextAsync(async () => {
      const profile = await this.service.getMyProfile(authenticatedUser(response).id);
      response.status(200).json({ data: { profile } });
    }, next);
  };

  public readonly updateMe = (request: Request, response: Response, next: NextFunction): void => {
    nextAsync(async () => {
      const patch = parseInput(profilePatchSchema, request.body);
      const profile = await this.service.updateMyProfile(authenticatedUser(response).id, {
        ...(patch.displayName === undefined ? {} : { displayName: patch.displayName }),
        ...(patch.bio === undefined ? {} : { bio: patch.bio }),
      });
      response.status(200).json({ data: { profile } });
    }, next);
  };

  public readonly xpHistory = (request: Request, response: Response, next: NextFunction): void => {
    nextAsync(async () => {
      const query = parseInput(xpHistoryQuerySchema, request.query);
      const page = await this.service.getMyXpHistory({
        userId: authenticatedUser(response).id,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        limit: query.limit,
      });
      response.status(200).json({
        data: { items: page.items },
        pagination: { nextCursor: page.nextCursor, limit: query.limit },
      });
    }, next);
  };
}
