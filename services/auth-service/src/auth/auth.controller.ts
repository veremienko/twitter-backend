import { Router } from 'express';
import type {AuthService} from "./auth.service.ts";

export function authController(authService: AuthService): Router {
    const router = Router();

    router.post('/register', async (req, res) => {
        try {
            const { message } = await authService.register(req.body);
            res.status(201).json({ message });
        } catch (error) {
            res.status(500).json({ error: (error as Error).message });
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
            res.status(500).json({ error: (error as Error).message });
        }
    });

    router.post('/logout', async (req, res) => {
        try {
            res.clearCookie('sid');
            const sid = req.body.sid;
            await authService.logout(sid);
            res.status(200).json({ message: 'Logout successful' });
        } catch (error) {
            res.status(500).json({ error: (error as Error).message });
        }
    });

    return router;
}
