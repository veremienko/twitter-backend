import {
    index,
    integer,
    pgTable,
    text,
    timestamp,
    unique,
} from 'drizzle-orm/pg-core';

export const twits = pgTable(
    'twits',
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        authorId: integer('author_id').notNull(),
        text: text().notNull(),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        likes: integer().notNull().default(0),
    },
    // Matches the feed's ORDER BY exactly, so keyset pagination seeks straight
    // to the cursor row instead of sorting the table for every page.
    // nullsFirst() is not cosmetic: `ORDER BY x DESC` means NULLS FIRST in
    // Postgres, and an index built NULLS LAST cannot supply that ordering — the
    // planner would keep the index for the WHERE and still sort every matching
    // row, which for a deep cursor is most of the table.
    (t) => [
        index('twits_created_at_id_idx').on(
            t.createdAt.desc().nullsFirst(),
            t.id.desc().nullsFirst(),
        ),
    ],
);

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
