import express from 'express';
import { createKafka, createRedis, registerShutdown } from '@twitter/shared';
import { pool } from './db/client.ts';
import { Partitioners } from 'kafkajs';

async function main() {
    const redis = await createRedis();
    const producer = createKafka('health').producer({
        createPartitioner: Partitioners.DefaultPartitioner,
    });
    await producer.connect();

    const app = express();
    app.use(express.json());

    app.get('/health', async (req, res) => {
        const [postgres, redisStatus, kafka] = await Promise.all([
            pool.query('SELECT 1').then(
                () => 'ok',
                (e) => e.message,
            ),
            redis.ping().then(
                () => 'ok',
                (e: Error) => e.message,
            ),
            producer
                .send({ topic: 'health-check', messages: [{ value: 'ping' }] })
                .then(
                    () => 'ok',
                    (e) => e.message,
                ),
        ]);
        const status = { postgres, redis: redisStatus, kafka };
        const healthy = Object.values(status).every((s) => s === 'ok');
        res.status(healthy ? 200 : 503).json(status);
    });

    const port = process.env.HEALTH_SERVICE_PORT ?? 3001;
    const server = app.listen(port, () => {
        console.log(`health started on port ${port}`);
    });

    registerShutdown(
        () => server.closeIdleConnections(),
        () => new Promise((resolve) => server.close(resolve)),
        () => producer.disconnect(),
        () => redis.quit(),
    );
}

main();
