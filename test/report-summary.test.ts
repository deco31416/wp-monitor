import test from 'node:test';
import assert from 'node:assert/strict';
import { buildObservationWindow } from '../src/db.js';

test('calculates a passive-only observation window without requiring RTT', () => {
    const result = buildObservationWindow(
        null,
        null,
        new Date('2026-08-21T17:50:00.000Z'),
        new Date('2026-08-21T18:12:30.000Z'),
    );

    assert.equal(result.firstSeen?.toISOString(), '2026-08-21T17:50:00.000Z');
    assert.equal(result.lastSeen?.toISOString(), '2026-08-21T18:12:30.000Z');
    assert.equal(result.durationMs, 1_350_000);
    assert.equal(result.label, '0h 22m');
});

test('uses the complete technical and passive boundary set', () => {
    const result = buildObservationWindow(
        new Date('2026-08-21T18:00:00.000Z'),
        new Date('2026-08-21T19:00:00.000Z'),
        new Date('2026-08-21T17:00:00.000Z'),
        new Date('2026-08-22T20:30:00.000Z'),
    );

    assert.equal(result.firstSeen?.toISOString(), '2026-08-21T17:00:00.000Z');
    assert.equal(result.lastSeen?.toISOString(), '2026-08-22T20:30:00.000Z');
    assert.equal(result.label, '1d 3h');
});

test('returns a stable empty observation window', () => {
    assert.deepEqual(buildObservationWindow(null, null, null, null), {
        firstSeen: null,
        lastSeen: null,
        durationMs: 0,
        label: '0h 0m',
    });
});
