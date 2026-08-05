import { pool } from '../db/client.ts';
import { producer } from '../db/producer.ts';
import type { RedisClient } from '@twitter/shared';

export class HealthService {
    redis: RedisClient;

    constructor(redis: RedisClient) {
        this.redis = redis;
    }

    /** Ping postgres, redis and kafka; report each status and overall health. */
    async getHealth() {
        const [postgres, redisStatus, kafka] = await Promise.all([
            pool.query('SELECT 1').then(
                () => 'ok',
                (e) => e.message,
            ),
            this.redis.ping().then(
                () => 'ok',
                (e: Error) => e.message,
            ),
            producer
                .send({ topic: 'health-check', messages: [{ value: 'ping' }] })
                .then(
                    () => 'ok',
                    (e) => e.message,
                ),
        ]);
        const status = { postgres, redis: redisStatus, kafka };
        const healthy = Object.values(status).every((s) => s === 'ok');
        return { status, healthy };
    }
}
