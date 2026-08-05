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
        await createTwit('test twit 1');
        await createTwit('test twit 2');
        await createTwit('test twit 3');

        const res = await fetch(`${baseUrl}/twits`, {
            method: 'GET',
            headers: {
                'content-type': 'application/json',
                'x-internal-token': process.env.INTERNAL_TOKEN!,
                'x-user-id': '1',
            },
        });
        const body = await res.json();
        assert.equal(body.length, 3);
    });

    it('responds the first page for offset=0', async () => {
        await createTwit('test twit 1');
        await createTwit('test twit 2');
        await createTwit('test twit 3');

        const res = await fetch(`${baseUrl}/twits?limit=2&offset=0`, {
            method: 'GET',
            headers: {
                'content-type': 'application/json',
                'x-internal-token': process.env.INTERNAL_TOKEN!,
                'x-user-id': '1',
            },
        });
        const body = await res.json();
        assert.equal(body.length, 2);
    });

    it('responds a different page for offset=2', async () => {
        await createTwit('test twit 1');
        await createTwit('test twit 2');
        await createTwit('test twit 3');

        const res1 = await fetch(`${baseUrl}/twits?limit=2&offset=0`, {
            method: 'GET',
            headers: {
                'content-type': 'application/json',
                'x-internal-token': process.env.INTERNAL_TOKEN!,
                'x-user-id': '1',
            },
        });

        const res2 = await fetch(`${baseUrl}/twits?limit=2&offset=2`, {
            method: 'GET',
            headers: {
                'content-type': 'application/json',
                'x-internal-token': process.env.INTERNAL_TOKEN!,
                'x-user-id': '1',
            },
        });
        const body1 = await res1.json();
        const ids1 = body1.map((item: { id: number }) => item.id);
        const body2 = await res2.json();
        const ids2 = body2.map((item: { id: number }) => item.id);
        assert.notDeepEqual(ids1, ids2);
    });

    it('responds 400 when limit is passed without offset', async () => {
        const res = await fetch(`${baseUrl}/twits?limit=2`, {
            method: 'GET',
            headers: {
                'content-type': 'application/json',
                'x-internal-token': process.env.INTERNAL_TOKEN!,
                'x-user-id': '1',
            },
        });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error, 'limit and offset must be provided together');
    });
});
