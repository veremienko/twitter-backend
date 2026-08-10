import {
    createKafka,
    createLogger,
    createRedis,
    ensureTopics,
    registerShutdown,
    requestContext,
    TOPICS,
} from '@twitter/shared';

import { createServer } from 'http';
import { createWsServer } from './ws.ts';
import { readFileSync } from 'fs';

const logger = createLogger('notification-service');

const main = async () => {
    const redis = await createRedis();

    const app = createServer();

    const ws = createWsServer(app);

    const kafka = createKafka('notification-service');
    await ensureTopics(kafka, [TOPICS.TWIT_CREATED]);

    const consumer = kafka.consumer({
        groupId: 'notification-service',
    });
    await consumer.connect();
    await consumer.subscribe({ topic: TOPICS.TWIT_CREATED });

    await consumer.run({
        eachMessage: async ({ message }) => {
            const eventId = message.headers?.eventId?.toString();
            const requestId = message.headers?.requestId?.toString();
            await requestContext.run(
                { requestId: requestId ?? 'unknown' },
                async () => {
                    if (!eventId) {
                        logger.warn({ eventId }, 'Message without eventId');
                    } else {
                        const isNew = await redis.set(
                            `processed:${eventId}`,
                            '1',
                            {
                                NX: true,
                                EX: 60 * 60 * 24 * 7,
                            },
                        );
                        if (!isNew) {
                            logger.info(
                                { eventId },
                                'Skipping duplicate event',
                            );
                            return;
                        }
                    }

                    const twit = JSON.parse(message.value!.toString());

                    ws.broadcast(JSON.stringify(twit));

                    logger.info(
                        {
                            eventId,
                            twitId: twit.id,
                            authorId: twit.authorId,
                            text: twit.text,
                        },
                        'Notification: new twit',
                    );
                },
            );
        },
    });

    logger.info({ topic: TOPICS.TWIT_CREATED }, 'Consuming topic');

    const port = process.env.NOTIFICATION_SERVICE_PORT ?? 8080;
    const server = app.listen(port, () => {
        logger.info({ port }, 'service started');
    });

    registerShutdown(
        () => server.closeIdleConnections(),
        () => ws.closeAll(),
        () => new Promise((resolve) => server.close(resolve)),
        () => consumer.disconnect(),
        () => consumer.disconnect(),
        () => redis.quit(),
    );
};

main();
