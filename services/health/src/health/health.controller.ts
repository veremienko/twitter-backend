import { Router } from 'express';
import { HealthService } from './health.service.ts';
import { sendError } from '@twitter/shared';

export function healthRouter(healthService: HealthService): Router {
    const router = Router();

    router.get('/health', async (req, res) => {
        try {
            const { status, healthy } = await healthService.getHealth();
            res.status(healthy ? 200 : 503).json(status);
        } catch (error) {
            sendError(res, error);
        }
    });

    return router;
}
