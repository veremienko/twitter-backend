import type { IncomingMessage } from 'http';
import type { Socket } from 'net';
import { parse } from 'cookie';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { redis } from './middleware.ts';

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;
if (!INTERNAL_TOKEN) throw new Error('INTERNAL_TOKEN env var is required');

const NOTIFICATION_SERVICE_URL =
    process.env.NOTIFICATION_SERVICE_URL ?? 'ws://127.0.0.1:8080';

// `noServer: true` means this instance never listens on its own — it only
// does the handshake bookkeeping (Sec-WebSocket-Accept etc.) for sockets we
// hand it manually below.
const wss = new WebSocketServer({ noServer: true });

const clients = new Set<WebSocket>();

export const handleUpgrade = async (
    req: IncomingMessage,
    socket: Socket,
    head: Buffer,
) => {
    if (req.url !== '/api/notifications/ws') {
        socket.destroy();
        return;
    }

    const cookies = parse(req.headers.cookie ?? '');
    const sid = cookies.sid;
    const session = sid && (await redis.get(`session:${sid}`));
    if (!session) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
    }

    wss.handleUpgrade(req, socket, head, (clientWs) => relay(clientWs));
};

/**
 * The browser leg is already accepted at this point; this opens the second,
 * independent leg to notification-service and stitches the two together.
 * Messages arriving before the upstream handshake finishes are queued —
 * `ws` throws if you `send()` while its readyState is still CONNECTING.
 */
function relay(clientWs: WebSocket) {
    clients.add(clientWs);
    const upstream = new WebSocket(`${NOTIFICATION_SERVICE_URL}/ws`, {
        headers: { 'x-internal-token': INTERNAL_TOKEN },
    });

    const queue: RawData[] = [];
    upstream.on('open', () => {
        for (const data of queue) upstream.send(data);
        queue.length = 0;
    });

    clientWs.on('message', (data) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
        else queue.push(data);
    });

    upstream.on('message', (data) => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
    });

    const closeBoth = (code?: number, reason?: Buffer) => {
        if (isCloseable(clientWs)) clientWs.close(code, reason?.toString());
        if (isCloseable(upstream)) upstream.close(code, reason?.toString());
        clients.delete(clientWs);
    };

    clientWs.on('close', closeBoth);
    upstream.on('close', closeBoth);
    clientWs.on('error', () => closeBoth(1011, Buffer.from('client error')));
    upstream.on('error', (err) => {
        console.error('upstream ws error:', err);
        closeBoth(1011, Buffer.from('upstream error'));
    });
}

function isCloseable(ws: WebSocket) {
    return (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
    );
}

export const closeAllProxied = () => {
    for (const client of clients) {
        client.close(1001, 'shutting down');
    }
};
