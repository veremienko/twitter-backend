import { createLogger, registerShutdown } from '@twitter/shared';
import { db } from './db/client.ts';
import { createApp } from './app.ts';
import { UsersService } from './users/users.service.ts';
import { ensureBucket } from './storage/client.ts';

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;
if (!INTERNAL_TOKEN) throw new Error('INTERNAL_TOKEN env var is required');

const logger = createLogger('user-service');

const main = async () => {
    await ensureBucket();
    const usersService = new UsersService();
    const app = createApp(usersService);

    const port = process.env.USER_SERVICE_PORT ?? 3004;
    const server = app.listen(port, () => {
        logger.info({ port }, 'service started');
    });

    registerShutdown(
        () => server.closeIdleConnections(),
        () => new Promise((resolve) => server.close(resolve)),
        () => db.$client.end(),
    );
};

main();
