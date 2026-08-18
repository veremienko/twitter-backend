import type { NextFunction, Request, Response } from 'express';
import { createRateLimiter, createRedis } from '@twitter/shared';

export const redis = await createRedis();

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

/**
 * For write endpoints behind `requireAuth`: keyed by the authenticated user,
 * so one abusive account can't burn through another's budget.
 */
export const writeRateLimiter = createRateLimiter(redis, {
    prefix: 'ratelimit:write',
    capacity: 10,
    refillPerSecond: 1,
    keyFn: (_req, res) => String(res.locals.userId),
});

/**
 * For pre-auth endpoints (login/register): there is no session yet, so the
 * only identity available is the caller's IP — blunt, but enough to slow down
 * credential stuffing / registration spam.
 */
export const authRateLimiter = createRateLimiter(redis, {
    prefix: 'ratelimit:auth',
    capacity: 5,
    refillPerSecond: 1 / 10,
    keyFn: (req) => req.ip ?? 'unknown',
});
