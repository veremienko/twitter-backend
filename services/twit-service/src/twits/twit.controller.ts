import { Router } from 'express';
import { sendError } from '@twitter/shared';
import type { TwitService } from './twit.service.ts';

export function twitRouter(twitService: TwitService): Router {
    const router = Router();

    router.post('/twits', async (req, res) => {
        try {
            const twit = await twitService.createTwit({
                text: req.body?.text,
                email: req.headers['x-user-email'],
            });
            res.status(201).json(twit);
        } catch (error) {
            sendError(res, error);
        }
    });

    router.get('/twits', async (req, res) => {
        try {
            const result = await twitService.getTwits();
            res.status(200).json(result);
        } catch (error) {
            sendError(res, error);
        }
    });

    return router;
}
