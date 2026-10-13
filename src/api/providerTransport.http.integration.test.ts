import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { requestProvider } from './providerTransport';

let server: Server | undefined;

afterEach(async () => {
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    server = undefined;
});

describe('provider request body framing', () => {
    const manuscript = JSON.stringify({ text: 'The café lantern — 海' });
    it.each([
        { name: 'UTF-8 text', body: manuscript },
        { name: 'binary body', body: new Uint8Array(Buffer.from(manuscript)).buffer }
    ])('works with a server requiring Content-Length for $name', async ({ body }) => {
        server = createServer((req, res) => {
            if (!req.headers['content-length']) {
                res.writeHead(411);
                res.end(JSON.stringify({ error: 'Length required' }));
                return;
            }
            const chunks: Buffer[] = [];
            req.on('data', (chunk: Buffer) => chunks.push(chunk));
            req.on('end', () => {
                const received = Buffer.concat(chunks);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    text: received.toString('utf8'),
                    bytes: received.length,
                    declaredBytes: Number(req.headers['content-length']),
                    chunked: req.headers['transfer-encoding'] === 'chunked'
                }));
            });
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Test server has no TCP address');
        const result = await requestProvider({
            url: `http://127.0.0.1:${address.port}/v1/chat/completions`,
            method: 'POST',
            body,
            headers: { 'Content-Type': 'application/json' }
        }, undefined, { allowHttp: true });
        expect(result.status).toBe(200);
        expect(result.json).toEqual({
            text: manuscript,
            bytes: Buffer.byteLength(manuscript, 'utf8'),
            declaredBytes: Buffer.byteLength(manuscript, 'utf8'),
            chunked: false
        });
    });
});
