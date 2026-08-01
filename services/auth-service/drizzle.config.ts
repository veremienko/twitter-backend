import { defineConfig } from "drizzle-kit";

export default defineConfig({
    dialect: 'postgresql',
    schema: './src/db/schema.ts',
    out: './drizzle',
    migrations: {
        table: 'auth_migrations',
    },
    dbCredentials: {
        url: process.env.DATABASE_URL ?? 'postgres://twitter:twitter@localhost:5432/twitter',
    },
});