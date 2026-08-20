import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivityEventDoc, buildObservationScope } from '../src/db.js';

test('builds case-scoped observation queries without changing legacy contact-wide queries', () => {
    assert.deepEqual(buildObservationScope('synthetic-contact@s.whatsapp.net', 'CASE-UNIT-001'), {
        jid: 'synthetic-contact@s.whatsapp.net',
        caseId: 'CASE-UNIT-001',
    });
    assert.deepEqual(buildObservationScope('synthetic-contact@s.whatsapp.net'), {
        jid: 'synthetic-contact@s.whatsapp.net',
    });
});

test('retains case and tracking session provenance in persisted activity events', () => {
    const event = buildActivityEventDoc({
        caseId: 'CASE-UNIT-001',
        trackingSessionId: 'tracking-unit-001',
        jid: 'synthetic-contact@s.whatsapp.net',
        source: 'presence',
        type: 'available',
        label: 'Online',
        confidence: 'high',
        timestamp: '2026-08-19T12:00:00.000Z',
    });

    assert.equal(event.caseId, 'CASE-UNIT-001');
    assert.equal(event.trackingSessionId, 'tracking-unit-001');
    assert.equal(event.timestampUtc, '2026-08-19T12:00:00.000Z');
});
