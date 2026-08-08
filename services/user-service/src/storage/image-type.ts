import { AVATAR_MIME_TYPES } from '@twitter/shared';

/**
 * How many leading bytes settle the question. WebP is the greedy one: `RIFF`
 * sits at 0-3, a length field at 4-7, and only 8-11 spell `WEBP` — so a shorter
 * peek would confuse it with any other RIFF container.
 */
export const SNIFF_BYTES = 12;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ascii = (head: Buffer, start: number, end: number) =>
    head.subarray(start, end).toString('latin1');

/**
 * Identify an image by its leading bytes, or return null.
 *
 * This exists because the `Content-Type` in a multipart part is written by the
 * client from the file extension, so it describes intent rather than content —
 * a renamed executable arrives labelled `image/png`. The magic bytes are the
 * only claim the sender cannot fake without actually sending an image.
 */
export function sniffImageType(head: Buffer): string | null {
    if (
        head.length >= 3 &&
        head[0] === 0xff &&
        head[1] === 0xd8 &&
        head[2] === 0xff
    ) {
        return 'image/jpeg';
    }
    if (head.subarray(0, 8).equals(PNG_MAGIC)) {
        return 'image/png';
    }
    if (
        head.length >= SNIFF_BYTES &&
        ascii(head, 0, 4) === 'RIFF' &&
        ascii(head, 8, 12) === 'WEBP'
    ) {
        return 'image/webp';
    }
    return null;
}

/**
 * The media type to store the object under, or null when the bytes are not an
 * image the contract accepts. Recognising a format and allowing it are separate
 * questions: `sniffImageType` knows GIF-shaped bytes when it sees them, this
 * decides whether we take them.
 */
export function acceptedImageType(head: Buffer): string | null {
    const type = sniffImageType(head);
    return type !== null && AVATAR_MIME_TYPES.includes(type) ? type : null;
}

/** True when the leading bytes are one of the formats the contract allows. */
export function isSupportedImage(head: Buffer): boolean {
    return acceptedImageType(head) !== null;
}
