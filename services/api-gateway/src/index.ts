import express from 'express';
import cookieParser from 'cookie-parser';
import apiRouter from './routes/index.ts';
import { registerShutdown } from '@twitter/shared';
import { redis } from './middleware.ts';

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
    const requestId =
        req.headers['x-request-id']?.toString() ?? crypto.randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('x-request-id', requestId); // клієнт бачить id — зручно для скарг "запит упав"
    next();
});

app.use('/api', apiRouter);

const port = process.env.GATEWAY_PORT ?? 3000;
const server = app.listen(port, () => {
    console.log(`api-gateway started on port ${port}`);
});

registerShutdown(
    () => server.closeIdleConnections(),
    () => new Promise((resolve) => server.close(resolve)),
    () => redis.quit(),
);
