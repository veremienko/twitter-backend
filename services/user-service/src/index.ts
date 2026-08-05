import express from 'express';
import {
    createLogger,
    internalAuth,
    registerShutdown,
    requestContextMiddleware,
} from '@twitter/shared';
import { UsersService } from './users/users.service.ts';
import { usersController as usersRouter } from './users/users.controller.ts';
import { db } from './db/client.ts';

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;
if (!INTERNAL_TOKEN) throw new Error('INTERNAL_TOKEN env var is required');

const logger = createLogger('user-service');

const main = async () => {
    const app = express();

    app.use(express.json());

    app.use(requestContextMiddleware);
    app.use(internalAuth(INTERNAL_TOKEN));

    const usersService = new UsersService();
    app.use('/', usersRouter(usersService));

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
