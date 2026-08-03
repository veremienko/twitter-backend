import { Router } from 'express';
import { forward } from '../forward.ts';

const HEALTH_SERVICE_URL =
    process.env.HEALTH_SERVICE_URL ?? 'http://localhost:3001';

const healthRouter = Router();

healthRouter.get('/health', async (_, res) => {
    await forward(res, `${HEALTH_SERVICE_URL}/health`);
});

export default healthRouter;
