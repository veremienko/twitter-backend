import express, {type NextFunction, type Response, type Request} from 'express';
import cookieParser from "cookie-parser";
import {createRedis} from "@twitter/shared";

const HEALTH_SERVICE_URL = process.env.HEALTH_SERVICE_URL ?? 'http://localhost:3001';
const TWIT_SERVICE_URL = process.env.TWIT_SERVICE_URL ?? 'http://localhost:3002';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL ?? 'http://localhost:3003';

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;
if (!INTERNAL_TOKEN) throw new Error('INTERNAL_TOKEN env var is required');

const app = express();

app.use(express.json());
app.use(cookieParser());

const redis =  await createRedis();

async function requireAuth(req: Request, res: Response, next: NextFunction) {
    const sid = req.cookies.sid;
    const session = sid && await redis.get(`session:${sid}`);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    const { userId, email } = JSON.parse(session);
    res.locals.userId = String(userId);
    res.locals.email = email;
    next();
}

/** Forward a request to a downstream service and mirror its response. */
async function forward(res: Response, url: string, init?: RequestInit) {
    try {
        const response = await fetch(url, {
            ...init,
            headers: { 'x-internal-token': INTERNAL_TOKEN!, ...init?.headers },
        });
        for (const cookie of response.headers.getSetCookie()) {
            res.append('set-cookie', cookie);
        }
        res.status(response.status).json(await response.json());
    } catch (error) {
        res.status(502).json({ error: (error as Error).message });
    }
}

app.get('/api/twits', requireAuth, async (req, res) => {
    await forward(res, `${TWIT_SERVICE_URL}/twits`);
});

app.post('/api/twits', requireAuth, async (req, res) => {
    await forward(res, `${TWIT_SERVICE_URL}/twits`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user-email': res.locals.email },
        body: JSON.stringify(req.body),
    });
});

app.get('/api/health', async (req, res) => {
    await forward(res, `${HEALTH_SERVICE_URL}/health`);
});

app.post('/api/register', async (req, res) => {
    await forward(res, `${AUTH_SERVICE_URL}/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req.body),
    });
});

app.post('/api/login', async (req, res) => {
    await forward(res, `${AUTH_SERVICE_URL}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req.body),
    });
});

app.post('/api/logout', async (req, res) => {
    await forward(res, `${AUTH_SERVICE_URL}/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sid: req.cookies.sid }),
    });
});

const port = process.env.GATEWAY_PORT ?? 3000;
app.listen(port, () => {
    console.log(`api-gateway started on port ${port}`);
});
