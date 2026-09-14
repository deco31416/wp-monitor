import assert from 'node:assert/strict';
import test from 'node:test';
import type { CallAnalysisResult } from '../src/call-analyzer.js';
import { CallCaptureService } from '../src/call-capture-service.js';
import { CaptureAgentClient, CaptureAgentClientError } from '../src/capture-agent-client.js';
import type { BrowserWebRtcEvidence } from '../src/call-observation-evidence.js';
import { WebRtcObserverClient } from '../src/webrtc-observer-client.js';

const targetJid = '573001112233@s.whatsapp.net';
const callId = 'CALL-OBSERVER-001';

function analysis(): CallAnalysisResult {
    return {
        callId,
        targetJid,
        startTime: new Date('2026-09-11T12:00:00.000Z'),
        endTime: new Date('2026-09-11T12:01:00.000Z'),
        durationSec: 60,
        isVideo: false,
        totalPackets: 0,
        candidateIps: [],
        metaIps: [],
        verdict: 'insufficient_data',
        captureInterface: '192.0.2.10',
    };
}

function browserEvidence(): BrowserWebRtcEvidence {
    return {
        version: 1,
        status: 'available',
        startedAt: new Date('2026-09-11T12:00:00.000Z'),
        endedAt: new Date('2026-09-11T12:01:00.000Z'),
        connectionCount: 0,
        selectedPairs: [],
        stateTransitions: [],
        truncated: false,
        limitations: [],
    };
}

function agent(
    stop: () => Promise<CallAnalysisResult> = async () => analysis(),
    status: () => Promise<{
        isCapturing: boolean;
        targetJid: string | null;
        callId: string | null;
        startTime: Date | null;
        packetsCollected: number;
        elapsed: number;
    }> = async () => ({
        isCapturing: false, targetJid: null, callId: null, startTime: null, packetsCollected: 0, elapsed: 0,
    }),
): CaptureAgentClient {
    return {
        ready: async () => true,
        listInterfaces: async () => [],
        getCallCaptureStatus: status,
        startCallCapture: async () => true,
        observeCallCapturePhase: async () => true,
        markOperatorCallCapturePhase: async () => true,
        stopCallCapture: stop,
    } as unknown as CaptureAgentClient;
}

function observer(options: {
    startFails?: boolean;
    stopFails?: boolean;
    stopCalls?: string[];
    status?: () => Promise<{
        active: boolean;
        callId: string | null;
        targetJid: string | null;
        startedAt: Date | null;
    }>;
} = {}): WebRtcObserverClient {
    return {
        ready: async () => true,
        start: async () => {
            if (options.startFails) throw new Error('synthetic observer failure');
        },
        stop: async (requestedCallId: string) => {
            options.stopCalls?.push(requestedCallId);
            if (options.stopFails) throw new Error('synthetic observer stop failure');
            return browserEvidence();
        },
        status: options.status ?? (async () => ({ active: false, callId: null, targetJid: null, startedAt: null })),
    } as unknown as WebRtcObserverClient;
}

test('manual capture attaches browser evidence without changing the packet capture lifecycle', async () => {
    const service = new CallCaptureService({ mode: 'agent', agent: agent(), observer: observer() });
    assert.equal(await service.start('192.0.2.10', targetJid, callId, false, undefined, { trigger: 'manual' }), true);
    const result = await service.stop(callId);
    assert.equal(result?.browserWebRtcEvidence?.status, 'available');
    assert.deepEqual(result?.browserWebRtcEvidence?.limitations, []);
});

test('automatic capture declares that browser observation may start after the first call signal', async () => {
    const service = new CallCaptureService({ mode: 'agent', agent: agent(), observer: observer() });
    assert.equal(await service.start('192.0.2.10', targetJid, callId, false, undefined, {
        trigger: 'auto',
        observedCallId: 'OBSERVED-CALL-001',
        initialCallStatus: 'offer',
    }), true);
    const result = await service.stop(callId);
    assert.ok(result?.browserWebRtcEvidence?.limitations.includes('browser_webrtc_armed_after_automatic_call_signal'));
});

test('observer start failure degrades explicitly while packet capture still completes', async () => {
    const service = new CallCaptureService({
        mode: 'agent',
        agent: agent(),
        observer: observer({ startFails: true }),
    });
    assert.equal(await service.start('192.0.2.10', targetJid, callId, false), true);
    const result = await service.stop(callId);
    assert.equal(result?.browserWebRtcEvidence?.status, 'unavailable');
    assert.deepEqual(result?.browserWebRtcEvidence?.limitations, ['browser_webrtc_observer_start_unavailable']);
});

