import { type RedisClient} from "@twitter/shared";
import {db} from "../db/client.ts";
import {users} from "../db/schema.ts";
import {eq} from "drizzle-orm";
import bcrypt from "bcrypt";
import {HttpError} from "../http-error.ts";

const SESSION_TTL_SECONDS = 7 * 24 * 3600;
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
const MIN_PASSWORD_LENGTH = 8;

export class AuthService {
    redis:RedisClient;

    constructor(redis: RedisClient) {
        this.redis = redis;
    }

    async register(data: unknown) {
        const { email, password } = validateCredentials(data);
        if (password.length < MIN_PASSWORD_LENGTH) {
            throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
        }
        const normalizedEmail = email.trim().toLowerCase();
        const hash = await bcrypt.hash(password, 12);
        try {
            await db.insert(users).values({ email: normalizedEmail, passwordHash: hash });
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new HttpError(409, 'Email already exists');
            }
            throw error;
        }
        return { message: 'User registered successfully' };
    }

    async login(data: unknown) {
        const { email, password } = validateCredentials(data);
        const normalizedEmail = email.trim().toLowerCase();
        const [user] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
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

function validateCredentials(body: unknown): { email: string; password: string } {
    const { email, password } = (body ?? {}) as Record<string, unknown>;
    if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) {
        throw new HttpError(400, 'Valid email is required');
    }
    if (typeof password !== 'string' || password.length === 0) {
        throw new HttpError(400, 'Password is required');
    }
    return { email, password };
}

/** Detect a Postgres unique-constraint violation (code 23505), possibly wrapped by drizzle. */
function isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const code = (error as { code?: string }).code ?? (error.cause as { code?: string } | undefined)?.code;
    return code === '23505';
}