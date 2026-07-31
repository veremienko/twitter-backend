import { type RedisClient} from "@twitter/shared";
import {db} from "../db/client.ts";
import {type LoginRequest, type RegisterRequest, users} from "../db/schema.ts";
import {eq} from "drizzle-orm";
import bcrypt from "bcrypt";
import {HttpError} from "../http-error.ts";

const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export class AuthService {
    redis:RedisClient;

    constructor(redis: RedisClient) {
        this.redis = redis;
    }

    async register(data: RegisterRequest) {
        const { email, password } = data;
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

    async login(data: LoginRequest) {
        const { email, password } = data;
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

/** Detect a Postgres unique-constraint violation (code 23505), possibly wrapped by drizzle. */
function isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const code = (error as { code?: string }).code ?? (error.cause as { code?: string } | undefined)?.code;
    return code === '23505';
}