import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CONCLUSIVE_TRACKER_STATE_REGEX,
    ONLINE_TRACKER_STATE_REGEX,
    classifyTrackerState,
    getScopedPresenceEntries,
    hasAcknowledgedTrackerRtt,
    isConclusiveTrackerState,
    isNoAckState,
    jidBelongsToTarget,
    normalizeComparableJid,
    selectPrimaryTrackerDevice,
    shouldPersistTrackerMeasurement,
    summarizeTrackerStates,
    TRACKER_STATE_CATEGORY,
} from '../src/tracker-signals.js';

test('normalizes device JIDs without crossing WhatsApp namespaces', () => {
    assert.equal(normalizeComparableJid('573001112233:17@s.whatsapp.net'), '573001112233@s.whatsapp.net');
    assert.equal(normalizeComparableJid('123456:2@lid'), '123456@lid');
    assert.equal(normalizeComparableJid('invalid'), null);
});

test('matches the target account and known devices only', () => {
    const target = '573001112233@s.whatsapp.net';
    const knownLid = '123456@lid';
    assert.equal(jidBelongsToTarget('573001112233:4@s.whatsapp.net', target), true);
    assert.equal(jidBelongsToTarget('573009998877@s.whatsapp.net', target), false);
    assert.equal(jidBelongsToTarget('123456:2@lid', target, [knownLid]), true);
    assert.equal(jidBelongsToTarget('654321@lid', target, [knownLid]), false);
});

test('rejects presence events owned by another tracked contact', () => {
    const target = '573001112233@s.whatsapp.net';
    const foreignUpdate = {
        id: '573009998877@s.whatsapp.net',
        presences: {
            '573009998877:2@s.whatsapp.net': { lastKnownPresence: 'available' },
        },
    };

    assert.deepEqual(getScopedPresenceEntries(foreignUpdate, target, [target]), []);
});

test('accepts target devices and technical LIDs only inside the scoped event', () => {
    const target = '573001112233@s.whatsapp.net';
    const update = {
        id: target,
        presences: {
            '573001112233:3@s.whatsapp.net': { lastKnownPresence: 'composing' },
            '123456:7@lid': { lastKnownPresence: 'available' },
            '573009998877@s.whatsapp.net': { lastKnownPresence: 'recording' },
        },
    };

    assert.deepEqual(
        getScopedPresenceEntries(update, target, [target]).map(([jid]) => jid),
        ['573001112233:3@s.whatsapp.net', '123456:7@lid'],
    );
});

test('rejects an unscoped unknown LID and accepts a previously attributed LID', () => {
    const target = '573001112233@s.whatsapp.net';
    const lid = '123456@lid';
    const update = {
        presences: {
            '123456:7@lid': { lastKnownPresence: 'available' },
        },
    };

    assert.deepEqual(getScopedPresenceEntries(update, target, [target]), []);
    assert.deepEqual(
        getScopedPresenceEntries(update, target, [target, lid]).map(([jid]) => jid),
        ['123456:7@lid'],
    );
});

test('does not persist initial or empty tracker updates', () => {
    assert.equal(shouldPersistTrackerMeasurement({ sampleKind: 'initial', devices: [], median: 0 }), false);
    assert.equal(shouldPersistTrackerMeasurement({ sampleKind: 'probe', devices: [], median: 0 }), false);
    assert.equal(shouldPersistTrackerMeasurement({ sampleKind: 'probe', devices: [{ state: 'Online' }], median: 80 }), true);
    assert.equal(shouldPersistTrackerMeasurement({ sampleKind: 'probe', devices: [{}], median: 80 }), false);
    assert.equal(shouldPersistTrackerMeasurement({ sampleKind: 'probe', devices: [{}], median: Number.NaN }), false);
});

test('recognizes new and legacy no-ack states', () => {
    assert.equal(isNoAckState('NO_ACK'), true);
    assert.equal(isNoAckState('OFFLINE'), true);
    assert.equal(isNoAckState('Standby'), false);
});

test('does not let the legacy OFFLINE state match online Mongo filters', () => {
    assert.equal(ONLINE_TRACKER_STATE_REGEX.test('Online'), true);
    assert.equal(ONLINE_TRACKER_STATE_REGEX.test('Online (Active)'), true);
    assert.equal(ONLINE_TRACKER_STATE_REGEX.test('OFFLINE'), false);
    assert.equal(CONCLUSIVE_TRACKER_STATE_REGEX.test('Standby'), true);
    assert.equal(CONCLUSIVE_TRACKER_STATE_REGEX.test('NO_ACK'), false);
    assert.equal(CONCLUSIVE_TRACKER_STATE_REGEX.test('OFFLINE'), false);
});

test('classifies tracker states without treating calibration or unknown values as standby', () => {
    assert.equal(classifyTrackerState('Online'), TRACKER_STATE_CATEGORY.ONLINE);
    assert.equal(classifyTrackerState('Online (Active)'), TRACKER_STATE_CATEGORY.ONLINE);
    assert.equal(classifyTrackerState('Standby'), TRACKER_STATE_CATEGORY.STANDBY);
    assert.equal(classifyTrackerState('Calibrating...'), TRACKER_STATE_CATEGORY.CALIBRATING);
    assert.equal(classifyTrackerState('OFFLINE'), TRACKER_STATE_CATEGORY.NO_ACK);
    assert.equal(classifyTrackerState('unexpected-state'), TRACKER_STATE_CATEGORY.UNKNOWN);
    assert.equal(classifyTrackerState(null), TRACKER_STATE_CATEGORY.UNKNOWN);
});

test('summarizes every persisted state in one explicit bucket', () => {
    assert.deepEqual(
        summarizeTrackerStates(['Online', 'Standby', 'Calibrating...', 'NO_ACK', 'OFFLINE', 'unexpected-state']),
        { online: 1, standby: 1, calibrating: 1, noAck: 2, unknown: 1, total: 6 },
    );
});

test('selects one primary device consistently by state confidence', () => {
    const devices = [
        { jid: 'no-ack', state: 'NO_ACK', rtt: 10_000 },
        { jid: 'standby', state: 'Standby', rtt: 180 },
        { jid: 'online', state: 'Online', rtt: 70 },
    ];

    assert.deepEqual(selectPrimaryTrackerDevice(devices), devices[2]);
    assert.equal(isConclusiveTrackerState('Online'), true);
    assert.equal(isConclusiveTrackerState('Standby'), true);
    assert.equal(isConclusiveTrackerState('Calibrating...'), false);
    assert.equal(isConclusiveTrackerState('NO_ACK'), false);
    assert.equal(hasAcknowledgedTrackerRtt('Calibrating...'), true);
    assert.equal(hasAcknowledgedTrackerRtt('NO_ACK'), false);
});
