import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { users } from '../db/schema.ts';
import { createApp } from '../app.ts';
import { UsersService } from './users.service.ts';

describe('users controller: follows', () => {
    let server: http.Server;
    let baseUrl: string;

    const internal = { 'x-internal-token': process.env.INTERNAL_TOKEN! };

    before(async () => {
        const result = await db.execute(sql`SELECT current_database() AS name`);
        const dbName = result.rows[0]!.name as string;
        if (!dbName.endsWith('_test')) {
            throw new Error(
                `Tests must run against a *_test database, got "${dbName}"`,
            );
        }

        server = createApp(new UsersService()).listen(0);
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://localhost:${port}`;
    });

    beforeEach(async () => {
        await db.execute(sql`TRUNCATE users, follows RESTART IDENTITY CASCADE`);
    });

    after(async () => {
        server.closeIdleConnections();
        await new Promise((resolve) => server.close(resolve));
        await db.$client.end();
    });

    async function createUser(email: string) {
        const res = await fetch(`${baseUrl}/users`, {
            method: 'POST',
            headers: { ...internal, 'content-type': 'application/json' },
            body: JSON.stringify({
                email,
                passwordHash: 'hash',
                name: email,
                age: 30,
                sex: 'male',
            }),
        });
        assert.equal(res.status, 201);
        return (await res.json()).id as number;
    }

    function follow(followerId: number | string, followeeId: number | string) {
        return fetch(`${baseUrl}/follows`, {
            method: 'POST',
            headers: {
                ...internal,
                'content-type': 'application/json',
                'x-user-id': String(followerId),
            },
            body: JSON.stringify({ followeeId }),
        });
    }

    function unfollow(
        followerId: number | string,
        followeeId: number | string,
    ) {
        return fetch(`${baseUrl}/follows/${followeeId}`, {
            method: 'DELETE',
            headers: { ...internal, 'x-user-id': String(followerId) },
        });
    }

    async function counts(userId: number) {
        const [row] = await db
            .select({
                followerCount: users.followerCount,
                followingCount: users.followingCount,
            })
            .from(users)
            .where(eq(users.id, userId));
        return row!;
    }

    it('follows a user and bumps both counters', async () => {
        const a = await createUser('a@example.com');
        const b = await createUser('b@example.com');

        const res = await follow(a, b);
        assert.equal(res.status, 201);

        assert.deepEqual(await counts(a), {
            followerCount: 0,
            followingCount: 1,
        });
        assert.deepEqual(await counts(b), {
            followerCount: 1,
            followingCount: 0,
        });
    });

    it('rejects a duplicate follow with 409 and leaves counters alone', async () => {
        const a = await createUser('a@example.com');
        const b = await createUser('b@example.com');
        await follow(a, b);

        const res = await follow(a, b);
        assert.equal(res.status, 409);

        assert.deepEqual(await counts(b), {
            followerCount: 1,
            followingCount: 0,
        });
    });

    it('rejects following yourself with 400', async () => {
        const a = await createUser('a@example.com');

        const res = await follow(a, a);
        assert.equal(res.status, 400);
    });

    it('responds 404 for a followee that does not exist and leaves no row behind', async () => {
        const a = await createUser('a@example.com');

        const res = await follow(a, 999999);
        assert.equal(res.status, 404);

        const rows = await db.execute(sql`SELECT * FROM follows`);
        assert.equal(rows.rows.length, 0);
    });

    it('unfollows and brings both counters back down', async () => {
        const a = await createUser('a@example.com');
        const b = await createUser('b@example.com');
        await follow(a, b);

        const res = await unfollow(a, b);
        assert.equal(res.status, 204);

        assert.deepEqual(await counts(a), {
            followerCount: 0,
            followingCount: 0,
        });
        assert.deepEqual(await counts(b), {
            followerCount: 0,
            followingCount: 0,
        });
    });

    it('responds 404 unfollowing an edge that does not exist', async () => {
        const a = await createUser('a@example.com');
        const b = await createUser('b@example.com');

        const res = await unfollow(a, b);
        assert.equal(res.status, 404);
    });

    it('lists follower and following ids for fan-out', async () => {
        const a = await createUser('a@example.com');
        const b = await createUser('b@example.com');
        const c = await createUser('c@example.com');
        await follow(a, c);
        await follow(b, c);

        const followers = await fetch(`${baseUrl}/users/${c}/followers/ids`, {
            headers: internal,
        });
        assert.equal(followers.status, 200);
        const numericAsc = (x: number, y: number) => x - y;
        assert.deepEqual(
            (await followers.json()).sort(numericAsc),
            [a, b].sort(numericAsc),
        );

        const following = await fetch(`${baseUrl}/users/${a}/following/ids`, {
            headers: internal,
        });
        assert.equal(following.status, 200);
        assert.deepEqual(await following.json(), [c]);
    });
});
