import { after, before, beforeEach, describe, it } from 'node:test';
import { createRedis, type RedisClient } from '@twitter/shared';
import { TwitService } from './twit.service.ts';
import { db } from '../db/client.ts';
import { sql } from 'drizzle-orm';
import { twits } from '../db/schema.ts';
import assert from 'node:assert/strict';
import http from 'node:http';

describe('TwitService.getTwits cache stampede', () => {
    let redis: RedisClient;
    let service: TwitService;
    let userServiceRequests = 0;
    let userService: http.Server;

    before(async () => {
        const result = await db.execute(sql`SELECT current_database() AS name`);
        const dbName = result.rows[0]!.name as string;
        if (!dbName.endsWith('_test')) {
            throw new Error(
                `Tests must run against a *_test database, got "${dbName}"`,
            );
        }

        redis = await createRedis();
        service = new TwitService(redis);

        // Stands in for user-service so fetchAuthorNames succeeds and the
        // feed isn't served degraded — a degraded response is never cached,
        // which would hide the stampede lock's effect entirely.
        userService = http.createServer((_req, res) => {
            userServiceRequests++;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify([{ id: 1, name: 'Alice' }]));
        });
        await new Promise<void>((resolve) => userService.listen(3004, resolve));
    });

    beforeEach(async () => {
        userServiceRequests = 0;
        await redis.flushDb();
        await db.execute(
            sql`TRUNCATE twits, likes, outbox RESTART IDENTITY CASCADE`,
        );
    });

    after(async () => {
        await redis.quit();
        await new Promise((resolve) => userService.close(resolve));
        await db.$client.end();
    });

    async function createTwit() {
        const [twit] = await db
            .insert(twits)
            .values({ authorId: 1, text: 'test twit', likes: 0 })
            .returning();
        return twit!;
    }

    // A cache hit is served straight from the JSON string in Redis, while a
    // recompute returns `createdAt` as a live Date — same feed, different
    // representation. Round-tripping both sides through JSON normalizes that
    // away so the comparison is about the feed content, not the encoding.
    const asJson = (value: unknown) => JSON.parse(JSON.stringify(value));

    it('caches the full feed and serves the next call from cache', async () => {
        await createTwit();

        const first = await service.getTwits({});
        assert.equal(userServiceRequests, 1);
        assert.equal(first.items[0]!.authorName, 'Alice');

        const second = await service.getTwits({});
        assert.equal(userServiceRequests, 1);
        assert.deepEqual(asJson(second.items), asJson(first.items));
    });

    it('lets only one concurrent miss recompute; the other waits for its cache', async () => {
        await createTwit();

        const [a, b] = await Promise.all([
            service.getTwits({}),
            service.getTwits({}),
        ]);

        assert.equal(userServiceRequests, 1);
        assert.deepEqual(asJson(a.items), asJson(b.items));
        assert.equal(await redis.get('lock:twits:all'), null);
    });
});
