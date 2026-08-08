import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import { AVATAR_MAX_BYTES } from '@twitter/shared';
import { db } from '../db/client.ts';
import { createApp } from '../app.ts';
import { UsersService } from './users.service.ts';
import { bucket, client, ensureBucket } from '../storage/client.ts';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const png = (size = 64) =>
    Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(Math.max(0, size - 8), 0x2a),
    ]);

describe('users controller: avatars', () => {
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
        if (!bucket.endsWith('-test')) {
            throw new Error(
                `Tests must run against a *-test bucket, got "${bucket}"`,
            );
        }
        await ensureBucket();

        server = createApp(new UsersService()).listen(0);
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://localhost:${port}`;
    });

    beforeEach(async () => {
        await db.execute(sql`TRUNCATE users RESTART IDENTITY CASCADE`);
        const listed = await client.send(
            new ListObjectsV2Command({ Bucket: bucket }),
        );
        const keys = (listed.Contents ?? []).map((object) => object.Key!);
        if (keys.length > 0) {
            await client.send(
                new DeleteObjectsCommand({
                    Bucket: bucket,
                    Delete: { Objects: keys.map((Key) => ({ Key })) },
                }),
            );
        }
    });

    after(async () => {
        server.closeIdleConnections();
        await new Promise((resolve) => server.close(resolve));
        client.destroy();
        await db.$client.end();
    });

    /** Create a user through the API and return its id. */
    async function createUser(email = 'andrii@example.com') {
        const res = await fetch(`${baseUrl}/users`, {
            method: 'POST',
            headers: { ...internal, 'content-type': 'application/json' },
            body: JSON.stringify({
                email,
                passwordHash: 'hash',
                name: 'Andrii',
                age: 30,
                sex: 'male',
            }),
        });
        assert.equal(res.status, 201);
        return (await res.json()).id as number;
    }

    function uploadAvatar(userId: number | string, bytes: Buffer) {
        const form = new FormData();
        form.append(
            'file',
            new Blob([Uint8Array.from(bytes)], { type: 'image/png' }),
            'c.png',
        );
        return fetch(`${baseUrl}/avatar`, {
            method: 'POST',
            headers: { ...internal, 'x-user-id': String(userId) },
            body: form,
        });
    }

    const getAvatar = (userId: number | string) =>
        fetch(`${baseUrl}/users/${userId}/avatar`, { headers: internal });

    it('uploads an avatar and answers with the URL to read it back', async () => {
        const id = await createUser();

        const res = await uploadAvatar(id, png());

        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), {
            url: `/api/users/${id}/avatar`,
        });
    });

    it('serves the image back with the type sniffed on the way in', async () => {
        const id = await createUser();
        const original = png(2048);
        await uploadAvatar(id, original);

        const res = await getAvatar(id);

        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'image/png');
        assert.deepEqual(Buffer.from(await res.arrayBuffer()), original);
    });

    /**
     * The owner comes from the session, never from the request, so the object
     * key is the caller's id — uploading cannot overwrite somebody else's image.
     */
    it('keys the object by the caller, so two users do not collide', async () => {
        const first = await createUser('first@example.com');
        const second = await createUser('second@example.com');

        await uploadAvatar(first, png(64));
        await uploadAvatar(second, png(256));

        assert.equal(
            (await (await getAvatar(first)).arrayBuffer()).byteLength,
            64,
        );
        assert.equal(
            (await (await getAvatar(second)).arrayBuffer()).byteLength,
            256,
        );
    });

    it('responds 404 for a user that has no avatar yet', async () => {
        const id = await createUser();
        assert.equal((await getAvatar(id)).status, 404);
    });

    it('responds 404 for a user that does not exist', async () => {
        assert.equal((await getAvatar(9999)).status, 404);
    });

    it('responds 400 for a malformed user id in the path', async () => {
        assert.equal((await getAvatar('abc')).status, 400);
    });

    it('responds 400 without the x-user-id header', async () => {
        const form = new FormData();
        form.append(
            'file',
            new Blob([Uint8Array.from(png())], { type: 'image/png' }),
            'c.png',
        );
        const res = await fetch(`${baseUrl}/avatar`, {
            method: 'POST',
            headers: internal,
            body: form,
        });
        assert.equal(res.status, 400);
    });

    it('responds 401 without the internal token', async () => {
        const res = await fetch(`${baseUrl}/avatar`, {
            method: 'POST',
            headers: { 'x-user-id': '1' },
            body: new FormData(),
        });
        assert.equal(res.status, 401);
    });

    it('responds 415 for a file that is not an image', async () => {
        const id = await createUser();
        const res = await uploadAvatar(id, Buffer.from('not an image at all'));
        assert.equal(res.status, 415);
    });

    it('responds 413 for a file over the limit', async () => {
        const id = await createUser();
        const res = await uploadAvatar(id, png(AVATAR_MAX_BYTES + 1024));
        assert.equal(res.status, 413);
    });

    /**
     * The session outliving the row is the only way to reach this, and it must
     * not look like a successful upload.
     */
    it('responds 404 when the uploader no longer exists', async () => {
        const res = await uploadAvatar(9999, png());
        assert.equal(res.status, 404);
    });

    it('replaces the previous avatar rather than adding a second one', async () => {
        const id = await createUser();
        await uploadAvatar(id, png(64));
        await uploadAvatar(id, png(512));

        const listed = await client.send(
            new ListObjectsV2Command({ Bucket: bucket }),
        );
        assert.equal(listed.Contents?.length, 1);
        assert.equal(
            (await (await getAvatar(id)).arrayBuffer()).byteLength,
            512,
        );
    });
});
