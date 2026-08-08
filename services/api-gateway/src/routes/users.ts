import { Router } from 'express';
import { forward, forwardStream } from '../forward.ts';
import { requireAuth } from '../middleware.ts';
import { Readable } from 'node:stream';

const USER_SERVICE_URL =
    process.env.USER_SERVICE_URL ?? 'http://localhost:3004';

/** An upload is not a JSON round-trip; it needs room to actually transfer. */
const UPLOAD_TIMEOUT_MS = 30_000;

const userRouter = Router();

userRouter.post('/avatar', requireAuth, async (req, res) => {
    await forward(res, `${USER_SERVICE_URL}/avatar`, {
        method: 'POST',
        headers: {
            // Verbatim, because the boundary lives in here and is the only way
            // the parser downstream can tell the parts apart.
            'content-type': req.headers['content-type']!,
            'x-user-id': res.locals.userId,
        },
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        // `@types/node` declares web streams twice — in `node:stream/web` and
        // globally, via undici. At runtime it is one object; to the compiler the
        // two classes are unrelated, so `unknown` is the only bridge.
        body: Readable.toWeb(req) as unknown as BodyInit,
        duplex: 'half',
    });
});

userRouter.get('/users/:userId/avatar', requireAuth, async (req, res) => {
    await forwardStream(
        res,
        `${USER_SERVICE_URL}/users/${req.params.userId}/avatar`,
    );
});

export default userRouter;
