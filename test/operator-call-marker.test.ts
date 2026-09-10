import assert from 'node:assert/strict';
import test from 'node:test';
import {
    getOperatorCallMarkerDisposition,
    matchesActiveOperatorCallMarkerScope,
} from '../src/operator-call-marker.js';

const active = {
    caseId: 'CASE-001',
    targetJid: '573001112233@s.whatsapp.net',
    callId: 'manual-001',
};

test('operator marker scope requires the exact active case, contact, and capture', () => {
    assert.equal(matchesActiveOperatorCallMarkerScope(active, {
        ...active,
        marker: 'call_started',
    }), true);

    for (const request of [
        { ...active, caseId: 'CASE-OTHER', marker: 'call_started' as const },
        { ...active, targetJid: '573009999999@s.whatsapp.net', marker: 'call_started' as const },
        { ...active, callId: 'manual-stale', marker: 'call_started' as const },
    ]) {
        assert.equal(matchesActiveOperatorCallMarkerScope(active, request), false);
    }
    assert.equal(matchesActiveOperatorCallMarkerScope(null, {
        ...active,
        marker: 'call_started',
    }), false);
});

test('operator marker transitions are monotonic, idempotent, and allow unanswered calls', () => {
    assert.equal(getOperatorCallMarkerDisposition(undefined, 'call_started'), 'advance');
    assert.equal(getOperatorCallMarkerDisposition(undefined, 'call_connected'), 'reject');
    assert.equal(getOperatorCallMarkerDisposition('call_started', 'call_started'), 'idempotent');
    assert.equal(getOperatorCallMarkerDisposition('call_started', 'call_connected'), 'advance');
    assert.equal(getOperatorCallMarkerDisposition('call_started', 'call_ended'), 'advance');
    assert.equal(getOperatorCallMarkerDisposition('call_connected', 'call_started'), 'reject');
    assert.equal(getOperatorCallMarkerDisposition('call_connected', 'call_ended'), 'advance');
    assert.equal(getOperatorCallMarkerDisposition('call_ended', 'call_ended'), 'idempotent');
});
