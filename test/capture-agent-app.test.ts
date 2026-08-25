import test from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
    createCaptureAgentApp,
    type CaptureAgentAdapter,
} from '../src/capture-agent-app.js';
import { signCaptureAgentRequest } from '../src/capture-agent-auth.js';
import type { CallAnalysisResult, CallCaptureStatus } from '../src/call-analyzer.js';
import { SOFTWARE_VERSION } from '../src/version.js';

const SECRET = 'capture-agent-app-secret-000000000000000000000000';
const NOW = 1_787_593_200_000;

async function withServer(
    adapter: CaptureAgentAdapter,
    run: (baseUrl: string) => Promise<void>,
): Promise<void> {
    const app = createCaptureAgentApp({ sharedSecret: SECRET, adapter, now: () => NOW });
    const server: Server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    try {
        await run(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    }
}

function buildAdapter(privileges = true): CaptureAgentAdapter & { started: boolean } {
    const state: CallCaptureStatus = {
        isCapturing: false,
        targetJid: null,
        callId: null,
        startTime: null,
        packetsCollected: 0,
        elapsed: 0,
    };
    const adapter: CaptureAgentAdapter & { started: boolean } = {
        started: false,
        capturePrivilegesAvailable: () => privileges,
        listInterfaces: () => [{ name: 'eth-test', address: '192.0.2.10', description: 'Synthetic interface' }],
        getCallCaptureStatus: () => ({ ...state }),
        startCallCapture: (_interfaceAddr, targetJid, callId) => {
            adapter.started = true;
            state.isCapturing = true;
            state.targetJid = targetJid;
            state.callId = callId;
            state.startTime = new Date(NOW);
            return true;
        },
        stopCallCapture: () => {
            if (!state.isCapturing) return null;
            const result: CallAnalysisResult = {
                callId: state.callId!,
                targetJid: state.targetJid!,
                startTime: state.startTime!,
                endTime: new Date(NOW + 5_000),
                durationSec: 5,
                isVideo: false,
                totalPackets: 0,
                candidateIps: [],
                metaIps: [],
                verdict: 'insufficient_data',
                captureInterface: '192.0.2.10',
            };
            state.isCapturing = false;
            return result;
        },
    };
    return adapter;
}

function signedHeaders(method: string, path: string, body: string, nonce: string): Record<string, string> {
    const input = {
        method,
        path,
        timestamp: String(NOW),
        nonce,
        body: Buffer.from(body),
    };
    return {
        'content-type': 'application/json',
        'x-wp-timestamp': input.timestamp,
        'x-wp-nonce': input.nonce,
        'x-wp-signature': signCaptureAgentRequest(SECRET, input),
    };
}

test('exposes public liveness and readiness without interface details', async () => {
    await withServer(buildAdapter(), async baseUrl => {
        const live = await fetch(`${baseUrl}/v1/health/live`);
        const ready = await fetch(`${baseUrl}/v1/health/ready`);

        assert.equal(live.status, 200);
        assert.equal(ready.status, 200);
        assert.equal((await live.json()).status, 'alive');
        assert.deepEqual(await ready.json(), {
            service: 'wp-monitor-capture-agent',
            version: SOFTWARE_VERSION,
            status: 'ready',
            capturePrivileges: true,
        });
    });
});

test('fails readiness closed when packet privileges are missing', async () => {
    await withServer(buildAdapter(false), async baseUrl => {
        const response = await fetch(`${baseUrl}/v1/health/ready`);
        assert.equal(response.status, 503);
        assert.equal((await response.json()).capturePrivileges, false);
    });
});

test('rejects unsigned control requests', async () => {
    await withServer(buildAdapter(), async baseUrl => {
        const response = await fetch(`${baseUrl}/v1/call/status`);
        assert.equal(response.status, 401);
        assert.equal((await response.json()).code, 'invalid_request_auth');
    });
});

test('starts and stops one authenticated capture while rejecting replay', async () => {
    const adapter = buildAdapter();
    await withServer(adapter, async baseUrl => {
        const path = '/v1/call/start';
        const body = JSON.stringify({
            interfaceAddr: '192.0.2.10',
            targetJid: '573001112233@s.whatsapp.net',
            callId: 'CALL-001',
            isVideo: false,
        });
        const headers = signedHeaders('POST', path, body, 'nonce_start_1234567890');
        const start = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body });
        const replay = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body });

        assert.equal(start.status, 201);
        assert.equal(adapter.started, true);
        assert.equal(replay.status, 401);
        assert.equal((await replay.json()).code, 'replayed_request');

        const stopPath = '/v1/call/stop';
        const stopBody = '{}';
        const stop = await fetch(`${baseUrl}${stopPath}`, {
            method: 'POST',
            headers: signedHeaders('POST', stopPath, stopBody, 'nonce_stop_12345678901'),
            body: stopBody,
        });
        const result = await stop.json();
        assert.equal(stop.status, 200);
        assert.equal(result.callId, 'CALL-001');
        assert.equal(result.verdict, 'insufficient_data');
    });
});

test('validates capture input before invoking the adapter', async () => {
    const adapter = buildAdapter();
    await withServer(adapter, async baseUrl => {
        const path = '/v1/call/start';
        const body = JSON.stringify({
            interfaceAddr: 'not-an-ip',
            targetJid: 'invalid-target',
            callId: '../unsafe',
            isVideo: 'false',
        });
        const response = await fetch(`${baseUrl}${path}`, {
            method: 'POST',
            headers: signedHeaders('POST', path, body, 'nonce_invalid_12345678'),
            body,
        });

        assert.equal(response.status, 400);
        assert.equal(adapter.started, false);
        assert.equal((await response.json()).error, 'Capture request validation failed');
    });
});

test('returns a controlled JSON error when the native capture adapter throws', async () => {
    const adapter = buildAdapter();
    adapter.startCallCapture = () => {
        throw new Error('synthetic native failure with internal detail');
    };
    await withServer(adapter, async baseUrl => {
        const path = '/v1/call/start';
        const body = JSON.stringify({
            interfaceAddr: '192.0.2.10',
            targetJid: '573001112233@s.whatsapp.net',
            callId: 'CALL-FAIL-001',
            isVideo: false,
        });
        const response = await fetch(`${baseUrl}${path}`, {
            method: 'POST',
            headers: signedHeaders('POST', path, body, 'nonce_failure_1234567'),
            body,
        });
        const payload = await response.json();

        assert.equal(response.status, 500);
        assert.equal(payload.code, 'capture_agent_internal_error');
        assert.doesNotMatch(JSON.stringify(payload), /synthetic native failure/);
    });
});
