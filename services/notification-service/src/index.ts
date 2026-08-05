import {
    createKafka,
    createRedis,
    ensureTopics,
    registerShutdown,
    TOPICS,
} from '@twitter/shared';

async function main() {
    const redis = await createRedis();

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

            if (!eventId) {
                console.warn(
                    'Message without eventId, processing without dedup',
                );
            } else {
                const isNew = await redis.set(`processed:${eventId}`, '1', {
                    NX: true,
                    EX: 60 * 60 * 24 * 7,
                });
                if (!isNew) {
                    console.log(
                        `[${requestId}] Skipping duplicate event ${eventId}`,
                    );
                    return;
                }
            }

            const twit = JSON.parse(message.value!.toString());
            console.log(
                `[${requestId}] Notification: new twit #${twit.id} by ${twit.authorId}: "${twit.text}"`,
            );
        },
    });
    console.log(`notification-service consuming topic ${TOPICS.TWIT_CREATED}`);

    registerShutdown(
        () => consumer.disconnect(),
        () => redis.quit(),
    );
}

main();
