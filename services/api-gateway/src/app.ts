import express from 'express';
import cookieParser from 'cookie-parser';
import {
    httpMetricsMiddleware,
    metricsHandler,
    requestContext,
} from '@twitter/shared';
import apiRouter from './routes/index.ts';

export const createApp = () => {
    const app = express();

    app.use(express.json());
    app.use(cookieParser());
    app.use((req, res, next) => {
        const requestId =
            req.headers['x-request-id']?.toString() ?? crypto.randomUUID();
        requestContext.run({ requestId }, () => {
            res.setHeader('x-request-id', requestId);
            next();
        });
    });

    app.use(httpMetricsMiddleware('api-gateway'));
    app.get('/metrics', metricsHandler);
    app.use('/api', apiRouter);

    return app;
};
