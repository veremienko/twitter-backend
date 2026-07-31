import { Router, type Response } from 'express';
import type {AuthService} from "./auth.service.ts";
import {HttpError} from "../http-error.ts";

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
const MIN_PASSWORD_LENGTH = 8;

/** Send HttpError as-is; log anything else and reply with a generic 500. */
function sendError(res: Response, error: unknown) {
    if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message });
        return;
    }
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
}

function validateCredentials(body: unknown): { email: string; password: string } {
    const { email, password } = (body ?? {}) as Record<string, unknown>;
    if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) {
        throw new HttpError(400, 'Valid email is required');
    }
    if (typeof password !== 'string' || password.length === 0) {
        throw new HttpError(400, 'Password is required');
    }
    return { email, password };
}

export function authController(authService: AuthService): Router {
    const router = Router();

    router.post('/register', async (req, res) => {
        try {
            const credentials = validateCredentials(req.body);
            if (credentials.password.length < MIN_PASSWORD_LENGTH) {
                throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
            }
            const { message } = await authService.register(credentials);
            res.status(201).json({ message });
        } catch (error) {
            sendError(res, error);
        }
    });

    router.post('/login', async (req, res) => {
        try {
            const credentials = validateCredentials(req.body);
            const { sid } = await authService.login(credentials);
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
