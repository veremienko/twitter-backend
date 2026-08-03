import { createKafka, ensureTopics, TOPICS } from '@twitter/shared';

async function main() {
    const kafka = createKafka('notification-service');
    await ensureTopics(kafka, [TOPICS.TWIT_CREATED]);

    const consumer = kafka.consumer({
        groupId: 'notification-service',
    });
    await consumer.connect();
    await consumer.subscribe({ topic: TOPICS.TWIT_CREATED });

    await consumer.run({
        eachMessage: async ({ message }) => {
            const twit = JSON.parse(message.value!.toString());
            console.log(
                `Notification: new twit #${twit.id} by ${twit.authorId}: "${twit.text}"`,
            );
        },
    });

    console.log(`notification-service consuming topic ${TOPICS.TWIT_CREATED}`);
}

main();
