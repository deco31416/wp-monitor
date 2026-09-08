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
    });
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
