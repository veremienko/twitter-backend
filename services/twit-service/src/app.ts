import express from 'express';
import {
    httpMetricsMiddleware,
    internalAuth,
    metricsHandler,
    requestContextMiddleware,
} from '@twitter/shared';
import type { TwitService } from './twits/twit.service.ts';
import { twitRouter } from './twits/twit.controller.ts';

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;
if (!INTERNAL_TOKEN) throw new Error('INTERNAL_TOKEN env var is required');

export function createApp(twitService: TwitService) {
    const app = express();
    app.use(express.json());
    app.use(requestContextMiddleware);
    app.use(httpMetricsMiddleware('twit-service'));
    app.get('/metrics', metricsHandler);
    app.use(internalAuth(INTERNAL_TOKEN!));
    app.use(twitRouter(twitService));
    return app;
}
