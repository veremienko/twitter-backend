import { Router } from 'express';
import { sendError } from '@twitter/shared';
import type { UsersService } from './users.service.ts';

export function usersRouter(usersService: UsersService): Router {
    const router = Router();

    router.get('/users', async (req, res) => {
        try {
            res.status(200).json(
                await usersService.getUsersByIds(req.query.ids),
            );
        } catch (error) {
            sendError(res, error);
        }
    });

    router.get('/users/by-email', async (req, res) => {
        try {
            res.status(200).json(
                await usersService.getUserByEmail(req.query.email),
            );
        } catch (error) {
            sendError(res, error);
        }
    });

    router.post('/users', async (req, res) => {
        try {
            res.status(201).json(await usersService.createUser(req.body));
        } catch (error) {
            sendError(res, error);
        }
    });

    router.post('/avatar', async (req, res) => {
        try {
            res.status(200).json(
                await usersService.uploadAvatar(
                    req.headers['x-user-id'],
                    req,
                    req.headers,
                ),
            );
        } catch (error) {
            sendError(res, error);
        }
    });

    /**
     * Serve the image itself. The response is piped rather than sent, so the
     * bytes leave for the client as they arrive from storage — the same
     * discipline the upload follows, in the opposite direction.
     */
    router.get('/users/:userId/avatar', async (req, res) => {
        try {
            const { contentType, stream } = await usersService.getAvatar(
                req.params.userId,
            );
            res.status(200).type(contentType);
            // A failure after the first byte cannot become a status code, so
            // the only honest answer left is to break the connection.
            stream.on('error', () => res.destroy());
            stream.pipe(res);
        } catch (error) {
            sendError(res, error);
        }
    });

    router.post('/follows', async (req, res) => {
        try {
            await usersService.followUser({
                followerId: req.headers['x-user-id'],
                followeeId: req.body?.followeeId,
            });
            res.status(201).json({ ok: true });
        } catch (error) {
            sendError(res, error);
        }
    });

    router.delete('/follows/:followeeId', async (req, res) => {
        try {
            await usersService.unfollowUser({
                followerId: req.headers['x-user-id'],
                followeeId: req.params.followeeId,
            });
            res.status(204).send();
        } catch (error) {
            sendError(res, error);
        }
    });

    /** Internal: who follows this user — twit-service fans a new twit out to them on write. */
    router.get('/users/:userId/followers/ids', async (req, res) => {
        try {
            res.status(200).json(
                await usersService.getFollowerIds(req.params.userId),
            );
        } catch (error) {
            sendError(res, error);
        }
    });

    /** Internal: who this user follows — twit-service's fan-out-on-read feed. */
    router.get('/users/:userId/following/ids', async (req, res) => {
        try {
            res.status(200).json(
                await usersService.getFollowingIds(req.params.userId),
            );
        } catch (error) {
            sendError(res, error);
        }
    });

    return router;
}
