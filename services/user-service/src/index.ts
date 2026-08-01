import express from "express";
import {internalAuth} from "@twitter/shared";
import {UsersService} from "./users/users.service.ts";
import {usersController as usersRouter} from "./users/users.controller.ts";

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;
if (!INTERNAL_TOKEN) throw new Error('INTERNAL_TOKEN env var is required');

const main = async () => {
    const app = express();

    app.use(express.json());

    app.use(internalAuth(INTERNAL_TOKEN));

    const usersService = new UsersService();
    app.use('/', usersRouter(usersService));

    const port = process.env.USER_SERVICE_PORT ?? 3003;
    app.listen(port, () => {
        console.log(`user-service started on port ${port}`);
    });
}

main()