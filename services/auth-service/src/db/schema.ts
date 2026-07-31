import { pgTable, text, integer, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    email: text().notNull().unique(),
    passwordHash: varchar('passwordHash', { length: 255 }).notNull(),
});

export type LoginRequest = {
    email: string;
    password: string;
};

export type RegisterRequest = {
    email: string;
    password: string;
};

export type User = typeof users.$inferSelect;
