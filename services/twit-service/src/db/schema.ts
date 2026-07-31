import { integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const twits = pgTable('twits', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    author: varchar({ length: 64 }).notNull(),
    text: text().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Twit = typeof twits.$inferSelect;
