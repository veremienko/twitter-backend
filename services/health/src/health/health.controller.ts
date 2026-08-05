import { Router } from 'express';
import { HealthService } from './health.service.ts';
import { sendError } from '@twitter/shared';

export function healthRouter(healthService: HealthService): Router {
    const router = Router();

    router.get('/health', async (req, res) => {
        try {
            await healthService.getHealth(res);
        } catch (error) {
            sendError(res, error);
        }
    });

    return router;
}
