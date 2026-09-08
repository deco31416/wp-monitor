import test from 'node:test';
import assert from 'node:assert/strict';
import type { BaileysEventMap } from 'baileys';
import {
    BaileysPresenceObserver,
    type LearnedPresenceAlias,
    type ObservedPresenceTransition,
    type ObservedTechnicalDestination,
} from '../src/baileys-presence-observer.js';

const TARGET = '573001112233@s.whatsapp.net';

function update(value: unknown): BaileysEventMap['presence.update'] {
    return value as BaileysEventMap['presence.update'];
}

function fixture() {
    const transitions: ObservedPresenceTransition[] = [];
    const aliases: LearnedPresenceAlias[] = [];
    const devices: ObservedTechnicalDestination[] = [];
    const observer = new BaileysPresenceObserver({
        onPresence: value => { transitions.push(value); },
        onAliasLearned: value => { aliases.push(value); },
        onNewDevice: value => { devices.push(value); },
        now: () => 1_788_284_800_000,
    });
    return { observer, transitions, aliases, devices };
}

test('routes one scoped presence transition and learns technical destinations', async () => {
    const { observer, transitions, aliases, devices } = fixture();
    observer.activate(TARGET);
    const result = await observer.handleUpdate(update({
        id: TARGET,
        presences: {
            '573001112233:3@s.whatsapp.net': {
                lastKnownPresence: 'composing',
                lastSeen: 1_788_284_700,
            },
            '123456:7@lid': { lastKnownPresence: 'available' },
            '573009998877@s.whatsapp.net': { lastKnownPresence: 'recording' },
        },
    }));

    assert.deepEqual(transitions, [{
        jid: TARGET,
        presence: 'composing',
        timestamp: 1_788_284_800_000,
        lastSeen: 1_788_284_700,
    }]);
    assert.deepEqual(aliases.map(value => value.jid), [
        '573001112233:3@s.whatsapp.net',
        '123456:7@lid',
    ]);
    assert.equal(devices.length, 1);
    assert.equal(devices[0]?.totalDevices, 2);
    assert.equal(observer.getTechnicalDestinationCount(TARGET), 2);
    assert.deepEqual(result, {
        rawEntries: 3,
        activeContexts: 1,
        resolvedAliases: 0,
        attributedContexts: 1,
        scopedEntries: 2,
        unsupportedTransitions: 0,
        duplicateTransitions: 0,
        attemptedTransitions: 1,
        acceptedTransitions: 1,
        rejectedTransitions: 0,
    });
});

test('reports sanitized routing counters for an unmatched presence update', async () => {
    const { observer } = fixture();
    observer.activate(TARGET);
    const result = await observer.handleUpdate(update({
        id: '573009998877@s.whatsapp.net',
        presences: {
            '573009998877@s.whatsapp.net': { lastKnownPresence: 'composing' },
        },
    }));

    assert.deepEqual(result, {
        rawEntries: 1,
        activeContexts: 1,
        resolvedAliases: 0,
        attributedContexts: 0,
        scopedEntries: 0,
        unsupportedTransitions: 0,
        duplicateTransitions: 0,
        attemptedTransitions: 0,
        acceptedTransitions: 0,
        rejectedTransitions: 0,
    });
});

test('attributes LID presence through the authenticated active-contact resolver', async () => {
    const transitions: ObservedPresenceTransition[] = [];
    const aliases: LearnedPresenceAlias[] = [];
    const observer = new BaileysPresenceObserver({
        resolveTrackedJid: value => String(value).includes('123456') ? TARGET : null,
        onPresence: value => { transitions.push(value); },
        onAliasLearned: value => { aliases.push(value); },
        onNewDevice: () => undefined,
        now: () => 1_788_284_800_000,
    });
    observer.activate(TARGET);

    const result = await observer.handleUpdate(update({
        id: '123456@lid',
        presences: {
            '123456:7@lid': { lastKnownPresence: 'recording' },
        },
    }));

    assert.deepEqual(transitions, [{
        jid: TARGET,
        presence: 'recording',
        timestamp: 1_788_284_800_000,
    }]);
    assert.deepEqual(aliases, [{ jid: '123456@lid', targetJid: TARGET }]);
    assert.equal(result.resolvedAliases, 1);
    assert.equal(result.attributedContexts, 1);
    assert.equal(result.acceptedTransitions, 1);
});

