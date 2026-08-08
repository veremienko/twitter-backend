import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    SNIFF_BYTES,
    acceptedImageType,
    isSupportedImage,
    sniffImageType,
} from './image-type.ts';

/** A header of `magic`, padded out to `SNIFF_BYTES` so length is never the reason. */
const header = (...magic: number[]) =>
    Buffer.concat([
        Buffer.from(magic),
        Buffer.alloc(Math.max(0, SNIFF_BYTES - magic.length)),
    ]);

const JPEG = header(0xff, 0xd8, 0xff, 0xe0);
const PNG = header(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const WEBP = Buffer.concat([
    Buffer.from('RIFF', 'latin1'),
    Buffer.alloc(4),
    Buffer.from('WEBP', 'latin1'),
]);

describe('sniffImageType', () => {
    it('recognises the formats the contract accepts', () => {
        assert.equal(sniffImageType(JPEG), 'image/jpeg');
        assert.equal(sniffImageType(PNG), 'image/png');
        assert.equal(sniffImageType(WEBP), 'image/webp');
    });

    it('returns null for bytes that are not an image', () => {
        assert.equal(sniffImageType(Buffer.from('<!doctype html>')), null);
        assert.equal(sniffImageType(Buffer.alloc(SNIFF_BYTES)), null);
    });

    /**
     * WebP is why SNIFF_BYTES is twelve: `RIFF` alone also opens WAV and AVI,
     * and the four bytes that separate them sit at offset 8.
     */
    it('does not mistake another RIFF container for WebP', () => {
        const wav = Buffer.concat([
            Buffer.from('RIFF', 'latin1'),
            Buffer.alloc(4),
            Buffer.from('WAVE', 'latin1'),
        ]);
        assert.equal(sniffImageType(wav), null);
    });

    it('returns null rather than guessing from a short header', () => {
        assert.equal(sniffImageType(WEBP.subarray(0, 8)), null);
        assert.equal(sniffImageType(Buffer.from([0xff, 0xd8])), null);
    });

    /** The first three bytes are the signature; the fourth varies by encoder. */
    it('accepts any JPEG variant', () => {
        for (const fourth of [0xe0, 0xe1, 0xdb, 0xee]) {
            assert.equal(
                sniffImageType(header(0xff, 0xd8, 0xff, fourth)),
                'image/jpeg',
                `0xff 0xd8 0xff 0x${fourth.toString(16)}`,
            );
        }
    });
});

describe('acceptedImageType', () => {
    it('returns the type to store an accepted image under', () => {
        assert.equal(acceptedImageType(PNG), 'image/png');
    });

    /**
     * Recognising a format and allowing it are separate questions. GIF has a
     * magic number like any other image, but it is not on the contract's list,
     * so it must come back as refused rather than as `image/gif`.
     */
    it('refuses a recognisable format that is not on the list', () => {
        const gif = Buffer.concat([
            Buffer.from('GIF89a', 'latin1'),
            Buffer.alloc(6),
        ]);
        assert.equal(acceptedImageType(gif), null);
        assert.equal(isSupportedImage(gif), false);
    });
});
