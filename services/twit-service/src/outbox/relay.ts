import type { Producer } from 'kafkajs';
import { eq, isNull } from 'drizzle-orm';
import { outbox } from '../db/schema.ts';
import { db } from '../db/client.ts';

/** Poll unsent outbox rows and publish them to Kafka, marking each as sent. */
export const startOutboxRelay = (producer: Producer) => {
    setInterval(async () => {
        try {
            const [row] = await db
                .select()
                .from(outbox)
                .where(isNull(outbox.sentAt))
                .orderBy(outbox.id)
                .limit(1);
            if (!row) return;

            await producer.send({
                topic: row.topic,
                messages: [{ value: row.payload }],
            });
            await db
                .update(outbox)
                .set({ sentAt: new Date() })
                .where(eq(outbox.id, row.id));
        } catch (error) {
            console.error('Outbox relay tick failed:', error);
        }
    }, 1000);
};