test('capture-not-active reconciliation disarms the matching browser observer scope', async () => {
    const stopCalls: string[] = [];
    const unavailableAgent = agent(async () => {
        throw new CaptureAgentClientError('Synthetic capture already closed', 409, 'capture_not_active');
    });
    const service = new CallCaptureService({
        mode: 'agent',
        agent: unavailableAgent,
        observer: observer({ stopCalls }),
    });
    assert.equal(await service.start('192.0.2.10', targetJid, callId, false), true);
    assert.equal(await service.stop(callId), null);
    assert.deepEqual(stopCalls, [callId]);
});

test('backend restart recovers a matching active observer scope before capture stop', async () => {
    const stopCalls: string[] = [];
    const activeCaptureStatus = async () => ({
        isCapturing: true,
        targetJid,
        callId,
        startTime: new Date('2026-09-11T12:00:00.000Z'),
        packetsCollected: 25,
        elapsed: 30,
    });
    const activeObserverStatus = async () => ({
        active: true,
        callId,
        targetJid,
        startedAt: new Date('2026-09-11T12:00:01.000Z'),
    });
    const service = new CallCaptureService({
        mode: 'agent',
        agent: agent(async () => analysis(), activeCaptureStatus),
        observer: observer({ stopCalls, status: activeObserverStatus }),
    });

    assert.equal(await service.refreshAvailability(), true);
    const result = await service.stop(callId);

    assert.equal(result?.browserWebRtcEvidence?.status, 'available');
    assert.ok(result?.browserWebRtcEvidence?.limitations.includes(
        'browser_webrtc_observer_scope_recovered_after_backend_restart',
    ));
    assert.deepEqual(stopCalls, [callId]);
});

test('observer restart clears backend phantom state and declares evidence loss', async () => {
    const stopCalls: string[] = [];
    const activeCaptureStatus = async () => ({
        isCapturing: true,
        targetJid,
        callId,
        startTime: new Date('2026-09-11T12:00:00.000Z'),
        packetsCollected: 25,
        elapsed: 30,
    });
    const service = new CallCaptureService({
        mode: 'agent',
        agent: agent(async () => analysis(), activeCaptureStatus),
        observer: observer({ stopCalls, stopFails: true }),
    });
    assert.equal(await service.start('192.0.2.10', targetJid, callId, false), true);

    assert.equal(await service.refreshAvailability(), true);
    const result = await service.stop(callId);

    assert.equal(result?.browserWebRtcEvidence?.status, 'unavailable');
    assert.deepEqual(result?.browserWebRtcEvidence?.limitations, [
        'browser_webrtc_observer_scope_lost_during_capture',
    ]);
    assert.deepEqual(stopCalls, [callId]);
});

test('reconciliation recovers observer evidence finalized by TTL while packet capture remains active', async () => {
    const stopCalls: string[] = [];
    const activeCaptureStatus = async () => ({
        isCapturing: true,
        targetJid,
        callId,
        startTime: new Date('2026-09-11T12:00:00.000Z'),
        packetsCollected: 25,
        elapsed: 61,
    });
    const expiredEvidence: BrowserWebRtcEvidence = {
        ...browserEvidence(),
        limitations: ['browser_webrtc_observer_ttl_expired'],
    };
    const expiredObserver = observer({ stopCalls });
    expiredObserver.stop = async (requestedCallId: string) => {
        stopCalls.push(requestedCallId);
        return expiredEvidence;
    };
    const service = new CallCaptureService({
        mode: 'agent',
        agent: agent(async () => analysis(), activeCaptureStatus),
        observer: expiredObserver,
    });
    assert.equal(await service.start('192.0.2.10', targetJid, callId, false), true);

    assert.equal(await service.refreshAvailability(), true);
    const result = await service.stop(callId);

    assert.equal(result?.browserWebRtcEvidence?.status, 'available');
    assert.ok(result?.browserWebRtcEvidence?.limitations.includes(
        'browser_webrtc_observer_ttl_expired',
    ));
    assert.deepEqual(stopCalls, [callId]);
});

