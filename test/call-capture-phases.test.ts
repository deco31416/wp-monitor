import assert from 'node:assert/strict';
import test from 'node:test';
import {
    CallCapturePhaseLifecycle,
    classifyCapturePacketPhase,
} from '../src/call-capture-phases.js';

const CAPTURE_ID = 'CAPTURE-001';
const CALL_ID = 'CALL-001';
const JID = '573001112233@s.whatsapp.net';

function clock(initial: number) {
    let current = initial;
    return {
        now: () => new Date(current),
        set: (value: number) => { current = value; },
    };
}

test('manual capture records an ordered baseline, negotiation and active call', () => {
    const time = clock(1_000);
    const lifecycle = new CallCapturePhaseLifecycle(time.now);

    assert.equal(lifecycle.start({ captureCallId: CAPTURE_ID, targetJid: JID, trigger: 'manual' }), true);
    time.set(4_000);
    assert.equal(lifecycle.observe(JID, CALL_ID, 'offer'), true);
    time.set(6_000);
    assert.equal(lifecycle.observe(JID, CALL_ID, 'accept'), true);
    const result = lifecycle.finish(CAPTURE_ID, JID, new Date(9_000));

    assert.deepEqual(result, {
        baselineAvailable: true,
        baselineStartedAt: new Date(1_000),
        baselineEndedAt: new Date(4_000),
        negotiationStartedAt: new Date(4_000),
        activeCallStartedAt: new Date(6_000),
        callEndedAt: null,
        captureEndedAt: new Date(9_000),
        phaseEvidenceVersion: 1,
        phaseEvidence: [
            { sequence: 1, kind: 'baseline_started', at: new Date(1_000), source: 'capture_start', confidence: 'system' },
            { sequence: 2, kind: 'negotiation_started', at: new Date(4_000), source: 'baileys_normalized', confidence: 'protocol', status: 'offer' },
            { sequence: 3, kind: 'active_started', at: new Date(6_000), source: 'baileys_normalized', confidence: 'protocol', status: 'accept' },
            { sequence: 4, kind: 'capture_ended', at: new Date(9_000), source: 'capture_stop', confidence: 'system' },
        ],
    });
    assert.equal(lifecycle.snapshot(), null);
});

test('automatic capture started by an offer declares that no prior baseline exists', () => {
    const time = clock(2_000);
    const lifecycle = new CallCapturePhaseLifecycle(time.now);

    assert.equal(lifecycle.start({
        captureCallId: CALL_ID,
        targetJid: JID,
        trigger: 'auto',
        observedCallId: CALL_ID,
        initialCallStatus: 'offer',
    }), true);

    assert.deepEqual(lifecycle.snapshot(), {
        baselineAvailable: false,
        baselineStartedAt: null,
        baselineEndedAt: null,
        negotiationStartedAt: new Date(2_000),
        activeCallStartedAt: null,
        callEndedAt: null,
        captureEndedAt: null,
        phaseEvidenceVersion: 1,
        phaseEvidence: [
            { sequence: 1, kind: 'negotiation_started', at: new Date(2_000), source: 'baileys_normalized', confidence: 'protocol', status: 'offer' },
        ],
    });
});

test('automatic capture started after accept records active call without inventing a baseline', () => {
    const time = clock(3_000);
    const lifecycle = new CallCapturePhaseLifecycle(time.now);

    lifecycle.start({
        captureCallId: CALL_ID,
        targetJid: JID,
        trigger: 'auto',
        observedCallId: CALL_ID,
        initialCallStatus: 'accept',
    });

    assert.deepEqual(lifecycle.snapshot(), {
        baselineAvailable: false,
        baselineStartedAt: null,
        baselineEndedAt: null,
        negotiationStartedAt: new Date(3_000),
        activeCallStartedAt: new Date(3_000),
        callEndedAt: null,
        captureEndedAt: null,
        phaseEvidenceVersion: 1,
        phaseEvidence: [
            { sequence: 1, kind: 'negotiation_started', at: new Date(3_000), source: 'baileys_normalized', confidence: 'protocol', status: 'accept' },
            { sequence: 2, kind: 'active_started', at: new Date(3_000), source: 'baileys_normalized', confidence: 'protocol', status: 'accept' },
        ],
    });
});

