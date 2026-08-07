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

    return router;
}
