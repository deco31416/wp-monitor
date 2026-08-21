import test from 'node:test';
import assert from 'node:assert/strict';
import { isSyntheticProbeMessage, registerSyntheticProbeId } from '../src/probe-messages.js';

test('identifies a synthetic reaction from its registered reference id', () => {
    const now = 1_000;
    registerSyntheticProbeId('FAKE-REFERENCE-001', now);

    assert.equal(isSyntheticProbeMessage({
        key: { id: 'ENVELOPE-001' },
        message: {
            reactionMessage: {
                key: { id: 'FAKE-REFERENCE-001' },
            },
        },
    }, now + 1), true);
});

test('identifies a synthetic message from its registered envelope id', () => {
    const now = 2_000;
    registerSyntheticProbeId('PROBE-ENVELOPE-002', now);

    assert.equal(isSyntheticProbeMessage({
        key: { id: 'PROBE-ENVELOPE-002' },
        message: { conversation: 'synthetic test payload' },
    }, now + 1), true);
});

test('does not classify an unrelated user reaction as a probe', () => {
    assert.equal(isSyntheticProbeMessage({
        key: { id: 'USER-ENVELOPE-003' },
        message: {
            reactionMessage: {
                key: { id: 'REAL-MESSAGE-003' },
            },
        },
    }, 3_000), false);
});

test('expires probe identifiers instead of retaining them indefinitely', () => {
    const now = 4_000;
    registerSyntheticProbeId('EXPIRED-PROBE-004', now);

    assert.equal(isSyntheticProbeMessage({ key: { id: 'EXPIRED-PROBE-004' } }, now + 60_001), false);
});
