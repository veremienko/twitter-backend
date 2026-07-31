import { Router } from 'express';
import type { TwitService } from './twit.service.ts';

const MAX_TEXT_LENGTH = 280;
const MAX_AUTHOR_LENGTH = 64;

export function twitRouter(twitService: TwitService): Router {
    const router = Router();

    router.post('/twits', async (req, res) => {
        try {
            const email = req.headers['x-user-email'];
            if (typeof email !== 'string' || email.length === 0 || email.length > MAX_AUTHOR_LENGTH) {
                return res.status(400).json({ error: 'x-user-email header is required' });
            }
            const text = req.body?.text;
            if (typeof text !== 'string' || text.trim().length === 0 || text.length > MAX_TEXT_LENGTH) {
                return res.status(400).json({ error: `text must be a non-empty string up to ${MAX_TEXT_LENGTH} characters` });
            }
            const twit = await twitService.createTwit({ text, email });
            res.status(201).json(twit);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.get('/twits', async (req, res) => {
        try {
            const result = await twitService.getTwits();
            res.status(200).json(result);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
}
