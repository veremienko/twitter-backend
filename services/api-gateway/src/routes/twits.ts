import { Router } from 'express';
import { forward } from '../forward.ts';
import { requireAuth } from '../middleware.ts';

const TWIT_SERVICE_URL =
    process.env.TWIT_SERVICE_URL ?? 'http://localhost:3002';

const twitsRouter = Router();

twitsRouter.get('/twits', requireAuth, async (req, res) => {
    const queryString = new URLSearchParams(
        req.query as Record<string, string>,
    ).toString();
    await forward(res, `${TWIT_SERVICE_URL}/twits?${queryString}`);
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

export default twitsRouter;
