import { createLogger, createRedis, registerShutdown } from '@twitter/shared';
import { createApp } from './app.ts';
import { HealthService } from './health/health.service.ts';
import { producer } from './db/producer.ts';
import { pool } from './db/client.ts';

const logger = createLogger('health');

const main = async ()=> {
    const redis = await createRedis();

    await producer.connect();

    const healthService = new HealthService(redis);
    const app = createApp(healthService);

    const port = process.env.HEALTH_SERVICE_PORT ?? 3001;
    const server = app.listen(port, () => {
        logger.info({ port }, 'started');
    });

    registerShutdown(
        () => server.closeIdleConnections(),
        () => new Promise((resolve) => server.close(resolve)),
        () => producer.disconnect(),
        () => redis.quit(),
        () => pool.end(),
    );
}

main();
