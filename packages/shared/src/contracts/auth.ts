import { z } from 'zod';

export const MIN_PASSWORD_LENGTH = 8;

/**
 * Email as accepted from clients: trimmed and lowercased *before* validation,
 * so surrounding whitespace and casing are forgiven.
 *
 * `.meta()` only feeds the OpenAPI spec — `z.toJSONSchema({ io: 'input' })` sees a
 * plain string on the input side of the pipe and would otherwise lose `format: email`.
 */
const emailField = z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email('Valid email is required'))
    .meta({ format: 'email', examples: ['alice@example.com'] });

/** Contract for POST /login: what the gateway forwards to auth-service. */
export const CredentialsSchema = z.object({
    email: emailField,
    password: z
        .string()
        .min(1, 'Password is required')
        .meta({ examples: ['supersecret1'] }),
});

/** Contract for POST /register: credentials plus the profile fields user-service stores. */
export const RegistrationSchema = CredentialsSchema.extend({
    password: z
        .string()
        .min(
            MIN_PASSWORD_LENGTH,
            `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        )
        .meta({ examples: ['supersecret1'] }),
    name: z
        .string()
        .trim()
        .min(1, 'Name is required')
        .meta({
            examples: ['Alice'],
        }),
    age: z
        .int()
        .min(1)
        .max(150)
        .meta({ examples: [30] }),
    sex: z.enum(['male', 'female']),
});

export type Credentials = z.infer<typeof CredentialsSchema>;
export type Registration = z.infer<typeof RegistrationSchema>;
