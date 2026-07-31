import express from 'express';
import { createKafka, createRedis } from '@twitter/shared';
import { TwitService } from './twits/twit.service.ts';
import { twitRouter } from './twits/twit.controller.ts';

async function main() {
    const redis = await createRedis();
    const producer = createKafka('twit-service').producer();
    await producer.connect();

    const app = express();
    app.use(express.json());

    const twitService = new TwitService(redis, producer);
    app.use(twitRouter(twitService));

    const port = process.env.TWIT_SERVICE_PORT ?? 3001;
    app.listen(port, () => {
        console.log(`twit-service started on port ${port}`);
    });
}

main();
