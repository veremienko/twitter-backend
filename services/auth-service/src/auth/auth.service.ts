import {
    CredentialsSchema,
    HttpError,
    parseBody,
    RegistrationSchema,
    type NewUser,
    type RedisClient,
} from '@twitter/shared';
import bcrypt from 'bcrypt';

const SESSION_TTL_SECONDS = 7 * 24 * 3600;
const USER_SERVICE_URL =
    process.env.USER_SERVICE_URL ?? 'http://localhost:3004';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN!;

export class AuthService {
    redis: RedisClient;

    constructor(redis: RedisClient) {
        this.redis = redis;
    }

    async register(data: unknown) {
        const { email, password, name, age, sex } = parseBody(
            RegistrationSchema,
            data,
        );
        const passwordHash = await bcrypt.hash(password, 12);
        const newUser: NewUser = { email, passwordHash, name, age, sex };
        const response = await fetch(`${USER_SERVICE_URL}/users`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-internal-token': INTERNAL_TOKEN,
            },
            body: JSON.stringify(newUser),
        });
        if (response.status === 409) {
            throw new HttpError(409, 'Email already exists');
        }
        if (!response.ok) {
            throw new Error(
                `user-service POST /users responded with ${response.status}`,
            );
        }
        return { message: 'User registered successfully' };
    }

    async login(data: unknown) {
        const { email, password } = parseBody(CredentialsSchema, data);
        const response = await fetch(
            `${USER_SERVICE_URL}/users/by-email?email=${encodeURIComponent(email)}`,
            {
                headers: { 'x-internal-token': INTERNAL_TOKEN },
            },
        );
        if (response.status === 404) {
            throw new HttpError(401, 'Invalid email or password');
        }
        if (!response.ok) {
            throw new Error(
                `user-service GET /users/by-email responded with ${response.status}`,
            );
        }
        const user: { id: number; passwordHash: string } =
            await response.json();
        const isPasswordValid = await bcrypt.compare(
            password,
            user.passwordHash,
        );
        if (!isPasswordValid) {
            throw new HttpError(401, 'Invalid email or password');
        }
        const sid = crypto.randomUUID();
        await this.redis.set(
            `session:${sid}`,
            JSON.stringify({ userId: user.id }),
            { EX: SESSION_TTL_SECONDS },
        );
        return { sid };
    }

    async logout(sid: string) {
        await this.redis.del(`session:${sid}`);
    }
}
