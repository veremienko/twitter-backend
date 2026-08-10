import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer } from 'ws';

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;
if (!INTERNAL_TOKEN) throw new Error('INTERNAL_TOKEN env var is required');

/**
 * Browsers can't be trusted to send `x-internal-token` themselves, but the
 * gateway (the only allowed caller) can — it attaches the header when it
 * opens the upstream connection, so this is the same internalAuth contract
 * as regular HTTP routes, just checked at handshake time instead of per-request.
 */
export function createWsServer(server: Server) {
    const wss = new WebSocketServer({
        server,
        path: '/ws',
        verifyClient: (info: { req: IncomingMessage }) =>
            info.req.headers['x-internal-token'] === INTERNAL_TOKEN,
    });

    const clients = wss.clients;

    wss.on('connection', (ws) => {
        clients.add(ws);

        ws.on('close', () => {
            clients.delete(ws);
        });
    });

    return {
        broadcast: (data: string) => {
            for (const client of clients) {
                if (client.readyState === client.OPEN) {
                    client.send(data);
                }
            }
        },
        closeAll: () => {
            for (const client of clients) {
                client.close(1001, 'shutting down');
            }
        },
    };
}
