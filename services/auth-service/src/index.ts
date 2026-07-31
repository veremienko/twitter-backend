import {createRedis} from "@twitter/shared";
import express from "express";
import {AuthService} from "./auth/auth.service.ts";
import {authController as authRouter} from "./auth/auth.controller.ts";


const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;
if (!INTERNAL_TOKEN) throw new Error('INTERNAL_TOKEN env var is required');

const main = async ()=>{
    const redis = await createRedis();

    const app = express();

    app.use(express.json());

    app.use((req, res, next) => {
        if (req.headers['x-internal-token'] !== INTERNAL_TOKEN) {
            return res.status(401).json({ error: 'unauthorized' });
        }
        next();
    });

    const authService = new AuthService(redis);

    app.use('/', authRouter(authService));

    const port = process.env.AUTH_SERVICE_PORT ?? 3003;
    app.listen(port, () => {
        console.log(`auth-service started on port ${port}`);
    });
}

main()