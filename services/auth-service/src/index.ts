import {createRedis} from "@twitter/shared";
import express from "express";
import {AuthService} from "./auth/auth.service.ts";
import {authController as authRouter} from "./auth/auth.controller.ts";


const main = async ()=>{
    const redis = await createRedis();

    const app = express();

    app.use(express.json());

    const authService = new AuthService(redis);

    app.use('/', authRouter(authService));

    const port = process.env.AUTH_SERVICE_PORT ?? 3003;
    app.listen(port, () => {
        console.log(`auth-service started on port ${port}`);
    });
}

main()