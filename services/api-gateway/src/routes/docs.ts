import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from '../openapi.ts';

const docsRouter = Router();

/** Raw spec, for codegen or an external viewer. */
docsRouter.get('/openapi.json', (_, res) => {
    res.json(openApiDocument);
});

docsRouter.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
        customSiteTitle: 'twitter-backend API',
        swaggerOptions: { persistAuthorization: true },
    }),
);

export default docsRouter;
