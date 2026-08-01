import { pgTable, text, integer, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    email: text().notNull().unique(),
    passwordHash: varchar('passwordHash', { length: 255 }).notNull(),
    name: text().notNull(),
    age: integer().notNull(),
    sex: text({ enum: ['male', 'female'] }).notNull(),
});

export type User = typeof users.$inferSelect;
