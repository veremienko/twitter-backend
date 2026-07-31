import {drizzle} from 'drizzle-orm/node-postgres';
import * as schema from './schema.ts';

/** Drizzle database client. Usage: db.select().from(users) or db.query.users.findMany() */
export const db = drizzle(process.env.DATABASE_URL!, { schema });