import type { Producer } from 'kafkajs';
import { eq, isNull } from 'drizzle-orm';
import { outbox } from '../db/schema.ts';
import { db } from '../db/client.ts';
import { logger } from '../logger.ts';

/** Poll unsent outbox rows and publish them to Kafka, marking each as sent. */
export const startOutboxRelay = (producer: Producer) => {
    let currentTick = Promise.resolve();

    const interval = setInterval(() => {
        currentTick = (async () => {
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
                    messages: [
                        {
                            headers: {
                                eventId: String(row.id),
                                requestId: row.requestId ?? undefined,
                            },
                            value: row.payload,
                        },
                    ],
                });
                await db
                    .update(outbox)
                    .set({ sentAt: new Date() })
                    .where(eq(outbox.id, row.id));
            } catch (error) {
                logger.error({ err: error }, 'outbox relay tick failed');
            }
        })();
    }, 1000);

    return async () => {
        clearInterval(interval);
        await currentTick;
    };
};
