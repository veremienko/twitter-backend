import express from 'express';
import { internalAuth } from '@twitter/shared';
import type { TwitService } from './twits/twit.service.ts';
import { twitRouter } from './twits/twit.controller.ts';
import { AsyncLocalStorage } from 'node:async_hooks';

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;
if (!INTERNAL_TOKEN) throw new Error('INTERNAL_TOKEN env var is required');

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

export function createApp(twitService: TwitService) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        const requestId =
            req.headers['x-request-id']?.toString() ?? crypto.randomUUID();
        requestContext.run({ requestId }, () => next());
    });
    app.use(internalAuth(INTERNAL_TOKEN!));
    app.use(twitRouter(twitService));
    return app;
}
