import {
    collectDefaultMetrics,
    Counter,
    Histogram,
    Registry,
} from 'prom-client';
import { type NextFunction, type Request, type Response } from 'express';

const register = new Registry();
collectDefaultMetrics({ register });

export async function metricsHandler(_req: Request, res: Response) {
    res.set('content-type', register.contentType);
    res.send(await register.metrics());
}

export const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['service', 'method', 'route', 'status'],
    registers: [register],
});

export const httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['service', 'method', 'route', 'status'],
    registers: [register],
});

export function httpMetricsMiddleware(service: string) {
    return (req: Request, res: Response, next: NextFunction) => {
        const endTimer = httpRequestDuration.startTimer();
        res.on('finish', () => {
            const labels = {
                service,
                method: req.method,
                route: req.route ? req.baseUrl + req.route.path : 'unmatched',
                status: String(res.statusCode),
            };
            httpRequestsTotal.inc(labels);
            endTimer(labels);
        });
        next();
    };
}
