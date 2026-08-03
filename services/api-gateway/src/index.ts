import express from 'express';
import cookieParser from 'cookie-parser';
import apiRouter from './routes/index.ts';

const app = express();

app.use(express.json());
app.use(cookieParser());

app.use('/api', apiRouter);

const port = process.env.GATEWAY_PORT ?? 3000;
app.listen(port, () => {
    console.log(`api-gateway started on port ${port}`);
});
