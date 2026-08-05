import { integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

export const twits = pgTable('twits', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    authorId: integer('author_id').notNull(),
    text: text().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    likes: integer().notNull().default(0),
});

export const likes = pgTable(
    'likes',
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        userId: integer('user_id').notNull(),
        twitId: integer('twit_id').notNull(),
        createdAt: timestamp('created_at').defaultNow().notNull(),
    },
    (t) => [unique().on(t.twitId, t.userId)],
);

export const outbox = pgTable('outbox', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    topic: text().notNull(),
    payload: text().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    sentAt: timestamp('sent_at'),
    requestId: text('request_id'),
});

export type Twit = typeof twits.$inferSelect;