test('duplicates are idempotent and a different call cannot mutate the active lifecycle', () => {
    const time = clock(1_000);
    const lifecycle = new CallCapturePhaseLifecycle(time.now);
    lifecycle.start({ captureCallId: CAPTURE_ID, targetJid: JID, trigger: 'manual' });

    time.set(2_000);
    assert.equal(lifecycle.observe(JID, CALL_ID, 'offer'), true);
    time.set(3_000);
    assert.equal(lifecycle.observe(JID, CALL_ID, 'ringing'), true);
    assert.equal(lifecycle.observe(JID, 'CALL-OTHER', 'accept'), false);
    assert.equal(lifecycle.observe('573009999999@s.whatsapp.net', CALL_ID, 'accept'), false);

    const snapshot = lifecycle.snapshot();
    assert.equal(snapshot?.negotiationStartedAt?.getTime(), 2_000);
    assert.equal(snapshot?.activeCallStartedAt, null);
});

test('a late negotiation event cannot regress an active call phase', () => {
    const time = clock(1_000);
    const lifecycle = new CallCapturePhaseLifecycle(time.now);
    lifecycle.start({ captureCallId: CAPTURE_ID, targetJid: JID, trigger: 'manual' });
    time.set(2_000);
    assert.equal(lifecycle.observe(JID, CALL_ID, 'offer'), true);
    time.set(3_000);
    assert.equal(lifecycle.observe(JID, CALL_ID, 'accept'), true);
    time.set(4_000);
    assert.equal(lifecycle.observe(JID, CALL_ID, 'ringing'), false);

    assert.deepEqual(lifecycle.snapshot(), {
        baselineAvailable: true,
        baselineStartedAt: new Date(1_000),
        baselineEndedAt: new Date(2_000),
        negotiationStartedAt: new Date(2_000),
        activeCallStartedAt: new Date(3_000),
        callEndedAt: null,
        captureEndedAt: null,
        phaseEvidenceVersion: 1,
        phaseEvidence: [
            { sequence: 1, kind: 'baseline_started', at: new Date(1_000), source: 'capture_start', confidence: 'system' },
            { sequence: 2, kind: 'negotiation_started', at: new Date(2_000), source: 'baileys_normalized', confidence: 'protocol', status: 'offer' },
            { sequence: 3, kind: 'active_started', at: new Date(3_000), source: 'baileys_normalized', confidence: 'protocol', status: 'accept' },
        ],
    });
});

test('a clock regression cannot create an invalid phase order', () => {
    const time = clock(1_000);
    const lifecycle = new CallCapturePhaseLifecycle(time.now);
    lifecycle.start({ captureCallId: CAPTURE_ID, targetJid: JID, trigger: 'manual' });
    time.set(4_000);
    lifecycle.observe(JID, CALL_ID, 'offer');
    time.set(3_000);

    assert.equal(lifecycle.observe(JID, CALL_ID, 'accept'), false);
    assert.equal(lifecycle.snapshot()?.activeCallStartedAt, null);
});

test('finishing an immediate manual capture does not invent a zero-length baseline', () => {
    const time = clock(1_000);
    const lifecycle = new CallCapturePhaseLifecycle(time.now);
    lifecycle.start({ captureCallId: CAPTURE_ID, targetJid: JID, trigger: 'manual' });

    assert.deepEqual(lifecycle.finish(CAPTURE_ID, JID, new Date(1_000)), {
        baselineAvailable: false,
        baselineStartedAt: null,
        baselineEndedAt: null,
        negotiationStartedAt: null,
        activeCallStartedAt: null,
        callEndedAt: null,
        captureEndedAt: new Date(1_000),
        phaseEvidenceVersion: 1,
        phaseEvidence: [
            { sequence: 1, kind: 'capture_ended', at: new Date(1_000), source: 'capture_stop', confidence: 'system' },
        ],
    });
});

