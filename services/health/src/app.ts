import express from 'express';
import { metricsHandler, requestContextMiddleware } from '@twitter/shared';
import { HealthService } from './health/health.service.ts';
import { healthRouter } from './health/health.controller.ts';

export const createApp = (healthService: HealthService) => {
    const app = express();

    app.use(express.json());
    app.use(requestContextMiddleware);
    app.get('/metrics', metricsHandler);
    app.use(healthRouter(healthService));

    return app;
};