test('completed packet reconciliation rejects a foreign observer without mixing evidence', async () => {
    const stopCalls: string[] = [];
    const foreignCallId = 'CALL-OBSERVER-FOREIGN';
    const foreignObserverStatus = async () => ({
        active: true,
        callId: foreignCallId,
        targetJid,
        startedAt: new Date('2026-09-11T12:00:01.000Z'),
    });
    const service = new CallCaptureService({
        mode: 'agent',
        agent: agent(),
        observer: observer({ stopCalls, status: foreignObserverStatus }),
    });
    assert.equal(await service.start('192.0.2.10', targetJid, callId, false), true);

    assert.equal(await service.refreshAvailability(), true);
    const result = await service.stop(callId);

    assert.equal(result?.browserWebRtcEvidence?.status, 'unavailable');
    assert.deepEqual(result?.browserWebRtcEvidence?.limitations, [
        'browser_webrtc_observer_scope_lost_during_capture',
    ]);
    assert.deepEqual(stopCalls, [foreignCallId]);
});

test('startup reconciliation disarms a stale observer when packet capture is inactive', async () => {
    const stopCalls: string[] = [];
    const activeObserverStatus = async () => ({
        active: true,
        callId,
        targetJid,
        startedAt: new Date('2026-09-11T12:00:01.000Z'),
    });
    const service = new CallCaptureService({
        mode: 'agent',
        agent: agent(),
        observer: observer({ stopCalls, status: activeObserverStatus }),
    });

    assert.equal(await service.refreshAvailability(), true);
    assert.deepEqual(stopCalls, [callId]);
});

test('reconciliation preserves browser evidence when the packet result completed first', async () => {
    const stopCalls: string[] = [];
    const activeObserverStatus = async () => ({
        active: true,
        callId,
        targetJid,
        startedAt: new Date('2026-09-11T12:00:01.000Z'),
    });
    const service = new CallCaptureService({
        mode: 'agent',
        agent: agent(),
        observer: observer({ stopCalls, status: activeObserverStatus }),
    });
    assert.equal(await service.start('192.0.2.10', targetJid, callId, false), true);

    assert.equal(await service.refreshAvailability(), true);
    const result = await service.stop(callId);

    assert.equal(result?.browserWebRtcEvidence?.status, 'available');
    assert.deepEqual(result?.browserWebRtcEvidence?.limitations, []);
    assert.deepEqual(stopCalls, [callId]);
});

test('reconciliation preserves an expired observer result when the packet result completed first', async () => {
    const stopCalls: string[] = [];
    const expiredObserver = observer({ stopCalls });
    expiredObserver.stop = async (requestedCallId: string) => {
        stopCalls.push(requestedCallId);
        return {
            ...browserEvidence(),
            limitations: ['browser_webrtc_observer_ttl_expired'],
        };
    };
    const service = new CallCaptureService({
        mode: 'agent',
        agent: agent(),
        observer: expiredObserver,
    });
    assert.equal(await service.start('192.0.2.10', targetJid, callId, false, undefined, {
        trigger: 'auto',
        observedCallId: 'OBSERVED-CALL-TTL-COMPLETED',
        initialCallStatus: 'offer',
    }), true);

    assert.equal(await service.refreshAvailability(), true);
    const result = await service.stop(callId);

    assert.equal(result?.browserWebRtcEvidence?.status, 'available');
    assert.ok(result?.browserWebRtcEvidence?.limitations.includes(
        'browser_webrtc_observer_ttl_expired',
    ));
    assert.ok(result?.browserWebRtcEvidence?.limitations.includes(
        'browser_webrtc_armed_after_automatic_call_signal',
    ));
    assert.deepEqual(stopCalls, [callId]);
});

test('reconciliation rejects a foreign observer scope while preserving the active packet capture', async () => {
    const stopCalls: string[] = [];
    const activeCaptureStatus = async () => ({
        isCapturing: true,
        targetJid,
        callId,
        startTime: new Date('2026-09-11T12:00:00.000Z'),
        packetsCollected: 25,
        elapsed: 30,
    });
    const foreignObserverStatus = async () => ({
        active: true,
        callId: 'CALL-OBSERVER-STALE',
        targetJid,
        startedAt: new Date('2026-09-11T11:59:00.000Z'),
    });
    const service = new CallCaptureService({
        mode: 'agent',
        agent: agent(async () => analysis(), activeCaptureStatus),
        observer: observer({ stopCalls, status: foreignObserverStatus }),
    });

    assert.equal(await service.refreshAvailability(), true);
    const result = await service.stop(callId);

    assert.deepEqual(stopCalls, ['CALL-OBSERVER-STALE']);
    assert.deepEqual(result?.browserWebRtcEvidence?.limitations, [
        'browser_webrtc_observer_scope_lost_during_capture',
    ]);
});

