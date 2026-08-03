import type { NextFunction, Request, Response } from 'express';
import { createRedis } from '@twitter/shared';

const redis = await createRedis();
export async function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction,
) {
    const sid = req.cookies.sid;
    const session = sid && (await redis.get(`session:${sid}`));
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    const { userId } = JSON.parse(session);
    res.locals.userId = String(userId);
    next();
}
