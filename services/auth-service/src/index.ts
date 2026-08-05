import { createLogger, createRedis, registerShutdown } from '@twitter/shared';
import { AuthService } from './auth/auth.service.ts';
import { createApp } from './app.ts';

const logger = createLogger('auth-service');

const main = async () => {
    const redis = await createRedis();

    const authService = new AuthService(redis);
    const app = createApp(authService);

    const port = process.env.AUTH_SERVICE_PORT ?? 3003;
    const server = app.listen(port, () => {
        logger.info({ port }, 'service started');
    });

    registerShutdown(
        () => server.closeIdleConnections(),
        () => new Promise((resolve) => server.close(resolve)),
        () => redis.quit(),
    );
};

main();
