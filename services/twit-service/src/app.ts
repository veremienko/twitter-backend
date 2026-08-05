import express from 'express';
import {
    internalAuth,
    metricsHandler,
    requestContextMiddleware,
} from '@twitter/shared';
import type { TwitService } from './twits/twit.service.ts';
import { twitRouter } from './twits/twit.controller.ts';
import { logger } from './logger.ts';

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;
if (!INTERNAL_TOKEN) throw new Error('INTERNAL_TOKEN env var is required');

export function createApp(twitService: TwitService) {
    const app = express();
    app.use(express.json());
    app.use(requestContextMiddleware);
    app.use((req, res, next) => {
        res.on('finish', () => {
            logger.info(
                { method: req.method, path: req.path, status: res.statusCode },
                'request completed',
            );
        });
        next();
    });
    app.get('/metrics', metricsHandler);
    app.use(internalAuth(INTERNAL_TOKEN!));
    app.use(twitRouter(twitService));
    return app;
}
