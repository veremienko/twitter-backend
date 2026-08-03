import express from 'express';
import { createKafka, createRedis, internalAuth } from '@twitter/shared';
import { TwitService } from './twits/twit.service.ts';
import { twitRouter } from './twits/twit.controller.ts';
import { Partitioners } from 'kafkajs';

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;
if (!INTERNAL_TOKEN) throw new Error('INTERNAL_TOKEN env var is required');

async function main() {
    const redis = await createRedis();
    const producer = createKafka('twit-service').producer({
        createPartitioner: Partitioners.DefaultPartitioner,
    });
    await producer.connect();

    const app = express();
    app.use(express.json());

    app.use(internalAuth(INTERNAL_TOKEN!));

    const twitService = new TwitService(redis, producer);
    app.use(twitRouter(twitService));

    const port = process.env.TWIT_SERVICE_PORT ?? 3002;
    app.listen(port, () => {
        console.log(`twit-service started on port ${port}`);
    });
}

main();