test('periodic reconciliation preserves the known automatic-capture provenance', async () => {
    const stopCalls: string[] = [];
    const activeCaptureStatus = async () => ({
        isCapturing: true,
        targetJid,
        callId,
        startTime: new Date('2026-09-11T12:00:00.000Z'),
        packetsCollected: 25,
        elapsed: 30,
    });
    const activeObserverStatus = async () => ({
        active: true,
        callId,
        targetJid,
        startedAt: new Date('2026-09-11T12:00:01.000Z'),
    });
    const service = new CallCaptureService({
        mode: 'agent',
        agent: agent(async () => analysis(), activeCaptureStatus),
        observer: observer({ stopCalls, status: activeObserverStatus }),
    });
    assert.equal(await service.start('192.0.2.10', targetJid, callId, false, undefined, {
        trigger: 'auto',
        observedCallId: 'OBSERVED-CALL-RECONCILED',
        initialCallStatus: 'offer',
    }), true);

    assert.equal(await service.refreshAvailability(), true);
    const result = await service.stop(callId);

    assert.ok(result?.browserWebRtcEvidence?.limitations.includes(
        'browser_webrtc_armed_after_automatic_call_signal',
    ));
    assert.equal(result?.browserWebRtcEvidence?.limitations.includes(
        'browser_webrtc_observer_scope_recovered_after_backend_restart',
    ), false);
    assert.deepEqual(stopCalls, [callId]);
});

test('periodic reconciliation cannot discard observer evidence during capture stop', async () => {
    let captureActive = false;
    let observerActive = false;
    let releaseAgentStop!: () => void;
    let reportAgentStopStarted!: () => void;
    const agentStopGate = new Promise<void>(resolve => { releaseAgentStop = resolve; });
    const agentStopStarted = new Promise<void>(resolve => { reportAgentStopStarted = resolve; });
    const stopCalls: string[] = [];
    const controlledAgent = {
        ready: async () => true,
        listInterfaces: async () => [],
        getCallCaptureStatus: async () => ({
            isCapturing: captureActive,
            targetJid: captureActive ? targetJid : null,
            callId: captureActive ? callId : null,
            startTime: captureActive ? new Date('2026-09-11T12:00:00.000Z') : null,
            packetsCollected: captureActive ? 25 : 0,
            elapsed: captureActive ? 30 : 0,
        }),
        startCallCapture: async () => {
            captureActive = true;
            return true;
        },
        observeCallCapturePhase: async () => true,
        markOperatorCallCapturePhase: async () => true,
        stopCallCapture: async () => {
            reportAgentStopStarted();
            await agentStopGate;
            captureActive = false;
            return analysis();
        },
    } as unknown as CaptureAgentClient;
    const controlledObserver = {
        ready: async () => true,
        start: async () => { observerActive = true; },
        status: async () => ({
            active: observerActive,
            callId: observerActive ? callId : null,
            targetJid: observerActive ? targetJid : null,
            startedAt: observerActive ? new Date('2026-09-11T12:00:01.000Z') : null,
        }),
        stop: async (requestedCallId: string) => {
            stopCalls.push(requestedCallId);
            observerActive = false;
            return browserEvidence();
        },
    } as unknown as WebRtcObserverClient;
    const service = new CallCaptureService({
        mode: 'agent',
        agent: controlledAgent,
        observer: controlledObserver,
    });
    assert.equal(await service.start('192.0.2.10', targetJid, callId, false), true);

    const stopping = service.stop(callId);
    await agentStopStarted;
    const refreshing = service.refreshAvailability();
    releaseAgentStop();
    const result = await stopping;
    assert.equal(await refreshing, true);

    assert.equal(result?.browserWebRtcEvidence?.status, 'available');
    assert.deepEqual(stopCalls, [callId]);
});

test('reconciliation preserves a start failure until an idempotent packet result is collected', async () => {
    const service = new CallCaptureService({
        mode: 'agent',
        agent: agent(),
        observer: observer({ startFails: true }),
    });
    assert.equal(await service.start('192.0.2.10', targetJid, callId, false), true);

    assert.equal(await service.refreshAvailability(), true);
    const result = await service.stop(callId);

    assert.equal(result?.browserWebRtcEvidence?.status, 'unavailable');
    assert.deepEqual(result?.browserWebRtcEvidence?.limitations, [
        'browser_webrtc_observer_start_unavailable',
    ]);
});
