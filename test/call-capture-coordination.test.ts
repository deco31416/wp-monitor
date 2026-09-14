import assert from 'node:assert/strict';
import test from 'node:test';
import type { CallAnalysisResult, CallCaptureStatus } from '../src/call-analyzer.js';
import {
    CallCaptureCoordinationError,
    CallCaptureService,
    type CallCaptureLifecycleLog,
} from '../src/call-capture-service.js';
import { CaptureAgentClient, CaptureAgentClientError } from '../src/capture-agent-client.js';
import type { BrowserWebRtcEvidence } from '../src/call-observation-evidence.js';
import { WebRtcObserverClient, WebRtcObserverClientError } from '../src/webrtc-observer-client.js';

const TARGET_JID = '573001112233@s.whatsapp.net';
const INTERFACE = '192.0.2.10';

interface HarnessOptions {
    agentStart?: 'ok' | 'reject' | 'hang';
    observerStart?: 'ok' | 'reject';
    agentPostStartStatus?: 'state' | 'inactive' | 'inactive_after_first' | 'error';
    observerPostStartStatus?: 'state' | 'inactive' | 'error';
    agentStopFails?: boolean;
    observerStopFails?: boolean;
    observerFailuresBeforeSuccess?: number;
    startupTimeoutMs?: number;
    startupVerificationDelayMs?: number;
}

function evidence(callId: string): BrowserWebRtcEvidence {
    return {
        version: 1,
        status: 'available',
        startedAt: new Date('2026-09-14T20:00:00.000Z'),
        endedAt: new Date('2026-09-14T20:00:01.000Z'),
        connectionCount: 0,
        selectedPairs: [],
        stateTransitions: [],
        truncated: false,
        limitations: [`synthetic:${callId.length}`],
    };
}

function analysis(callId: string): CallAnalysisResult {
    return {
        callId,
        targetJid: TARGET_JID,
        startTime: new Date('2026-09-14T20:00:00.000Z'),
        endTime: new Date('2026-09-14T20:00:01.000Z'),
        durationSec: 1,
        isVideo: false,
        totalPackets: 0,
        candidateIps: [],
        metaIps: [],
        verdict: 'insufficient_data',
        captureInterface: INTERFACE,
    };
}

function buildHarness(options: HarnessOptions = {}) {
    let agentActive = false;
    let observerActive = false;
    let activeCallId: string | null = null;
    let agentStops = 0;
    let observerStops = 0;
    let observerStarts = 0;
    let agentStatusChecks = 0;
    const logs: CallCaptureLifecycleLog[] = [];

    const agent = {
        ready: async () => true,
        listInterfaces: async () => [],
        startCallCapture: async (input: { callId: string }) => {
            activeCallId = input.callId;
            if (options.agentStart === 'hang') return new Promise<boolean>(() => undefined);
            if (options.agentStart === 'reject') return false;
            agentActive = true;
            return true;
        },
        getCallCaptureStatus: async (): Promise<CallCaptureStatus> => {
            agentStatusChecks += 1;
            if (options.agentPostStartStatus === 'error') {
                throw new CaptureAgentClientError('Synthetic status failure', 503, 'capture_agent_unavailable');
            }
            const forcedInactive = options.agentPostStartStatus === 'inactive'
                || (options.agentPostStartStatus === 'inactive_after_first' && agentStatusChecks > 1);
            const active = forcedInactive ? false : agentActive;
            return {
                isCapturing: active,
                targetJid: active ? TARGET_JID : null,
                callId: active ? activeCallId : null,
                startTime: active ? new Date('2026-09-14T20:00:00.000Z') : null,
                packetsCollected: 0,
                elapsed: 0,
            };
        },
        stopCallCapture: async (callId: string) => {
            agentStops += 1;
            if (options.agentStopFails) {
                throw new CaptureAgentClientError('Synthetic stop failure', 503, 'capture_agent_unavailable');
            }
            if (!agentActive) {
                throw new CaptureAgentClientError('No active capture', 409, 'capture_not_active');
            }
            agentActive = false;
            return analysis(callId);
        },
        observeCallCapturePhase: async () => true,
        markOperatorCallCapturePhase: async () => true,
    } as unknown as CaptureAgentClient;

    const observer = {
        ready: async () => true,
        start: async (callId: string) => {
            activeCallId = callId;
            observerStarts += 1;
            if (options.observerStart === 'reject' || observerStarts <= (options.observerFailuresBeforeSuccess ?? 0)) {
                throw new WebRtcObserverClientError('Synthetic observer failure', 503, 'observer_start_unavailable');
            }
            observerActive = true;
        },
        status: async () => {
            if (options.observerPostStartStatus === 'error') {
                throw new WebRtcObserverClientError('Synthetic observer status failure', 503, 'observer_unavailable');
            }
            const active = options.observerPostStartStatus === 'inactive' ? false : observerActive;
            return {
                active,
                callId: active ? activeCallId : null,
                targetJid: active ? TARGET_JID : null,
                startedAt: active ? new Date('2026-09-14T20:00:00.010Z') : null,
            };
        },
        stop: async (callId: string) => {
            observerStops += 1;
            if (options.observerStopFails) {
                throw new WebRtcObserverClientError('Synthetic observer stop failure', 503, 'observer_stop_unavailable');
            }
            if (!observerActive) {
                throw new WebRtcObserverClientError('No matching scope', 409, 'observer_scope_mismatch');
            }
            observerActive = false;
            return evidence(callId);
        },
    } as unknown as WebRtcObserverClient;

    const service = new CallCaptureService({
        mode: 'agent',
        agent,
        observer,
        startupTimeoutMs: options.startupTimeoutMs ?? 50,
        startupVerificationDelayMs: options.startupVerificationDelayMs ?? 0,
        lifecycleLogger: event => logs.push(event),
    });
    return {
        service,
        logs,
        state: () => ({ agentActive, observerActive, agentStops, observerStops, observerStarts }),
    };
}

