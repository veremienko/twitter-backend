import { Router } from 'express';
import type { TwitService } from './twit.service.ts';

export function twitRouter(twitService: TwitService): Router {
    const router = Router();

    router.post('/twits', async (req, res) => {
        try {
            const email = req.headers['x-user-email'];
            const twit = await twitService.createTwit({ ...req.body, email: String(email) });
            res.status(201).json(twit);
        } catch (error) {
            res.status(500).json({ error: (error as Error).message });
        }
    });

    router.get('/twits', async (req, res) => {
        try {
            const result = await twitService.getTwits();
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ error: (error as Error).message });
        }
    });

    return router;
}
