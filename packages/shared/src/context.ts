import type { NextFunction, Request, Response } from 'express';

import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

export function requestContextMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
) {
    const requestId =
        req.headers['x-request-id']?.toString() ?? crypto.randomUUID();
    requestContext.run({ requestId }, () => next());
}
