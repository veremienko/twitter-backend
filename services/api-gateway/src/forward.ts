import { type Response } from 'express';
import { requestContext } from '@twitter/shared';
import { logger } from 'twit-service/src/logger.ts';

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;
if (!INTERNAL_TOKEN) throw new Error('INTERNAL_TOKEN env var is required');

/** Forward a request to a downstream service and mirror its response. */
export async function forward(res: Response, url: string, init?: RequestInit) {
    const requestId =
        requestContext.getStore()?.requestId ?? crypto.randomUUID();
    try {
        const response = await fetch(url, {
            ...init,
            headers: {
                'x-request-id': requestId,
                'x-internal-token': INTERNAL_TOKEN!,
                ...init?.headers,
            },
            signal: AbortSignal.timeout(5000),
        });
        for (const cookie of response.headers.getSetCookie()) {
            res.append('set-cookie', cookie);
        }
        res.status(response.status).json(await response.json());
    } catch (error) {
        logger.error(error);
        if (error instanceof Error && error.name === 'TimeoutError') {
            res.status(504).json({ error: 'Gateway timeout' });
        } else {
            res.status(502).json({ error: 'Bad gateway' });
        }
    }
}
