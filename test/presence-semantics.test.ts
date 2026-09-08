import test from 'node:test';
import assert from 'node:assert/strict';
import {
    closesObservedPresence,
    classifyObservedPresenceScope,
    formatObservedPresenceLabel,
    isActiveObservedPresence,
    normalizeObservedPresence,
    observedPresenceTtlMs,
    summarizeObservedPresenceGroups,
} from '../src/presence-semantics.js';

test('accepts only the five supported Baileys presence values', () => {
    assert.equal(normalizeObservedPresence(' available '), 'available');
    assert.equal(normalizeObservedPresence('recording'), 'recording');
    assert.equal(normalizeObservedPresence('offline'), null);
    assert.equal(normalizeObservedPresence(null), null);
});

test('separates active observations from closing signals without claiming offline', () => {
    assert.equal(isActiveObservedPresence('available'), true);
    assert.equal(isActiveObservedPresence('composing'), true);
    assert.equal(closesObservedPresence('unavailable'), true);
    assert.equal(closesObservedPresence('paused'), true);
    assert.equal(closesObservedPresence('available'), false);
    assert.equal(formatObservedPresenceLabel('unavailable'), 'Presencia no disponible');
    assert.equal(formatObservedPresenceLabel('paused').includes('Offline'), false);
});

test('uses bounded freshness windows for every presence observation', () => {
    assert.equal(observedPresenceTtlMs('available'), 45_000);
    assert.equal(observedPresenceTtlMs('composing'), 12_000);
    assert.equal(observedPresenceTtlMs('recording'), 12_000);
    assert.equal(observedPresenceTtlMs('paused'), 12_000);
    assert.equal(observedPresenceTtlMs('unavailable'), 12_000);
});

test('separates ambient availability from direct chat signals', () => {
    assert.equal(classifyObservedPresenceScope('available'), 'availability');
    assert.equal(classifyObservedPresenceScope('unavailable'), 'availability');
    assert.equal(classifyObservedPresenceScope('composing'), 'direct_chat');
    assert.equal(classifyObservedPresenceScope('recording'), 'direct_chat');
    assert.equal(classifyObservedPresenceScope('paused'), 'direct_chat');
    assert.equal(classifyObservedPresenceScope('offline'), null);

    assert.deepEqual(summarizeObservedPresenceGroups([
        { type: 'available', count: 3 },
        { type: 'unavailable', count: 2 },
        { type: 'composing', count: 4 },
        { type: 'recording', count: 1 },
        { type: 'paused', count: 1 },
        { type: 'offline', count: 20 },
        { type: 'available', count: -1 },
    ]), {
        availabilitySignals: 5,
        available: 3,
        unavailable: 2,
        directChatSignals: 6,
        composing: 4,
        recording: 1,
        paused: 1,
    });
});
