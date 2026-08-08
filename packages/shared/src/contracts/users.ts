import { z } from 'zod';

/** Contract for POST /users on user-service; auth-service builds this body. */
export const NewUserSchema = z.object({
    email: z
        .string()
        .trim()
        .toLowerCase()
        .pipe(z.email('Valid email is required')),
    passwordHash: z.string().min(1, 'passwordHash is required'),
    name: z.string().trim().min(1, 'Name is required'),
    age: z.int().min(1).max(150),
    sex: z.enum(['male', 'female']),
});

export type NewUser = z.infer<typeof NewUserSchema>;

/**
 * Avatar limits. The upload is streamed, so nothing here can be checked against
 * a whole file: the size is enforced by busboy while the bytes flow (and the
 * upload is aborted the moment it is exceeded), and the type by the leading
 * bytes of the stream — never by the Content-Type the client claims.
 */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
