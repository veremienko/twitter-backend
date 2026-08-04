import { after, before, beforeEach, describe, it } from 'node:test';
import { createRedis, HttpError, type RedisClient } from '@twitter/shared';
import { TwitService } from './twit.service.ts';
import { db } from '../db/client.ts';
import { sql } from 'drizzle-orm';
import { likes, twits } from '../db/schema.ts';
import assert from 'node:assert/strict';

describe('TwitService.postLike', () => {
    let redis: RedisClient;
    let service: TwitService;

    before(async () => {
        const result = await db.execute(sql`SELECT current_database() AS name`);
        const dbName = result.rows[0]!.name as string;
        if (!dbName.endsWith('_test')) {
            throw new Error(`Tests must run against a *_test database, got "${dbName}"`);
        }

        redis = await createRedis();
        service = new TwitService(redis);
    });

    beforeEach(async () => {
        await db.execute(
            sql`TRUNCATE twits, likes, outbox RESTART IDENTITY CASCADE`,
        );
    });

    after(async () => {
        await redis.quit();
        await db.$client.end();
    });

    async function createTwit() {
        const [twit] = await db
            .insert(twits)
            .values({ authorId: 1, text: 'test twit', likes: 0 })
            .returning();
        return twit!.id;
    }

    it('increments the counter and stores the like ', async () => {
        const twitId = await createTwit();

        const twit = await service.postLike({
            userId: 1,
            twitId,
        });

        const likeRows = await db.select().from(likes);

        assert.equal(twit.likes, 1);
        assert.equal(likeRows.length, 1);
    });

    it('rejects a duplicate like with 409 and keeps the counter at 1', async () => {
        const twitId = await createTwit();

        await service.postLike({
            userId: 1,
            twitId,
        });

        await assert.rejects(service.postLike({ twitId, userId: 1 }), (err) => {
            assert.ok(err instanceof HttpError);
            assert.equal(err.status, 409);
            return true;
        });

        const likesCount = await db.select().from(likes);

        assert.equal(likesCount.length, 1);
    });

    it('rejects a like of a missing twit with 404 and rolls back the like row', async () => {
        await assert.rejects(service.postLike({ twitId: 999, userId: 1 }), (err) => {
            assert.ok(err instanceof HttpError);
            assert.equal(err.status, 404);
            return true;
        });

        const likesCount = await db.select().from(likes);

        assert.equal(likesCount.length, 0);

    });

    it('counts likes from different users independently', async () => {
        const twitId = await createTwit();

        await service.postLike({
            userId: 1,
            twitId,
        });

        const twit = await service.postLike({
            userId: 2,
            twitId,
        });

        assert.equal(twit.likes, 2);

        const likesCount = await db.select().from(likes);

        assert.equal(likesCount.length, 2);
    });
});
