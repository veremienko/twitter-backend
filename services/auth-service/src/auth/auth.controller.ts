import { Router, type Response } from 'express';
import type {AuthService} from "./auth.service.ts";
import {HttpError} from "../http-error.ts";

/** Send HttpError as-is; log anything else and reply with a generic 500. */
function sendError(res: Response, error: unknown) {
    if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message });
        return;
    }
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
}

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
