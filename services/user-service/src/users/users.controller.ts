import { Router } from 'express';
import {sendError} from "@twitter/shared";
import type {UsersService} from "./users.service.ts";

export function usersController(usersService: UsersService): Router {
    const router = Router();

    router.get('/users', async (req, res) => {
        try {
            res.status(200).json(await usersService.getUsers(req));
        } catch (error) {
            sendError(res, error);
        }
    });

    return router;
}
