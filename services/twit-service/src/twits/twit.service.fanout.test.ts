import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRedis, HttpError, type RedisClient } from '@twitter/shared';
import { TwitService } from './twit.service.ts';
import { db } from '../db/client.ts';
import { sql } from 'drizzle-orm';
import { homeFeed } from '../db/schema.ts';

describe('TwitService fan-out (createTwit / getHomeFeed / getFeedOnRead)', () => {
    let redis: RedisClient;
    let service: TwitService;
    let userService: http.Server;

    // followerGraph[followeeId] = follower ids; followingGraph[followerId] = followee ids.
    // Populated per test so the fake user-service can answer both directions.
    let followerGraph: Record<number, number[]>;
    let followingGraph: Record<number, number[]>;

    function startUserService() {
        return new Promise<http.Server>((resolve) => {
            const srv = http.createServer((req, res) => {
                const url = new URL(req.url!, 'http://internal');
                res.setHeader('content-type', 'application/json');

                const followersMatch = url.pathname.match(
                    /^\/users\/(\d+)\/followers\/ids$/,
                );
                const followingMatch = url.pathname.match(
                    /^\/users\/(\d+)\/following\/ids$/,
                );

                if (followersMatch) {
                    const id = Number(followersMatch[1]);
                    res.end(JSON.stringify(followerGraph[id] ?? []));
                    return;
                }
                if (followingMatch) {
                    const id = Number(followingMatch[1]);
                    res.end(JSON.stringify(followingGraph[id] ?? []));
                    return;
                }
                if (url.pathname === '/users') {
                    const ids = (url.searchParams.get('ids') ?? '')
                        .split(',')
                        .filter(Boolean);
                    res.end(
                        JSON.stringify(
                            ids.map((id) => ({
                                id: Number(id),
                                name: `User ${id}`,
                            })),
                        ),
                    );
                    return;
                }
                res.statusCode = 404;
                res.end(JSON.stringify({ error: 'not found' }));
            });
            srv.listen(3004, () => resolve(srv));
        });
    }

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
        userService = await startUserService();
    });

    beforeEach(async () => {
        followerGraph = {};
        followingGraph = {};
        await redis.flushDb();
        await db.execute(
            sql`TRUNCATE twits, likes, outbox, home_feed RESTART IDENTITY CASCADE`,
        );
    });

    after(async () => {
        await redis.quit();
        await new Promise((resolve) => userService.close(resolve));
        await db.$client.end();
    });

    it('fans a new twit out to every current follower', async () => {
        // Author 1 has two followers: 2 and 3.
        followerGraph[1] = [2, 3];

        const twit = await service.createTwit({ authorId: 1, text: 'hello' });

        const rows = await db
            .select({
                followerId: homeFeed.followerId,
                twitId: homeFeed.twitId,
            })
            .from(homeFeed);
        assert.deepEqual(
            rows.sort((a, b) => a.followerId - b.followerId),
            [
                { followerId: 2, twitId: twit.id },
                { followerId: 3, twitId: twit.id },
            ],
        );
    });

    it('creates the twit even when user-service is unreachable, with no fan-out rows', async () => {
        await new Promise((resolve) => userService.close(resolve));
        try {
            const twit = await service.createTwit({
                authorId: 1,
                text: 'no fan-out today',
            });
            assert.ok(twit.id);

            const rows = await db.select().from(homeFeed);
            assert.equal(rows.length, 0);
        } finally {
            userService = await startUserService();
        }
    });

    it('getHomeFeed and getFeedOnRead agree on the same feed for a follower', async () => {
        // User 2 follows user 1; user 1 twits once.
        followerGraph[1] = [2];
        followingGraph[2] = [1];

        const twit = await service.createTwit({ authorId: 1, text: 'hi' });

        const home = await service.getHomeFeed({ userId: 2, limit: 10 });
        const onRead = await service.getFeedOnRead({ userId: 2, limit: 10 });

        assert.equal(home.items.length, 1);
        assert.equal(home.items[0]!.id, twit.id);
        assert.equal(onRead.items.length, 1);
        assert.equal(onRead.items[0]!.id, twit.id);
        assert.equal(home.items[0]!.authorName, onRead.items[0]!.authorName);
    });

    it('getFeedOnRead fails loudly when user-service is unreachable, unlike getHomeFeed', async () => {
        await new Promise((resolve) => userService.close(resolve));
        try {
            await assert.rejects(
                service.getFeedOnRead({ userId: 2, limit: 10 }),
                (err) => {
                    assert.ok(err instanceof HttpError);
                    assert.equal(err.status, 503);
                    return true;
                },
            );

            // getHomeFeed never calls user-service for the feed itself (only
            // to enrich author names, which degrades instead of failing), so
            // it still answers even with user-service down.
            const home = await service.getHomeFeed({ userId: 2, limit: 10 });
            assert.deepEqual(home.items, []);
        } finally {
            userService = await startUserService();
        }
    });
});
