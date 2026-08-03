import { Router } from 'express';
import { forward } from '../forward.ts';

const AUTH_SERVICE_URL =
    process.env.AUTH_SERVICE_URL ?? 'http://localhost:3003';

const authRouter = Router();

authRouter.post('/register', async (req, res) => {
    await forward(res, `${AUTH_SERVICE_URL}/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req.body),
    });
});

authRouter.post('/login', async (req, res) => {
    await forward(res, `${AUTH_SERVICE_URL}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req.body),
    });
});

authRouter.post('/logout', async (req, res) => {
    await forward(res, `${AUTH_SERVICE_URL}/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sid: req.cookies.sid }),
    });
});

export default authRouter;
