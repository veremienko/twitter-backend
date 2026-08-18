import { Router, type Request, type Response } from 'express';
import { forward } from '../forward.ts';
import { requireAuth } from '../middleware.ts';

const TWIT_SERVICE_URL =
    process.env.TWIT_SERVICE_URL ?? 'http://localhost:3002';

const twitsRouter = Router();

twitsRouter.get('/twits', requireAuth, async (req, res) => {
    const queryString = new URLSearchParams(
        req.query as Record<string, string>,
    ).toString();

    const cursor = req.headers['x-cursor'];
    await forward(res, `${TWIT_SERVICE_URL}/twits?${queryString}`, {
        headers: typeof cursor === 'string' ? { 'x-cursor': cursor } : {},
    });
});
twitsRouter.post('/twits', requireAuth, async (req, res) => {
    await forward(res, `${TWIT_SERVICE_URL}/twits`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-user-id': res.locals.userId,
        },
        body: JSON.stringify(req.body),
    });
});

twitsRouter.post('/twits/:twitId/like', requireAuth, async (req, res) => {
    await forward(res, `${TWIT_SERVICE_URL}/twits/${req.params.twitId}/like`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-user-id': res.locals.userId,
        },
        body: JSON.stringify(req.body),
    });
});

/** Forwards a feed read: query string, caller identity, and the cursor header. */
function forwardFeed(path: string) {
    return async (req: Request, res: Response) => {
        const queryString = new URLSearchParams(
            req.query as Record<string, string>,
        ).toString();
        const cursor = req.headers['x-cursor'];
        await forward(res, `${TWIT_SERVICE_URL}${path}?${queryString}`, {
            headers: {
                'x-user-id': res.locals.userId,
                ...(typeof cursor === 'string' ? { 'x-cursor': cursor } : {}),
            },
        });
    };
}

twitsRouter.get('/feed/home', requireAuth, forwardFeed('/feed/home'));
twitsRouter.get('/feed/on-read', requireAuth, forwardFeed('/feed/on-read'));

export default twitsRouter;
