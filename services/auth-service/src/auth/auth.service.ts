import { type RedisClient} from "@twitter/shared";
import {db} from "../db/client.ts";
import {type LoginRequest, type RegisterRequest, users} from "../db/schema.ts";
import {eq} from "drizzle-orm";
import bcrypt from "bcrypt";

const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export class AuthService {
    redis:RedisClient;

    constructor(redis: RedisClient) {
        this.redis = redis;
    }

    async register(data: RegisterRequest) {
        const { email, password } = data;
        const normalizedEmail = email.trim().toLowerCase();
        const [user] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
        if (user) {
            throw new Error('Email already exists');
        }
        const hash = await bcrypt.hash(password, 12);
        await db.insert(users).values({ email: normalizedEmail, passwordHash: hash });
        return { message: 'User registered successfully' };
    }

    async login(data: LoginRequest) {
        const { email, password } = data;
        const normalizedEmail = email.trim().toLowerCase();
        const [user] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
        if (!user) {
            throw new Error('Invalid email or password');
        }
        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
        if (!isPasswordValid) {
            throw new Error('Invalid email or password');
        }
        const sid = crypto.randomUUID();
        await this.redis.set(`session:${sid}`, JSON.stringify({ userId: user.id, email: user.email }), { EX: SESSION_TTL_SECONDS });
        return { sid };
    }

    async logout(sid: string) {
        await this.redis.del(`session:${sid}`);
    }
}