import { z } from 'zod';

/** Contract for POST /users on user-service; auth-service builds this body. */
export const NewUserSchema = z.object({
    email: z.string().trim().toLowerCase().pipe(z.email('Valid email is required')),
    passwordHash: z.string().min(1, 'passwordHash is required'),
    name: z.string().trim().min(1, 'Name is required'),
    age: z.int().min(1).max(150),
    sex: z.enum(['male', 'female']),
});

export type NewUser = z.infer<typeof NewUserSchema>;
