import type { RequestHandler, Response } from 'express';

/** Error with an HTTP status code, safe to expose to the client. */
export class HttpError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

/** Send HttpError as-is; log anything else and reply with a generic 500. */
export function sendError(res: Response, error: unknown) {
    if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message });
        return;
    }
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
}

/** Express middleware that rejects requests without the shared internal token. */
export function internalAuth(token: string): RequestHandler {
    return (req, res, next) => {
        if (req.headers['x-internal-token'] !== token) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
        next();
    };
}
