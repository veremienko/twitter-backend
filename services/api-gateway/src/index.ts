import express from 'express';
import cookieParser from 'cookie-parser';
import apiRouter from './routes/index.ts';
import {
    createLogger,
    httpMetricsMiddleware,
    metricsHandler,
    registerShutdown,
    requestContextMiddleware,
} from '@twitter/shared';
import { redis } from './middleware.ts';

const logger = createLogger('api-gateway');

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
    const requestId =
        req.headers['x-request-id']?.toString() ?? crypto.randomUUID();

    res.setHeader('x-request-id', requestId); // клієнт бачить id — зручно для скарг "запит упав"

    requestContextMiddleware(req, res, next);
});

app.use(httpMetricsMiddleware('api-gateway'));
app.get('/metrics', metricsHandler);
app.use('/api', apiRouter);

const port = process.env.GATEWAY_PORT ?? 3000;
const server = app.listen(port, () => {
    logger.info({ port }, 'started');
});

registerShutdown(
    () => server.closeIdleConnections(),
    () => new Promise((resolve) => server.close(resolve)),
    () => redis.quit(),
);
