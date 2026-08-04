import { z } from 'zod';

export const MAX_TEXT_LENGTH = 280;

const TEXT_MESSAGE = `text must be a non-empty string up to ${MAX_TEXT_LENGTH} characters`;

/**
 * Contract for POST /twits: the whole body a client sends.
 * The author is never taken from the body — twit-service reads it from the
 * `x-user-id` header the gateway fills from the session.
 */
export const NewTwitSchema = z.object({
    text: z
        .string()
        .trim()
        .min(1, TEXT_MESSAGE)
        .max(MAX_TEXT_LENGTH, TEXT_MESSAGE)
        .meta({ examples: ['hello world'] }),
});

export type NewTwit = z.infer<typeof NewTwitSchema>;
