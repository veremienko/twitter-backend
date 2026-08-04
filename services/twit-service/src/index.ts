import { createKafka, createRedis, registerShutdown } from '@twitter/shared';
import { TwitService } from './twits/twit.service.ts';
import { Partitioners } from 'kafkajs';
import { startOutboxRelay } from './outbox/relay.ts';
import { db } from './db/client.ts';
import { createApp } from './app.ts';

async function main() {
    const redis = await createRedis();
    const producer = createKafka('twit-service').producer({
        createPartitioner: Partitioners.DefaultPartitioner,
    });
    await producer.connect();

    const stopRelay = startOutboxRelay(producer);

    const twitService = new TwitService(redis);

    const app = createApp(twitService);

    const port = process.env.TWIT_SERVICE_PORT ?? 3002;
    const server = app.listen(port, () => {
        console.log(`twit-service started on port ${port}`);
    });

    registerShutdown(
        () => server.closeIdleConnections(),
        () => new Promise((resolve) => server.close(resolve)),
        () => stopRelay(),
        () => producer.disconnect(),
        () => redis.quit(),
        () => db.$client.end(),
    );
}

main();
