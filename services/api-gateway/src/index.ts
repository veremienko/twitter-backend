import { createLogger, registerShutdown } from '@twitter/shared';
import { redis } from './middleware.ts';
import { createApp } from './app.ts';

const logger = createLogger('api-gateway');

const main = async () => {
    const app = createApp();

    const port = process.env.GATEWAY_PORT ?? 3000;
    const server = app.listen(port, () => {
        logger.info({ port }, 'started');
    });

    registerShutdown(
        () => server.closeIdleConnections(),
        () => new Promise((resolve) => server.close(resolve)),
        () => redis.quit(),
    );
};

main();
