import { Router } from 'express';
import { sendError } from '@twitter/shared';
import type { AuthService } from './auth.service.ts';

export function authController(authService: AuthService): Router {
    const router = Router();

    router.post('/register', async (req, res) => {
        try {
            const { message } = await authService.register(req.body);
            res.status(201).json({ message });
        } catch (error) {
            sendError(res, error);
        }
    });

    router.post('/login', async (req, res) => {
        try {
            const { sid } = await authService.login(req.body);
            res.cookie('sid', sid, {
                httpOnly: true,
                sameSite: 'lax',
                maxAge: 7 * 24 * 3600 * 1000,
            });
            res.status(200).json({ message: 'Login successful' });
        } catch (error) {
            sendError(res, error);
        }
    });

    router.post('/logout', async (req, res) => {
        try {
            res.clearCookie('sid');
            const sid = req.body.sid;
            if (typeof sid === 'string' && sid.length > 0) {
                await authService.logout(sid);
            }
            res.status(200).json({ message: 'Logout successful' });
        } catch (error) {
            sendError(res, error);
        }
    });

    return router;
}
