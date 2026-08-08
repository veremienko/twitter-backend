import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { HttpError, AVATAR_MAX_BYTES } from '@twitter/shared';
import { storeAvatar } from './avatar.ts';
import { bucket, client, ensureBucket, readStream } from './client.ts';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

/** A PNG as far as the sniff is concerned: real magic, filler for a body. */
const png = (size = 64) =>
    Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(Math.max(0, size - 8), 0x2a),
    ]);

/**
 * Serialise a real multipart body the way a browser would, rather than hand-
 * rolling boundaries — the parser under test is the one that has to be trusted,
 * not the fixture.
 */
async function multipart(parts: [string, Buffer][]) {
    const form = new FormData();
    for (const [name, bytes] of parts) {
        form.append(
            name,
            new Blob([Uint8Array.from(bytes)], { type: 'image/png' }),
            'cat.png',
        );
    }
    const request = new Request('http://fixture', {
        method: 'POST',
        body: form,
    });
    return {
        headers: {
            'content-type': request.headers.get('content-type') ?? '',
        },
        body: Readable.from([Buffer.from(await request.arrayBuffer())]),
    };
}

const upload = async (parts: [string, Buffer][], key = 'probe') => {
    const { headers, body } = await multipart(parts);
    return storeAvatar(body, headers, key);
};

/** Read an object back in full; only test fixtures are small enough to do this. */
async function download(key: string) {
    const chunks: Buffer[] = [];
    for await (const chunk of await readStream(key)) chunks.push(chunk);
    return Buffer.concat(chunks);
}

async function listKeys() {
    const listed = await client.send(
        new ListObjectsV2Command({ Bucket: bucket }),
    );
    return (listed.Contents ?? []).map((object) => object.Key!);
}

/** Assert that `fn` rejects with an HttpError carrying `status`. */
async function rejectsWith(status: number, fn: () => Promise<unknown>) {
    await assert.rejects(fn, (error: unknown) => {
        assert.ok(
            error instanceof HttpError,
            `expected HttpError, got ${error}`,
        );
        assert.equal(error.status, status, error.message);
        return true;
    });
}

describe('storeAvatar', () => {
    before(async () => {
        if (!bucket.endsWith('-test')) {
            throw new Error(
                `Tests must run against a *-test bucket, got "${bucket}"`,
            );
        }
        await ensureBucket();
    });

    beforeEach(async () => {
        const keys = await listKeys();
        if (keys.length === 0) return;
        await client.send(
            new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: { Objects: keys.map((Key) => ({ Key })) },
            }),
        );
    });

    after(() => client.destroy());

    it('stores the file and reports the type it sniffed', async () => {
        assert.equal(await upload([['file', png()]]), 'image/png');
        assert.deepEqual(await listKeys(), ['probe']);
    });

    /**
     * The sniff withholds the leading bytes until it has a verdict. Releasing
     * only the chunk that completed the header — instead of everything held —
     * would strip the image header and store a file no decoder can open, while
     * still reporting success.
     */
    it('stores the bytes unchanged, header included', async () => {
        const original = png(4096);
        await upload([['file', original]]);
        assert.deepEqual(await download('probe'), original);
    });

    it('overwrites in place, so a re-upload leaves one object', async () => {
        await upload([['file', png(64)]]);
        await upload([['file', png(128)]]);

        assert.deepEqual(await listKeys(), ['probe']);
        assert.equal((await download('probe')).length, 128);
    });

    it('rejects a mislabelled file with 415', async () => {
        await rejectsWith(415, () =>
            upload([['file', Buffer.from('not an image at all')]]),
        );
    });

    it('rejects a file too short to identify with 415', async () => {
        await rejectsWith(415, () =>
            upload([['file', Buffer.from([0x89, 0x50, 0x4e])]]),
        );
    });

    it('rejects an empty part with 400', async () => {
        await rejectsWith(400, () => upload([['file', Buffer.alloc(0)]]));
    });

    it('rejects a body with no `file` part with 400', async () => {
        await rejectsWith(400, () => upload([['avatar', png()]]));
    });

    it('rejects a body that is not multipart with 400', async () => {
        await rejectsWith(400, () =>
            storeAvatar(
                Readable.from([Buffer.from('{}')]),
                { 'content-type': 'application/json' },
                'probe',
            ),
        );
    });

    /**
     * Busboy answers an oversized file by truncating it and emitting `limit`
     * rather than by failing, so the danger is not a missing error but a stored
     * 5 MB fragment served as a whole avatar.
     */
    it('rejects an oversized file with 413 and stores nothing', async () => {
        await rejectsWith(413, () =>
            upload([['file', png(AVATAR_MAX_BYTES + 1024)]]),
        );
        assert.deepEqual(await listKeys(), []);
    });

    /** Every rejection above must leave the bucket as it found it. */
    it('leaves no partial object behind when it fails', async () => {
        for (const bad of [
            Buffer.from('not an image at all'),
            Buffer.alloc(0),
            png(AVATAR_MAX_BYTES + 1024),
        ]) {
            await assert.rejects(() => upload([['file', bad]]));
        }
        assert.deepEqual(await listKeys(), []);
    });

    /**
     * The contract allows exactly one file part, and busboy enforces that by
     * skipping the extras — so a foreign part sent first consumes the budget and
     * the real one is never announced. The refusal has to say that, rather than
     * claim the `file` part was missing when it was sent.
     */
    it('refuses a second file part instead of hunting for the right one', async () => {
        await assert.rejects(
            () =>
                upload([
                    ['cover', png(256)],
                    ['file', png(64)],
                ]),
            (error: unknown) => {
                assert.ok(error instanceof HttpError);
                assert.equal(error.status, 400);
                assert.match(error.message, /single file part/);
                return true;
            },
        );
        assert.deepEqual(await listKeys(), []);
    });

    /** Text fields are not file parts, so they cost nothing and are ignored. */
    it('accepts the file alongside ordinary form fields', async () => {
        const form = new FormData();
        form.append('nickname', 'andrii');
        form.append(
            'file',
            new Blob([Uint8Array.from(png(64))], { type: 'image/png' }),
            'c.png',
        );
        const request = new Request('http://fixture', {
            method: 'POST',
            body: form,
        });

        const type = await storeAvatar(
            Readable.from([Buffer.from(await request.arrayBuffer())]),
            { 'content-type': request.headers.get('content-type') ?? '' },
            'probe',
        );

        assert.equal(type, 'image/png');
        assert.equal((await download('probe')).length, 64);
    });
});
