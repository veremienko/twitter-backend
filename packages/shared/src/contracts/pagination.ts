import { z } from 'zod';
import { HttpError } from '../http.ts';

export const PaginationSchema = z
    .object({
        limit: z.coerce
            .number()
            .int()
            .min(1, 'Limit must be at least 1')
            .max(100, 'Limit cannot exceed 100')
            .optional(),
        nextCursor: z.string().optional(),
    })
    /**
     * Unlike offset pagination the two are not symmetric: `limit` alone is the
     * first page, and neither is the whole feed. Only a cursor without a page
     * size is meaningless — the guard exists so it 400s instead of being
     * silently dropped and answering with the entire (cached) feed.
     */
    .refine(
        (data) => data.nextCursor === undefined || data.limit !== undefined,
        {
            message: 'nextCursor requires limit',
        },
    );

export type Pagination = z.infer<typeof PaginationSchema>;

type Cursor = { id: number; createdAt: string };

export function encodeCursor(cursor: Cursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/**
 * A cursor is client input, so every way it can be wrong is a 400, not a 500:
 * base64url that is not JSON, JSON of the wrong shape, an unparseable date.
 * `new Date('nope').toISOString()` throws RangeError rather than returning
 * Invalid Date, which is why the whole body is guarded rather than the parse alone.
 */
export function decodeCursor(cursor: string): Cursor {
    try {
        const decoded = JSON.parse(
            Buffer.from(cursor, 'base64url').toString('utf-8'),
        );
        const id = Number(decoded?.id);
        if (!Number.isInteger(id) || id < 1) throw new Error('bad id');
        return {
            id,
            createdAt: new Date(decoded.createdAt).toISOString(),
        };
    } catch {
        throw new HttpError(400, 'nextCursor is malformed');
    }
}