test('records protocol provenance and rejects phase progression after call end', () => {
    const time = clock(1_000);
    const lifecycle = new CallCapturePhaseLifecycle(time.now);
    lifecycle.start({ captureCallId: CAPTURE_ID, targetJid: JID, trigger: 'manual' });
    time.set(2_000);
    assert.equal(lifecycle.observe(JID, CALL_ID, 'transport', {
        source: 'baileys_raw',
        confidence: 'protocol',
    }), true);
    time.set(3_000);
    assert.equal(lifecycle.observe(JID, CALL_ID, 'terminate', {
        source: 'baileys_raw',
        confidence: 'protocol',
    }), true);
    time.set(4_000);
    assert.equal(lifecycle.observe(JID, CALL_ID, 'accept'), false);

    const snapshot = lifecycle.snapshot();
    assert.equal(snapshot?.callEndedAt?.getTime(), 3_000);
    assert.deepEqual(snapshot?.phaseEvidence?.map(event => ({
        kind: event.kind,
        source: event.source,
        confidence: event.confidence,
    })), [
        { kind: 'baseline_started', source: 'capture_start', confidence: 'system' },
        { kind: 'negotiation_started', source: 'baileys_raw', confidence: 'protocol' },
        { kind: 'call_ended', source: 'baileys_raw', confidence: 'protocol' },
    ]);
});

test('authorized operator markers create an ordered manual lifecycle without protocol claims', () => {
    const time = clock(1_000);
    const lifecycle = new CallCapturePhaseLifecycle(time.now);
    lifecycle.start({ captureCallId: CAPTURE_ID, targetJid: JID, trigger: 'manual' });

    assert.equal(lifecycle.markOperatorPhase(JID, 'call_connected'), false);
    time.set(2_000);
    assert.equal(lifecycle.markOperatorPhase(JID, 'call_started'), true);
    assert.equal(lifecycle.markOperatorPhase(JID, 'call_started'), true);
    time.set(4_000);
    assert.equal(lifecycle.markOperatorPhase(JID, 'call_connected'), true);
    time.set(7_000);
    assert.equal(lifecycle.markOperatorPhase(JID, 'call_ended'), true);
    assert.equal(lifecycle.markOperatorPhase(JID, 'call_ended'), true);
    assert.equal(lifecycle.markOperatorPhase(JID, 'call_connected'), false);

    assert.deepEqual(lifecycle.snapshot()?.phaseEvidence, [
        { sequence: 1, kind: 'baseline_started', at: new Date(1_000), source: 'capture_start', confidence: 'system' },
        { sequence: 2, kind: 'negotiation_started', at: new Date(2_000), source: 'operator_marker', confidence: 'operator_asserted' },
        { sequence: 3, kind: 'active_started', at: new Date(4_000), source: 'operator_marker', confidence: 'operator_asserted' },
        { sequence: 4, kind: 'call_ended', at: new Date(7_000), source: 'operator_marker', confidence: 'operator_asserted' },
    ]);
});

test('operator markers reject automatic captures, foreign contacts, and clock regression', () => {
    const time = clock(2_000);
    const automatic = new CallCapturePhaseLifecycle(time.now);
    automatic.start({ captureCallId: CALL_ID, targetJid: JID, trigger: 'auto' });
    assert.equal(automatic.markOperatorPhase(JID, 'call_started'), false);

    const manual = new CallCapturePhaseLifecycle(time.now);
    manual.start({ captureCallId: CAPTURE_ID, targetJid: JID, trigger: 'manual' });
    assert.equal(manual.markOperatorPhase('573009999999@s.whatsapp.net', 'call_started'), false);
    time.set(3_000);
    assert.equal(manual.markOperatorPhase(JID, 'call_started'), true);
    time.set(2_500);
    assert.equal(manual.markOperatorPhase(JID, 'call_connected'), false);
});

test('packet classification separates baseline traffic from the call window', () => {
    const phases = {
        baselineAvailable: true,
        baselineStartedAt: new Date(1_000),
        baselineEndedAt: new Date(4_000),
        negotiationStartedAt: new Date(4_000),
        activeCallStartedAt: new Date(6_000),
    };

    assert.equal(classifyCapturePacketPhase(new Date(2_000), phases), 'baseline');
    assert.equal(classifyCapturePacketPhase(new Date(4_000), phases), 'call');
    assert.equal(classifyCapturePacketPhase(new Date(7_000), phases), 'call');
    assert.equal(classifyCapturePacketPhase(new Date(2_000), undefined), 'call');
});
