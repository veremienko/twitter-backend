import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, parseBody } from './http.ts';
import { z } from 'zod';

describe('parseBody', () => {
    const schema = z.object({
        text: z.string(),
    });

    it('returns parsed data for valid input', () => {
        assert.deepEqual(parseBody(schema, { text: 'hi' }), { text: 'hi' });
    });

    it('throws HttpError 400 for invalid input', () => {
        assert.throws(
            () => parseBody(schema, {}),
            (err) => {
                assert.ok(err instanceof HttpError);
                assert.equal(err.status, 400);
                return true;
            },
        );
    });

    it('includes the field path in the error message', () => {
        assert.throws(
            () => parseBody(schema, { extra: 1 }),
            (err) => {
                assert.ok(err instanceof HttpError);
                assert.equal(err.status, 400);
                assert.equal(
                    err.message,
                    'text: Invalid input: expected string, received undefined',
                );
                return true;
            },
        );
    });

    it('strips unknown fields', () => {
        assert.deepEqual(parseBody(schema, { text: 'hi', extra: 1 }), {
            text: 'hi',
        });
    });
});
