import { z } from 'zod';

export const PaginationSchema = z.object({
    limit: z.coerce
        .number()
        .int()
        .min(1, 'Limit must be at least 1')
        .max(100, 'Limit cannot exceed 100')
        .optional(),
        nextCursor: z.coerce.string().optional(),
}).refine(
    (data) => (data.nextCursor && !data.limit), 
    { message: 'limit and nextCursor must be provided together' }
);

export type Pagination = z.infer<typeof PaginationSchema>;

type Cursor = { id: number; createdAt: string };

export function encodeCursor(cursor: Cursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(cursor: string): Cursor {
    const decoded = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf-8'),
    );
    return {
        id: decoded.id,
        createdAt: new Date(decoded.createdAt).toISOString(),
    };
}
