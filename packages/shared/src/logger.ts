import { pino } from 'pino';
import { requestContext } from './context.ts';

/** Create a service logger; requestId is mixed into every log line automatically. */
export function createLogger(service: string) {
    return pino({
        name: service,
        level: process.env.LOG_LEVEL ?? 'info',
        mixin() {
            const requestId = requestContext.getStore()?.requestId;
            return requestId ? { requestId } : {};
        },
        transport:
            process.env.NODE_ENV === 'production'
                ? undefined
                : { target: 'pino-pretty' },
    });
}
