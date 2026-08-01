import {HttpError, parseBody, type RedisClient} from "@twitter/shared";
import {db} from "../db/client.ts";
import {users} from "../db/schema.ts";
import {eq} from "drizzle-orm";
import bcrypt from "bcrypt";
import {z} from "zod";

const SESSION_TTL_SECONDS = 7 * 24 * 3600;
const MIN_PASSWORD_LENGTH = 8;

const CredentialsSchema = z.object({
    email: z.string().trim().toLowerCase().pipe(z.email('Valid email is required')),
    password: z.string().min(1, 'Password is required'),
});

const RegistrationSchema = CredentialsSchema.extend({
    password: z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
    name: z.string().trim().min(1, 'Name is required'),
    age: z.int().min(1).max(150),
    sex: z.enum(['male', 'female']),
});

export class AuthService {
    redis:RedisClient;

    constructor(redis: RedisClient) {
        this.redis = redis;
    }

    async register(data: unknown) {
        const { email, password, name, age, sex } = parseBody(RegistrationSchema, data);
        const passwordHash = await bcrypt.hash(password, 12);
        try {
            await db.insert(users).values({ email, passwordHash, name, age, sex });
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new HttpError(409, 'Email already exists');
            }
            throw error;
        }
        return { message: 'User registered successfully' };
    }

    async login(data: unknown) {
        const { email, password } = parseBody(CredentialsSchema, data);
        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!user) {
            throw new HttpError(401, 'Invalid email or password');
        }
        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
        if (!isPasswordValid) {
            throw new HttpError(401, 'Invalid email or password');
        }
        const sid = crypto.randomUUID();
        await this.redis.set(`session:${sid}`, JSON.stringify({ userId: user.id, email: user.email }), { EX: SESSION_TTL_SECONDS });
        return { sid };
    }

    async logout(sid: string) {
        await this.redis.del(`session:${sid}`);
    }
}

/** Detect a Postgres unique-constraint violation (code 23505), possibly wrapped by drizzle. */
function isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const code = (error as { code?: string }).code ?? (error.cause as { code?: string } | undefined)?.code;
    return code === '23505';
}