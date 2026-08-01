import {inArray} from "drizzle-orm";
import {parseBody} from "@twitter/shared";
import { type Request } from 'express';
import {z} from "zod";
import {db} from "../db/client.ts";
import {users} from "../db/schema.ts";

const UserIdsSchema = z.string({ error: 'ids query parameter is required' })
    .transform(ids => ids.split(',').map(Number))
    .pipe(z.array(z.int().positive()).min(1));

const UserEmailsSchema = z.string({ error: 'emails query parameter is required' })
    .transform(emails => emails.split(',').map(String))
    .pipe(z.array(z.string()).min(1));

export class UsersService {
    /** Resolve user names by ids; internal, called by other services. */
    async getUsers(req: Request) {
        const query = req.query;

        if (!Object.keys(query).length) {
            return db.select().from(users);
        }

        console.log('query.ids', query.email);
        const ids = query.ids;
        if (ids) {
            const parsed = parseBody(UserIdsSchema, ids);
            return db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, parsed));
        }

        const emails = query.emails;
        if (emails){
            const parsed = parseBody(UserEmailsSchema, emails);
            return db.select({ id: users.id, passwordHash: users.passwordHash }).from(users).where(inArray(users.email, parsed));
        }
    }
}
