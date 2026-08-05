import express from 'express';
import {
    internalAuth,
    metricsHandler,
    requestContextMiddleware,
} from '@twitter/shared';
import { UsersService } from './users/users.service.ts';
import { usersRouter } from './users/users.controller.ts';

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;
if (!INTERNAL_TOKEN) throw new Error('INTERNAL_TOKEN env var is required');

export const createApp = (usersService: UsersService) => {
    const app = express();

    app.use(express.json());
    app.use(requestContextMiddleware);
    app.get('/metrics', metricsHandler);
    app.use(internalAuth(INTERNAL_TOKEN));
    app.use('/', usersRouter(usersService));

    return app;
};
