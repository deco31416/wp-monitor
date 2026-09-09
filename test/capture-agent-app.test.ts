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
import { CallCapturePhaseLifecycle } from '../src/call-capture-phases.js';
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

function buildAdapter(privileges = true): CaptureAgentAdapter & {
    started: boolean;
    stopCount: number;
    waitedForClose: boolean;
} {
    const phaseLifecycle = new CallCapturePhaseLifecycle(() => new Date(NOW));
    const state: CallCaptureStatus = {
        isCapturing: false,
        targetJid: null,
        callId: null,
        startTime: null,
        packetsCollected: 0,
        elapsed: 0,
    };
    const adapter: CaptureAgentAdapter & { started: boolean; stopCount: number; waitedForClose: boolean } = {
        started: false,
        stopCount: 0,
        waitedForClose: false,
        capturePrivilegesAvailable: () => privileges,
        listInterfaces: () => [{ name: 'eth-test', address: '192.0.2.10', description: 'Synthetic interface' }],
        getCallCaptureStatus: () => ({ ...state }),
        startCallCapture: (_interfaceAddr, targetJid, callId, _isVideo, context) => {
            adapter.started = true;
            state.isCapturing = true;
            state.targetJid = targetJid;
            state.callId = callId;
            state.startTime = new Date(NOW);
            phaseLifecycle.start({ captureCallId: callId, targetJid, ...context });
            return true;
        },
        observeCallCapturePhase: (targetJid, observedCallId, status) => (
            phaseLifecycle.observe(targetJid, observedCallId, status)
        ),
        stopCallCapture: () => {
            if (!state.isCapturing) return null;
            adapter.stopCount += 1;
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
            state.targetJid = null;
            state.callId = null;
            state.startTime = null;
            return result;
        },
        waitForCallCaptureClose: async () => {
            await Promise.resolve();
            adapter.waitedForClose = true;
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
            capabilities: { callCapturePhases: 1 },
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
        const mismatchedStopBody = JSON.stringify({ callId: 'CALL-OTHER-001' });
        const mismatchedStop = await fetch(`${baseUrl}${stopPath}`, {
            method: 'POST',
            headers: signedHeaders('POST', stopPath, mismatchedStopBody, 'nonce_stop_mismatch_01'),
            body: mismatchedStopBody,
        });
        assert.equal(mismatchedStop.status, 409);
        assert.equal((await mismatchedStop.json()).code, 'capture_stop_mismatch');
        assert.equal(adapter.stopCount, 0);

        const stopBody = JSON.stringify({ callId: 'CALL-001' });
        const stop = await fetch(`${baseUrl}${stopPath}`, {
            method: 'POST',
            headers: signedHeaders('POST', stopPath, stopBody, 'nonce_stop_12345678901'),
            body: stopBody,
        });
        const result = await stop.json();
        assert.equal(stop.status, 200);
        assert.equal(adapter.waitedForClose, true);
        assert.equal(adapter.stopCount, 1);
        assert.equal(result.callId, 'CALL-001');
        assert.equal(result.verdict, 'insufficient_data');

        const retry = await fetch(`${baseUrl}${stopPath}`, {
            method: 'POST',
            headers: signedHeaders('POST', stopPath, stopBody, 'nonce_stop_retry_000001'),
            body: stopBody,
        });
        assert.equal(retry.status, 200);
        assert.deepEqual(await retry.json(), result);
        assert.equal(adapter.stopCount, 1);
    });
});

