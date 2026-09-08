import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPresenceCoverageSummary } from '../src/presence-coverage.js';

const at = (minute: number) => new Date(Date.UTC(2026, 8, 2, 12, minute));

test('calculates covered and interrupted time from confirmed windows', () => {
    const summary = buildPresenceCoverageSummary(at(0), at(30), [
        { startedAt: at(2), lastConfirmedAt: at(10), endedAt: at(10) },
        { startedAt: at(15), lastConfirmedAt: at(25), endedAt: at(25) },
    ]);

    assert.equal(summary.elapsedMs, 30 * 60_000);
    assert.equal(summary.coveredMs, 18 * 60_000);
    assert.equal(summary.interruptedMs, 12 * 60_000);
    assert.equal(summary.coveragePct, 60);
    assert.equal(summary.windowCount, 2);
    assert.equal(summary.interruptionCount, 3);
    assert.equal(summary.currentState, 'interrupted');
});

test('uses last confirmation rather than now for an open window', () => {
    const summary = buildPresenceCoverageSummary(at(0), at(30), [
        { startedAt: at(0), lastConfirmedAt: at(20), endedAt: null },
    ]);

    assert.equal(summary.coveredMs, 20 * 60_000);
    assert.equal(summary.interruptedMs, 10 * 60_000);
    assert.equal(summary.currentState, 'observing');
    assert.deepEqual(summary.lastObservedAt, at(20));
});

test('merges overlapping windows so coverage never exceeds elapsed time', () => {
    const summary = buildPresenceCoverageSummary(at(0), at(30), [
        { startedAt: at(0), lastConfirmedAt: at(20), endedAt: at(20) },
        { startedAt: at(10), lastConfirmedAt: at(30), endedAt: at(30) },
    ]);

    assert.equal(summary.coveredMs, 30 * 60_000);
    assert.equal(summary.coveragePct, 100);
    assert.equal(summary.interruptionCount, 0);
});

test('returns an explicit empty interrupted session without inventing coverage', () => {
    const summary = buildPresenceCoverageSummary(at(0), at(30), []);
    assert.equal(summary.coveredMs, 0);
    assert.equal(summary.coveragePct, 0);
    assert.equal(summary.interruptionCount, 1);
    assert.equal(summary.firstObservedAt, null);
    assert.equal(summary.currentState, 'interrupted');
});

test('rejects an invalid observation interval', () => {
    assert.throws(() => buildPresenceCoverageSummary(at(30), at(0), []), /valid non-negative/);
});
