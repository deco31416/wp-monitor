import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommercialCallActivity } from '../src/call-activity.js';

const baseSignal = {
    confidence: 'medium' as const,
    timestampUtc: '2026-09-01T21:44:00.000Z',
};

test('collapses protocol and relay signals into one inconclusive call', () => {
    const result = buildCommercialCallActivity([
        { ...baseSignal, type: 'offer', confidence: 'high', timestamp: '2026-09-01T21:44:00.000Z' },
        {
            ...baseSignal,
            type: 'relaylatency',
            timestamp: '2026-09-01T21:44:02.000Z',
            details: { latencyMs: 84, isVideo: false },
        },
        { ...baseSignal, type: 'terminate', timestamp: '2026-09-01T21:44:05.000Z' },
    ]);

    assert.equal(result?.type, 'call_ended_unconfirmed');
    assert.equal(result?.label, 'Llamada finalizada · respuesta no confirmada');
    assert.equal(result?.call.signalCount, 3);
    assert.equal(result?.call.technicalSignalCount, 1);
    assert.equal(result?.call.relayLatencyMs, 84);
    assert.equal(result?.call.direction, 'incoming');
    assert.equal(result?.call.durationSec, null);
});

test('classifies an accepted and terminated call with confirmed duration', () => {
    const result = buildCommercialCallActivity([
        { ...baseSignal, type: 'terminate', timestamp: '2026-09-01T21:44:42.000Z' },
        { ...baseSignal, type: 'offer', confidence: 'high', timestamp: '2026-09-01T21:44:00.000Z' },
        { ...baseSignal, type: 'accept', confidence: 'high', timestamp: '2026-09-01T21:44:12.000Z' },
    ]);

    assert.equal(result?.type, 'call_completed');
    assert.equal(result?.label, 'Llamada contestada y finalizada');
    assert.equal(result?.confidence, 'high');
    assert.equal(result?.call.evidence, 'protocol_confirmed');
    assert.equal(result?.call.durationSec, 30);
});

test('uses explicit terminal outcomes instead of inferring an answer', () => {
    const rejected = buildCommercialCallActivity([
        { ...baseSignal, type: 'offer', timestamp: '2026-09-01T21:44:00.000Z' },
        { ...baseSignal, type: 'reject', timestamp: '2026-09-01T21:44:03.000Z' },
    ]);
    const missed = buildCommercialCallActivity([
        { ...baseSignal, type: 'offer', timestamp: '2026-09-01T21:44:00.000Z' },
        { ...baseSignal, type: 'timeout', timestamp: '2026-09-01T21:44:30.000Z' },
    ]);

    assert.equal(rejected?.type, 'call_rejected');
    assert.equal(missed?.type, 'call_missed');
});

test('does not manufacture commercial activity from internal-only signals', () => {
    const result = buildCommercialCallActivity([
        { ...baseSignal, type: 'transport', timestamp: '2026-09-01T21:44:00.000Z' },
        { ...baseSignal, type: 'relaylatency', timestamp: '2026-09-01T21:44:01.000Z' },
    ]);

    assert.equal(result, null);
});
