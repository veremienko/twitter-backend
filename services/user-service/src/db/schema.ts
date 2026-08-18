import {
    pgTable,
    text,
    integer,
    varchar,
    timestamp,
    unique,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    email: text().notNull().unique(),
    passwordHash: varchar('passwordHash', { length: 255 }).notNull(),
    name: text().notNull(),
    age: integer().notNull(),
    sex: text({ enum: ['male', 'female'] }).notNull(),
    avatar: text(),
    // Denormalized counts, the same cached-count(*) pattern as twits.likes:
    // kept in sync with `follows` only inside the transaction that writes it.
    followerCount: integer('follower_count').notNull().default(0),
    followingCount: integer('following_count').notNull().default(0),
});

export type User = typeof users.$inferSelect;

export const follows = pgTable(
    'follows',
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        followerId: integer('follower_id').notNull(),
        followeeId: integer('followee_id').notNull(),
        createdAt: timestamp('created_at').defaultNow().notNull(),
    },
    // One follow edge per pair: the invariant is a DB constraint, not code,
    // same as the one-like-per-user unique on `likes`.
    (t) => [unique().on(t.followerId, t.followeeId)],
);