async function expectIncompleteStart(service: CallCaptureService, callId: string): Promise<void> {
    await assert.rejects(
        service.start(INTERFACE, TARGET_JID, callId, false),
        (error: unknown) => error instanceof CallCaptureCoordinationError
            && error.status === 503
            && error.code === 'call_capture_start_incomplete',
    );
}

test('coordinated startup succeeds only after both signed scopes are active', async () => {
    const harness = buildHarness();
    assert.equal(await harness.service.start(INTERFACE, TARGET_JID, 'CALL-ATOMIC-001', false), true);
    assert.deepEqual(harness.state(), {
        agentActive: true,
        observerActive: true,
        agentStops: 0,
        observerStops: 0,
        observerStarts: 1,
    });
    assert.ok(await harness.service.stop('CALL-ATOMIC-001'));
    assert.equal(harness.state().agentActive, false);
    assert.equal(harness.state().observerActive, false);
});

test('a concurrent second start cannot erase or compensate the active coordinated scope', async () => {
    const harness = buildHarness();
    assert.equal(await harness.service.start(INTERFACE, TARGET_JID, 'CALL-ATOMIC-011', false), true);
    await assert.rejects(
        harness.service.start(INTERFACE, TARGET_JID, 'CALL-ATOMIC-012', false),
        (error: unknown) => error instanceof CallCaptureCoordinationError
            && error.status === 409
            && error.code === 'call_capture_already_active',
    );
    assert.equal(harness.state().agentActive, true);
    assert.equal(harness.state().observerActive, true);
    assert.ok(await harness.service.stop('CALL-ATOMIC-011'));
    assert.equal(harness.state().agentActive, false);
    assert.equal(harness.state().observerActive, false);
});

test('observer success plus capture-agent rejection compensates the observer', async () => {
    const harness = buildHarness({ agentStart: 'reject' });
    await expectIncompleteStart(harness.service, 'CALL-ATOMIC-002');
    assert.equal(harness.state().observerStops, 1);
    assert.equal(harness.state().agentActive, false);
    assert.equal(harness.state().observerActive, false);
});

test('capture-agent success plus observer rejection compensates packet capture', async () => {
    const harness = buildHarness({ observerStart: 'reject' });
    await expectIncompleteStart(harness.service, 'CALL-ATOMIC-003');
    assert.equal(harness.state().agentStops, 1);
    assert.equal(harness.state().agentActive, false);
    assert.equal(harness.state().observerActive, false);
});

test('post-start inactive capture reproduces E4 and disarms the active observer', async () => {
    const harness = buildHarness({ agentPostStartStatus: 'inactive' });
    await expectIncompleteStart(harness.service, 'CALL-ATOMIC-004');
    assert.equal(harness.state().observerStops, 1);
    assert.equal(harness.state().agentActive, false);
    assert.equal(harness.state().observerActive, false);
    assert.ok(harness.logs[0]?.causes.includes('capture_post_start_inactive'));
});

