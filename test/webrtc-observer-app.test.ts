import test from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createWebRtcObserverApp } from '../src/webrtc-observer-app.js';
import type { WebRtcObservationAdapter } from '../src/webrtc-observer-cdp.js';
import { WebRtcObserverClient } from '../src/webrtc-observer-client.js';
import { signCaptureAgentRequest } from '../src/capture-agent-auth.js';

const secret = 'observer-secret-with-at-least-32-bytes-value';
const callId = 'CALL-OBS-001';
const targetJid = '573000000000@s.whatsapp.net';

class FakeAdapter implements WebRtcObservationAdapter {
    active: { callId: string; targetJid: string; startedAt: Date } | null = null;
    startCalls = 0;
    stopCalls = 0;
    constructor(private readonly delayMs = 0) {}
    async ready() { return true; }
    async start(nextCallId: string, nextTargetJid: string) {
        this.startCalls += 1;
        if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
        this.active = { callId: nextCallId, targetJid: nextTargetJid, startedAt: new Date('2026-09-11T12:00:00.000Z') };
    }
    status() {
        return {
            active: this.active !== null,
            callId: this.active?.callId ?? null,
            targetJid: this.active?.targetJid ?? null,
            startedAt: this.active?.startedAt ?? null,
        };
    }
    async stop(requestedCallId: string) {
        this.stopCalls += 1;
        if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
        assert.equal(requestedCallId, this.active?.callId);
        const startedAt = this.active!.startedAt;
        this.active = null;
        return {
            version: 1 as const,
            status: 'available' as const,
            startedAt,
            endedAt: new Date('2026-09-11T12:01:00.000Z'),
            connectionCount: 0,
            selectedPairs: [],
            stateTransitions: [],
            truncated: false,
            limitations: ['browser_candidate_address_not_exposed'],
        };
    }
    async shutdown() { this.active = null; }
}

async function withServer(
    run: (origin: string, adapter: FakeAdapter) => Promise<void>,
    adapter = new FakeAdapter(),
) {
    const app = createWebRtcObserverApp({ sharedSecret: secret, adapter });
    const server: Server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    try {
        await run(`http://127.0.0.1:${address.port}`, adapter);
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

test('observer enforces a signed exclusive scope and idempotent stop', async () => {
    await withServer(async origin => {
        let nonce = 0;
        const client = new WebRtcObserverClient({
            baseUrl: origin,
            sharedSecret: secret,
            nonce: () => `observer_nonce_${String(++nonce).padStart(4, '0')}`,
        });
        assert.equal(await client.ready(), true);
        await client.start(callId, targetJid, 60_000);
        assert.equal((await client.status()).callId, callId);
        const first = await client.stop(callId);
        const second = await client.stop(callId);
        assert.deepEqual(second, first);
        assert.equal(first.status, 'available');
    });
});

test('observer serializes concurrent duplicate starts and stops', async () => {
    const adapter = new FakeAdapter(20);
    await withServer(async origin => {
        let nonce = 0;
        const client = new WebRtcObserverClient({
            baseUrl: origin,
            sharedSecret: secret,
            nonce: () => `observer_concurrent_${String(++nonce).padStart(4, '0')}`,
        });
        await Promise.all([
            client.start(callId, targetJid, 60_000),
            client.start(callId, targetJid, 60_000),
        ]);
        assert.equal(adapter.startCalls, 1);

        const [first, second] = await Promise.all([client.stop(callId), client.stop(callId)]);
        assert.equal(adapter.stopCalls, 1);
        assert.deepEqual(second, first);
    }, adapter);
});

test('observer rejects a replayed signed request', async () => {
    await withServer(async origin => {
        const path = '/v1/observation/status';
        const timestamp = String(Date.now());
        const nonce = 'observer_replay_nonce_001';
        const body = Buffer.alloc(0);
        const signature = signCaptureAgentRequest(secret, { method: 'GET', path, timestamp, nonce, body });
        const request = () => fetch(`${origin}${path}`, {
            headers: {
                'x-wp-timestamp': timestamp,
                'x-wp-nonce': nonce,
                'x-wp-signature': signature,
                'content-type': 'application/json',
            },
        });
        assert.equal((await request()).status, 200);
        assert.equal((await request()).status, 401);
    });
});

test('disabled observer stays live without a secret and rejects every control operation', async () => {
    const adapter = new FakeAdapter();
    const app = createWebRtcObserverApp({ enabled: false, adapter });
    const server: Server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;
    try {
        assert.equal((await fetch(`${origin}/v1/health/live`)).status, 200);
        const ready = await fetch(`${origin}/v1/health/ready`);
        assert.equal(ready.status, 503);
        assert.equal((await ready.json() as { status: string }).status, 'disabled');
        assert.equal((await fetch(`${origin}/v1/observation/status`)).status, 503);
        assert.equal(adapter.active, null);
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});
