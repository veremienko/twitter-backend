import { Kafka, logLevel } from 'kafkajs';

/** Create a Kafka client for a service. Brokers come from KAFKA_BROKERS. */
export function createKafka(clientId: string): Kafka {
    return new Kafka({
        clientId,
        brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
        logLevel: logLevel.WARN,
    });
}

/** Create topics if they do not exist yet. Safe to call on every startup. */
export async function ensureTopics(kafka: Kafka, topics: string[]) {
    const admin = kafka.admin();
    await admin.connect();
    const existing = await admin.listTopics();
    const missing = topics.filter((topic) => !existing.includes(topic));
    if (missing.length) {
        await admin.createTopics({ topics: missing.map((topic) => ({ topic })) });
    }
    await admin.disconnect();
}
