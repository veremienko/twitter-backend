import { pool } from '../db/client.ts';
import type { Response } from 'express';
import { producer } from '../db/producer.ts';
import type { RedisClient } from '@twitter/shared';

export class HealthService {
    redis: RedisClient;

    constructor(redis: RedisClient) {
        this.redis = redis;
    }

    async getHealth(res: Response) {
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
        res.status(healthy ? 200 : 503).json(status);
    }
}
