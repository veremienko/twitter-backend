import {eq, inArray} from "drizzle-orm";
import {HttpError, parseBody} from "@twitter/shared";
import {z} from "zod";
import {db} from "../db/client.ts";
import {users} from "../db/schema.ts";

const UserIdsSchema = z.string({ error: 'ids query parameter is required' })
    .transform(ids => ids.split(',').map(Number))
    .pipe(z.array(z.int().positive()).min(1));

const EmailSchema = z.string({ error: 'email query parameter is required' })
    .trim().toLowerCase().pipe(z.email('Valid email is required'));

const NewUserSchema = z.object({
    email: z.string().trim().toLowerCase().pipe(z.email('Valid email is required')),
    passwordHash: z.string().min(1, 'passwordHash is required'),
    name: z.string().trim().min(1, 'Name is required'),
    age: z.int().min(1).max(150),
    sex: z.enum(['male', 'female']),
});

export class UsersService {
    /** Resolve public profiles (id, name) by ids; used by twit-service. */
    async getUsersByIds(ids: unknown) {
        const parsed = parseBody(UserIdsSchema, ids);
        return db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, parsed));
    }

    /** Find login credentials by email; used by auth-service. */
    async getUserByEmail(email: unknown) {
        const parsed = parseBody(EmailSchema, email);
        const [user] = await db.select({ id: users.id, passwordHash: users.passwordHash })
            .from(users).where(eq(users.email, parsed)).limit(1);
        if (!user) throw new HttpError(404, 'User not found');
        return user;
    }

    /** Create a user; 409 if the email is already taken. */
    async createUser(data: unknown) {
        const user = parseBody(NewUserSchema, data);
        try {
            const [created] = await db.insert(users).values(user).returning({ id: users.id });
            return created!;
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new HttpError(409, 'Email already exists');
            }
            throw error;
        }
    }
}

/** Detect a Postgres unique-constraint violation (code 23505), possibly wrapped by drizzle. */
function isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const code = (error as { code?: string }).code ?? (error.cause as { code?: string } | undefined)?.code;
    return code === '23505';
}
