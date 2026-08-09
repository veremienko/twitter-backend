import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
    HttpError,
    AVATAR_MAX_BYTES,
    AVATAR_MAX_DIMENSION,
    AVATAR_OUTPUT_MIME,
} from '@twitter/shared';
import { storeAvatar } from './avatar.ts';
import { bucket, client, ensureBucket, readStream } from './client.ts';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import sharp from 'sharp';

/**
 * A PNG as far as the sniff is concerned: real magic, filler for a body. Good
 * enough for paths that reject before the pipeline ever reaches `resize()` —
 * everywhere the upload is expected to succeed, sharp has to decode the bytes
 * for real, so `pngImage` is what those tests need instead.
 */
const fakePng = (size = 64) =>
    Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(Math.max(0, size - 8), 0x2a),
    ]);

/** A real, decodable PNG — `resize()` re-encodes every upload, so a magic-number stub is not enough for a path that runs the whole pipeline. */
const pngImage = (width: number, height = width) =>
    sharp({
        create: {
            width,
            height,
            channels: 3,
            background: { r: 200, g: 30, b: 30 },
        },
    })
        .png()
        .toBuffer();

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

    it('stores the file and reports the type it was re-encoded to', async () => {
        assert.equal(
            await upload([['file', await pngImage(64)]]),
            AVATAR_OUTPUT_MIME,
        );
        assert.deepEqual(await listKeys(), ['probe']);
    });

    /**
     * `resize()` re-encodes every accepted format to `AVATAR_OUTPUT_MIME` and
     * scales it down to `AVATAR_MAX_DIMENSION`, so the object in storage is
     * never the bytes that were sent — it is what sharp made of them.
     */
    it('re-encodes the stored bytes to the output format, scaled to the max dimension', async () => {
        await upload([['file', await pngImage(600, 400)]]);

        const meta = await sharp(await download('probe')).metadata();
        assert.equal(meta.format, 'webp');
        assert.equal(meta.width, AVATAR_MAX_DIMENSION);
        assert.ok(
            meta.height! < AVATAR_MAX_DIMENSION,
            'a landscape image should stay narrower than it is wide',
        );
    });

    it('overwrites in place, so a re-upload leaves one object', async () => {
        await upload([['file', await pngImage(300, 150)]]);
        await upload([['file', await pngImage(150, 300)]]);

        assert.deepEqual(await listKeys(), ['probe']);

        // Both uploads share a width once resized; only the second upload's
        // aspect ratio can explain the stored height, which proves the object
        // was replaced rather than left over from the first upload.
        const meta = await sharp(await download('probe')).metadata();
        assert.equal(meta.width, AVATAR_MAX_DIMENSION);
        assert.equal(meta.height, AVATAR_MAX_DIMENSION * 2);
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
        await rejectsWith(400, () => upload([['avatar', fakePng()]]));
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
     * 5 MB fragment served as a whole avatar. The limit fires from the raw
     * byte count alone, well before sharp would ever see these bytes, so a
     * fixture that only fools the sniff is enough here.
     */
    it('rejects an oversized file with 413 and stores nothing', async () => {
        await rejectsWith(413, () =>
            upload([['file', fakePng(AVATAR_MAX_BYTES + 1024)]]),
        );
        assert.deepEqual(await listKeys(), []);
    });

    /** Every rejection above must leave the bucket as it found it. */
    it('leaves no partial object behind when it fails', async () => {
        for (const bad of [
            Buffer.from('not an image at all'),
            Buffer.alloc(0),
            fakePng(AVATAR_MAX_BYTES + 1024),
        ]) {
            await assert.rejects(() => upload([['file', bad]]));
        }
        assert.deepEqual(await listKeys(), []);
    });

    /**
     * The contract allows exactly one file part, and busboy enforces that by
     * skipping the extras — so a foreign part sent first consumes the budget and
     * the real one is never announced. The refusal has to say that, rather than
     * claim the `file` part was missing when it was sent. Neither part is ever
     * decoded, so the fake fixture is enough.
     */
    it('refuses a second file part instead of hunting for the right one', async () => {
        await assert.rejects(
            () =>
                upload([
                    ['cover', fakePng(256)],
                    ['file', fakePng(64)],
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
            new Blob([Uint8Array.from(await pngImage(64))], {
                type: 'image/png',
            }),
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

        assert.equal(type, AVATAR_OUTPUT_MIME);
        const meta = await sharp(await download('probe')).metadata();
        assert.equal(meta.format, 'webp');
        assert.equal(meta.width, AVATAR_MAX_DIMENSION);
        assert.equal(meta.height, AVATAR_MAX_DIMENSION);
    });
});