test('stability verification catches a capture that closes after its first active acknowledgement', async () => {
    const harness = buildHarness({
        agentPostStartStatus: 'inactive_after_first',
        startupVerificationDelayMs: 1,
    });
    await expectIncompleteStart(harness.service, 'CALL-ATOMIC-STABILITY');
    assert.equal(harness.state().agentActive, false);
    assert.equal(harness.state().observerActive, false);
    assert.ok(harness.logs[0]?.causes.includes('capture_stability_check_inactive'));
});

test('automatic startup verifies both scopes immediately without the manual stability window', async () => {
    const harness = buildHarness({
        agentPostStartStatus: 'inactive_after_first',
        startupVerificationDelayMs: 1,
    });
    assert.equal(await harness.service.start(
        INTERFACE,
        TARGET_JID,
        'CALL-ATOMIC-AUTO',
        false,
        undefined,
        {
            trigger: 'auto',
            observedCallId: 'OBSERVED-AUTO-001',
            initialCallStatus: 'offer',
        },
    ), true);
    assert.ok(await harness.service.stop('CALL-ATOMIC-AUTO'));
    assert.equal(harness.state().agentActive, false);
    assert.equal(harness.state().observerActive, false);
});

test('startup timeout is controlled and compensates every component that did start', async () => {
    const harness = buildHarness({ agentStart: 'hang', startupTimeoutMs: 15 });
    await expectIncompleteStart(harness.service, 'CALL-ATOMIC-005');
    assert.equal(harness.state().observerStops, 1);
    assert.equal(harness.state().observerActive, false);
    assert.ok(harness.logs[0]?.causes.includes('startup_timeout'));
});

test('failed compensation is explicit and the log contains only hashed scope identity', async () => {
    const rawCallId = 'CALL-SENSITIVE-RAW-006';
    const harness = buildHarness({ observerStart: 'reject', agentStopFails: true });
    await assert.rejects(
        harness.service.start(INTERFACE, TARGET_JID, rawCallId, false),
        (error: unknown) => error instanceof CallCaptureCoordinationError
            && error.code === 'call_capture_compensation_failed',
    );
    const serializedLog = JSON.stringify(harness.logs);
    assert.doesNotMatch(serializedLog, new RegExp(rawCallId));
    assert.doesNotMatch(serializedLog, new RegExp(TARGET_JID));
    assert.doesNotMatch(serializedLog, new RegExp(INTERFACE.replaceAll('.', '\\.')));
    assert.equal(harness.logs[0]?.compensation, 'failed');
    assert.ok(harness.logs[0]?.causes.includes('capture_compensation_stop_failed'));
    await assert.rejects(
        harness.service.start(INTERFACE, TARGET_JID, 'CALL-AFTER-FAILED-COMPENSATION', false),
        (error: unknown) => error instanceof CallCaptureCoordinationError
            && error.code === 'call_capture_already_active',
    );
});

test('stop remains idempotent after a compensated partial start', async () => {
    const harness = buildHarness({ observerStart: 'reject' });
    await expectIncompleteStart(harness.service, 'CALL-ATOMIC-007');
    assert.equal(await harness.service.stop(), null);
    assert.equal(await harness.service.stop(), null);
    assert.equal(harness.state().agentActive, false);
    assert.equal(harness.state().observerActive, false);
});

test('a compensated failure does not poison two subsequent coordinated cycles', async () => {
    const harness = buildHarness({ observerFailuresBeforeSuccess: 1 });
    await expectIncompleteStart(harness.service, 'CALL-ATOMIC-008');

    assert.equal(await harness.service.start(INTERFACE, TARGET_JID, 'CALL-ATOMIC-009', false), true);
    assert.ok(await harness.service.stop('CALL-ATOMIC-009'));
    assert.equal(await harness.service.start(INTERFACE, TARGET_JID, 'CALL-ATOMIC-010', false), true);
    assert.ok(await harness.service.stop('CALL-ATOMIC-010'));

    assert.equal(harness.state().agentActive, false);
    assert.equal(harness.state().observerActive, false);
    assert.equal(harness.state().observerStarts, 3);
});
