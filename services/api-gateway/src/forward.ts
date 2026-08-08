import { type Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { requestContext } from '@twitter/shared';
import { logger } from 'twit-service/src/logger.ts';

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;
if (!INTERNAL_TOKEN) throw new Error('INTERNAL_TOKEN env var is required');

type ForwardInit = RequestInit & { duplex?: 'half' };

/**
 * Forward a request to a downstream service and mirror its response.
 *
 * `duplex` is absent from the DOM `RequestInit` TypeScript resolves here, but
 * undici demands it whenever the body is a stream, so it is added by hand.
 */
export async function forward(res: Response, url: string, init?: ForwardInit) {
    try {
        const response = await send(url, init);
        for (const cookie of response.headers.getSetCookie()) {
            res.append('set-cookie', cookie);
        }
        res.status(response.status).json(await response.json());
    } catch (error) {
        sendGatewayError(res, error);
    }
}

/**
 * Same, for a response that is not JSON: the body is piped through instead of
 * read, so an image reaches the client without ever being held whole here.
 *
 * Errors are still JSON — a failing downstream answers with a status and an
 * object, and only a successful response carries bytes worth streaming.
 */
export async function forwardStream(
    res: Response,
    url: string,
    init?: ForwardInit,
) {
    try {
        const response = await send(url, init);
        if (!response.ok || !response.body) {
            res.status(response.status).json(await response.json());
            return;
        }

        res.status(response.status);
        const type = response.headers.get('content-type');
        if (type) res.type(type);

        // Past this point the status line is already on the wire, so a failure
        // can no longer be reported — `pipeline` tears the connection down,
        // which is the only signal left.
        await pipeline(
            Readable.fromWeb(response.body as never),
            res as NodeJS.WritableStream,
        );
    } catch (error) {
        if (res.headersSent) {
            logger.error(error);
            res.destroy();
            return;
        }
        sendGatewayError(res, error);
    }
}

function send(url: string, init?: ForwardInit) {
    const requestId =
        requestContext.getStore()?.requestId ?? crypto.randomUUID();
    return fetch(url, {
        ...init,
        headers: {
            'x-request-id': requestId,
            'x-internal-token': INTERNAL_TOKEN!,
            ...init?.headers,
        },
        signal: init?.signal ?? AbortSignal.timeout(5000),
    });
}

function sendGatewayError(res: Response, error: unknown) {
    logger.error(error);
    if (error instanceof Error && error.name === 'TimeoutError') {
        res.status(504).json({ error: 'Gateway timeout' });
    } else {
        res.status(502).json({ error: 'Bad gateway' });
    }
}
