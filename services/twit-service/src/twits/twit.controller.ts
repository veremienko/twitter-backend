import { Router } from 'express';
import { sendError, encodeCursor } from '@twitter/shared';
import type { TwitService } from './twit.service.ts';

export function twitRouter(twitService: TwitService): Router {
    const router = Router();

    router.post('/twits', async (req, res) => {
        try {
            const twit = await twitService.createTwit({
                text: req.body?.text,
                authorId: req.headers['x-user-id'],
            });
            res.status(201).json(twit);
        } catch (error) {
            sendError(res, error);
        }
    });

    router.get('/twits', async (req, res) => {
        try {
            const result = await twitService.getTwits({
                ...req.query,
                nextCursor: req.headers['x-cursor'],
            });
            res.status(200).json(result);
        } catch (error) {
            sendError(res, error);
        }
    });

    router.post('/twits/:twitId/like', async (req, res) => {
        try {
            const result = await twitService.postLike({
                twitId: req.params.twitId,
                userId: req.headers['x-user-id'],
            });
            res.status(200).json(result);
        } catch (error) {
            sendError(res, error);
        }
    });

    /** Fan-out-on-write: precomputed per-follower feed. */
    router.get('/feed/home', async (req, res) => {
        try {
            const result = await twitService.getHomeFeed({
                ...req.query,
                userId: req.headers['x-user-id'],
                nextCursor: req.headers['x-cursor'],
            });
            res.status(200).json(result);
        } catch (error) {
            sendError(res, error);
        }
    });

    /** Fan-out-on-read: resolved from `follows` at read time, for comparison with /feed/home. */
    router.get('/feed/on-read', async (req, res) => {
        try {
            const result = await twitService.getFeedOnRead({
                ...req.query,
                userId: req.headers['x-user-id'],
                nextCursor: req.headers['x-cursor'],
            });
            res.status(200).json(result);
        } catch (error) {
            sendError(res, error);
        }
    });

    return router;
}
