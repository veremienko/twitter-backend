import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createRedis, type RedisClient } from './redis.ts';
import { createRateLimiter } from './rate-limit.ts';

describe('createRateLimiter', () => {
    let redis: RedisClient;

    before(async () => {
        redis = await createRedis();
    });

    beforeEach(async () => {
        await redis.flushDb();
    });

    after(async () => {
        await redis.quit();
    });

    async function startServer(capacity: number, refillPerSecond: number) {
        const app = express();
        const limiter = createRateLimiter(redis, {
            prefix: 'test',
            capacity,
            refillPerSecond,
            keyFn: (req) => (req.headers['x-test-key'] as string) ?? 'default',
        });
        app.get('/', limiter, (_req, res) =>
            res.status(200).json({ ok: true }),
        );

        const server = app.listen(0);
        await new Promise<void>((resolve) => server.once('listening', resolve));
        const { port } = server.address() as AddressInfo;

        return {
            request: (key = 'default') =>
                fetch(`http://localhost:${port}/`, {
                    headers: { 'x-test-key': key },
                }),
            close: () => new Promise((resolve) => server.close(resolve)),
        };
    }

    it('allows up to capacity requests, then 429s with Retry-After', async () => {
        const { request, close } = await startServer(3, 0.001);
        try {
            for (let i = 0; i < 3; i++) {
                assert.equal((await request()).status, 200);
            }
            const blocked = await request();
            assert.equal(blocked.status, 429);
            assert.ok(Number(blocked.headers.get('retry-after')) > 0);
        } finally {
            await close();
        }
    });

    it('refills tokens once enough time has passed', async () => {
        const { request, close } = await startServer(1, 20);
        try {
            assert.equal((await request()).status, 200);
            assert.equal((await request()).status, 429);
            await new Promise((resolve) => setTimeout(resolve, 100));
            assert.equal((await request()).status, 200);
        } finally {
            await close();
        }
    });

    it('tracks separate keys independently', async () => {
        const { request, close } = await startServer(1, 0.001);
        try {
            assert.equal((await request('a')).status, 200);
            assert.equal((await request('a')).status, 429);
            assert.equal((await request('b')).status, 200);
        } finally {
            await close();
        }
    });
});
