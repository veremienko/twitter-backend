import healthRouter from './health.ts';
import authRouter from './auth.ts';
import twitsRouter from './twits.ts';
import { Router } from 'express';

const apiRouter = Router();

apiRouter.use(healthRouter, authRouter, twitsRouter);

export default apiRouter;
