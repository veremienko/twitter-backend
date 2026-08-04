import express from 'express';
import { internalAuth } from '@twitter/shared';
import type { TwitService } from './twits/twit.service.ts';
import { twitRouter } from './twits/twit.controller.ts';

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;
if (!INTERNAL_TOKEN) throw new Error('INTERNAL_TOKEN env var is required');

export function createApp(twitService: TwitService) {
    const app = express();
    app.use(express.json());
    app.use(internalAuth(INTERNAL_TOKEN!));
    app.use(twitRouter(twitService));
    return app;
}