test('does not attribute a LID resolved to another or inactive contact', async () => {
    const transitions: ObservedPresenceTransition[] = [];
    const observer = new BaileysPresenceObserver({
        resolveTrackedJid: () => '573009998877@s.whatsapp.net',
        onPresence: value => { transitions.push(value); },
        onAliasLearned: () => undefined,
        onNewDevice: () => undefined,
    });
    observer.activate(TARGET);

    const result = await observer.handleUpdate(update({
        id: '123456@lid',
        presences: {
            '123456:7@lid': { lastKnownPresence: 'composing' },
        },
    }));

    assert.deepEqual(transitions, []);
    assert.equal(result.resolvedAliases, 0);
    assert.equal(result.attributedContexts, 0);
    assert.equal(result.acceptedTransitions, 0);
});

test('deduplicates equal states and rejects foreign contact updates', async () => {
    const { observer, transitions } = fixture();
    observer.activate(TARGET);
    const scoped = update({
        id: TARGET,
        presences: { [TARGET]: { lastKnownPresence: 'available' } },
    });

    await observer.handleUpdate(scoped);
    await observer.handleUpdate(scoped);
    await observer.handleUpdate(update({
        id: '573009998877@s.whatsapp.net',
        presences: {
            '573009998877@s.whatsapp.net': { lastKnownPresence: 'recording' },
        },
    }));

    assert.equal(transitions.length, 1);
    assert.equal(observer.getLastPresence(TARGET), 'available');
});

test('recognizes an unscoped LID only after it was learned in a scoped event', async () => {
    const { observer, transitions } = fixture();
    observer.activate(TARGET);
    await observer.handleUpdate(update({
        presences: { '123456:7@lid': { lastKnownPresence: 'available' } },
    }));
    assert.equal(transitions.length, 0);

    await observer.handleUpdate(update({
        id: TARGET,
        presences: { '123456:7@lid': { lastKnownPresence: 'available' } },
    }));
    await observer.handleUpdate(update({
        presences: { '123456:9@lid': { lastKnownPresence: 'recording' } },
    }));

    assert.deepEqual(transitions.map(value => value.presence), ['available', 'recording']);
});

test('deactivation clears state and prevents later attribution', async () => {
    const { observer, transitions } = fixture();
    assert.equal(observer.activate(TARGET), true);
    assert.equal(observer.activate(TARGET), false);
    assert.equal(observer.deactivate(TARGET), true);
    assert.equal(observer.deactivate(TARGET), false);

    await observer.handleUpdate(update({
        id: TARGET,
        presences: { [TARGET]: { lastKnownPresence: 'available' } },
    }));
    assert.deepEqual(transitions, []);
    assert.equal(observer.getLastPresence(TARGET), null);
});

test('allows the same state to be observed again after its freshness expires', async () => {
    const { observer, transitions } = fixture();
    observer.activate(TARGET);
    const available = update({
        id: TARGET,
        presences: { [TARGET]: { lastKnownPresence: 'available' } },
    });

    await observer.handleUpdate(available);
    assert.equal(observer.expire(TARGET, 'recording'), false);
    assert.equal(observer.expire(TARGET, 'available'), true);
    await observer.handleUpdate(available);
    await observer.handleUpdate(update({
        id: TARGET,
        presences: { [TARGET]: { lastKnownPresence: 'offline' } },
    }));

    assert.deepEqual(transitions.map(value => value.presence), ['available', 'available']);
});

test('rolls back local dedupe when durable presence handling rejects the transition', async () => {
    let attempts = 0;
    const observer = new BaileysPresenceObserver({
        onPresence: () => {
            attempts += 1;
            return attempts > 1;
        },
        onAliasLearned: () => undefined,
        onNewDevice: () => undefined,
    });
    observer.activate(TARGET);
    const available = update({
        id: TARGET,
        presences: { [TARGET]: { lastKnownPresence: 'available' } },
    });

    await observer.handleUpdate(available);
    assert.equal(observer.getLastPresence(TARGET), null);
    await observer.handleUpdate(available);
    assert.equal(observer.getLastPresence(TARGET), 'available');
    assert.equal(attempts, 2);
});
