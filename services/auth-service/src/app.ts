import { AuthService } from './auth/auth.service.ts';
import { authController as authRouter } from './auth/auth.controller.ts';
import express from 'express';
import {
    httpMetricsMiddleware,
    internalAuth,
    metricsHandler,
    requestContextMiddleware,
} from '@twitter/shared';

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;
if (!INTERNAL_TOKEN) throw new Error('INTERNAL_TOKEN env var is required');

export const createApp = (authService: AuthService) => {
    const app = express();

    app.use(express.json());
    app.use(requestContextMiddleware);
    app.use(httpMetricsMiddleware('auth-service'));
    app.get('/metrics', metricsHandler);
    app.use(internalAuth(INTERNAL_TOKEN));
    app.use('/', authRouter(authService));

    return app;
};
