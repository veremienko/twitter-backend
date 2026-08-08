import {
    S3Client,
    HeadBucketCommand,
    CreateBucketCommand,
    GetObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { HttpError } from '@twitter/shared';

import type { Readable } from 'node:stream';

const S3_ENDPOINT = process.env.S3_ENDPOINT;
if (!S3_ENDPOINT) throw new Error('S3_ENDPOINT env var is required');

const S3_BUCKET = process.env.S3_BUCKET;
if (!S3_BUCKET) throw new Error('S3_BUCKET env var is required');

/** The bucket every avatar object lives in. */
export const bucket = S3_BUCKET;

/**
 * MinIO speaks S3, with two deviations the SDK has to be told about: it has no
 * regions (the value is required regardless, and then ignored), and it cannot
 * do virtual-host addressing. `forcePathStyle` keeps the bucket in the path —
 * without it the SDK builds `http://avatars.localhost:9000`, a host that
 * resolves nowhere, and the failure looks like a broken MinIO rather than a
 * misconfigured client.
 */
export const client = new S3Client({
    endpoint: S3_ENDPOINT,
    region: 'us-east-1',
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET_KEY!,
    },
    forcePathStyle: true,
});

/**
 * Create the bucket unless it already exists, so a wiped volume, a fresh clone
 * or a CI run needs no manual step.
 *
 * `HeadBucket` signals absence by throwing — but it throws for every other
 * failure too: wrong credentials, unreachable endpoint, an illegal bucket name.
 * Only `NotFound` may be handled here. Anything else has to reach the caller,
 * otherwise the service boots happily on storage that cannot work.
 */
export const ensureBucket = async () => {
    try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (error) {
        if ((error as Error).name !== 'NotFound') throw error;
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
};

export const uploadStream = async (
    key: string,
    body: Readable,
): Promise<void> => {
    const upload = new Upload({
        client,
        params: { Bucket: bucket, Key: key, Body: body },
    });

    await upload.done();
};

/**
 * Open an object for reading. The bytes are not fetched here — the returned
 * stream pulls them as the caller consumes it, so an avatar travels to the
 * browser the same way it arrived: never held whole.
 *
 * A missing object is a 404 rather than a 500: the database row and the bucket
 * can disagree (a wiped volume, a restored backup), and that is the client's
 * problem to see, not a server fault to hide.
 */
export const readStream = async (key: string): Promise<Readable> => {
    try {
        const object = await client.send(
            new GetObjectCommand({ Bucket: bucket, Key: key }),
        );
        return object.Body as Readable;
    } catch (error) {
        if ((error as Error).name === 'NoSuchKey') {
            throw new HttpError(404, 'Avatar not found');
        }
        throw error;
    }
};
