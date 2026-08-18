import type { IncomingHttpHeaders } from 'node:http';
import type { Readable } from 'node:stream';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { HttpError, NewUserSchema, parseBody } from '@twitter/shared';
import { z } from 'zod';
import { db } from '../db/client.ts';
import { follows, users } from '../db/schema.ts';
import { storeAvatar } from '../storage/avatar.ts';
import { readStream } from '../storage/client.ts';

const UserIdsSchema = z
    .string({ error: 'ids query parameter is required' })
    .transform((ids) => ids.split(',').map(Number))
    .pipe(z.array(z.int().positive()).min(1));

const EmailSchema = z
    .string({ error: 'email query parameter is required' })
    .trim()
    .toLowerCase()
    .pipe(z.email('Valid email is required'));

const UserIdSchema = z.coerce
    .number({ error: 'x-user-id header is required' })
    .int()
    .positive();

/** Same shape, but the id arrives in the path rather than in a header. */
const AvatarUserIdSchema = z.coerce
    .number({ error: 'userId is required' })
    .int()
    .positive();

/** Same shape again, for the follower/following-ids path param. */
const FollowUserIdSchema = z.coerce
    .number({ error: 'userId is required' })
    .int()
    .positive();

const FollowFieldsSchema = z.object({
    followerId: z.coerce
        .number({ error: 'x-user-id header is required' })
        .int()
        .positive(),
    followeeId: z.coerce
        .number({ error: 'followeeId is required' })
        .int()
        .positive(),
});

const FollowSchema = FollowFieldsSchema.refine(
    (data) => data.followerId !== data.followeeId,
    { message: 'cannot follow yourself', path: ['followeeId'] },
);

export class UsersService {
    /** Resolve public profiles (id, name) by ids; used by twit-service. */
    async getUsersByIds(ids: unknown) {
        const parsed = parseBody(UserIdsSchema, ids);
        return db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(inArray(users.id, parsed));
    }

    /** Find login credentials by email; used by auth-service. */
    async getUserByEmail(email: unknown) {
        const parsed = parseBody(EmailSchema, email);
        const [user] = await db
            .select({ id: users.id, passwordHash: users.passwordHash })
            .from(users)
            .where(eq(users.email, parsed))
            .limit(1);
        if (!user) throw new HttpError(404, 'User not found');
        return user;
    }

    /** Create a user; 409 if the email is already taken. */
    async createUser(data: unknown) {
        const user = parseBody(NewUserSchema, data);
        try {
            const [created] = await db
                .insert(users)
                .values(user)
                .returning({ id: users.id });
            return created!;
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new HttpError(409, 'Email already exists');
            }
            throw error;
        }
    }

    /**
     * Stream an avatar into object storage and record it on the profile; 404 if
     * the user is gone.
     *
     * The two writes are deliberately not wrapped in a transaction. Postgres
     * cannot roll back an object in S3, so the transaction would buy no
     * atomicity — it would only hold a connection open for the length of an
     * upload. The key does that work instead: it is derived from the user id, so
     * every upload overwrites the previous one in place, and a database write
     * that fails afterwards leaves an object the next attempt replaces rather
     * than an orphan nobody can name.
     *
     * Which is also why the column stores the media type rather than the key —
     * the key is `String(id)` and needs no recording. The type is the one thing
     * about the object that cannot be derived, and a non-null value doubles as
     * "this user has an avatar".
     */
    async uploadAvatar(
        data: unknown,
        stream: Readable,
        headers: IncomingHttpHeaders,
    ) {
        const userId = parseBody(UserIdSchema, data);

        const contentType = await storeAvatar(
            stream,
            headers,
            avatarKey(userId),
        );

        const [updated] = await db
            .update(users)
            .set({ avatar: contentType })
            .where(eq(users.id, userId))
            .returning({ id: users.id });
        if (!updated) throw new HttpError(404, 'User not found');

        return { url: avatarUrl(userId) };
    }

    /**
     * Open a user's avatar for reading, together with the type to serve it as.
     *
     * The type comes from the row rather than from storage, because it was
     * settled by sniffing the bytes on the way in — asking S3 would only return
     * whatever the SDK guessed at upload time.
     */
    async getAvatar(id: unknown) {
        const userId = parseBody(AvatarUserIdSchema, id);

        const [user] = await db
            .select({ avatar: users.avatar })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        if (!user) throw new HttpError(404, 'User not found');
        if (!user.avatar) throw new HttpError(404, 'Avatar not found');

        return {
            contentType: user.avatar,
            stream: await readStream(avatarKey(userId)),
        };
    }

    /**
     * Insert the follow edge and bump both counters in one transaction — the
     * same insert+counter pattern as `postLike`/`twits.likes`. 409 if the
     * edge already exists (unique constraint as the invariant), 404 if the
     * followee doesn't.
     */
    async followUser(data: unknown) {
        const { followerId, followeeId } = parseBody(FollowSchema, data);
        try {
            await db.transaction(async (tx) => {
                await tx.insert(follows).values({ followerId, followeeId });

                const [followee] = await tx
                    .update(users)
                    .set({ followerCount: sql`${users.followerCount} + 1` })
                    .where(eq(users.id, followeeId))
                    .returning({ id: users.id });
                if (!followee) throw new HttpError(404, 'User not found');

                await tx
                    .update(users)
                    .set({ followingCount: sql`${users.followingCount} + 1` })
                    .where(eq(users.id, followerId));
            });
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new HttpError(409, 'already following');
            }
            throw error;
        }
    }

    /** Remove the follow edge and bump both counters back down; 404 if it wasn't there. */
    async unfollowUser(data: unknown) {
        const { followerId, followeeId } = parseBody(FollowFieldsSchema, data);
        await db.transaction(async (tx) => {
            const [deleted] = await tx
                .delete(follows)
                .where(
                    and(
                        eq(follows.followerId, followerId),
                        eq(follows.followeeId, followeeId),
                    ),
                )
                .returning({ id: follows.id });
            if (!deleted) throw new HttpError(404, 'not following');

            await tx
                .update(users)
                .set({ followerCount: sql`${users.followerCount} - 1` })
                .where(eq(users.id, followeeId));
            await tx
                .update(users)
                .set({ followingCount: sql`${users.followingCount} - 1` })
                .where(eq(users.id, followerId));
        });
    }

    /** Ids of everyone following this user; used by twit-service to fan out a new twit on write. */
    async getFollowerIds(id: unknown): Promise<number[]> {
        const userId = parseBody(FollowUserIdSchema, id);
        const rows = await db
            .select({ id: follows.followerId })
            .from(follows)
            .where(eq(follows.followeeId, userId));
        return rows.map((row) => row.id);
    }

    /** Ids of everyone this user follows; used by twit-service's fan-out-on-read feed. */
    async getFollowingIds(id: unknown): Promise<number[]> {
        const userId = parseBody(FollowUserIdSchema, id);
        const rows = await db
            .select({ id: follows.followeeId })
            .from(follows)
            .where(eq(follows.followerId, userId));
        return rows.map((row) => row.id);
    }
}

/** Objects are named after their owner, so the name never has to be stored. */
const avatarKey = (userId: number) => String(userId);

/** Where the gateway serves the image back from. */
const avatarUrl = (userId: number) => `/api/users/${userId}/avatar`;

/** Detect a Postgres unique-constraint violation (code 23505), possibly wrapped by drizzle. */
function isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const code =
        (error as { code?: string }).code ??
        (error.cause as { code?: string } | undefined)?.code;
    return code === '23505';
}
