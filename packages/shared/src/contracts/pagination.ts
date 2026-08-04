import { z } from 'zod';

export const PaginationSchema = z
    .object({
        limit: z.coerce
            .number()
            .int()
            .min(1, 'Limit must be at least 1')
            .max(100, 'Limit cannot exceed 100')
            .optional(),
        offset: z.coerce
            .number()
            .int()
            .min(0, 'Offset cannot be negative')
            .optional(),
    })
    .refine(
        (data) => (data.limit !== undefined) === (data.offset !== undefined),
        { message: 'limit and offset must be provided together' },
    );

export type Pagination = z.infer<typeof PaginationSchema>;
