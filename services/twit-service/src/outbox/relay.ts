import type { Producer } from 'kafkajs';
import { eq, isNull } from 'drizzle-orm';
import { outbox } from '../db/schema.ts';
import { db } from '../db/client.ts';
import { logger } from '../logger.ts';

/**
 * Poll unsent outbox rows and publish them to Kafka, marking each as sent.
 *
 * The select and the `sentAt` update run inside one transaction with
 * `FOR UPDATE SKIP LOCKED`. With more than one twit-service instance ticking
 * the relay at the same time, a plain `select` + separate `update` is a real
 * race: two instances can both pick the same unsent row before either has
 * marked it sent, and both call `producer.send` — the same event published
 * twice. Locking the row for the length of the transaction (including the
 * `producer.send` in between) closes that window; `SKIP LOCKED` means the
 * instance that loses the race just sees no row that tick instead of
 * blocking on one already being relayed.
 */
export const startOutboxRelay = (producer: Producer) => {
    let currentTick = Promise.resolve();

    const interval = setInterval(() => {
        currentTick = (async () => {
            try {
                await db.transaction(async (tx) => {
                    const [row] = await tx
                        .select()
                        .from(outbox)
                        .where(isNull(outbox.sentAt))
                        .orderBy(outbox.id)
                        .limit(1)
                        .for('update', { skipLocked: true });
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
                    await tx
                        .update(outbox)
                        .set({ sentAt: new Date() })
                        .where(eq(outbox.id, row.id));
                });
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
