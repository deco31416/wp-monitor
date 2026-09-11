import assert from 'node:assert/strict';
import test from 'node:test';
import {
    canBindObservedCall,
    correlateCallCapturePhase,
    type CallCaptureCorrelationResult,
} from '../src/call-capture-correlation.js';
import { CallCapturePhaseLifecycle } from '../src/call-capture-phases.js';

const CAPTURE_ID = 'CAPTURE-MANUAL-001';
const CALL_ID = 'CALL-WEB-001';
const TARGET_JID = '573001112233@s.whatsapp.net';

test('raw transport closes a manual baseline through the shared phase lifecycle', async () => {
    let now = new Date(1_000);
    const lifecycle = new CallCapturePhaseLifecycle(() => now);
    lifecycle.start({ captureCallId: CAPTURE_ID, targetJid: TARGET_JID, trigger: 'manual' });
    now = new Date(4_000);

    const result = await correlateCallCapturePhase(
        async (jid, callId, status, observation) => lifecycle.observe(jid, callId, status, observation),
        {
            source: 'raw_transport',
            targetJid: TARGET_JID,
            observedCallId: CALL_ID,
            status: 'transport',
        },
    );

    assert.deepEqual(result, {
        source: 'raw_transport',
        status: 'transport',
        accepted: true,
        bindObservedCall: true,
    });
    assert.deepEqual(lifecycle.snapshot(), {
        baselineAvailable: true,
        baselineStartedAt: new Date(1_000),
        baselineEndedAt: new Date(4_000),
        negotiationStartedAt: new Date(4_000),
        activeCallStartedAt: null,
        callEndedAt: null,
        captureEndedAt: null,
        phaseEvidenceVersion: 2,
        phaseEvidence: [
            { sequence: 1, kind: 'baseline_started', at: new Date(1_000), source: 'capture_start', confidence: 'system' },
            { sequence: 2, kind: 'negotiation_started', at: new Date(4_000), source: 'baileys_raw', confidence: 'protocol', status: 'transport' },
        ],
    });
});

test('normalized and raw duplicates preserve the first transition timestamp', async () => {
    let now = new Date(1_000);
    const lifecycle = new CallCapturePhaseLifecycle(() => now);
    lifecycle.start({ captureCallId: CAPTURE_ID, targetJid: TARGET_JID, trigger: 'manual' });
    const observe = async (
        jid: string,
        callId: string,
        status: Parameters<typeof lifecycle.observe>[2],
        observation: Parameters<typeof lifecycle.observe>[3],
    ) => lifecycle.observe(jid, callId, status, observation);

    now = new Date(3_000);
    const first = await correlateCallCapturePhase(observe, {
        source: 'baileys', targetJid: TARGET_JID, observedCallId: CALL_ID, status: 'offer',
    });
    now = new Date(5_000);
    const duplicate = await correlateCallCapturePhase(observe, {
        source: 'raw_transport', targetJid: TARGET_JID, observedCallId: CALL_ID, status: 'transport',
    });

    assert.equal(first.accepted, true);
    assert.equal(duplicate.accepted, true);
    assert.equal(lifecycle.snapshot()?.negotiationStartedAt?.getTime(), 3_000);
    assert.equal(lifecycle.snapshot()?.baselineEndedAt?.getTime(), 3_000);
});

test('unsupported status does not invoke the phase observer', async () => {
    let calls = 0;
    const result = await correlateCallCapturePhase(async () => {
        calls += 1;
        return true;
    }, {
        source: 'baileys', targetJid: TARGET_JID, observedCallId: CALL_ID, status: 'busy',
    });

    assert.equal(calls, 0);
    assert.deepEqual(result, {
        source: 'baileys', status: null, accepted: false, bindObservedCall: false,
    });
});

test('terminal phase is accepted but cannot bind a manual capture to a new call', async () => {
    const result = await correlateCallCapturePhase(async () => true, {
        source: 'baileys', targetJid: TARGET_JID, observedCallId: CALL_ID, status: 'terminate',
    });

    assert.equal(result.accepted, true);
    assert.equal(result.bindObservedCall, false);
    assert.equal(result.status, 'terminate');
});

test('a different observed call cannot mutate an already correlated lifecycle', async () => {
    const lifecycle = new CallCapturePhaseLifecycle(() => new Date(2_000));
    lifecycle.start({ captureCallId: CAPTURE_ID, targetJid: TARGET_JID, trigger: 'manual' });
    const observe = async (
        jid: string,
        callId: string,
        status: Parameters<typeof lifecycle.observe>[2],
        observation: Parameters<typeof lifecycle.observe>[3],
    ) => lifecycle.observe(jid, callId, status, observation);
    await correlateCallCapturePhase(observe, {
        source: 'baileys', targetJid: TARGET_JID, observedCallId: CALL_ID, status: 'offer',
    });

    const rejected = await correlateCallCapturePhase(observe, {
        source: 'raw_transport', targetJid: TARGET_JID, observedCallId: 'CALL-OTHER-001', status: 'transport',
    });

    assert.equal(rejected.accepted, false);
    assert.equal(rejected.bindObservedCall, false);
});

test('manual binding requires the same target and an unbound distinct capture id', () => {
    const result: CallCaptureCorrelationResult = {
        source: 'raw_transport',
        status: 'transport',
        accepted: true,
        bindObservedCall: true,
    };
    const active = {
        targetJid: TARGET_JID,
        captureCallId: CAPTURE_ID,
    };

    assert.equal(canBindObservedCall(result, active, TARGET_JID, CALL_ID), true);
    assert.equal(canBindObservedCall(result, active, '573009999999@s.whatsapp.net', CALL_ID), false);
    assert.equal(canBindObservedCall(result, { ...active, observedCallId: CALL_ID }, TARGET_JID, CALL_ID), false);
    assert.equal(canBindObservedCall(result, active, TARGET_JID, CAPTURE_ID), false);
    assert.equal(canBindObservedCall({ ...result, bindObservedCall: false }, active, TARGET_JID, CALL_ID), false);
    assert.equal(canBindObservedCall(result, null, TARGET_JID, CALL_ID), false);
});
