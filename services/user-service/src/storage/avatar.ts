import busboy from 'busboy';
import type { IncomingHttpHeaders } from 'node:http';
import { PassThrough, Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
    AVATAR_MAX_BYTES,
    AVATAR_MIME_TYPES,
    HttpError,
} from '@twitter/shared';
import { uploadStream } from './client.ts';
import { SNIFF_BYTES, acceptedImageType } from './image-type.ts';

/** The name of the multipart part the OpenAPI contract documents. */
const FIELD = 'file';

const MAX_MB = AVATAR_MAX_BYTES / 1024 / 1024;

/**
 * Parse one avatar out of a multipart body, stream it into object storage, and
 * report the media type its bytes turned out to be.
 *
 * Nothing is buffered beyond a twelve-byte peek: the bytes leave for storage as
 * they arrive, and a body that breaks a rule is cut off mid-transfer instead of
 * being accepted and judged afterwards.
 */
export async function storeAvatar(
    source: Readable,
    headers: IncomingHttpHeaders,
    key: string,
): Promise<string> {
    const parser = createParser(headers);

    const file = await firstFilePart(parser, source);

    // The type is only knowable once twelve bytes have arrived, which is after
    // the upload has to have been started — so the sniff reports it sideways,
    // and it is read back below, where the pipeline has certainly run.
    const found: { type?: string } = {};

    // `pipeline` feeds the upload and, on any failure along the chain, destroys
    // every stream in it — including this one, which is how the SDK learns to
    // give up rather than wait for bytes that will never come.
    const body = new PassThrough();

    await Promise.all([
        pipeline(
            file,
            sniffImage((type) => (found.type = type)),
            body,
        ),
        uploadStream(key, body),
    ]);

    // Unreachable unless the sniff accepted the head, which is the only way the
    // pipeline above can resolve.
    if (!found.type) throw new Error('avatar stored without a known type');
    return found.type;
}

/** Busboy throws when the body is not multipart at all; that is a client error. */

const createParser = (headers: IncomingHttpHeaders): busboy.Busboy => {
    try {
        return busboy({
            headers,
            limits: { files: 1, fileSize: AVATAR_MAX_BYTES },
        });
    } catch {
        throw new HttpError(400, 'Expected a multipart/form-data body');
    }
};

/**
 * Resolve with the stream of the `file` part, or reject once the body turns out
 * not to contain one.
 *
 * Parts that are not wanted still have to be read: busboy hands out one stream
 * at a time and will not move on until the current one is drained, so ignoring
 * a part stalls the request until it times out.
 */

const firstFilePart = (parser: busboy.Busboy, source: Readable) => {
    return new Promise<Readable>((resolve, reject) => {
        // Whether the part we are after has already been handed out. Busboy
        // announces every file part, so this decides which one to act on.
        let found = false;

        parser.on('file', (name, part) => {
            if (found || name !== FIELD) {
                // Busboy releases one part at a time and will not move on until
                // the current one has been read, so a part we do not want still
                // has to be drained — ignoring it stalls the whole request.
                part.resume();
                return;
            }
            found = true;

            // Busboy answers an oversized file by truncating it and emitting
            // `limit`, which left alone would store a broken image and report
            // success. The event fires the moment busboy has buffered the last
            // allowed byte — before anyone reads the stream — so the listener
            // belongs here, while the part is being handed over, and not after
            // the caller awaits this promise.
            part.on('limit', () =>
                part.destroy(
                    new HttpError(413, `The file is larger than ${MAX_MB} MB`),
                ),
            );

            // `destroy` above emits `error`, and it can do so before the caller
            // has resumed from awaiting this promise and handed the part to
            // `pipeline` — an `error` event with no listener takes the process
            // down. This listener exists only to keep the event handled; the
            // failure itself is not lost, because `pipeline` reads it back off
            // `part.errored` whenever it does attach.
            part.on('error', () => {});

            resolve(part);
        });

        // One file part is all the contract allows, and busboy enforces that by
        // skipping the extras silently. Without this the caller would be told
        // the `file` part is missing when in truth it was sent behind another
        // one and never announced.
        parser.on('filesLimit', () => {
            if (!found) {
                reject(
                    new HttpError(
                        400,
                        `Send a single file part, named \`${FIELD}\``,
                    ),
                );
            }
        });

        // `close` means the envelope has been read to the end. It arrives on the
        // happy path too, only later, so it proves something just when nothing
        // has been found by then.
        parser.on('close', () => {
            if (!found) {
                reject(
                    new HttpError(400, `The body carries no \`${FIELD}\` part`),
                );
            }
        });

        // A malformed envelope, or a client that hung up mid-upload.
        parser.on('error', reject);

        // Listeners first, bytes second: an event emitted before its handler
        // exists is simply lost, and `limit` is emitted early enough to matter.
        source.pipe(parser);
    });
};

/**
 * Withhold the leading bytes until the format is known, then pass everything
 * through untouched.
 *
 * The check cannot happen before the stream opens — there are no bytes yet —
 * and must not happen after it closes, because by then the file would already
 * be in storage. Holding back exactly `SNIFF_BYTES` is the narrowest window in
 * which the answer exists and still costs nothing.
 */

const sniffImage = (onType: (type: string) => void): Transform => {
    let head: Buffer[] = [];
    let held = 0;
    let decided = false;

    return new Transform({
        transform(chunk: Buffer, _encoding, done) {
            // Past the verdict this stream is a no-op, and saying so first
            // keeps the hot path — every chunk after the first — trivial.
            if (decided) return done(null, chunk);

            head.push(chunk);
            held += chunk.length;

            // Calling `done` with no second argument emits nothing downstream.
            // That is the whole trick: the bytes stay here, unjudged, and a
            // chunk is under no obligation to reach SNIFF_BYTES on its own.
            if (held < SNIFF_BYTES) return done();

            decided = true;
            const buffered = Buffer.concat(head);
            head = [];

            const type = acceptedImageType(buffered);
            if (type === null) return done(unsupported());
            onType(type);

            // Release everything withheld, not just this chunk — the leading
            // bytes are the image header, and dropping them would store a file
            // that no decoder can open.
            done(null, buffered);
        },

        flush(done) {
            if (decided) return done();

            // The part ended before the format could be read. Either nothing
            // came at all, or too little for any format we accept — the
            // shortest of them still needs SNIFF_BYTES.
            done(
                held === 0
                    ? new HttpError(400, 'The file part is empty')
                    : unsupported(),
            );
        },
    });
};

const unsupported = () =>
    new HttpError(
        415,
        `Not a supported image; expected ${AVATAR_MIME_TYPES.join(', ')}`,
    );
