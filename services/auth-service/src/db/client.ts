import {drizzle} from 'drizzle-orm/node-postgres';
import * as schema from './schema.ts';

/** Drizzle database client. Usage: db.select().from(auth) or db.query.auth.findMany() */
export const db = drizzle(process.env.DATABASE_URL!, { schema });