import { after, before, beforeEach, describe, it } from 'node:test';
import { createRedis, type RedisClient } from '@twitter/shared';
import { db } from '../db/client.ts';
import { sql } from 'drizzle-orm';
import http from 'http';
import assert from 'node:assert/strict';
import { createApp } from '../app.ts';
import { TwitService } from './twit.service.ts';
import type { AddressInfo } from 'node:net';

describe('twit controller', () => {
    let redis: RedisClient;
    let server: http.Server;
    let baseUrl: string;

    before(async () => {
        const result = await db.execute(sql`SELECT current_database() AS name`);
        const dbName = result.rows[0]!.name as string;
        if (!dbName.endsWith('_test')) {
            throw new Error(
                `Tests must run against a *_test database, got "${dbName}"`,
            );
        }

        redis = await createRedis();
        const twitService = new TwitService(redis);
        server = createApp(twitService).listen(0);
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://localhost:${port}`;
    });

    beforeEach(async () => {
        await redis.flushDb();
        await db.execute(
            sql`TRUNCATE twits, likes, outbox RESTART IDENTITY CASCADE`,
        );
    });

    after(async () => {
        await server.closeIdleConnections();
        new Promise((resolve) => server.close(resolve));
        await redis.quit();
        await db.$client.end();
    });

    function createTwit(text: string) {
        return fetch(`${baseUrl}/twits`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-internal-token': process.env.INTERNAL_TOKEN!,
                'x-user-id': '1',
            },
            body: JSON.stringify({
                text,
            }),
        });
    }

    /** GET /twits, optionally paginated. The cursor travels as a header. */
    function getTwits(query = '', cursor?: string) {
        return fetch(`${baseUrl}/twits${query}`, {
            method: 'GET',
            headers: {
                'content-type': 'application/json',
                'x-internal-token': process.env.INTERNAL_TOKEN!,
                'x-user-id': '1',
                ...(cursor ? { 'x-cursor': cursor } : {}),
            },
        });
    }

    type Feed = { items: { id: number }[]; nextCursor?: string };

    const idsOf = (feed: Feed) => feed.items.map((twit) => twit.id);

    /** Newest first, so twits created last come back first. */
    async function seed(count: number) {
        for (let i = 1; i <= count; i++) await createTwit(`test twit ${i}`);
    }

    it('creates a twit and responds 201', async () => {
        const res = await createTwit('test twit');
        assert.equal(res.status, 201);
        const twit = await res.json();
        assert.equal(twit.text, 'test twit');
        assert.equal(twit.authorId, 1);
    });

    it('responds 401 without the internal token', async () => {
        const res = await fetch(`${baseUrl}/twits`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-user-id': '1',
            },
            body: JSON.stringify({
                text: 'test twit',
            }),
        });

        assert.equal(res.status, 401);
    });

    it('responds 400 for an empty body', async () => {
        const res = await fetch(`${baseUrl}/twits`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-internal-token': process.env.INTERNAL_TOKEN!,
                'x-user-id': '1',
            },
            body: '',
        });
        assert.equal(res.status, 400);
    });

    it('responds all twits for an empty query', async () => {
        await seed(3);

        const res = await getTwits();
        const body: Feed = await res.json();

        assert.equal(body.items.length, 3);
    });

    it('responds the first page and a cursor to continue from', async () => {
        await seed(3);

        const res = await getTwits('?limit=2');
        const body: Feed = await res.json();

        assert.equal(res.status, 200);
        assert.deepEqual(idsOf(body), [3, 2]);
        assert.equal(typeof body.nextCursor, 'string');
    });

    it('walks the whole feed through the cursor without gaps or repeats', async () => {
        await seed(5);

        const seen: number[] = [];
        let cursor: string | undefined;

        // Bounded so a cursor that stops advancing fails loudly instead of hanging.
        for (let page = 0; page < 10; page++) {
            const body: Feed = await (
                await getTwits('?limit=2', cursor)
            ).json();
            if (body.items.length === 0) break;
            seen.push(...idsOf(body));
            cursor = body.nextCursor;
        }

        assert.deepEqual(seen, [5, 4, 3, 2, 1]);
    });

    /**
     * The reason keyset pagination exists: with offset, a twit inserted between
     * two reads shifts every later row down one, so page 2 repeats the tail of
     * page 1. A cursor is anchored to a row, so it cannot drift.
     */
    it('does not repeat a twit when a new one is posted between pages', async () => {
        await seed(4);

        const page1: Feed = await (await getTwits('?limit=2')).json();
        assert.deepEqual(idsOf(page1), [4, 3]);

        await createTwit('posted between the two reads');

        const page2: Feed = await (
            await getTwits('?limit=2', page1.nextCursor)
        ).json();

        assert.deepEqual(idsOf(page2), [2, 1]);
        const repeated = idsOf(page2).filter((id) => idsOf(page1).includes(id));
        assert.deepEqual(repeated, [], 'page 2 must not repeat page 1');
    });

    it('responds an empty page and stops at the end of the feed', async () => {
        await seed(2);

        const page1: Feed = await (await getTwits('?limit=2')).json();
        assert.deepEqual(idsOf(page1), [2, 1]);

        const page2: Feed = await (
            await getTwits('?limit=2', page1.nextCursor)
        ).json();
        assert.deepEqual(idsOf(page2), []);
    });

    it('responds 400 for a malformed cursor', async () => {
        await seed(3);

        for (const bad of [
            'not-base64url!!',
            Buffer.from('not json').toString('base64url'),
            Buffer.from('{"id":"x","createdAt":"nope"}').toString('base64url'),
        ]) {
            const res = await getTwits('?limit=2', bad);
            assert.equal(res.status, 400, `expected 400 for "${bad}"`);
            const body = await res.json();
            assert.equal(body.error, 'nextCursor is malformed');
        }
    });

    it('responds 400 for a cursor without a limit', async () => {
        await seed(3);

        const first: Feed = await (await getTwits('?limit=2')).json();
        const res = await getTwits('', first.nextCursor);

        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error, 'nextCursor requires limit');
    });
});