test('retries a stop by call ID after the original HTTP response is lost', async () => {
    const adapter = buildAdapter();
    let releaseClose!: () => void;
    let reportCloseWaitStarted!: () => void;
    const closeGate = new Promise<void>(resolve => { releaseClose = resolve; });
    const closeWaitStarted = new Promise<void>(resolve => { reportCloseWaitStarted = resolve; });
    adapter.waitForCallCaptureClose = async () => {
        reportCloseWaitStarted();
        await closeGate;
        adapter.waitedForClose = true;
    };

    await withServer(adapter, async baseUrl => {
        const startPath = '/v1/call/start';
        const startBody = JSON.stringify({
            interfaceAddr: '192.0.2.10',
            targetJid: '573001112233@s.whatsapp.net',
            callId: 'CALL-RETRY-001',
            isVideo: false,
        });
        const start = await fetch(`${baseUrl}${startPath}`, {
            method: 'POST',
            headers: signedHeaders('POST', startPath, startBody, 'nonce_retry_start_0001'),
            body: startBody,
        });
        assert.equal(start.status, 201);

        const stopPath = '/v1/call/stop';
        const stopBody = JSON.stringify({ callId: 'CALL-RETRY-001' });
        const controller = new AbortController();
        const lostResponse = fetch(`${baseUrl}${stopPath}`, {
            method: 'POST',
            headers: signedHeaders('POST', stopPath, stopBody, 'nonce_retry_stop_00001'),
            body: stopBody,
            signal: controller.signal,
        });
        await closeWaitStarted;
        controller.abort();
        await assert.rejects(lostResponse, error => error instanceof Error && error.name === 'AbortError');

        releaseClose();
        const retry = await fetch(`${baseUrl}${stopPath}`, {
            method: 'POST',
            headers: signedHeaders('POST', stopPath, stopBody, 'nonce_retry_stop_00002'),
            body: stopBody,
        });
        const result = await retry.json();
        assert.equal(retry.status, 200);
        assert.equal(result.callId, 'CALL-RETRY-001');
        assert.equal(adapter.stopCount, 1);
        assert.equal(adapter.waitedForClose, true);
    });
});

test('accepts signed call phases and rejects replay, tampering, mismatch, and phase regression', async () => {
    const adapter = buildAdapter();
    await withServer(adapter, async baseUrl => {
        const startPath = '/v1/call/start';
        const startBody = JSON.stringify({
            interfaceAddr: '192.0.2.10',
            targetJid: '573001112233@s.whatsapp.net',
            callId: 'CAPTURE-PHASE-001',
            isVideo: false,
            trigger: 'manual',
        });
        const start = await fetch(`${baseUrl}${startPath}`, {
            method: 'POST',
            headers: signedHeaders('POST', startPath, startBody, 'nonce_phase_start_0001'),
            body: startBody,
        });
        assert.equal(start.status, 201);

        const phasePath = '/v1/call/phase';
        const offerBody = JSON.stringify({
            captureCallId: 'CAPTURE-PHASE-001',
            targetJid: '573001112233@s.whatsapp.net',
            observedCallId: 'OBSERVED-PHASE-001',
            status: 'offer',
        });
        const offerHeaders = signedHeaders('POST', phasePath, offerBody, 'nonce_phase_offer_0001');
        const offer = await fetch(`${baseUrl}${phasePath}`, {
            method: 'POST',
            headers: offerHeaders,
            body: offerBody,
        });
        assert.equal(offer.status, 200);
        assert.equal((await offer.json()).ok, true);

        const replay = await fetch(`${baseUrl}${phasePath}`, {
            method: 'POST',
            headers: offerHeaders,
            body: offerBody,
        });
        assert.equal(replay.status, 401);
        assert.equal((await replay.json()).code, 'replayed_request');

        const tamperedBody = offerBody.replace('offer', 'accept');
        const tampered = await fetch(`${baseUrl}${phasePath}`, {
            method: 'POST',
            headers: signedHeaders('POST', phasePath, offerBody, 'nonce_phase_tamper_001'),
            body: tamperedBody,
        });
        assert.equal(tampered.status, 401);
        assert.equal((await tampered.json()).code, 'invalid_request_auth');

        const mismatchBody = JSON.stringify({
            captureCallId: 'CAPTURE-OTHER-001',
            targetJid: '573001112233@s.whatsapp.net',
            observedCallId: 'OBSERVED-PHASE-001',
            status: 'accept',
        });
        const mismatch = await fetch(`${baseUrl}${phasePath}`, {
            method: 'POST',
            headers: signedHeaders('POST', phasePath, mismatchBody, 'nonce_phase_mismatch_01'),
            body: mismatchBody,
        });
        assert.equal(mismatch.status, 409);
        assert.equal((await mismatch.json()).code, 'capture_phase_mismatch');

        const acceptBody = offerBody.replace('offer', 'accept');
        const accept = await fetch(`${baseUrl}${phasePath}`, {
            method: 'POST',
            headers: signedHeaders('POST', phasePath, acceptBody, 'nonce_phase_accept_0001'),
            body: acceptBody,
        });
        assert.equal(accept.status, 200);

        const regressedBody = offerBody.replace('offer', 'ringing');
        const regressed = await fetch(`${baseUrl}${phasePath}`, {
            method: 'POST',
            headers: signedHeaders('POST', phasePath, regressedBody, 'nonce_phase_regress_001'),
            body: regressedBody,
        });
        assert.equal(regressed.status, 409);
        assert.equal((await regressed.json()).code, 'capture_phase_rejected');
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
