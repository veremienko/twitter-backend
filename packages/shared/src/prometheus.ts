import { collectDefaultMetrics, Registry } from 'prom-client';
import { type Request, type Response } from 'express';

const register = new Registry();
collectDefaultMetrics({ register });

export async function metricsHandler(_req: Request, res: Response) {
    res.set('content-type', register.contentType);
    res.send(await register.metrics());
}
