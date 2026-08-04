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

    it('creates a twit and responds 201', async () => {
        const res = await fetch(`${baseUrl}/twits`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-internal-token': process.env.INTERNAL_TOKEN!,
                'x-user-id': '1',
            },
            body: JSON.stringify({
                text: 'test twit',
            }),
        });
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
});
