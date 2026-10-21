import type { NextFunction, Request, Response } from 'express';

import type { GameService } from '../application/game.service.js';
import { authenticatedUser, nextAsync } from '../../auth/presentation/auth.middleware.js';
import {
  createGameSessionSchema,
  gameIdParamsSchema,
  parseGameInput,
  sessionIdParamsSchema,
} from './game.schemas.js';

const publicCatalogCache = 'public, max-age=60, stale-while-revalidate=30';

export class GameController {
  public constructor(private readonly service: GameService) {}

  public readonly list = (_request: Request, response: Response, next: NextFunction): void => {
    nextAsync(async () => {
      const games = await this.service.listGames();
      response.set('Cache-Control', publicCatalogCache).status(200).json({ data: { games } });
    }, next);
  };

  public readonly detail = (request: Request, response: Response, next: NextFunction): void => {
    nextAsync(async () => {
      const { gameId } = parseGameInput(gameIdParamsSchema, request.params);
      const game = await this.service.getGame(gameId);
      response.set('Cache-Control', publicCatalogCache).status(200).json({ data: { game } });
    }, next);
  };

  public readonly createSession = (
    request: Request,
    response: Response,
    next: NextFunction,
  ): void => {
    nextAsync(async () => {
      const { gameId } = parseGameInput(gameIdParamsSchema, request.params);
      const { mode } = parseGameInput(createGameSessionSchema, request.body);
      const issued = await this.service.createSession({
        userId: authenticatedUser(response).id,
        gameId,
        mode,
      });
      response.set('Cache-Control', 'no-store').status(201).json({ data: issued });
    }, next);
  };

  public readonly getSession = (request: Request, response: Response, next: NextFunction): void => {
    nextAsync(async () => {
      const { sessionId } = parseGameInput(sessionIdParamsSchema, request.params);
      const session = await this.service.getSession(authenticatedUser(response).id, sessionId);
      response.set('Cache-Control', 'no-store').status(200).json({ data: { session } });
    }, next);
  };
}
