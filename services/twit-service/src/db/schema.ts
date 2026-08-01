import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const twits = pgTable('twits', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    authorId: integer('author_id').notNull(),
    text: text().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Twit = typeof twits.$inferSelect;
